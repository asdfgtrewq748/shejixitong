"""
智能工作面布局算法

符合采矿规程的工作面设计，考虑：
1. 工作面长度约束 (150-300m)
2. 推进长度约束
3. 煤层倾角和布置方向
4. 地质条件评分
5. 煤柱宽度要求
"""

import numpy as np
from shapely.geometry import Polygon, Point, LineString, box, MultiPolygon
from shapely.affinity import rotate, translate
from shapely.ops import unary_union
from typing import List, Dict, Any, Tuple, Optional
from dataclasses import dataclass

from utils.mining_rules import MiningRules, DEFAULT_MINING_RULES
from utils.geology_analysis import GeologyAnalyzer


@dataclass
class WorkfaceCandidate:
    """工作面候选方案"""
    polygon: Polygon
    center_x: float
    center_y: float
    length: float        # 工作面长度 (沿走向)
    width: float         # 推进长度 (沿倾向)
    area: float
    score: float = 0
    is_valid: bool = True
    validation_msg: str = ""


def create_polygon_from_points(points: List[Dict[str, float]]) -> Polygon:
    """从点列表创建 Shapely 多边形"""
    if not points or len(points) < 3:
        return Polygon()

    coords = [(p['x'], p['y']) for p in points]
    if coords[0] != coords[-1]:
        coords.append(coords[0])
    return Polygon(coords)


