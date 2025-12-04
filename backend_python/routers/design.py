from fastapi import APIRouter, HTTPException, Response, Body
from fastapi.responses import StreamingResponse
from store import store
from utils.algorithms import generate_smart_layout, generate_roadways
from utils.mining_rules import MiningRules, DEFAULT_MINING_RULES
from utils.geology_analysis import GeologyAnalyzer
import ezdxf
from ezdxf import colors
from ezdxf.enums import TextEntityAlignment
from io import BytesIO, StringIO
from typing import Dict, Any
import traceback
import math

router = APIRouter()


def setup_mining_layers(doc):
    """
    设置符合煤矿CAD制图规范的图层
    参考《煤矿采掘工程平面图》GB/T 12719-2021
    """
    layers_config = [
        # 边界类
        ('采区边界', 7, 'CONTINUOUS', 0.5),      # 白色，粗实线
        ('保护煤柱', 8, 'DASHED', 0.35),         # 灰色，虚线

        # 巷道类 - 按照煤矿规范
        ('主要巷道', 3, 'CONTINUOUS', 0.7),      # 绿色，粗实线 - 主运输大巷
        ('回风巷道', 1, 'CONTINUOUS', 0.5),      # 红色，中实线 - 回风大巷
        ('运输巷道', 4, 'CONTINUOUS', 0.35),     # 青色，细实线 - 顺槽运输巷
        ('回采巷道', 6, 'CONTINUOUS', 0.35),     # 紫色，细实线 - 顺槽回风巷
        ('开切眼', 5, 'CONTINUOUS', 0.35),       # 蓝色，细实线
        ('联络巷', 8, 'CONTINUOUS', 0.25),       # 灰色，细实线

        # 工作面类
        ('回采工作面', 2, 'CONTINUOUS', 0.5),    # 黄色，中实线
        ('工作面边界', 1, 'CONTINUOUS', 0.35),   # 红色，细实线
        ('已采区', 8, 'CONTINUOUS', 0.25),       # 灰色填充区

        # 钻孔类
        ('钻孔', 4, 'CONTINUOUS', 0.25),         # 青色
        ('钻孔标注', 7, 'CONTINUOUS', 0.18),     # 白色

        # 标注类
        ('尺寸标注', 7, 'CONTINUOUS', 0.18),     # 白色
        ('文字标注', 7, 'CONTINUOUS', 0.25),     # 白色
        ('图框', 7, 'CONTINUOUS', 0.5),          # 白色
    ]

    # 添加线型
    doc.linetypes.add('DASHED', pattern=[0.5, -0.25], description='Dashed line')
    doc.linetypes.add('CENTER', pattern=[1.25, -0.25, 0.25, -0.25], description='Center line')

    for name, color, linetype, lineweight in layers_config:
        if name not in doc.layers:
            layer = doc.layers.add(name=name)
            layer.color = color
            layer.linetype = linetype if linetype in doc.linetypes else 'CONTINUOUS'
            # lineweight in mm * 100
            layer.dxf.lineweight = int(lineweight * 100)

    return doc


def add_roadway_with_width(msp, path, width, layer, doc):
    """
    绘制带宽度的巷道（双线表示）
    煤矿CAD规范：巷道用双线表示，线间距代表巷道宽度
    """
    if len(path) < 2:
        return

    # 计算巷道中心线的偏移
    half_width = width / 2

    left_points = []
    right_points = []

    for i in range(len(path)):
        if i == 0:
            # 起点：使用第一段的方向
            dx = path[1][0] - path[0][0]
            dy = path[1][1] - path[0][1]
        elif i == len(path) - 1:
            # 终点：使用最后一段的方向
            dx = path[-1][0] - path[-2][0]
            dy = path[-1][1] - path[-2][1]
        else:
            # 中间点：使用前后两段的平均方向
            dx = path[i+1][0] - path[i-1][0]
            dy = path[i+1][1] - path[i-1][1]

        length = math.sqrt(dx*dx + dy*dy)
        if length > 0:
            # 法向量（垂直于前进方向）
            nx = -dy / length
            ny = dx / length
        else:
            nx, ny = 0, 1

        # 左右边线点
        left_points.append((path[i][0] + nx * half_width, path[i][1] + ny * half_width))
        right_points.append((path[i][0] - nx * half_width, path[i][1] - ny * half_width))

    # 绘制左边线
    msp.add_lwpolyline(left_points, dxfattribs={'layer': layer})
    # 绘制右边线
    msp.add_lwpolyline(right_points, dxfattribs={'layer': layer})

    # 添加端部封闭线（巷道交叉口不封闭，这里简化处理只封闭端点）
    # msp.add_line(left_points[0], right_points[0], dxfattribs={'layer': layer})
    # msp.add_line(left_points[-1], right_points[-1], dxfattribs={'layer': layer})


