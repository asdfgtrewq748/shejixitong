from fastapi import APIRouter
from store import store

router = APIRouter()

@router.get("/")
async def get_boundary():
    return store.boundary or []