def generate_smart_layout(
        boundary_points: List[Dict[str, float]],
        dip_angle: float,
        dip_direction: float,
        face_width: float,
        pillar_width: float,
        boundary_margin: float = 30.0,
        manual_roadways: List[Dict] = None,
        mining_rules: MiningRules = None,
        geology_analyzer: GeologyAnalyzer = None,
        target_seam: str = None
) -> Dict[str, Any]:
    """
    智能工作面布局生成

    Args:
        boundary_points: 采区边界点
        dip_angle: 煤层倾角 (度)
        dip_direction: 煤层倾向 (度)
        face_width: 工作面宽度/推进长度 (用户指定)
        pillar_width: 煤柱宽度
        boundary_margin: 边界煤柱宽度
        manual_roadways: 手动绘制的巷道
        mining_rules: 采矿规程参数
        geology_analyzer: 地质分析器 (用于评分)
        target_seam: 目标煤层名称

    Returns:
        包含工作面和巷道的设计结果
    """
    # 使用默认规程参数
    if mining_rules is None:
        mining_rules = DEFAULT_MINING_RULES

    # 1. 创建采区边界多边形
    boundary_poly = create_polygon_from_points(boundary_points)

    if not boundary_poly.is_valid:
        print("Warning: Invalid boundary polygon, attempting to fix...")
        boundary_poly = boundary_poly.buffer(0)

    total_area = boundary_poly.area
    print(f"采区总面积: {total_area:.0f} m²")

    # 2. 内缩边界（预留边界煤柱）
    mining_area = boundary_poly.buffer(-boundary_margin)

    # 处理 buffer 返回 MultiPolygon 的情况（复杂边界内缩可能产生多个独立区域）
    if mining_area.geom_type == 'MultiPolygon':
        # 选择面积最大的多边形作为主要可采区
        mining_area = max(mining_area.geoms, key=lambda g: g.area)
        print(f"警告：内缩后产生多个区域，选择最大区域继续")

    if mining_area.is_empty or not hasattr(mining_area, 'area') or mining_area.area < 1000:
        print("可采区面积过小!")
        return {"workfaces": [], "roadways": [], "stats": {"error": "可采区面积过小"}}

    print(f"可采区面积: {mining_area.area:.0f} m²")

    # 3. 确定布局方向
    # 优先使用手动巷道方向，其次使用煤层倾向，最后自动检测
    rotation_angle = 0
    layout_info = ""

    if manual_roadways and len(manual_roadways) > 0:
        # 使用手动巷道作为基准
        main_road = manual_roadways[0]
        path = main_road.get('path', [])
        if len(path) >= 2:
            p1 = path[0]
            p2 = path[-1]
            dx = p2['x'] - p1['x']
            dy = p2['y'] - p1['y']
            rotation_angle = -np.degrees(np.arctan2(dy, dx))
            layout_info = f"使用手动巷道方向: {-rotation_angle:.1f}°"
    elif dip_direction != 0:
        # 使用煤层倾向
        # 走向长壁：工作面沿走向布置，推进方向沿倾向
        # 倾向长壁：工作面沿倾向布置，推进方向沿走向
        if mining_rules.layout_direction == 'strike':
            # 走向长壁：旋转使工作面方向与走向平行
            strike_direction = (dip_direction + 90) % 360
            rotation_angle = -strike_direction
            layout_info = f"走向长壁布置，走向: {strike_direction:.1f}°"
        else:
            # 倾向长壁
            rotation_angle = -dip_direction
            layout_info = f"倾向长壁布置，倾向: {dip_direction:.1f}°"
    else:
        # 自动检测：使用最小外接矩形的长边作为工作面方向
        rotation_angle, auto_info = _auto_detect_direction(mining_area, mining_rules)
        layout_info = auto_info

    print(layout_info)

    # 4. 旋转采区到水平坐标系进行切割
    centroid = mining_area.centroid
    rotated_area = rotate(mining_area, rotation_angle, origin=centroid)
    min_x, min_y, max_x, max_y = rotated_area.bounds

    # 采区尺寸
    area_width = max_x - min_x   # 沿推进方向的尺寸
    area_length = max_y - min_y  # 沿工作面方向的尺寸

    print(f"采区尺寸: 宽度(推进方向)={area_width:.0f}m, 长度(工作面方向)={area_length:.0f}m")

    # 5. 确定工作面参数
    # 工作面长度 (沿y方向，即走向)
    face_length = _determine_face_length(area_length, mining_rules)

    # 推进长度/工作面宽度 (沿x方向，即倾向)
    # 这里 face_width 参数实际是推进长度
    advance_length = face_width

    # 区段煤柱宽度
    section_pillar = pillar_width if pillar_width else mining_rules.section_pillar_preferred

    print(f"设计参数: 工作面长度={face_length:.0f}m, 推进长度={advance_length:.0f}m, 区段煤柱={section_pillar:.0f}m")

    # 6. 生成工作面
    workfaces = []
    face_id = 1

    # 沿工作面方向（y方向）划分
    # 每个"条带"就是一个工作面
    current_y = min_y

    while current_y + face_length <= max_y + 1:  # 允许小误差
        # 确定这一条工作面的y范围
        strip_min_y = current_y
        strip_max_y = min(current_y + face_length, max_y)

        # 实际的工作面长度
        actual_length = strip_max_y - strip_min_y

        # 检查长度是否符合规程
        is_length_valid, length_msg = mining_rules.validate_face_length(actual_length)

        if actual_length < mining_rules.face_length_min * 0.8:
            # 长度太短，跳过或合并到上一个
            print(f"条带 {face_id} 长度 {actual_length:.0f}m 过短，跳过")
            current_y = strip_max_y + section_pillar
            continue

        # 创建这一条的候选矩形
        strip_rect = box(min_x, strip_min_y, max_x, strip_max_y)

        # 与可采区求交
        intersection = rotated_area.intersection(strip_rect)

        if intersection.is_empty:
            current_y = strip_max_y + section_pillar
            continue

        # 处理可能的多个部分，安全处理各种几何类型
        parts = []
        if intersection.geom_type == 'Polygon':
            parts = [intersection]
        elif intersection.geom_type in ('MultiPolygon', 'GeometryCollection'):
            parts = [g for g in intersection.geoms if g.geom_type == 'Polygon']
        # 其他类型（LineString, Point等）跳过

        for part in parts:
            if part.area < 500:
                continue

            # 获取这部分的边界
            part_min_x, part_min_y, part_max_x, part_max_y = part.bounds
            part_width = part_max_x - part_min_x
            part_length = part_max_y - part_min_y

            # 验证尺寸
            is_valid = True
            validation_msgs = []

            # 检查工作面长度
            length_valid, length_msg = mining_rules.validate_face_length(part_length)
            if not length_valid:
                validation_msgs.append(length_msg)
                # 长度不符合但仍可接受（边缘工作面）
                if part_length < mining_rules.face_length_min * 0.6:
                    is_valid = False

            # 检查推进长度
            # 推进长度是整个工作面的水平推进距离
            advance_valid, advance_msg = mining_rules.validate_advance_length(part_width)
            if not advance_valid:
                validation_msgs.append(advance_msg)

            # 旋转回原始坐标系
            original_shape = rotate(part, -rotation_angle, origin=centroid)
            bounds = original_shape.minimum_rotated_rectangle
            coords = list(bounds.exterior.coords)
            center = original_shape.centroid

            # 计算评分
            if geology_analyzer:
                score_data = geology_analyzer.calculate_score_at_point(
                    center.x, center.y, target_seam
                )
                avg_score = score_data['total_score']
            else:
                # 没有地质数据时，基于位置给一个基础分
                avg_score = 75 + (10 * (1 - face_id / 10))  # 靠前的工作面分数略高

            workface = {
                "id": f"WF-{face_id:02d}",
                "x": coords[0][0],
                "y": coords[0][1],
                "center_x": center.x,
                "center_y": center.y,
                "width": part_width,      # 推进长度
                "length": part_length,    # 工作面长度
                "area": part.area,
                "points": [{"x": x, "y": y} for x, y in coords[:-1]],
                "avgScore": round(avg_score, 1),
                "isValid": is_valid,
                "validationMsg": "; ".join(validation_msgs) if validation_msgs else "符合规程",
                "faceLength": round(part_length, 1),
                "advanceLength": round(part_width, 1)
            }

            workfaces.append(workface)
            face_id += 1

        # 移动到下一条（加上煤柱宽度）
        current_y = strip_max_y + section_pillar

    # 如果工作面数量太少，尝试调整参数
    if len(workfaces) == 0:
        print("警告：未能生成任何工作面，尝试降低约束...")
        # 降低约束重新生成
        return _generate_fallback_layout(
            boundary_points, rotated_area, rotation_angle, centroid,
            mining_rules, face_width, pillar_width
        )

    # 7. 生成巷道网络
    roadways = generate_roadways_v2(
        workfaces, boundary_points, rotation_angle, centroid, rotated_area,
        mining_rules
    )

    # 8. 统计信息
    valid_count = sum(1 for wf in workfaces if wf.get('isValid', True))
    total_workface_area = sum(wf['area'] for wf in workfaces)

    stats = {
        "totalArea": total_workface_area,
        "count": len(workfaces),
        "validCount": valid_count,
        "invalidCount": len(workfaces) - valid_count,
        "layoutDirection": layout_info,
        "avgFaceLength": round(np.mean([wf['length'] for wf in workfaces]), 1) if workfaces else 0,
        "avgAdvanceLength": round(np.mean([wf['width'] for wf in workfaces]), 1) if workfaces else 0,
        "avgScore": round(np.mean([wf['avgScore'] for wf in workfaces]), 1) if workfaces else 0,
        "miningMethod": f"{'走向' if mining_rules.layout_direction == 'strike' else '倾向'}长壁后退式开采"
    }

    print(f"生成 {len(workfaces)} 个工作面，有效 {valid_count} 个")

    return {
        "workfaces": workfaces,
        "roadways": roadways,
        "stats": stats
    }


