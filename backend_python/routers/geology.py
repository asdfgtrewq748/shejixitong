from fastapi import APIRouter, HTTPException
from store import store
import numpy as np
from scipy.interpolate import griddata
import pandas as pd

router = APIRouter()


@router.get("/layers")
async def get_borehole_layers():
    """
    获取钻孔分层数据，用于3D地质建模
    返回每个钻孔的完整分层序列
    """
    if not store.borehole_layer_data:
        # 如果没有分层数据，但有合并后的钻孔数据，构建模拟分层
        if store.boreholes:
            return _generate_mock_layers()
        raise HTTPException(status_code=400, detail="缺少钻孔分层数据")

    # 解析分层数据
    df = pd.DataFrame(store.borehole_layer_data)

    # 查找关键列
    name_col = next((c for c in df.columns if '名称' in c or 'name' in c.lower() or '岩性' in c), None)
    thick_col = next((c for c in df.columns if '厚' in c or 'thick' in c.lower()), None)
    id_col = next((c for c in df.columns if 'id' in c.lower() or '编号' in c or '孔号' in c), None)

    # 如果没有id列，尝试使用源文件名
    if not id_col and '_source_file' in df.columns:
        df['borehole_id'] = df['_source_file'].apply(lambda x: str(x).rsplit('.', 1)[0] if x else 'unknown')
        id_col = 'borehole_id'

    if not name_col or not thick_col:
        raise HTTPException(status_code=400, detail="分层数据缺少必要列(名称/厚度)")

    # 获取钻孔坐标
    coords = {}
    if store.borehole_coordinates:
        for c in store.borehole_coordinates:
            coords[str(c.get('id', ''))] = {'x': c.get('x', 0), 'y': c.get('y', 0)}
    elif store.boreholes:
        for b in store.boreholes:
            coords[str(b.get('id', ''))] = {'x': b.get('x', 0), 'y': b.get('y', 0)}

    # 按钻孔分组，构建分层序列
    boreholes_data = []

    if id_col:
        grouped = df.groupby(id_col)
        for bh_id, group in grouped:
            bh_id_str = str(bh_id)
            coord = coords.get(bh_id_str, {'x': 0, 'y': 0})

            layers = []
            current_depth = 0

            for _, row in group.iterrows():
                layer_name = str(row[name_col]).strip() if pd.notna(row[name_col]) else '未知'
                thickness = float(row[thick_col]) if pd.notna(row[thick_col]) else 0

                if thickness > 0:
                    layers.append({
                        'name': layer_name,
                        'thickness': thickness,
                        'top_depth': current_depth,
                        'bottom_depth': current_depth + thickness,
                        'is_coal': '煤' in layer_name
                    })
                    current_depth += thickness

            if layers:
                boreholes_data.append({
                    'id': bh_id_str,
                    'x': coord['x'],
                    'y': coord['y'],
                    'total_depth': current_depth,
                    'layers': layers
                })
    else:
        # 没有ID列，当作单个钻孔
        layers = []
        current_depth = 0

        for _, row in df.iterrows():
            layer_name = str(row[name_col]).strip() if pd.notna(row[name_col]) else '未知'
            thickness = float(row[thick_col]) if pd.notna(row[thick_col]) else 0

            if thickness > 0:
                layers.append({
                    'name': layer_name,
                    'thickness': thickness,
                    'top_depth': current_depth,
                    'bottom_depth': current_depth + thickness,
                    'is_coal': '煤' in layer_name
                })
                current_depth += thickness

        if layers:
            boreholes_data.append({
                'id': 'BH-1',
                'x': 0,
                'y': 0,
                'total_depth': current_depth,
                'layers': layers
            })

    return {
        'boreholes': boreholes_data,
        'count': len(boreholes_data),
        'total_layers': sum(len(b['layers']) for b in boreholes_data)
    }


def _generate_mock_layers():
    """
    当没有真实分层数据时，根据钻孔数据生成模拟分层
    """
    boreholes_data = []

    # 定义典型的煤矿地层序列（从上到下）
    typical_sequence = [
        {'name': '第四系', 'ratio': 0.15, 'is_coal': False},
        {'name': '砂岩', 'ratio': 0.20, 'is_coal': False},
        {'name': '泥岩', 'ratio': 0.12, 'is_coal': False},
        {'name': '粉砂岩', 'ratio': 0.10, 'is_coal': False},
        {'name': '炭质泥岩', 'ratio': 0.08, 'is_coal': False},
        {'name': '煤层', 'ratio': 0.10, 'is_coal': True},  # 煤层
        {'name': '泥岩', 'ratio': 0.10, 'is_coal': False},
        {'name': '细砂岩', 'ratio': 0.08, 'is_coal': False},
        {'name': '粉砂岩', 'ratio': 0.07, 'is_coal': False},
    ]

    for bh in store.boreholes:
        bh_id = str(bh.get('id', 'unknown'))
        x = float(bh.get('x', 0))
        y = float(bh.get('y', 0))
        coal_thickness = float(bh.get('coalThickness', bh.get('thickness', 3)))

        # 假设总深度是煤厚的10-15倍
        total_depth = coal_thickness * (10 + np.random.random() * 5)

        layers = []
        current_depth = 0

        for seq in typical_sequence:
            if seq['is_coal']:
                thickness = coal_thickness
            else:
                # 根据比例和一些随机变化计算厚度
                base_thick = total_depth * seq['ratio']
                thickness = base_thick * (0.8 + np.random.random() * 0.4)

            layers.append({
                'name': seq['name'],
                'thickness': round(thickness, 2),
                'top_depth': round(current_depth, 2),
                'bottom_depth': round(current_depth + thickness, 2),
                'is_coal': seq['is_coal']
            })
            current_depth += thickness

        boreholes_data.append({
            'id': bh_id,
            'x': x,
            'y': y,
            'total_depth': round(current_depth, 2),
            'layers': layers
        })

    return {
        'boreholes': boreholes_data,
        'count': len(boreholes_data),
        'total_layers': sum(len(b['layers']) for b in boreholes_data),
        'is_mock': True
    }


@router.post("/")
async def generate_geology(resolution: int = 50):
    if not store.boreholes:
        raise HTTPException(status_code=400, detail="缺少钻孔数据")
        
    # 提取数据点
    points = []
    values = []
    
    for b in store.boreholes:
        if 'x' in b and 'y' in b and 'coalThickness' in b:
            points.append([b['x'], b['y']])
            values.append(b['coalThickness'])
            
    if len(points) < 3:
        raise HTTPException(status_code=400, detail="钻孔数据不足，无法生成模型")
        
    points = np.array(points)
    values = np.array(values)
    
    # 创建网格
    min_x, min_y = points.min(axis=0)
    max_x, max_y = points.max(axis=0)
    
    grid_x, grid_y = np.mgrid[min_x:max_x:complex(0, resolution), min_y:max_y:complex(0, resolution)]
    
    # 插值 (使用 cubic 插值，如果点太少会退化为 linear)
    try:
        grid_z = griddata(points, values, (grid_x, grid_y), method='cubic')
    except:
        grid_z = griddata(points, values, (grid_x, grid_y), method='linear')
        
    # 替换 NaN
    grid_z = np.nan_to_num(grid_z)
    
    # 保存结果
    store.geology_model = {
        "resolution": resolution,
        "minX": float(min_x),
        "minY": float(min_y),
        "maxX": float(max_x),
        "maxY": float(max_y),
        "data": grid_z.tolist()
    }
    
    return {"success": True, "model": store.geology_model}

@router.get("/")
async def get_geology():
    return store.geology_model or {}
