from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import os
from datetime import datetime

from routers import upload, boreholes, design, score, boundary, geology
from store import store

app = FastAPI(title="Mining Design System API", version="2.1")

# 配置 CORS - 从环境变量读取允许的域名，默认为本地开发地址
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)

# 注册路由
app.include_router(upload.router, prefix="/api/upload", tags=["Upload"])
app.include_router(boreholes.router, prefix="/api/boreholes", tags=["Boreholes"])
app.include_router(design.router, prefix="/api/design", tags=["Design"])
app.include_router(score.router, prefix="/api/score", tags=["Score"])
app.include_router(boundary.router, prefix="/api/boundary", tags=["Boundary"])
app.include_router(geology.router, prefix="/api/geology", tags=["Geology"])


@app.get("/")
async def root():
    return {"message": "Mining Design System Python Backend is running", "version": "2.1"}


@app.get("/health")
async def health_check():
    """健康检查端点"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "2.1",
        "database": "sqlite"
    }


@app.get("/api/project")
async def get_project_info():
    """获取当前项目信息"""
    return store.get_project_info()


@app.post("/api/project/clear")
async def clear_project():
    """清空当前项目数据"""
    store.clear()
    return {"success": True, "message": "项目数据已清空"}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=3001, reload=True)