def add_workface_hatch(msp, points, doc, layer='回采工作面'):
    """
    添加工作面填充图案
    煤矿规范：已采区用斜线填充
    """
    if len(points) < 3:
        return

    try:
        # 创建填充
        hatch = msp.add_hatch(color=2, dxfattribs={'layer': layer})  # 黄色
        hatch.set_pattern_fill('ANSI31', scale=0.5)  # 斜线填充

        # 添加边界路径
        coords = [(p[0], p[1]) for p in points]
        if coords[0] != coords[-1]:
            coords.append(coords[0])
        hatch.paths.add_polyline_path(coords)
    except Exception as e:
        print(f"填充创建失败: {e}")


def add_dimension(msp, start, end, offset, text, layer='尺寸标注'):
    """
    添加尺寸标注
    """
    try:
        # 计算标注线位置
        dx = end[0] - start[0]
        dy = end[1] - start[1]
        length = math.sqrt(dx*dx + dy*dy)

        if length > 0:
            # 法向量
            nx = -dy / length
            ny = dx / length

            # 标注点
            dim_start = (start[0] + nx * offset, start[1] + ny * offset)
            dim_end = (end[0] + nx * offset, end[1] + ny * offset)

            # 绘制标注线
            msp.add_line(dim_start, dim_end, dxfattribs={'layer': layer})

            # 延长线
            msp.add_line(start, dim_start, dxfattribs={'layer': layer})
            msp.add_line(end, dim_end, dxfattribs={'layer': layer})

            # 标注文字
            mid = ((dim_start[0] + dim_end[0]) / 2, (dim_start[1] + dim_end[1]) / 2)
            angle = math.degrees(math.atan2(dy, dx))

            msp.add_text(
                text,
                dxfattribs={
                    'layer': layer,
                    'height': 3,
                    'rotation': angle if -90 < angle < 90 else angle + 180
                }
            ).set_placement(mid, align=TextEntityAlignment.MIDDLE_CENTER)
    except Exception as e:
        print(f"标注创建失败: {e}")


