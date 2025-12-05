from fastapi import APIRouter
from store import store

router = APIRouter()

@router.get("/")
async def get_boundary():
    # 返回归一化后的边界坐标（与设计模块保持一致）
    return {"boundary": store.get_normalized_boundary()}
