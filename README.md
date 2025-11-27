# GeoMind NEXUS 智能采掘设计系统

基于 React + Vite + Tailwind CSS 的智能采掘可视化原型，包含数据导入、参数调节、可视化画布和系统日志等交互模块。

## 项目结构

```
shejixitong/
├── frontend/                    # 前端项目
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   ├── index.css
│   │   ├── api.js              # 前端 API 封装
│   │   ├── FileUploader.jsx    # CSV文件上传组件
│   │   └── MiningDesignSystem.jsx
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── postcss.config.js
│
├── backend/                     # 后端项目
│   ├── index.js                # Express 入口 (端口 3001)
│   ├── store.js                # 内存数据存储
│   ├── package.json
│   ├── routes/
│   │   ├── boundary.js         # 边界 API
│   │   ├── boreholes.js        # 钻孔 API
│   │   ├── score.js            # 评分 & IDW 插值 & 等值线 API
│   │   ├── design.js           # 智能设计方案 API
│   │   └── upload.js           # CSV文件上传解析 API
│   └── utils/
│       └── scoreFormulas.js    # 评分公式模块
│
├── examples/                    # 示例CSV文件
│   ├── boundary.csv
│   ├── borehole-coordinates.csv
│   └── borehole-data.csv
│
├── package.json                 # 根目录快捷脚本
├── README.md
└── 设计系统的原始代码.md
```

## 技术栈

**前端**
- React 18 + Vite 5 (开发体验与热更新)
- Tailwind CSS 3 (快速搭建 UI)
- lucide-react (图标库)
- HTML5 Canvas (可视化渲染)

**后端**
- Node.js + Express (REST API)
- multer + csv-parser (CSV文件解析)
- IDW 插值算法（反距离加权）
- Marching Squares 等值线生成算法
- 智能巷道/工作面规划算法

## 核心功能

### 1. 数据导入
- **CSV批量导入**：支持采区边界、钻孔坐标、钻孔数据三种CSV文件
- **模拟数据**：一键生成示例边界和随机钻孔数据

### 2. 地质分析
- **多维度评分**：安全性、经济性、环保性及综合评分
- **热力图可视化**：基于IDW插值的全区评分热力图
- **等值线绘制**：自动生成评分等值线

### 3. 智能设计
- **高分区域识别**：BFS连通区域聚类算法
- **主巷道规划**：从边界入口到采区高分区域的最优路径
- **工作面划分**：在高分区域内自动布置矩形工作面
- **分巷道连接**：连接主巷道与各工作面

## 快速开始

### 1. 安装依赖

```powershell
# 方式一：使用根目录快捷命令
cd e:\xiangmu\shejixitong
npm run install:all

# 方式二：分别安装
cd e:\xiangmu\shejixitong\frontend
npm install
cd ..\backend
npm install
```

### 2. 启动服务

**启动后端**（端口 3001）
```powershell
cd e:\xiangmu\shejixitong\backend
npm run dev
```

**启动前端**（端口 5173，新开一个终端）
```powershell
cd e:\xiangmu\shejixitong\frontend
npm run dev
```

### 3. 访问应用

- 前端界面：http://localhost:5173
- 后端 API：http://localhost:3001

## 使用流程

1. **导入数据**
   - 点击"导入采区边界"或使用CSV上传
   - 点击"导入钻孔数据"或使用CSV上传

2. **地质分析**
   - 调整安全性/经济性/环保性权重滑块
   - 系统自动计算各钻孔评分

3. **生成设计**
   - 点击"执行智能分析"按钮
   - 系统生成热力图、等值线和设计方案
   - 切换到"工程决策"标签查看结果

4. **调整可视化**
   - 点击设置按钮，切换热力图/等值线/设计方案显示
   - 选择不同分析维度（安全性/经济性/环保性/综合）

## 画布交互
| 操作 | 功能 |
| --- | --- |
| 鼠标滚轮 | 缩放视图 (25% - 400%) |
| 中键拖拽 / Alt+左键拖拽 | 平移画布 |
| 底部 Grid 按钮 | 切换网格显示 |
| 底部 Search 按钮 | 搜索钻孔并定位 |
| 底部 +/- 按钮 | 缩放控制 |
| 底部 1:1 按钮 | 重置视图 |
| 顶部 Settings 按钮 | 打开设置面板 |
| 顶部 Report 按钮 | 导出 JSON 报告 |

## 后端 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/boundary` | 上传采区边界 `{ points: [{x,y}, ...] }` |
| GET | `/api/boundary` | 获取当前边界 |
| POST | `/api/boreholes` | 上传钻孔数组 `{ boreholes: [...] }` |
| GET | `/api/boreholes` | 获取钻孔列表 |
| POST | `/api/score` | 计算评分 `{ weights, resolution }` |
| GET | `/api/score` | 获取评分及网格插值结果 |
| GET | `/api/score/grid/:type` | 获取指定维度评分网格 |
| POST | `/api/design` | 生成设计方案 `{ mode, workfaceWidth, ... }` |
| GET | `/api/design` | 获取最近设计方案 |
| POST | `/api/upload/:type` | 上传CSV文件 (boundary/borehole-coordinates/borehole-data) |
| GET | `/api/health` | 健康检查 |

## CSV文件格式

### 边界文件 (boundary.csv)
```csv
x,y
100,100
700,100
700,500
100,500
```

### 钻孔坐标文件 (borehole-coordinates.csv)
```csv
id,x,y
BH001,200,250
BH002,350,180
```

### 钻孔数据文件 (borehole-data.csv)
```csv
id,岩石硬度,煤层厚度,瓦斯含量,透水系数,含硫量
BH001,7.2,3.5,8.5,0.02,0.8
BH002,5.5,4.2,6.0,0.05,1.2
```

## 常见问题

| 问题 | 解决方式 |
| --- | --- |
| `npm install` 超时 | 使用镜像：`npm config set registry https://registry.npmmirror.com` |
| 端口被占用 | 前端：`npm run dev -- --port 5174`；后端：修改 `backend/index.js` 中的端口 |
| 页面空白/报错 | 检查终端错误；浏览器 F12 控制台查看详情 |
| 前端连不上后端 | 确保后端已启动；检查 `frontend/src/api.js` 中的 API_BASE 配置 |
| 热力图不显示 | 确保已导入边界和钻孔数据，并执行过"智能分析" |

## 下一步建议

1. **代码规范**：集成 ESLint + Prettier
2. **数据持久化**：将 `store.js` 替换为 SQLite / PostgreSQL / MongoDB
3. **真实数据**：接入 DXF 文件解析或钻孔数据库
4. **算法升级**：用 Kriging（克里金）替换 IDW 插值
5. **部署上线**：前端静态文件部署到 OSS/Nginx，后端容器化部署