@router.get("/export/dxf")
async def export_dxf():
    """
    导出符合煤矿CAD制图规范的DXF文件
    """
    try:
        if not store.design_result:
            raise HTTPException(status_code=400, detail="请先生成设计方案")

        # 创建DXF文档，使用AutoCAD 2010格式以获得更好兼容性
        doc = ezdxf.new(dxfversion='R2010')
        msp = doc.modelspace()

        # 设置图层
        setup_mining_layers(doc)

        # 设置文字样式
        doc.styles.add('MINING', font='simhei.ttf')  # 黑体

        # ========== 绘制采区边界 ==========
        if store.boundary:
            points = [(p['x'], p['y']) for p in store.boundary]
            if points:
                points.append(points[0])  # 闭合
                # 采区边界 - 粗实线
                msp.add_lwpolyline(
                    points,
                    dxfattribs={
                        'layer': '采区边界',
                        'const_width': 0.5  # 线宽
                    }
                )

                # 添加边界标注
                msp.add_text(
                    '采区边界',
                    dxfattribs={
                        'layer': '文字标注',
                        'height': 8,
                        'style': 'MINING'
                    }
                ).set_placement((points[0][0], points[0][1] + 15))

        # ========== 绘制钻孔 ==========
        if store.boreholes:
            for b in store.boreholes:
                x, y = b['x'], b['y']
                bh_id = b.get('id', 'BH')

                # 钻孔符号：同心圆（符合规范）
                msp.add_circle((x, y), radius=3, dxfattribs={'layer': '钻孔'})
                msp.add_circle((x, y), radius=1.5, dxfattribs={'layer': '钻孔'})
                msp.add_point((x, y), dxfattribs={'layer': '钻孔'})

                # 钻孔编号
                msp.add_text(
                    bh_id,
                    dxfattribs={
                        'layer': '钻孔标注',
                        'height': 4,
                        'style': 'MINING'
                    }
                ).set_placement((x + 5, y + 2))

                # 如果有煤厚数据，标注
                coal_thick = b.get('coalThickness', b.get('thickness'))
                if coal_thick:
                    msp.add_text(
                        f'M={coal_thick:.1f}m',
                        dxfattribs={
                            'layer': '钻孔标注',
                            'height': 3
                        }
                    ).set_placement((x + 5, y - 5))

        # ========== 绘制巷道 ==========
        roadways = store.design_result.get("roadways", [])
        if roadways:
            # 巷道宽度配置（米）
            roadway_widths = {
                'main': 5.0,       # 主运输大巷
                'ventilation': 4.5, # 回风大巷
                'transport': 4.0,   # 运输顺槽
                'return': 4.0,      # 回风顺槽
                'cut': 6.0,         # 开切眼（较宽）
                'gate': 3.5         # 联络巷
            }

            for r in roadways:
                road_path = r.get('path', [])
                if len(road_path) >= 2:
                    path = [(pt['x'], pt['y']) for pt in road_path]
                    road_type = r.get('type', 'gate')
                    road_name = r.get('name', r.get('id', ''))

                    # 确定图层和宽度
                    if road_type == 'main':
                        layer = '主要巷道'
                        width = roadway_widths['main']
                    elif road_type == 'ventilation':
                        layer = '回风巷道'
                        width = roadway_widths['ventilation']
                    elif road_type == 'transport':
                        layer = '运输巷道'
                        width = roadway_widths['transport']
                    elif road_type in ['return']:
                        layer = '回采巷道'
                        width = roadway_widths['return']
                    elif road_type == 'cut':
                        layer = '开切眼'
                        width = roadway_widths['cut']
                    else:
                        layer = '联络巷'
                        width = roadway_widths['gate']

                    # 绘制双线巷道
                    add_roadway_with_width(msp, path, width, layer, doc)

                    # 巷道中心线（用于标注）
                    # msp.add_lwpolyline(path, dxfattribs={'layer': layer, 'linetype': 'CENTER'})

                    # 添加巷道名称标注
                    mid_x = (path[0][0] + path[-1][0]) / 2
                    mid_y = (path[0][1] + path[-1][1]) / 2

                    # 计算文字角度
                    dx = path[-1][0] - path[0][0]
                    dy = path[-1][1] - path[0][1]
                    angle = math.degrees(math.atan2(dy, dx))
                    if angle < -90 or angle > 90:
                        angle += 180

                    # 主巷道标注更大
                    text_height = 6 if road_type == 'main' else 4

                    msp.add_text(
                        road_name,
                        dxfattribs={
                            'layer': '文字标注',
                            'height': text_height,
                            'rotation': angle,
                            'style': 'MINING'
                        }
                    ).set_placement((mid_x, mid_y + width), align=TextEntityAlignment.MIDDLE_CENTER)

        # ========== 绘制工作面 ==========
        panels = store.design_result.get("panels", []) or store.design_result.get("workfaces", [])
        if panels:
            for idx, p in enumerate(panels):
                panel_points = p.get('points', [])
                if panel_points:
                    points = [(pt['x'], pt['y']) for pt in panel_points]

                    is_valid = p.get('isValid', True)
                    layer = '工作面边界' if is_valid else '工作面边界'

                    # 工作面边界线
                    closed_points = points + [points[0]]
                    msp.add_lwpolyline(
                        closed_points,
                        dxfattribs={
                            'layer': layer,
                            'const_width': 0.35
                        }
                    )

                    # 工作面填充（斜线表示回采区）
                    # add_workface_hatch(msp, points, doc)

                    # 工作面编号标注
                    center_x = p.get('center_x', sum(pt[0] for pt in points) / len(points))
                    center_y = p.get('center_y', sum(pt[1] for pt in points) / len(points))

                    wf_id = p.get('id', f'WF-{idx+1:02d}')

                    # 工作面名称（较大字体）
                    msp.add_text(
                        wf_id,
                        dxfattribs={
                            'layer': '文字标注',
                            'height': 8,
                            'style': 'MINING'
                        }
                    ).set_placement((center_x, center_y), align=TextEntityAlignment.MIDDLE_CENTER)

                    # 工作面参数标注
                    face_len = p.get('faceLength', p.get('length', 0))
                    advance_len = p.get('advanceLength', p.get('width', 0))
                    score = p.get('avgScore', 0)

                    info_text = f'工作面长度:{face_len:.0f}m'
                    msp.add_text(
                        info_text,
                        dxfattribs={
                            'layer': '文字标注',
                            'height': 4
                        }
                    ).set_placement((center_x, center_y - 12))

                    info_text2 = f'推进长度:{advance_len:.0f}m'
                    msp.add_text(
                        info_text2,
                        dxfattribs={
                            'layer': '文字标注',
                            'height': 4
                        }
                    ).set_placement((center_x, center_y - 20))

                    # 不符合规程的警告
                    if not is_valid:
                        msg = p.get('validationMsg', '不符合规程')
                        msp.add_text(
                            f'※{msg}',
                            dxfattribs={
                                'layer': '文字标注',
                                'height': 3,
                                'color': 1  # 红色
                            }
                        ).set_placement((center_x, center_y - 28))

        # ========== 添加图例和图框 ==========
        # 计算图纸范围
        all_points = []
        if store.boundary:
            all_points.extend([(p['x'], p['y']) for p in store.boundary])

        if all_points:
            min_x = min(p[0] for p in all_points) - 100
            min_y = min(p[1] for p in all_points) - 100
            max_x = max(p[0] for p in all_points) + 100
            max_y = max(p[1] for p in all_points) + 100

            # 图例位置（右下角）
            legend_x = max_x - 80
            legend_y = min_y + 20

            # 图例框
            msp.add_lwpolyline([
                (legend_x, legend_y),
                (legend_x + 70, legend_y),
                (legend_x + 70, legend_y + 80),
                (legend_x, legend_y + 80),
                (legend_x, legend_y)
            ], dxfattribs={'layer': '图框'})

            msp.add_text('图 例', dxfattribs={'layer': '文字标注', 'height': 5}).set_placement(
                (legend_x + 35, legend_y + 72), align=TextEntityAlignment.MIDDLE_CENTER)

            # 图例项
            legend_items = [
                ('主运输大巷', '主要巷道', legend_y + 58),
                ('回风大巷', '回风巷道', legend_y + 46),
                ('运输顺槽', '运输巷道', legend_y + 34),
                ('开切眼', '开切眼', legend_y + 22),
                ('工作面', '工作面边界', legend_y + 10),
            ]

            for name, layer_name, y in legend_items:
                # 示例线
                msp.add_line((legend_x + 5, y), (legend_x + 25, y), dxfattribs={'layer': layer_name})
                # 文字
                msp.add_text(name, dxfattribs={'layer': '文字标注', 'height': 3}).set_placement((legend_x + 28, y - 1))

            # 添加比例尺
            scale_y = min_y + 10
            scale_len = 100  # 100米
            msp.add_line((min_x + 20, scale_y), (min_x + 20 + scale_len, scale_y), dxfattribs={'layer': '图框'})
            msp.add_line((min_x + 20, scale_y - 2), (min_x + 20, scale_y + 2), dxfattribs={'layer': '图框'})
            msp.add_line((min_x + 20 + scale_len, scale_y - 2), (min_x + 20 + scale_len, scale_y + 2), dxfattribs={'layer': '图框'})
            msp.add_text(f'{scale_len}m', dxfattribs={'layer': '文字标注', 'height': 4}).set_placement(
                (min_x + 20 + scale_len/2, scale_y + 5), align=TextEntityAlignment.MIDDLE_CENTER)

            # 添加标题
            title_x = (min_x + max_x) / 2
            title_y = max_y - 20
            msp.add_text(
                '采区工作面布置图',
                dxfattribs={
                    'layer': '文字标注',
                    'height': 15,
                    'style': 'MINING'
                }
            ).set_placement((title_x, title_y), align=TextEntityAlignment.MIDDLE_CENTER)

            # 统计信息
            stats = store.design_result.get('stats', {})
            if stats:
                info_y = max_y - 45
                info_lines = [
                    f"工作面数量: {stats.get('count', len(panels))} 个",
                    f"平均工作面长度: {stats.get('avgFaceLength', 0):.0f} m",
                    f"平均推进长度: {stats.get('avgAdvanceLength', 0):.0f} m",
                    f"开采方式: {stats.get('miningMethod', '长壁后退式')}"
                ]
                for i, line in enumerate(info_lines):
                    msp.add_text(
                        line,
                        dxfattribs={'layer': '文字标注', 'height': 4}
                    ).set_placement((min_x + 20, info_y - i * 8))

        # 导出到内存流
        stream = BytesIO()
        doc.write(stream)
        stream.seek(0)

        return StreamingResponse(
            stream,
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": "attachment; filename=mining_design.dxf",
                "Access-Control-Expose-Headers": "Content-Disposition"
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"DXF 导出错误: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"DXF 导出失败: {str(e)}")


@router.post("/")
async def generate_design(params: Dict[str, Any] = Body(...)):
    if not store.boundary:
        raise HTTPException(status_code=400, detail="缺少边界数据")

    # 使用归一化方法获取数据副本，不修改原始数据
    normalized_boundary = store.get_normalized_boundary()
    normalized_boreholes = store.get_normalized_boreholes()

    # 获取基本参数
    face_width = params.get("faceWidth", 200.0)
    pillar_width = params.get("pillarWidth", 20.0)
    boundary_margin = params.get("boundaryMargin", 30.0)
    user_edits = params.get("userEdits", {})
    manual_roadways = user_edits.get("roadways", [])

    # 获取规程参数
    rules_params = params.get("miningRules", {})

    # 构建规程配置
    mining_rules = MiningRules()

    # 工作面长度约束
    if 'faceLength' in rules_params:
        fl = rules_params['faceLength']
        mining_rules.face_length_min = fl.get('min', mining_rules.face_length_min)
        mining_rules.face_length_max = fl.get('max', mining_rules.face_length_max)
        mining_rules.face_length_preferred = fl.get('preferred', mining_rules.face_length_preferred)

    # 推进长度约束
    if 'advanceLength' in rules_params:
        al = rules_params['advanceLength']
        mining_rules.advance_length_min = al.get('min', mining_rules.advance_length_min)
        mining_rules.advance_length_max = al.get('max', mining_rules.advance_length_max)
        mining_rules.advance_length_preferred = al.get('preferred', mining_rules.advance_length_preferred)

    # 煤柱约束
    if 'sectionPillar' in rules_params:
        sp = rules_params['sectionPillar']
        mining_rules.section_pillar_preferred = sp.get('preferred', mining_rules.section_pillar_preferred)

    if 'boundaryPillar' in rules_params:
        bp = rules_params['boundaryPillar']
        boundary_margin = bp.get('preferred', boundary_margin)

    # 布置方向
    if 'layoutDirection' in rules_params:
        mining_rules.layout_direction = rules_params['layoutDirection']

    # 获取煤层倾角（可能从前端传入，或从地质数据计算）
    dip_angle = params.get("dipAngle", 0)
    dip_direction = params.get("dipDirection", 0)
    target_seam = params.get("targetSeam", None)

    # 如果有钻孔地质数据，创建地质分析器
    geology_analyzer = None
    if normalized_boreholes and len(normalized_boreholes) > 0:
        # 简化版：使用已有的钻孔数据创建分析器
        geology_analyzer = _create_simple_geology_analyzer(normalized_boreholes)

    print(f"设计参数:")
    print(f"  - 推进长度: {face_width}m")
    print(f"  - 区段煤柱: {pillar_width}m")
    print(f"  - 边界煤柱: {boundary_margin}m")
    print(f"  - 工作面长度范围: {mining_rules.face_length_min}-{mining_rules.face_length_max}m")
    print(f"  - 布置方向: {mining_rules.layout_direction}")
    print(f"  - 煤层倾角: {dip_angle}°, 倾向: {dip_direction}°")

    # 生成设计（使用归一化后的边界）
    result = generate_smart_layout(
        boundary_points=normalized_boundary,
        dip_angle=dip_angle,
        dip_direction=dip_direction,
        face_width=float(face_width),
        pillar_width=float(pillar_width),
        boundary_margin=float(boundary_margin),
        manual_roadways=manual_roadways,
        mining_rules=mining_rules,
        geology_analyzer=geology_analyzer,
        target_seam=target_seam
    )

    panels = result.get("workfaces", [])
    roadways = result.get("roadways", [])
    stats = result.get("stats", {})

    print(f"生成 {len(panels)} 个工作面，{len(roadways)} 条巷道")

    # 保存结果
    store.design_result = {
        "panels": panels,
        "roadways": roadways,
        "stats": stats,
        "designParams": {
            "workfaceWidth": face_width,
            "pillarWidth": pillar_width,
            "boundaryMargin": boundary_margin,
            "miningRules": mining_rules.to_dict()
        }
    }

    return {
        "success": True,
        "panels": panels,
        "roadways": roadways,
        "boundary": normalized_boundary,
        "boreholes": normalized_boreholes,
        "stats": stats,
        "designParams": {
            "workfaceWidth": face_width,
            "pillarWidth": pillar_width,
            "boundaryMargin": boundary_margin
        },
        "miningRules": mining_rules.to_dict()
    }


@router.get("/")
async def get_design():
    return store.design_result or {}


@router.get("/rules")
async def get_mining_rules():
    """获取默认的采矿规程参数"""
    return DEFAULT_MINING_RULES.to_dict()


@router.post("/validate")
async def validate_design(params: Dict[str, Any] = Body(...)):
    """验证设计方案是否符合规程"""
    if not store.design_result:
        raise HTTPException(status_code=400, detail="请先生成设计方案")

    panels = store.design_result.get("panels", [])
    rules = MiningRules.from_dict(params.get("miningRules", {}))

    validation_results = []
    for panel in panels:
        result = {
            "id": panel["id"],
            "issues": []
        }

        # 验证工作面长度
        length = panel.get("length", 0)
        valid, msg = rules.validate_face_length(length)
        if not valid:
            result["issues"].append(msg)

        # 验证推进长度
        width = panel.get("width", 0)
        valid, msg = rules.validate_advance_length(width)
        if not valid:
            result["issues"].append(msg)

        result["isValid"] = len(result["issues"]) == 0
        validation_results.append(result)

    valid_count = sum(1 for r in validation_results if r["isValid"])

    return {
        "totalPanels": len(panels),
        "validPanels": valid_count,
        "invalidPanels": len(panels) - valid_count,
        "details": validation_results
    }


def _create_simple_geology_analyzer(boreholes: list) -> GeologyAnalyzer:
    """
    从简单钻孔数据创建地质分析器

    这是一个简化版本，主要用于评分计算
    """
    from utils.geology_analysis import GeologyAnalyzer, BoreholeGeology, CoalSeamInfo

    analyzer = GeologyAnalyzer()

    for bh in boreholes:
        borehole = BoreholeGeology(
            id=bh.get('id', 'unknown'),
            x=bh.get('x', 0),
            y=bh.get('y', 0)
        )

        # 如果有煤厚数据，创建一个虚拟煤层
        coal_thickness = bh.get('coalThickness', bh.get('thickness', 3.0))
        if coal_thickness:
            seam = CoalSeamInfo(
                name="主采煤层",
                thickness=float(coal_thickness),
                depth=100,  # 默认深度
                roof_rock="砂岩",  # 默认顶板
                roof_thickness=5,
                floor_rock="泥岩",  # 默认底板
                floor_thickness=3
            )
            borehole.coal_seams.append(seam)

        analyzer.add_borehole(borehole)

    return analyzer
