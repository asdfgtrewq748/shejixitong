from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import os

from routers import upload, boreholes, design, score, boundary, geology

app = FastAPI(title="Mining Design System API", version="2.0")

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
    return {"message": "Mining Design System Python Backend is running"}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=3001, reload=True)
