from fastapi import APIRouter, HTTPException
from store import store
import numpy as np
from scipy.interpolate import griddata

router = APIRouter()

@router.post("/")
async def generate_geology(resolution: int = 50):
    if not store.boreholes:
        raise HTTPException(status_code=400, detail="缺少钻孔数据")
        
    # 提取数据点
    points = []
    values = []
    
    for b in store.boreholes:
        if 'x' in b and 'y' in b and 'coalThickness' in b:
            points.append([b['x'], b['y']])
            values.append(b['coalThickness'])
            
    if len(points) < 3:
        raise HTTPException(status_code=400, detail="钻孔数据不足，无法生成模型")
        
    points = np.array(points)
    values = np.array(values)
    
    # 创建网格
    min_x, min_y = points.min(axis=0)
    max_x, max_y = points.max(axis=0)
    
    grid_x, grid_y = np.mgrid[min_x:max_x:complex(0, resolution), min_y:max_y:complex(0, resolution)]
    
    # 插值 (使用 cubic 插值，如果点太少会退化为 linear)
    try:
        grid_z = griddata(points, values, (grid_x, grid_y), method='cubic')
    except:
        grid_z = griddata(points, values, (grid_x, grid_y), method='linear')
        
    # 替换 NaN
    grid_z = np.nan_to_num(grid_z)
    
    # 保存结果
    store.geology_model = {
        "resolution": resolution,
        "minX": float(min_x),
        "minY": float(min_y),
        "maxX": float(max_x),
        "maxY": float(max_y),
        "data": grid_z.tolist()
    }
    
    return {"success": True, "model": store.geology_model}

@router.get("/")
async def get_geology():
    return store.geology_model or {}
