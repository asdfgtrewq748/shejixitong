# GeoMind NEXUS 智能采矿设计系统 - 优化建议

## 目录

1. [系统概述](#1-系统概述)
2. [当前架构分析](#2-当前架构分析)
3. [关键问题汇总](#3-关键问题汇总)
4. [前端优化建议](#4-前端优化建议)
5. [后端优化建议](#5-后端优化建议)
6. [性能优化](#6-性能优化)
7. [安全加固](#7-安全加固)
8. [测试策略](#8-测试策略)
9. [部署与运维](#9-部署与运维)
10. [实施路线图](#10-实施路线图)

---

## 1. 系统概述

### 1.1 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端 | React + Vite | v18 |
| 后端 | FastAPI + Python | 3.x |
| 算法 | Shapely + NumPy | - |
| 导出 | ezdxf | - |

### 1.2 核心功能

- 采区边界与钻孔数据导入
- 多维度地质评分计算
- 智能工作面布局设计
- 巷道网络自动生成
- DXF格式导出

---

## 2. 当前架构分析

### 2.1 前端代码结构

```
frontend/src/
├── App.jsx                      # 入口组件
├── MiningDesignSystem.jsx       # 主业务组件 (2635行) ⚠️
├── FileUploader.jsx             # 文件上传 (290行)
├── api.js                       # API封装 (298行)
├── components/
│   └── GeoModelPreview.jsx      # 3D预览
└── index.css                    # 样式
```

### 2.2 后端代码结构

```
backend_python/
├── main.py                      # FastAPI入口
├── store.py                     # 全局内存存储 ⚠️
├── routers/
│   ├── design.py               # 设计方案 (710行)
│   ├── boreholes.py            # 钻孔管理
│   ├── boundary.py             # 边界管理
│   ├── score.py                # 评分计算
│   └── geology.py              # 地质分析
└── utils/
    ├── algorithms.py           # 布局算法 (717行)
    ├── mining_rules.py         # 规程参数
    └── geology_analysis.py     # 地质工具
```

### 2.3 数据流

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  CSV文件    │────▶│  后端API    │────▶│  内存Store  │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Canvas渲染 │◀────│  前端State  │◀────│  API响应    │
└─────────────┘     └─────────────┘     └─────────────┘
```

---

## 3. 关键问题汇总

### 3.1 严重程度分级

| 等级 | 标识 | 说明 |
|------|------|------|
| P0 | 🔴 | 阻塞性问题，需立即修复 |
| P1 | 🟠 | 重要问题，本周内修复 |
| P2 | 🟡 | 一般问题，计划内修复 |
| P3 | 🟢 | 优化建议，有空时处理 |

### 3.2 问题清单

| 问题 | 等级 | 分类 | 影响 |
|------|------|------|------|

| MiningDesignSystem.jsx 2635行 | 🔴 P0 | 维护性 | 难以理解和修改 |
| Canvas渲染无限循环风险 | 🔴 P0 | 性能 | 浏览器卡死 |
| 全局内存存储无持久化 | 🟠 P1 | 可靠性 | 重启后数据丢失 |
| 无输入验证 | 🟠 P1 | 安全 | 恶意数据注入 |
| API无错误重试 | 🟠 P1 | 体验 | 网络波动时失败 |
| 无单元测试 | 🟡 P2 | 质量 | 回归风险高 |
| 无日志系统 | 🟡 P2 | 运维 | 问题难以追踪 |
| 缺乏TypeScript | 🟢 P3 | 维护性 | 类型错误风险 |

---

## 4. 前端优化建议

### 4.1 组件拆分 (P0)

**问题**: MiningDesignSystem.jsx 包含2635行代码，混合了：
- 状态管理 (20+ useState)
- Canvas绑制逻辑 (~700行)
- 业务逻辑
- UI渲染 (~950行)

**建议**: 按职责拆分为多个组件

```
src/
├── components/
│   ├── Canvas/
│   │   ├── MiningCanvas.jsx        # Canvas容器组件
│   │   ├── renderers/
│   │   │   ├── HeatmapRenderer.js  # 热力图渲染
│   │   │   ├── WorkfaceRenderer.js # 工作面渲染
│   │   │   ├── RoadwayRenderer.js  # 巷道渲染
│   │   │   └── BoreholeRenderer.js # 钻孔渲染
│   │   └── hooks/
│   │       ├── useCanvasZoom.js    # 缩放逻辑
│   │       └── useCanvasPan.js     # 平移逻辑
│   │
│   ├── Panels/
│   │   ├── ImportPanel.jsx         # 数据导入面板
│   │   ├── AnalysisPanel.jsx       # 分析设置面板
│   │   ├── DesignPanel.jsx         # 设计参数面板
│   │   └── ResultPanel.jsx         # 结果展示面板
│   │
│   ├── Toolbar/
│   │   ├── MainToolbar.jsx         # 主工具栏
│   │   └── EditToolbar.jsx         # 编辑工具栏
│   │
│   └── Common/
│       ├── LoadingOverlay.jsx      # 加载遮罩
│       ├── LogPanel.jsx            # 日志面板
│       └── ErrorBoundary.jsx       # 错误边界
│
├── stores/
│   ├── miningStore.js              # 主状态管理
│   └── uiStore.js                  # UI状态管理
│
├── hooks/
│   ├── useDesignGeneration.js      # 设计生成逻辑
│   └── useDataImport.js            # 数据导入逻辑
│
└── MiningDesignSystem.jsx          # 主容器 (~300行)
```

### 4.2 状态管理重构 (P1)

**问题**: 20+ 个分散的 useState，导致：
- 状态难以追踪
- 组件重渲染频繁
- 状态共享困难

**建议**: 使用 Zustand 或 Redux Toolkit

```javascript
// stores/miningStore.js
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

export const useMiningStore = create(
  devtools(
    persist(
      (set, get) => ({
        // 数据状态
        boundary: [],
        boreholes: [],
        scoreData: null,
        designData: null,

        // UI状态
        activeTab: 'import',
        isLoading: false,
        viewMode: 'design',

        // 视图状态
        scale: 1,
        panOffset: { x: 0, y: 0 },

        // Actions
        setBoundary: (data) => set({ boundary: data }),
        setDesignData: (data) => set({ designData: data }),

        // 复合操作
        resetView: () => set({
          scale: 1,
          panOffset: { x: 0, y: 0 }
        }),

        // 计算属性
        get statistics() {
          const { designData } = get();
          if (!designData?.panels) return null;
          return {
            workfaceCount: designData.panels.length,
            totalArea: designData.panels.reduce((s, p) => s + p.area, 0),
            avgScore: designData.stats?.avgScore || 0
          };
        }
      }),
      { name: 'mining-store' }
    )
  )
);
```

### 4.3 Canvas性能优化 (P0)

**问题**:
- 每帧全量重绘所有元素
- 17个useEffect依赖导致频繁重渲染
- 斜线填充循环可能无限执行

**建议**:

```javascript
// 1. 分层渲染 - 静态层和动态层分离
const MiningCanvas = () => {
  const staticCanvasRef = useRef(null);  // 边界、热力图
  const dynamicCanvasRef = useRef(null); // 工作面、巷道
  const interactCanvasRef = useRef(null); // 鼠标交互

  // 静态内容只在数据变化时重绘
  useEffect(() => {
    drawStaticLayer(staticCanvasRef.current);
  }, [boundary, scoreData]);

  // 动态内容在设计变化时重绘
  useEffect(() => {
    drawDynamicLayer(dynamicCanvasRef.current);
  }, [designData]);

  // 交互层使用requestAnimationFrame
  useEffect(() => {
    const animate = () => {
      drawInteractionLayer(interactCanvasRef.current);
      requestAnimationFrame(animate);
    };
    const id = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(id);
  }, [mousePos, isEditing]);
};

// 2. 脏检查机制
const useDirtyFlag = () => {
  const dirtyRef = useRef(new Set());

  const markDirty = (layer) => dirtyRef.current.add(layer);
  const isDirty = (layer) => dirtyRef.current.has(layer);
  const clearDirty = () => dirtyRef.current.clear();

  return { markDirty, isDirty, clearDirty };
};

// 3. 安全的循环边界
const drawHatchPattern = (ctx, bounds, spacing) => {
  const safeSpacing = Math.max(1, spacing); // 防止无限循环
  const maxIterations = 10000; // 安全上限
  let iterations = 0;

  for (let i = bounds.minX; i < bounds.maxX && iterations < maxIterations; i += safeSpacing) {
    // 绘制斜线
    iterations++;
  }

  if (iterations >= maxIterations) {
    console.warn('Hatch pattern reached max iterations');
  }
};
```

### 4.4 错误处理增强 (P1)

```javascript
// components/Common/ErrorBoundary.jsx
import { Component } from 'react';

class ErrorBoundary extends Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // 上报错误到监控系统
    console.error('React Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-fallback">
          <h2>系统出现错误</h2>
          <p>{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()}>
            刷新页面
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// api.js - 增强错误处理
const apiClient = {
  async request(url, options = {}) {
    const maxRetries = 3;
    let lastError;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const res = await fetch(url, {
          ...options,
          timeout: 30000,
        });

        if (!res.ok) {
          const error = await res.json().catch(() => ({}));
          throw new ApiError(error.detail || res.statusText, res.status);
        }

        return res.json();
      } catch (err) {
        lastError = err;
        if (i < maxRetries - 1) {
          await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
      }
    }

    throw lastError;
  }
};

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}
```

### 4.5 TypeScript迁移 (P3)

```typescript
// types/mining.ts
export interface Point {
  x: number;
  y: number;
}

export interface Borehole {
  id: string;
  x: number;
  y: number;
  coalThickness?: number;
  layers?: BoreholeLayer[];
}

export interface Workface {
  id: string;
  center_x: number;
  center_y: number;
  width: number;
  length: number;
  points: Point[];
  avgScore: number;
  isValid: boolean;
  validationMsg?: string;
}

export interface Roadway {
  id: string;
  name: string;
  type: 'main' | 'ventilation' | 'transport' | 'return' | 'cut';
  path: Point[];
  length: number;
  workface?: string;
}

export interface DesignResult {
  panels: Workface[];
  roadways: Roadway[];
  stats: DesignStats;
}
```

---

## 5. 后端优化建议

### 5.1 数据持久化 (P1)

**问题**: 所有数据存储在内存中的全局变量

```python
# 当前实现 - store.py
class Store:
    def __init__(self):
        self.boundary = []      # 重启后丢失
        self.boreholes = []     # 并发不安全
        self.design_result = {}
```

**建议**: 使用SQLite或PostgreSQL

```python
# models/database.py
from sqlalchemy import create_engine, Column, Integer, String, JSON, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime

Base = declarative_base()

class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    boundary = Column(JSON, default=list)
    boreholes = Column(JSON, default=list)
    design_params = Column(JSON, default=dict)
    design_result = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

# 数据库连接
DATABASE_URL = "sqlite:///./mining_design.db"
# 或 PostgreSQL: "postgresql://user:pass@localhost/mining"

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# routers/design.py 改造
from fastapi import Depends
from sqlalchemy.orm import Session

@router.post("/")
async def generate_design(
    params: DesignParams,
    project_id: int,
    db: Session = Depends(get_db)
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    result = generate_smart_layout(
        boundary_points=project.boundary,
        ...
    )

    project.design_result = result
    db.commit()

    return result
```

### 5.2 输入验证 (P1)

```python
# schemas/design.py
from pydantic import BaseModel, Field, validator
from typing import List, Optional
from enum import Enum

class LayoutDirection(str, Enum):
    STRIKE = "strike"
    DIP = "dip"

class FaceLengthConfig(BaseModel):
    min: float = Field(150, ge=100, le=500, description="最小工作面长度")
    max: float = Field(300, ge=150, le=500, description="最大工作面长度")
    preferred: Optional[float] = None

    @validator('max')
    def max_greater_than_min(cls, v, values):
        if 'min' in values and v < values['min']:
            raise ValueError('最大长度必须大于最小长度')
        return v

class MiningRulesConfig(BaseModel):
    face_length: FaceLengthConfig = FaceLengthConfig()
    layout_direction: LayoutDirection = LayoutDirection.STRIKE

class DesignParams(BaseModel):
    face_width: float = Field(200, ge=50, le=1000, description="推进长度(m)")
    pillar_width: float = Field(20, ge=5, le=100, description="煤柱宽度(m)")
    boundary_margin: float = Field(30, ge=10, le=100, description="边界煤柱(m)")
    dip_angle: float = Field(0, ge=0, le=45, description="煤层倾角(度)")
    dip_direction: float = Field(0, ge=0, le=360, description="煤层倾向(度)")
    mining_rules: MiningRulesConfig = MiningRulesConfig()

    class Config:
        schema_extra = {
            "example": {
                "face_width": 200,
                "pillar_width": 20,
                "boundary_margin": 30,
                "dip_angle": 5,
                "mining_rules": {
                    "face_length": {"min": 150, "max": 300},
                    "layout_direction": "strike"
                }
            }
        }

# 使用
@router.post("/", response_model=DesignResult)
async def generate_design(params: DesignParams):
    # params 已经过验证
    pass
```

### 5.3 算法优化 (P2)

```python
# utils/algorithms.py

from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor
import numpy as np

class WorkfaceGenerator:
    def __init__(self, mining_rules: MiningRules):
        self.rules = mining_rules
        self._executor = ThreadPoolExecutor(max_workers=4)

    @lru_cache(maxsize=128)
    def _calculate_optimal_face_length(
        self,
        available_length: float,
        pillar_width: float
    ) -> float:
        """缓存最优工作面长度计算"""
        min_len = self.rules.face_length_min
        max_len = self.rules.face_length_max

        best_length = self.rules.face_length_preferred
        best_waste = float('inf')

        # 使用numpy向量化计算
        test_lengths = np.arange(min_len, max_len + 1, 10)
        for length in test_lengths:
            num_faces = int((available_length + pillar_width) / (length + pillar_width))
            if num_faces < 1:
                continue
            total_used = num_faces * length + (num_faces - 1) * pillar_width
            waste = available_length - total_used
            if 0 <= waste < best_waste:
                best_waste = waste
                best_length = length

        return best_length

    def generate_workfaces_parallel(
        self,
        strips: List[Polygon],
        rotated_area: Polygon
    ) -> List[Dict]:
        """并行处理多个条带"""
        futures = []
        for strip in strips:
            future = self._executor.submit(
                self._process_strip,
                strip,
                rotated_area
            )
            futures.append(future)

        results = []
        for future in futures:
            result = future.result()
            if result:
                results.extend(result)

        return results

    def _process_strip(self, strip: Polygon, rotated_area: Polygon) -> List[Dict]:
        """处理单个条带"""
        intersection = rotated_area.intersection(strip)
        if intersection.is_empty:
            return []

        # 处理逻辑...
        return workfaces
```

### 5.4 日志系统 (P2)

```python
# utils/logger.py
import logging
import sys
from datetime import datetime
from pathlib import Path

def setup_logger(name: str = "mining_design") -> logging.Logger:
    logger = logging.getLogger(name)
    logger.setLevel(logging.DEBUG)

    # 控制台处理器
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_format = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    console_handler.setFormatter(console_format)

    # 文件处理器
    log_dir = Path("logs")
    log_dir.mkdir(exist_ok=True)
    file_handler = logging.FileHandler(
        log_dir / f"mining_{datetime.now():%Y%m%d}.log",
        encoding='utf-8'
    )
    file_handler.setLevel(logging.DEBUG)
    file_format = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(funcName)s:%(lineno)d - %(message)s'
    )
    file_handler.setFormatter(file_format)

    logger.addHandler(console_handler)
    logger.addHandler(file_handler)

    return logger

logger = setup_logger()

# 使用示例
# utils/algorithms.py
from utils.logger import logger

def generate_smart_layout(...):
    logger.info(f"开始生成工作面布局: face_width={face_width}, pillar_width={pillar_width}")

    try:
        # 处理逻辑
        logger.debug(f"采区面积: {total_area:.0f} m²")
        logger.debug(f"可采区面积: {mining_area.area:.0f} m²")
    except Exception as e:
        logger.error(f"工作面生成失败: {e}", exc_info=True)
        raise

    logger.info(f"生成完成: {len(workfaces)} 个工作面, {len(roadways)} 条巷道")
    return result
```

### 5.5 DXF导出修复 (P0)

```python
# routers/design.py

@router.get("/export/dxf")
async def export_dxf():
    """导出DXF文件 - 修复版本"""
    try:
        if not store.design_result:
            raise HTTPException(status_code=400, detail="请先生成设计方案")

        doc = ezdxf.new(dxfversion='R2010')
        msp = doc.modelspace()

        # 设置图层
        setup_mining_layers(doc)

        # 安全的字体设置
        try:
            doc.styles.add('MINING', font='simhei.ttf')
        except Exception:
            # fallback到标准字体
            doc.styles.add('MINING', font='arial.ttf')

        # ... 绘制逻辑 ...

        # 正确的二进制流导出
        byte_stream = BytesIO()
        doc.write(byte_stream, fmt='bin')  # 明确指定二进制格式
        byte_stream.seek(0)

        # 生成文件名
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"mining_design_{timestamp}.dxf"

        return StreamingResponse(
            byte_stream,
            media_type="application/dxf",
            headers={
                "Content-Disposition": f"attachment; filename={filename}",
                "Access-Control-Expose-Headers": "Content-Disposition"
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"DXF导出失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"DXF导出失败: {str(e)}")
```

---

## 6. 性能优化

### 6.1 前端性能

| 优化项 | 当前 | 目标 | 方法 |
|--------|------|------|------|
| Canvas FPS | ~30 | 60 | 分层渲染、脏检查 |
| 首屏加载 | ~3s | <1s | 代码分割、懒加载 |
| 状态更新 | 频繁重渲染 | 精确更新 | Zustand选择器 |
| 内存占用 | 未监控 | <200MB | 及时释放、虚拟列表 |

```javascript
// 代码分割示例
const GeoModelPreview = lazy(() => import('./components/GeoModelPreview'));
const FileUploader = lazy(() => import('./components/FileUploader'));

// 虚拟列表 (大量钻孔/工作面时)
import { FixedSizeList } from 'react-window';

const BoreholeList = ({ boreholes }) => (
  <FixedSizeList
    height={400}
    itemCount={boreholes.length}
    itemSize={50}
  >
    {({ index, style }) => (
      <div style={style}>
        <BoreholeItem borehole={boreholes[index]} />
      </div>
    )}
  </FixedSizeList>
);
```

### 6.2 后端性能

| 优化项 | 方法 |
|--------|------|
| 算法缓存 | LRU缓存计算结果 |
| 并行处理 | ThreadPoolExecutor |
| 数据库查询 | 索引优化、连接池 |
| 响应压缩 | gzip中间件 |

```python
# main.py
from fastapi.middleware.gzip import GZipMiddleware

app.add_middleware(GZipMiddleware, minimum_size=1000)
```

---

## 7. 安全加固

### 7.1 CORS配置 (P0)

```python
# main.py
from fastapi.middleware.cors import CORSMiddleware
import os

# 从环境变量读取允许的域名
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5173"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,  # 不再使用 ["*"]
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
    max_age=600,
)
```

### 7.2 输入验证

```python
# 文件上传限制
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
ALLOWED_EXTENSIONS = {'.csv'}

@router.post("/upload/boundary")
async def upload_boundary(file: UploadFile):
    # 检查文件大小
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, "文件大小超过限制(10MB)")

    # 检查文件扩展名
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"不支持的文件格式: {ext}")

    # 检查行数
    lines = content.decode('utf-8').splitlines()
    if len(lines) > 100000:
        raise HTTPException(400, "数据行数超过限制(100000行)")

    # 处理文件...
```

### 7.3 速率限制

```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

@router.post("/design/")
@limiter.limit("10/minute")
async def generate_design(request: Request, params: DesignParams):
    # 每分钟最多10次请求
    pass
```

---

## 8. 测试策略

### 8.1 前端测试

```javascript
// __tests__/components/MiningCanvas.test.jsx
import { render, screen, fireEvent } from '@testing-library/react';
import { MiningCanvas } from '../components/Canvas/MiningCanvas';

describe('MiningCanvas', () => {
  const mockBoundary = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 }
  ];

  it('should render canvas element', () => {
    render(<MiningCanvas boundary={mockBoundary} />);
    expect(screen.getByTestId('mining-canvas')).toBeInTheDocument();
  });

  it('should handle zoom with mouse wheel', () => {
    const onZoom = jest.fn();
    render(<MiningCanvas boundary={mockBoundary} onZoom={onZoom} />);

    const canvas = screen.getByTestId('mining-canvas');
    fireEvent.wheel(canvas, { deltaY: -100 });

    expect(onZoom).toHaveBeenCalledWith(expect.any(Number));
  });

  it('should display workfaces when designData provided', () => {
    const designData = {
      panels: [{ id: 'WF-01', points: [...], avgScore: 75 }],
      roadways: []
    };

    render(
      <MiningCanvas
        boundary={mockBoundary}
        designData={designData}
      />
    );

    // 验证渲染逻辑
  });
});
```

### 8.2 后端测试

```python
# tests/test_design.py
import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

class TestDesignAPI:
    @pytest.fixture
    def sample_boundary(self):
        return [
            {"x": 0, "y": 0},
            {"x": 400, "y": 0},
            {"x": 400, "y": 300},
            {"x": 0, "y": 300}
        ]

    def test_generate_design_success(self, sample_boundary):
        # 先上传边界
        response = client.post("/api/boundary/", json={"points": sample_boundary})
        assert response.status_code == 200

        # 生成设计
        params = {
            "faceWidth": 200,
            "pillarWidth": 20,
            "boundaryMargin": 30
        }
        response = client.post("/api/design/", json=params)

        assert response.status_code == 200
        data = response.json()
        assert "panels" in data
        assert "roadways" in data
        assert len(data["panels"]) > 0

    def test_generate_design_invalid_params(self):
        params = {
            "faceWidth": -100,  # 无效值
            "pillarWidth": 20
        }
        response = client.post("/api/design/", json=params)
        assert response.status_code == 422  # 验证失败

    def test_export_dxf_no_design(self):
        response = client.get("/api/design/export/dxf")
        assert response.status_code == 400
        assert "请先生成设计方案" in response.json()["detail"]


# tests/test_algorithms.py
import pytest
from utils.algorithms import generate_smart_layout
from utils.mining_rules import MiningRules

class TestWorkfaceGeneration:
    @pytest.fixture
    def simple_boundary(self):
        return [
            {"x": 0, "y": 0},
            {"x": 400, "y": 0},
            {"x": 400, "y": 300},
            {"x": 0, "y": 300}
        ]

    def test_generates_valid_workfaces(self, simple_boundary):
        rules = MiningRules()
        rules.face_length_min = 100
        rules.face_length_max = 200

        result = generate_smart_layout(
            boundary_points=simple_boundary,
            dip_angle=0,
            dip_direction=0,
            face_width=150,
            pillar_width=20,
            boundary_margin=20,
            mining_rules=rules
        )

        assert "workfaces" in result
        assert "roadways" in result

        for wf in result["workfaces"]:
            assert wf["faceLength"] >= rules.face_length_min * 0.8
            assert wf["faceLength"] <= rules.face_length_max * 1.1

    def test_generates_roadways_for_each_workface(self, simple_boundary):
        result = generate_smart_layout(
            boundary_points=simple_boundary,
            dip_angle=0,
            dip_direction=0,
            face_width=150,
            pillar_width=20
        )

        workface_ids = {wf["id"] for wf in result["workfaces"]}

        # 每个工作面应有运输顺槽、回风顺槽、开切眼
        for wf_id in workface_ids:
            related_roads = [
                r for r in result["roadways"]
                if r.get("workface") == wf_id
            ]
            assert len(related_roads) >= 3
```

### 8.3 测试覆盖率目标

| 模块 | 当前 | 目标 |
|------|------|------|
| 前端组件 | 0% | 80% |
| 后端API | 0% | 90% |
| 算法模块 | 0% | 95% |
| 整体 | 0% | 85% |

---

## 9. 部署与运维

### 9.1 Docker部署

```dockerfile
# Dockerfile.backend
FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 3001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3001"]

# Dockerfile.frontend
FROM node:18-alpine as builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "80:80"
    depends_on:
      - backend

  backend:
    build:
      context: ./backend_python
      dockerfile: Dockerfile
    ports:
      - "3001:3001"
    environment:
      - DATABASE_URL=postgresql://user:pass@db:5432/mining
      - ALLOWED_ORIGINS=http://localhost
    volumes:
      - ./logs:/app/logs
    depends_on:
      - db

  db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
      - POSTGRES_DB=mining
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

### 9.2 监控配置

```python
# 健康检查端点
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "5.0.1"
    }

# Prometheus指标
from prometheus_client import Counter, Histogram
from prometheus_fastapi_instrumentator import Instrumentator

request_count = Counter(
    'mining_requests_total',
    'Total requests',
    ['method', 'endpoint']
)

design_latency = Histogram(
    'mining_design_latency_seconds',
    'Design generation latency'
)

Instrumentator().instrument(app).expose(app)
```

---

## 10. 实施路线图

### 第一阶段: 紧急修复 (1-2天)

- [ ] 修复CORS安全配置
- [ ] 修复Canvas无限循环问题
- [ ] 修复DXF导出文本流问题
- [ ] 添加基本输入验证

### 第二阶段: 核心重构 (1-2周)

- [ ] 拆分MiningDesignSystem.jsx
- [ ] 实现Zustand状态管理
- [ ] 添加数据库持久化
- [ ] 实现日志系统

### 第三阶段: 质量提升 (2-3周)

- [ ] 添加单元测试 (覆盖率>80%)
- [ ] 实现Canvas性能优化
- [ ] 添加错误边界组件
- [ ] 完善API文档

### 第四阶段: 生产就绪 (1-2周)

- [ ] Docker部署配置
- [ ] 监控和告警配置
- [ ] 性能压测
- [ ] 安全审计

---

## 附录

### A. 代码质量指标

| 指标 | 当前 | 目标 |
|------|------|------|
| 单文件最大行数 | 2635 | <500 |
| 函数最大行数 | ~150 | <50 |
| 圈复杂度 | 未知 | <10 |
| 测试覆盖率 | 0% | >85% |
| TypeScript覆盖 | 0% | 100% |

### B. 依赖更新建议

```json
// package.json 建议添加
{
  "dependencies": {
    "zustand": "^4.4.0",
    "react-window": "^1.8.9",
    "react-error-boundary": "^4.0.0"
  },
  "devDependencies": {
    "@testing-library/react": "^14.0.0",
    "vitest": "^0.34.0",
    "typescript": "^5.0.0",
    "@types/react": "^18.0.0"
  }
}
```

```txt
# requirements.txt 建议添加
sqlalchemy>=2.0.0
alembic>=1.12.0
slowapi>=0.1.8
prometheus-fastapi-instrumentator>=6.0.0
pytest>=7.4.0
pytest-asyncio>=0.21.0
httpx>=0.24.0
```

### C. 参考资源

- [React性能优化指南](https://react.dev/learn/render-and-commit)
- [FastAPI最佳实践](https://fastapi.tiangolo.com/tutorial/best-practices/)
- [Canvas性能优化](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
- [SQLAlchemy文档](https://docs.sqlalchemy.org/)

---

*文档版本: 1.0*
*创建日期: 2024-12*
*维护者: GeoMind开发团队*