def _auto_detect_direction(mining_area: Polygon, mining_rules: MiningRules) -> Tuple[float, str]:
    """
    自动检测最佳布局方向

    基于最小外接矩形，选择使工作面数量最优的方向
    """
    min_rect = mining_area.minimum_rotated_rectangle
    rect_coords = list(min_rect.exterior.coords)

    # 计算各边的长度和角度
    edges = []
    for i in range(len(rect_coords) - 1):
        p1 = rect_coords[i]
        p2 = rect_coords[i + 1]
        dx = p2[0] - p1[0]
        dy = p2[1] - p1[1]
        length = np.sqrt(dx ** 2 + dy ** 2)
        angle = np.degrees(np.arctan2(dy, dx))
        edges.append((length, angle))

    # 按长度排序
    edges.sort(key=lambda x: x[0], reverse=True)

    # 最长边作为推进方向（工作面沿短边布置）
    long_edge_angle = edges[0][1]
    short_edge_angle = edges[1][1] if len(edges) > 1 else long_edge_angle + 90

    # 工作面应沿短边方向布置，这样工作面长度在合理范围内
    # 推进方向沿长边
    rotation_angle = -long_edge_angle

    info = f"自动检测方向: 推进方向 {-rotation_angle:.1f}°"
    return rotation_angle, info


