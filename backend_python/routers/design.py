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
        points = [(p['x'], p['y']) for p in store.boundary]
        if points:
            points.append(points[0]) # 闭合
            msp.add_lwpolyline(points, dxfattribs={'color': 7}) # 白色
            
    # 绘制工作面
    panels = store.design_result.get("panels", [])
    for p in panels:
        points = [(pt['x'], pt['y']) for pt in p['points']]
        if points:
            points.append(points[0])
            msp.add_lwpolyline(points, dxfattribs={'color': 1}) # 红色
            # 添加文字
            msp.add_text(p['id'], dxfattribs={'height': 5}).set_placement((p['center_x'], p['center_y']))
            
    # 绘制巷道
    roadways = store.design_result.get("roadways", [])
    for r in roadways:
        path = [(pt['x'], pt['y']) for pt in r['path']]
        msp.add_lwpolyline(path, dxfattribs={'color': 3}) # 绿色
        
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
    
    # 获取参数
    face_width = params.get("faceWidth", 150.0)
    pillar_width = params.get("pillarWidth", 20.0)
    
    # 1. 智能生成工作面
    result = generate_smart_layout(
        boundary_points=store.boundary,
        dip_angle=0,
        dip_direction=0,
        face_width=float(face_width),
        pillar_width=float(pillar_width)
    )
    
    panels = result.get("workfaces", [])
    roadways = result.get("roadways", [])
    
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
