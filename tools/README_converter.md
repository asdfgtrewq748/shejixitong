# Excel 批量转 CSV 工具

一个基于 PyQt6 的图形界面工具，用于批量将 Excel 文件（.xlsx, .xls）转换为 CSV 格式。

## 功能特性

- ✅ 友好的图形界面（GUI）
- ✅ 支持批量选择多个 Excel 文件
- ✅ 支持拖拽添加文件
- ✅ 自定义输出目录
- ✅ UTF-8 BOM 编码支持（Excel 友好）
- ✅ 后台转换，不阻塞界面
- ✅ 实时进度显示
- ✅ 错误处理和提示

## 安装依赖

```powershell
cd d:\xiangmu\shejixitong\tools
pip install -r requirements_converter.txt
```

## 运行程序

```powershell
python excel_to_csv_converter.py
```

## 使用方法

1. **添加文件**：
   - 点击"添加 Excel 文件"按钮选择文件
   - 或直接拖拽 Excel 文件到窗口

2. **设置输出**：
   - 点击"浏览..."选择输出目录（默认为桌面）
   - 选择编码选项（建议使用 UTF-8 with BOM，Excel 可正确打开中文）
   - 选择是否包含行索引

3. **开始转换**：
   - 点击"开始转换"按钮
   - 等待进度条完成
   - 转换完成后会弹出提示框

4. **其他操作**：
   - "清空列表"：清除所有待转换文件
   - "移除选中"：移除列表中选中的文件

## 支持的文件格式

- `.xlsx` - Excel 2007 及更高版本
- `.xls` - Excel 97-2003

## 输出说明

- CSV 文件与源 Excel 文件同名（扩展名改为 .csv）
- 默认使用 UTF-8 with BOM 编码，确保 Excel 正确显示中文
- 默认不包含行索引

## 注意事项

- 如果 Excel 文件包含多个工作表，只会转换第一个工作表
- 确保 Excel 文件未被其他程序占用
- 转换过程中请勿关闭程序

## 常见问题

**Q: 转换后的 CSV 在 Excel 中打开中文显示乱码？**  
A: 请确保勾选"UTF-8 with BOM"选项。

**Q: 程序启动报错缺少模块？**  
A: 运行 `pip install -r requirements_converter.txt` 安装依赖。

**Q: 转换失败？**  
A: 检查 Excel 文件是否损坏，是否被其他程序打开。
