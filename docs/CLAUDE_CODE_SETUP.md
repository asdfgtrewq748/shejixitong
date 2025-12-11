# Claude Code 配置说明

## 问题诊断

在使用 Claude Code 对项目进行优化时，可能遇到 "error writing file" 错误。经过排查，发现以下问题：

### 1. **包含中文字符的文件和目录**
以下文件/目录包含中文字符，可能导致编码问题：
- `input/3451周边钻孔资料/`
- `input/各个钻孔-补充/`
- `input/测试钻孔/`
- `启动指南.md`
- `论文排版.py`
- `1-1-1中国矿业大学（北京）博士学位论文模板.doc`
- `3451N风运道预想剖面.dwg`

### 2. **只读文件**
- `input/敏东钻孔对应坐标.csv` - 已移除只读属性

### 3. **大文件**
以下 node_modules 文件过大（>500KB）：
- `frontend/node_modules/tailwindcss/peers/index.js` (4.4MB)
- `frontend/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js` (2MB)

## 解决方案

### 1. `.claudeignore` 文件
已创建 `.claudeignore` 文件，排除以下内容：
- `node_modules/` - 依赖包目录
- `dist/`, `build/` - 构建输出
- 包含中文的文件和目录
- 大型二进制文件（.dwg, .doc等）
- 上传目录和临时文件

### 2. 文件权限修复
```powershell
# 移除只读属性
Set-ItemProperty -Path "input/敏东钻孔对应坐标.csv" -Name IsReadOnly -Value $false
```

### 3. 项目结构优化建议

#### 重命名中文文件/目录（可选但推荐）：
```
input/3451周边钻孔资料/ → input/borehole_data_3451/
input/各个钻孔-补充/ → input/borehole_supplement/
input/测试钻孔/ → input/test_boreholes/
启动指南.md → STARTUP_GUIDE.md
论文排版.py → thesis_formatting.py
```

#### 移动非代码文件到单独目录：
```
docs/
  ├── 1-1-1中国矿业大学（北京）博士学位论文模板.doc
  └── 3451N风运道预想剖面.dwg
```

## Claude Code 使用建议

### 1. 聚焦核心代码目录
优化时主要关注：
- `backend_python/` - Python后端代码
- `frontend/src/` - React前端源码
- `backend_python/utils/` - 算法实现
- `backend_python/routers/` - API路由

### 2. 分批次优化
不要一次性优化整个项目，而是分模块进行：
```
第一批：算法优化
- backend_python/utils/algorithms.py
- backend_python/utils/mining_rules.py

第二批：API优化
- backend_python/routers/*.py

第三批：前端优化
- frontend/src/MiningDesignSystem.jsx
- frontend/src/api.js
```

### 3. 避免编辑的文件类型
- 配置文件：`package.json`, `vite.config.js`（除非必要）
- 锁文件：`package-lock.json`, `yarn.lock`
- 构建产物：`dist/`, `.vite/`
- 依赖包：`node_modules/`

## 验证修复

运行以下命令验证配置正确：
```powershell
# 检查 .claudeignore 是否生效
Get-Content .claudeignore

# 检查没有只读文件
Get-ChildItem -Recurse -File | Where-Object { $_.IsReadOnly } | Select-Object FullName

# 检查文件编码
Get-ChildItem -Path "frontend/src" -Filter "*.jsx" | ForEach-Object {
    [System.IO.File]::ReadAllText($_.FullName) | Out-Null
}
```

## 最佳实践

1. **定期清理**：删除 `node_modules/` 和 `dist/` 后重新安装
2. **使用英文**：新建文件和目录时使用英文名称
3. **小步迭代**：每次只让 Claude Code 修改 1-2 个文件
4. **版本控制**：优化前先提交 git，方便回滚
5. **测试验证**：每次优化后立即测试功能是否正常

## 当前项目特殊注意事项

1. **坐标归一化**：所有 API 返回的数据必须使用归一化坐标（0-3500范围）
2. **Canvas 渲染**：`MiningDesignSystem.jsx` 的 Canvas 部分需要特别注意 DPR 缩放
3. **巷道生成**：`algorithms.py` 的 `generate_roadways_v2` 已修复，不要引入旧的旋转变换逻辑
