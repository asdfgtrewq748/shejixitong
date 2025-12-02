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
        
    # 生成简单的网格数据用于热力图
    df = pd.DataFrame(store.boreholes)
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
    
    return {
        "boreholes": store.boreholes,
        "grids": grids,
        "contours": {} # 暂不生成等值线
    }

@router.get("/")
async def get_score():
    if not store.scores:
        return {}
    return {
        "boreholes": store.boreholes,
        "grids": store.scores.get("grids", {}),
        "contours": {}
    }

@router.get("/grid/{type}")
async def get_score_grid(type: str):
    if not store.scores or "grids" not in store.scores:
        return {}
    return store.scores["grids"].get(type, {})