def _determine_face_length(available_length: float, mining_rules: MiningRules) -> float:
    """
    确定最佳工作面长度

    在规程允许范围内，尽量使工作面数量为整数
    """
    min_len = mining_rules.face_length_min
    max_len = mining_rules.face_length_max
    preferred = mining_rules.face_length_preferred
    pillar = mining_rules.section_pillar_preferred

    # 如果可用长度很小，直接使用
    if available_length <= max_len:
        return min(available_length, max_len)

    # 尝试不同的工作面长度，找到最优解
    best_length = preferred
    best_waste = float('inf')

    for test_length in range(int(min_len), int(max_len) + 1, 10):
        # 计算可以放置的工作面数量
        num_faces = int((available_length + pillar) / (test_length + pillar))
        if num_faces < 1:
            continue

        # 计算总占用
        total_used = num_faces * test_length + (num_faces - 1) * pillar
        waste = available_length - total_used

        if 0 <= waste < best_waste:
            best_waste = waste
            best_length = test_length

    return best_length


def _generate_fallback_layout(
        boundary_points: List[Dict],
        rotated_area: Polygon,
        rotation_angle: float,
        centroid: Point,
        mining_rules: MiningRules,
        face_width: float,
        pillar_width: float
) -> Dict[str, Any]:
    """
    当标准算法无法生成工作面时的后备方案

    降低约束，确保能生成至少一个工作面
    """
    print("使用后备布局方案...")

    # 安全检查
    if rotated_area is None or rotated_area.is_empty:
        print("错误：旋转区域为空")
        return {"workfaces": [], "roadways": [], "stats": {"error": "旋转区域为空", "miningMethod": "后备方案"}}

    min_x, min_y, max_x, max_y = rotated_area.bounds
    area_width = max_x - min_x
    area_height = max_y - min_y

    # 防止除零
    if area_height <= 0:
        print("错误：区域高度为零")
        return {"workfaces": [], "roadways": [], "stats": {"error": "区域高度为零", "miningMethod": "后备方案"}}

    workfaces = []

    # 简单地将整个区域作为一个或几个工作面
    num_faces = max(1, int(area_height / 200))
    face_height = area_height / num_faces

    for i in range(num_faces):
        strip_min_y = min_y + i * face_height
        strip_max_y = min_y + (i + 1) * face_height

        strip_rect = box(min_x, strip_min_y, max_x, strip_max_y)
        intersection = rotated_area.intersection(strip_rect)

        if intersection.is_empty or intersection.area < 100:
            continue

        # 安全处理非 Polygon 类型
        if intersection.geom_type == 'MultiPolygon':
            intersection = max(intersection.geoms, key=lambda g: g.area)
        elif intersection.geom_type == 'GeometryCollection':
            polygons = [g for g in intersection.geoms if g.geom_type == 'Polygon' and g.area > 100]
            if not polygons:
                continue
            intersection = max(polygons, key=lambda g: g.area)
        elif intersection.geom_type != 'Polygon':
            continue

        original_shape = rotate(intersection, -rotation_angle, origin=centroid)
        bounds = original_shape.minimum_rotated_rectangle
        coords = list(bounds.exterior.coords)
        center = original_shape.centroid

        workfaces.append({
            "id": f"WF-{i + 1:02d}",
            "x": coords[0][0],
            "y": coords[0][1],
            "center_x": center.x,
            "center_y": center.y,
            "width": area_width,
            "length": face_height,
            "area": intersection.area,
            "points": [{"x": x, "y": y} for x, y in coords[:-1]],
            "avgScore": 70,
            "isValid": False,
            "validationMsg": "后备方案生成，可能不符合规程"
        })

    roadways = generate_roadways_v2(
        workfaces, boundary_points, rotation_angle, centroid, rotated_area, mining_rules
    )

    return {
        "workfaces": workfaces,
        "roadways": roadways,
        "stats": {
            "totalArea": sum(wf['area'] for wf in workfaces),
            "count": len(workfaces),
            "miningMethod": "后备方案"
        }
    }


