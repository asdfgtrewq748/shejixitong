#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Excel 批量转 CSV 工具
使用 PyQt6 GUI 界面，支持批量选择 Excel 文件并转换为 CSV 格式
"""

import sys
import os
from pathlib import Path
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QPushButton, QListWidget, QLabel, QFileDialog, QProgressBar,
    QMessageBox, QGroupBox, QLineEdit, QCheckBox
)
from PyQt6.QtCore import Qt, QThread, pyqtSignal
from PyQt6.QtGui import QIcon, QDragEnterEvent, QDropEvent
import pandas as pd


class ConvertThread(QThread):
    """后台转换线程，避免阻塞 GUI"""
    progress = pyqtSignal(int, str)  # 进度百分比，当前文件名
    finished = pyqtSignal(int, int)  # 成功数，失败数
    error = pyqtSignal(str, str)  # 文件名，错误信息
    
    def __init__(self, files, output_dir, encoding='utf-8-sig', index=False):
        super().__init__()
        self.files = files
        self.output_dir = output_dir
        self.encoding = encoding
        self.index = index
        self.is_running = True
    
    def run(self):
        success_count = 0
        fail_count = 0
        total = len(self.files)
        
        for i, file_path in enumerate(self.files):
            if not self.is_running:
                break
                
            try:
                # 发送进度信号
                file_name = Path(file_path).name
                progress_percent = int((i / total) * 100)
                self.progress.emit(progress_percent, file_name)
                
                # 读取 Excel 文件
                df = pd.read_excel(file_path, engine='openpyxl')
                
                # 生成输出文件名
                output_name = Path(file_path).stem + '.csv'
                output_path = Path(self.output_dir) / output_name
                
                # 保存为 CSV
                df.to_csv(output_path, index=self.index, encoding=self.encoding)
                success_count += 1
                
            except Exception as e:
                fail_count += 1
                self.error.emit(file_name, str(e))
        
        # 完成信号
        self.progress.emit(100, "转换完成")
        self.finished.emit(success_count, fail_count)
    
    def stop(self):
        self.is_running = False


class ExcelToCsvConverter(QMainWindow):
    """Excel 转 CSV 主窗口"""
    
    def __init__(self):
        super().__init__()
        self.file_list = []
        self.output_dir = str(Path.home() / "Desktop")  # 默认输出到桌面
        self.convert_thread = None
        self.init_ui()
    
    def init_ui(self):
        """初始化 UI"""
        self.setWindowTitle("Excel 批量转 CSV 工具")
        self.setGeometry(100, 100, 800, 600)
        
        # 中心部件
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        main_layout = QVBoxLayout(central_widget)
        
        # 标题
        title_label = QLabel("Excel 文件批量转换为 CSV")
        title_label.setStyleSheet("font-size: 18px; font-weight: bold; padding: 10px;")
        title_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        main_layout.addWidget(title_label)
        
        # 文件列表区域
        file_group = QGroupBox("待转换文件列表")
        file_layout = QVBoxLayout()
        
        self.file_list_widget = QListWidget()
        self.file_list_widget.setAcceptDrops(True)
        self.file_list_widget.setStyleSheet("QListWidget { border: 2px dashed #aaa; min-height: 200px; }")
        file_layout.addWidget(self.file_list_widget)
        
        # 文件操作按钮
        file_btn_layout = QHBoxLayout()
        
        self.add_btn = QPushButton("添加 Excel 文件")
        self.add_btn.clicked.connect(self.add_files)
        file_btn_layout.addWidget(self.add_btn)
        
        self.clear_btn = QPushButton("清空列表")
        self.clear_btn.clicked.connect(self.clear_files)
        file_btn_layout.addWidget(self.clear_btn)
        
        self.remove_btn = QPushButton("移除选中")
        self.remove_btn.clicked.connect(self.remove_selected)
        file_btn_layout.addWidget(self.remove_btn)
        
        file_layout.addLayout(file_btn_layout)
        file_group.setLayout(file_layout)
        main_layout.addWidget(file_group)
        
        # 输出设置区域
        output_group = QGroupBox("输出设置")
        output_layout = QVBoxLayout()
        
        # 输出目录
        dir_layout = QHBoxLayout()
        dir_layout.addWidget(QLabel("输出目录:"))
        self.output_dir_edit = QLineEdit(self.output_dir)
        self.output_dir_edit.setReadOnly(True)
        dir_layout.addWidget(self.output_dir_edit)
        
        self.browse_btn = QPushButton("浏览...")
        self.browse_btn.clicked.connect(self.browse_output_dir)
        dir_layout.addWidget(self.browse_btn)
        output_layout.addLayout(dir_layout)
        
        # 编码选项
        encoding_layout = QHBoxLayout()
        encoding_layout.addWidget(QLabel("CSV 编码:"))
        self.encoding_utf8_bom = QCheckBox("UTF-8 with BOM (推荐，Excel 友好)")
        self.encoding_utf8_bom.setChecked(True)
        encoding_layout.addWidget(self.encoding_utf8_bom)
        encoding_layout.addStretch()
        output_layout.addLayout(encoding_layout)
        
        # 索引选项
        index_layout = QHBoxLayout()
        self.include_index = QCheckBox("包含行索引")
        self.include_index.setChecked(False)
        index_layout.addWidget(self.include_index)
        index_layout.addStretch()
        output_layout.addLayout(index_layout)
        
        output_group.setLayout(output_layout)
        main_layout.addWidget(output_group)
        
        # 进度条
        self.progress_bar = QProgressBar()
        self.progress_bar.setValue(0)
        main_layout.addWidget(self.progress_bar)
        
        self.status_label = QLabel("就绪")
        self.status_label.setStyleSheet("color: #666; padding: 5px;")
        main_layout.addWidget(self.status_label)
        
        # 转换按钮
        self.convert_btn = QPushButton("开始转换")
        self.convert_btn.setStyleSheet("""
            QPushButton {
                background-color: #4CAF50;
                color: white;
                font-size: 16px;
                font-weight: bold;
                padding: 10px;
                border-radius: 5px;
            }
            QPushButton:hover {
                background-color: #45a049;
            }
            QPushButton:disabled {
                background-color: #cccccc;
                color: #666666;
            }
        """)
        self.convert_btn.clicked.connect(self.start_conversion)
        self.convert_btn.setEnabled(False)
        main_layout.addWidget(self.convert_btn)
        
        # 拖拽支持
        self.setAcceptDrops(True)
    
    def dragEnterEvent(self, event: QDragEnterEvent):
        """拖入事件"""
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
    
    def dropEvent(self, event: QDropEvent):
        """放下事件"""
        files = []
        for url in event.mimeData().urls():
            file_path = url.toLocalFile()
            if file_path.lower().endswith(('.xlsx', '.xls')):
                files.append(file_path)
        
        if files:
            self.add_files_to_list(files)
    
    def add_files(self):
        """添加文件对话框"""
        files, _ = QFileDialog.getOpenFileNames(
            self,
            "选择 Excel 文件",
            "",
            "Excel Files (*.xlsx *.xls);;All Files (*.*)"
        )
        if files:
            self.add_files_to_list(files)
    
    def add_files_to_list(self, files):
        """将文件添加到列表"""
        for file_path in files:
            if file_path not in self.file_list:
                self.file_list.append(file_path)
                self.file_list_widget.addItem(Path(file_path).name)
        
        self.update_ui_state()
    
    def clear_files(self):
        """清空文件列表"""
        self.file_list.clear()
        self.file_list_widget.clear()
        self.update_ui_state()
    
    def remove_selected(self):
        """移除选中的文件"""
        selected_items = self.file_list_widget.selectedItems()
        if not selected_items:
            return
        
        for item in selected_items:
            row = self.file_list_widget.row(item)
            self.file_list_widget.takeItem(row)
            self.file_list.pop(row)
        
        self.update_ui_state()
    
    def browse_output_dir(self):
        """浏览输出目录"""
        directory = QFileDialog.getExistingDirectory(
            self,
            "选择输出目录",
            self.output_dir
        )
        if directory:
            self.output_dir = directory
            self.output_dir_edit.setText(directory)
    
    def update_ui_state(self):
        """更新 UI 状态"""
        has_files = len(self.file_list) > 0
        self.convert_btn.setEnabled(has_files)
        self.status_label.setText(f"已选择 {len(self.file_list)} 个文件")
    
    def start_conversion(self):
        """开始转换"""
        if not self.file_list:
            return
        
        # 确保输出目录存在
        os.makedirs(self.output_dir, exist_ok=True)
        
        # 禁用按钮
        self.convert_btn.setEnabled(False)
        self.add_btn.setEnabled(False)
        self.clear_btn.setEnabled(False)
        self.remove_btn.setEnabled(False)
        self.browse_btn.setEnabled(False)
        
        # 获取设置
        encoding = 'utf-8-sig' if self.encoding_utf8_bom.isChecked() else 'utf-8'
        include_index = self.include_index.isChecked()
        
        # 创建并启动转换线程
        self.convert_thread = ConvertThread(
            self.file_list,
            self.output_dir,
            encoding,
            include_index
        )
        self.convert_thread.progress.connect(self.on_progress)
        self.convert_thread.error.connect(self.on_error)
        self.convert_thread.finished.connect(self.on_finished)
        self.convert_thread.start()
    
    def on_progress(self, percent, file_name):
        """更新进度"""
        self.progress_bar.setValue(percent)
        self.status_label.setText(f"正在转换: {file_name}")
    
    def on_error(self, file_name, error_msg):
        """处理错误"""
        print(f"转换失败 [{file_name}]: {error_msg}")
    
    def on_finished(self, success_count, fail_count):
        """转换完成"""
        self.progress_bar.setValue(100)
        
        # 恢复按钮
        self.convert_btn.setEnabled(True)
        self.add_btn.setEnabled(True)
        self.clear_btn.setEnabled(True)
        self.remove_btn.setEnabled(True)
        self.browse_btn.setEnabled(True)
        
        # 显示结果
        msg = f"转换完成！\n\n成功: {success_count} 个\n失败: {fail_count} 个\n\n输出目录: {self.output_dir}"
        
        if fail_count == 0:
            QMessageBox.information(self, "转换完成", msg)
        else:
            QMessageBox.warning(self, "转换完成（有错误）", msg)
        
        self.status_label.setText(f"转换完成 - 成功 {success_count} 个，失败 {fail_count} 个")


def main():
    """主函数"""
    app = QApplication(sys.argv)
    app.setStyle('Fusion')  # 使用 Fusion 风格，更现代
    
    window = ExcelToCsvConverter()
    window.show()
    
    sys.exit(app.exec())


if __name__ == '__main__':
    main()
