#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
钻孔数据格式转换工具
将详细的地层钻孔数据转换为系统所需的简化格式
"""

import pandas as pd
import sys
import os

def convert_borehole_data(input_file, output_file=None):
    """
    转换钻孔数据格式
    
    参数:
        input_file: 原始钻孔数据文件路径（如 O10.csv）
        output_file: 输出文件路径（可选，默认为原文件名_converted.csv）
    """
    try:
        # 读取原始数据
        df = pd.read_csv(input_file, encoding='utf-8')
        
        # 检查必需的列
        required_cols = ['岩石名称', '层厚']
        if not all(col in df.columns for col in required_cols):
            print(f"错误：文件缺少必需的列 {required_cols}")
            return False
        
        # 过滤掉空行
        df = df[df['岩石名称'].notna() & (df['岩石名称'] != '')]
        
        # 从下到上重新排序（原数据从上到下）
        df = df.iloc[::-1].reset_index(drop=True)
        
        # 创建新的数据框
        converted_data = {
            '序号(从下到上)': range(1, len(df) + 1),
            '名称': df['岩石名称'].values,
            '厚度/m': df['层厚'].values,
            '弹性模量/Gpa': '',
            '容重/kN*m-3': '',
            '抗拉强度/MPa': ''
        }
        
        result_df = pd.DataFrame(converted_data)
        
        # 确定输出文件名
        if output_file is None:
            base_name = os.path.splitext(input_file)[0]
            output_file = f"{base_name}_converted.csv"
        
        # 保存转换后的数据
        result_df.to_csv(output_file, index=False, encoding='utf-8-sig')
        
        print(f"✓ 转换成功！")
        print(f"  输入文件: {input_file}")
        print(f"  输出文件: {output_file}")
        print(f"  地层数量: {len(result_df)}")
        print(f"\n前5层预览:")
        print(result_df.head())
        
        return True
        
    except Exception as e:
        print(f"× 转换失败: {e}")
        return False


def batch_convert(input_dir, output_dir=None):
    """
    批量转换目录下所有钻孔文件
    
    参数:
        input_dir: 输入目录
        output_dir: 输出目录（可选，默认为input_dir/converted）
    """
    if output_dir is None:
        output_dir = os.path.join(input_dir, 'converted')
    
    # 创建输出目录
    os.makedirs(output_dir, exist_ok=True)
    
    # 查找所有CSV文件
    csv_files = [f for f in os.listdir(input_dir) if f.endswith('.csv')]
    
    print(f"找到 {len(csv_files)} 个CSV文件")
    print(f"输出目录: {output_dir}\n")
    
    success_count = 0
    for csv_file in csv_files:
        input_path = os.path.join(input_dir, csv_file)
        output_path = os.path.join(output_dir, csv_file)
        
        print(f"正在转换: {csv_file}...")
        if convert_borehole_data(input_path, output_path):
            success_count += 1
        print()
    
    print(f"\n批量转换完成: {success_count}/{len(csv_files)} 成功")


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("用法:")
        print("  单个文件转换: python convert_borehole_data.py <输入文件> [输出文件]")
        print("  批量转换:     python convert_borehole_data.py --batch <输入目录> [输出目录]")
        print("\n示例:")
        print("  python convert_borehole_data.py O10.csv")
        print("  python convert_borehole_data.py O10.csv O10_ready.csv")
        print("  python convert_borehole_data.py --batch ./钻孔资料")
        sys.exit(1)
    
    if sys.argv[1] == '--batch':
        # 批量转换模式
        input_dir = sys.argv[2] if len(sys.argv) > 2 else '.'
        output_dir = sys.argv[3] if len(sys.argv) > 3 else None
        batch_convert(input_dir, output_dir)
    else:
        # 单文件转换模式
        input_file = sys.argv[1]
        output_file = sys.argv[2] if len(sys.argv) > 2 else None
        convert_borehole_data(input_file, output_file)