def generate_roadways_v2(
        workfaces: List[Dict],
        boundary_points: List[Dict],
        rotation_angle: float,
        centroid: Point,
        rotated_area: Polygon,
        mining_rules: MiningRules
) -> List[Dict]:
    """
    生成符合规程的巷道网络

    正确的布置方式（参考示意图）：
    - 大巷（运输大巷、回风大巷）：在采区左侧，垂直方向延伸
    - 顺槽（运输顺槽、回风顺槽）：从大巷水平伸出，在每个工作面的上下两侧
    - 工作面：水平方向是推进距离（长边），垂直方向是工作面长度（短边）
    - 开切眼：在工作面右侧（推进终点），连接上下两条顺槽

    布局示意：
        回风大巷  运输大巷
           │        │
           │        ├────── 运输顺槽 ──────┐
           │        │                      │
           │        │      工作面-01       │ 开切眼
           │        │                      │
           │        ├────── 回风顺槽 ──────┘
           │        │
           │        ├────── 运输顺槽 ──────┐
           │        │                      │
           │        │      工作面-02       │ 开切眼
           │        │                      │
           │        ├────── 回风顺槽 ──────┘
           │        │
           ↓        ↓
    """
    if not workfaces:
        return []

    # 安全检查：确保 centroid 存在
    if centroid is None:
        # 从工作面计算中心点
        avg_x = sum(wf['center_x'] for wf in workfaces) / len(workfaces)
        avg_y = sum(wf['center_y'] for wf in workfaces) / len(workfaces)
        centroid = Point(avg_x, avg_y)

    roadways = []

    # 将工作面中心点旋转到水平坐标系
    rotated_centers = []
    for wf in workfaces:
        p = Point(wf['center_x'], wf['center_y'])
        rp = rotate(p, rotation_angle, origin=centroid)
        rotated_centers.append({
            'x': rp.x,
            'y': rp.y,
            'id': wf['id'],
            'width': wf.get('width', 200),    # 推进距离（水平方向，长边），提供默认值
            'length': wf.get('length', 200)   # 工作面长度（垂直方向，短边），提供默认值
        })

    if not rotated_centers:
        return []

    # 工作面群的边界
    # width是推进距离（x方向），length是工作面长度（y方向）
    wf_min_x = min(p['x'] - p['width'] / 2 for p in rotated_centers)
    wf_max_x = max(p['x'] + p['width'] / 2 for p in rotated_centers)
    wf_min_y = min(p['y'] - p['length'] / 2 for p in rotated_centers)
    wf_max_y = max(p['y'] + p['length'] / 2 for p in rotated_centers)

    # 采区边界
    if rotated_area:
        area_bounds = rotated_area.bounds
        area_min_x = area_bounds[0]
    else:
        area_min_x = wf_min_x - 100

    # 大巷间距（运输大巷和回风大巷之间的距离）
    main_road_spacing = 15  # 两条大巷之间的间距

    # 大巷放在左侧，垂直延伸
    # 运输大巷在右（靠近工作面），回风大巷在左
    main_x = wf_min_x - 30  # 大巷距离工作面左边界的距离
    transport_main_x = main_x
    ventilation_main_x = main_x - main_road_spacing

    # 大巷的纵向范围：覆盖所有工作面，上下各延伸一些
    main_road_y_start = wf_min_y - 50
    main_road_y_end = wf_max_y + 50

    # 1. 运输大巷（垂直方向，在左侧靠近工作面）
    transport_start = Point(transport_main_x, main_road_y_start)
    transport_end = Point(transport_main_x, main_road_y_end)
    real_ts = rotate(transport_start, -rotation_angle, origin=centroid)
    real_te = rotate(transport_end, -rotation_angle, origin=centroid)

    roadways.append({
        "id": "Main-Transport",
        "name": "运输大巷",
        "type": "main",
        "path": [
            {"x": real_ts.x, "y": real_ts.y},
            {"x": real_te.x, "y": real_te.y}
        ],
        "length": transport_start.distance(transport_end)
    })

    # 2. 回风大巷（垂直方向，在左侧更远处）
    vent_start = Point(ventilation_main_x, main_road_y_start)
    vent_end = Point(ventilation_main_x, main_road_y_end)
    real_vs = rotate(vent_start, -rotation_angle, origin=centroid)
    real_ve = rotate(vent_end, -rotation_angle, origin=centroid)

    roadways.append({
        "id": "Main-Ventilation",
        "name": "回风大巷",
        "type": "ventilation",
        "path": [
            {"x": real_vs.x, "y": real_vs.y},
            {"x": real_ve.x, "y": real_ve.y}
        ],
        "length": vent_start.distance(vent_end)
    })

    # 3. 为每个工作面生成顺槽（水平方向，在工作面上下两侧）
    for i, wf in enumerate(rotated_centers):
        wf_id = wf['id']
        wf_x = wf['x']
        wf_y = wf['y']
        wf_half_len = wf['length'] / 2
        wf_half_width = wf['width'] / 2

        # 工作面的左边界（靠近大巷）和右边界
        wf_left_x = wf_x - wf_half_width
        wf_right_x = wf_x + wf_half_width

        # 运输顺槽：在工作面上方，从运输大巷水平延伸到工作面右边界
        # 位置：工作面上边界
        transport_lane_y = wf_y + wf_half_len
        transport_lane_start = Point(transport_main_x, transport_lane_y)
        transport_lane_end = Point(wf_right_x, transport_lane_y)
        real_tls = rotate(transport_lane_start, -rotation_angle, origin=centroid)
        real_tle = rotate(transport_lane_end, -rotation_angle, origin=centroid)

        roadways.append({
            "id": f"Transport-Lane-{i + 1}",
            "name": f"{wf_id}运输顺槽",
            "type": "transport",
            "workface": wf_id,
            "path": [
                {"x": real_tls.x, "y": real_tls.y},
                {"x": real_tle.x, "y": real_tle.y}
            ],
            "length": transport_lane_start.distance(transport_lane_end)
        })

        # 回风顺槽：在工作面下方，从运输大巷水平延伸到工作面右边界
        # 位置：工作面下边界
        return_lane_y = wf_y - wf_half_len
        return_lane_start = Point(transport_main_x, return_lane_y)
        return_lane_end = Point(wf_right_x, return_lane_y)
        real_rls = rotate(return_lane_start, -rotation_angle, origin=centroid)
        real_rle = rotate(return_lane_end, -rotation_angle, origin=centroid)

        roadways.append({
            "id": f"Return-Lane-{i + 1}",
            "name": f"{wf_id}回风顺槽",
            "type": "return",
            "workface": wf_id,
            "path": [
                {"x": real_rls.x, "y": real_rls.y},
                {"x": real_rle.x, "y": real_rle.y}
            ],
            "length": return_lane_start.distance(return_lane_end)
        })

        # 4. 开切眼：在工作面右侧（推进终点），垂直连接运输顺槽和回风顺槽
        cut_x = wf_right_x
        cut_start = Point(cut_x, return_lane_y)
        cut_end = Point(cut_x, transport_lane_y)
        real_cs = rotate(cut_start, -rotation_angle, origin=centroid)
        real_ce = rotate(cut_end, -rotation_angle, origin=centroid)

        roadways.append({
            "id": f"Cut-{i + 1}",
            "name": f"{wf_id}开切眼",
            "type": "cut",
            "workface": wf_id,
            "path": [
                {"x": real_cs.x, "y": real_cs.y},
                {"x": real_ce.x, "y": real_ce.y}
            ],
            "length": cut_start.distance(cut_end)
        })

    return roadways


# 保留旧函数签名以保持兼容性
def generate_roadways(workfaces: List[Dict], boundary_points: List[Dict],
                      rotation_angle: float = 0, centroid: Point = None,
                      rotated_area: Polygon = None) -> List[Dict]:
    """
    旧版巷道生成函数 - 保持向后兼容
    """
    return generate_roadways_v2(
        workfaces, boundary_points, rotation_angle, centroid, rotated_area,
        DEFAULT_MINING_RULES
    )
