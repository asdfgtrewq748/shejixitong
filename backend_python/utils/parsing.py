import pandas as pd
import numpy as np
from io import StringIO, BytesIO
from typing import List, Dict

def parse_csv_file(file_content: bytes) -> List[Dict]:
    """
    解析 CSV 文件内容，处理 BOM 和列名
    """
    # 尝试解码，处理 UTF-8 BOM
    try:
        content_str = file_content.decode('utf-8-sig')
    except UnicodeDecodeError:
        content_str = file_content.decode('gbk') # 尝试 GBK

    df = pd.read_csv(StringIO(content_str))
    
    # 清理列名（去除空格）
    df.columns = df.columns.str.strip()
    
    # 替换 NaN 为 None (JSON 兼容)
    df = df.replace({np.nan: None})
    
    return df.to_dict(orient='records')

def normalize_columns(data: List[Dict], type: str) -> List[Dict]:
    """
    标准化列名
    """
    if not data:
        return []
        
    normalized = []
    for row in data:
        new_row = {}
        for k, v in row.items():
            key = k.lower()
            try:
                if type == 'boundary':
                    if 'x' in key: new_row['x'] = float(v)
                    elif 'y' in key: new_row['y'] = float(v)
                elif type == 'coordinate':
                    # 宽松匹配 ID
                    if any(x in key for x in ['id', '编号', '孔号', 'name', '名称', '钻孔']): 
                        new_row['id'] = str(v)
                    # 宽松匹配 X
                    elif any(x in key for x in ['x', 'east', '东']): 
                        new_row['x'] = float(v)
                    # 宽松匹配 Y
                    elif any(x in key for x in ['y', 'north', '北']): 
                        new_row['y'] = float(v)
            except (ValueError, TypeError):
                continue # 忽略无法转换的数据
        
        # 只有当关键字段存在时才添加
        if type == 'boundary' and 'x' in new_row and 'y' in new_row:
            normalized.append(new_row)
        elif type == 'coordinate' and 'id' in new_row and 'x' in new_row and 'y' in new_row:
            normalized.append(new_row)
            
    return normalized
