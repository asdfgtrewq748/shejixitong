from fastapi import APIRouter
from store import store
import pandas as pd
import numpy as np

router = APIRouter()

@router.post("/")
async def calculate_score():
    # 简单返回当前钻孔，实际应包含插值逻辑
    # 为了兼容前端，需要返回 grids 结构
    
    if not store.boreholes:
        return {"boreholes": []}
    
    # 使用归一化坐标（与设计模块保持一致）
    normalized_boundary = store.get_normalized_boundary()
    normalized_boreholes = store.get_normalized_boreholes()
    
    if not normalized_boreholes:
        return {"boreholes": []}
        
    # 生成简单的网格数据用于热力图
    df = pd.DataFrame(normalized_boreholes)
    min_x, max_x = df['x'].min(), df['x'].max()
    min_y, max_y = df['y'].min(), df['y'].max()
    
    resolution = 50
    cols = int((max_x - min_x) / resolution) + 1
    rows = int((max_y - min_y) / resolution) + 1
    
    # 模拟网格数据
    grid_data = np.random.randint(50, 100, size=(rows, cols)).tolist()
    
    grids = {
        "composite": {
            "data": grid_data,
            "minX": min_x,
            "minY": min_y,
            "stepX": resolution,
            "stepY": resolution,
            "resolution": resolution
        }
    }
    
    store.scores = {"grids": grids}
    
    # 返回归一化后的钻孔和边界数据
    return {
        "boreholes": normalized_boreholes,
        "boundary": normalized_boundary,
        "grids": grids,
        "contours": {} # 暂不生成等值线
    }

@router.get("/")
async def get_score():
    if not store.scores:
        return {}
    
    # 使用归一化坐标
    normalized_boreholes = store.get_normalized_boreholes()
    normalized_boundary = store.get_normalized_boundary()
    
    return {
        "boreholes": normalized_boreholes,
        "boundary": normalized_boundary,
        "grids": store.scores.get("grids", {}),
        "contours": {}
    }

@router.get("/grid/{type}")
async def get_score_grid(type: str):
    if not store.scores or "grids" not in store.scores:
        return {}
    return store.scores["grids"].get(type, {})
