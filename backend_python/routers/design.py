from fastapi import APIRouter, HTTPException, Response, Body
from store import store
from utils.algorithms import generate_smart_layout, generate_roadways
import ezdxf
from io import BytesIO
from typing import Dict, Any

router = APIRouter()

@router.get("/export/dxf")
async def export_dxf():
    if not store.design_result:
        raise HTTPException(status_code=400, detail="请先生成设计方案")
        
    doc = ezdxf.new()
    msp = doc.modelspace()
    
    # 绘制边界
    if store.boundary:
        # 创建图层
        doc.layers.new(name='BOUNDARY', dxfattribs={'color': 7})
        points = [(p['x'], p['y']) for p in store.boundary]
        if points:
            points.append(points[0]) # 闭合
            msp.add_lwpolyline(points, dxfattribs={'layer': 'BOUNDARY'})
            
    # 绘制钻孔 (新增)
    if store.boreholes:
        doc.layers.new(name='BOREHOLES', dxfattribs={'color': 4}) # 青色
        for b in store.boreholes:
            # 绘制圆圈
            msp.add_circle((b['x'], b['y']), radius=2, dxfattribs={'layer': 'BOREHOLES'})
            # 绘制文字
            msp.add_text(b['id'], dxfattribs={'height': 3, 'layer': 'BOREHOLES'}).set_placement((b['x'] + 3, b['y']))

    # 绘制工作面
    panels = store.design_result.get("panels", [])
    if panels:
        doc.layers.new(name='WORKFACES', dxfattribs={'color': 1}) # 红色
        for p in panels:
            points = [(pt['x'], pt['y']) for pt in p['points']]
            if points:
                points.append(points[0])
                msp.add_lwpolyline(points, dxfattribs={'layer': 'WORKFACES'})
                # 添加文字
                msp.add_text(p['id'], dxfattribs={'height': 5, 'layer': 'WORKFACES'}).set_placement((p['center_x'], p['center_y']))
            
    # 绘制巷道
    roadways = store.design_result.get("roadways", [])
    if roadways:
        doc.layers.new(name='ROADWAYS', dxfattribs={'color': 3}) # 绿色
        for r in roadways:
            path = [(pt['x'], pt['y']) for pt in r['path']]
            msp.add_lwpolyline(path, dxfattribs={'layer': 'ROADWAYS'})
        
    # 导出到内存
    out = BytesIO()
    doc.write(out)
    out.seek(0)
    
    return Response(
        content=out.getvalue(),
        media_type="application/dxf",
        headers={"Content-Disposition": "attachment; filename=mining_design.dxf"}
    )

@router.post("/")
async def generate_design(params: Dict[str, Any] = Body(...)):
    if not store.boundary:
        raise HTTPException(status_code=400, detail="缺少边界数据")
    
    # 坐标归一化处理
    if store.boundary:
        min_x = min(p['x'] for p in store.boundary)
        min_y = min(p['y'] for p in store.boundary)
        
        # 只有当坐标较大时才进行归一化，避免重复归一化
        if min_x > 100 or min_y > 100:
            print(f"Normalizing coordinates. Shift: {-min_x}, {-min_y}")
            # 更新 Store 中的数据为归一化坐标
            for p in store.boundary:
                p['x'] -= min_x
                p['y'] -= min_y
                
            if store.boreholes:
                for b in store.boreholes:
                    if 'x' in b and 'y' in b:
                        b['x'] -= min_x
                        b['y'] -= min_y
                        
            if store.borehole_coordinates:
                for c in store.borehole_coordinates:
                    if 'x' in c and 'y' in c:
                        c['x'] -= min_x
                        c['y'] -= min_y

    # 获取参数 (默认宽度改为 200)
    face_width = params.get("faceWidth", 200.0)
    pillar_width = params.get("pillarWidth", 20.0)
    user_edits = params.get("userEdits", {})
    manual_roadways = user_edits.get("roadways", [])
    
    # 1. 智能生成工作面
    print(f"Generating design with params: face_width={face_width}, pillar_width={pillar_width}")
    print(f"Boundary points count: {len(store.boundary)}")
    
    result = generate_smart_layout(
        boundary_points=store.boundary,
        dip_angle=0,
        dip_direction=0,
        face_width=float(face_width),
        pillar_width=float(pillar_width),
        manual_roadways=manual_roadways
    )
    
    panels = result.get("workfaces", [])
    roadways = result.get("roadways", [])
    
    print(f"Generated {len(panels)} panels and {len(roadways)} roadways")
    
    # 3. 保存结果
    store.design_result = {
        "panels": panels,
        "roadways": roadways,
        "designParams": {
            "workfaceWidth": face_width,
            "pillarWidth": pillar_width
        }
    }
    
    return {
        "success": True,
        "panels": panels,
        "roadways": roadways,
        "boundary": store.boundary, # 返回归一化后的边界
        "boreholes": store.boreholes, # 返回归一化后的钻孔
        "designParams": {
            "workfaceWidth": face_width,
            "pillarWidth": pillar_width
        },
        "stats": {
            "panelCount": len(panels),
            "totalRoadwayLength": sum(r['length'] for r in roadways)
        }
    }

@router.get("/")
async def get_design():
    return store.design_result or {}
