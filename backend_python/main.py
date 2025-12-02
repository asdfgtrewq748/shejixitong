from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from routers import upload, boreholes, design, score, boundary, geology

app = FastAPI(title="Mining Design System API", version="2.0")

# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 允许所有来源，生产环境请限制为前端地址
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
