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
│   │   └── MiningDesignSystem.jsx
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.cjs
│   └── postcss.config.cjs
│
├── backend/                     # 后端项目
│   ├── index.js                # Express 入口 (端口 3001)
│   ├── store.js                # 内存数据存储
│   ├── package.json
│   ├── routes/
│   │   ├── boundary.js         # 边界 API
│   │   ├── boreholes.js        # 钻孔 API
│   │   ├── score.js            # 评分 & IDW 插值 API
│   │   └── design.js           # 设计方案 API
│   └── utils/
│       └── scoreFormulas.js    # 评分公式模块
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

**后端**
- Node.js + Express (REST API)
- IDW 插值算法（反距离加权）
- 可扩展评分公式模块

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

## 功能说明

### 画布交互
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

### 状态栏
- **COORDS**: 实时显示鼠标坐标
- **SCALE**: 实时显示缩放比例

## 后端 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/boundary` | 上传采区边界 `{ points: [{x,y}, ...] }` |
| GET | `/api/boundary` | 获取当前边界 |
| POST | `/api/boreholes` | 上传钻孔数组 `{ boreholes: [...] }` |
| GET | `/api/boreholes` | 获取钻孔列表 |
| POST | `/api/score` | 计算评分 `{ weights: {safety,economic,env} }` |
| GET | `/api/score` | 获取评分及网格插值结果 |
| POST | `/api/design` | 生成设计方案 `{ mode: 'composite' }` |
| GET | `/api/design` | 获取最近设计方案 |
| GET | `/api/health` | 健康检查 |

## 常用脚本

### 根目录
| 命令 | 说明 |
| --- | --- |
| `npm run install:all` | 安装前后端所有依赖 |
| `npm run dev:frontend` | 启动前端开发服务器 |
| `npm run dev:backend` | 启动后端服务器 |
| `npm run build:frontend` | 构建前端生产包 |

### frontend 目录
| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动开发服务器 (HMR) |
| `npm run build` | 生成 `dist/` 生产包 |
| `npm run preview` | 本地预览打包结果 |

### backend 目录
| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动服务器 (带文件监听) |
| `npm start` | 启动服务器 |

## 常见问题

| 问题 | 解决方式 |
| --- | --- |
| `npm install` 超时 | 使用镜像：`npm config set registry https://registry.npmmirror.com` |
| 端口被占用 | 前端：`npm run dev -- --port 5174`；后端：修改 `backend/index.js` 中的端口 |
| 页面空白/报错 | 检查终端错误；浏览器 F12 控制台查看详情 |
| 前端连不上后端 | 确保后端已启动；检查 `frontend/src/api.js` 中的 API_BASE 配置 |

## 下一步建议

1. **代码规范**：集成 ESLint + Prettier
2. **数据持久化**：将 `store.js` 替换为 SQLite / PostgreSQL / MongoDB
3. **真实数据**：接入 DXF 文件解析或钻孔数据库
4. **算法升级**：用 Kriging（克里金）替换 IDW 插值
5. **部署上线**：前端静态文件部署到 OSS/Nginx，后端容器化部署
