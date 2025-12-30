"""
覆岩扰动评价系统 - API路由
"""

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from pydantic import BaseModel
from typing import List, Dict, Optional
import pandas as pd
import numpy as np
import io
import json
import base64


def read_csv_with_encoding(content: bytes) -> pd.DataFrame:
    """尝试多种编码读取CSV文件"""
    encodings = ['utf-8-sig', 'utf-8', 'gbk', 'gb18030', 'gb2312', 'latin-1']

    for encoding in encodings:
        try:
            return pd.read_csv(io.BytesIO(content), encoding=encoding)
        except (UnicodeDecodeError, LookupError):
            continue

    # 最后尝试忽略错误
    return pd.read_csv(io.BytesIO(content), encoding='utf-8', errors='ignore')


def safe_float(value, default=0.0) -> float:
    """安全地将值转换为浮点数，处理格式错误"""
    if pd.isna(value):
        return default
    try:
        return float(value)
    except (ValueError, TypeError):
        # 尝试修复常见格式错误，如 "0..3" -> "0.3"
        str_val = str(value).strip()
        # 移除多余的点
        while '..' in str_val:
            str_val = str_val.replace('..', '.')
        try:
            return float(str_val)
        except (ValueError, TypeError):
            return default


def sanitize_for_json(obj, default=0.0):
    """递归清理对象中的 nan/inf 值，使其可以 JSON 序列化"""
    import math

    if isinstance(obj, dict):
        return {k: sanitize_for_json(v, default) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [sanitize_for_json(item, default) for item in obj]
    elif isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return default
        return obj
    elif isinstance(obj, np.floating):
        if np.isnan(obj) or np.isinf(obj):
            return default
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return sanitize_for_json(obj.tolist(), default)
    else:
        return obj

from utils.odi_calculator_v2 import (
    ODICalculatorV2 as ODICalculator,
    ScenarioType,
    BASE_WEIGHT_MATRIX_8X9 as BASE_WEIGHT_MATRIX,
    SCENARIO_WEIGHTS,
    ODI_LEVELS,
    get_elastic_modulus,
)
from utils.odi_calculator import (
    identify_target_layer,
    identify_key_layer,
    is_point_in_polygon,
)

router = APIRouter()


# =============================================================================
# 数据验证函数 (优化2.4)
# =============================================================================

def validate_coordinates(x: float, y: float, name: str = "坐标") -> tuple:
    """
    验证坐标值有效性

    Returns:
        (is_valid: bool, error_message: str)
    """
    if x is None or y is None:
        return False, f"{name}不能为空"

    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return False, f"{name}必须是数值类型"

    if not (-1e9 < x < 1e9 and -1e9 < y < 1e9):
        return False, f"{name}超出合理范围 (±10^9)"

    if np.isnan(x) or np.isnan(y) or np.isinf(x) or np.isinf(y):
        return False, f"{name}包含无效值 (NaN/Inf)"

    return True, ""


def validate_workface_coords(coords: List[Dict]) -> tuple:
    """
    验证工作面坐标

    Returns:
        (is_valid: bool, error_message: str, warnings: List[str])
    """
    warnings = []

    if not coords:
        return False, "工作面坐标为空", warnings

    if len(coords) < 3:
        return False, f"工作面坐标至少需要3个点，当前只有{len(coords)}个", warnings

    if len(coords) < 4:
        warnings.append("工作面坐标少于4个点，可能不是标准矩形")

    # 检查每个点的坐标
    for i, p in enumerate(coords):
        x, y = p.get("x"), p.get("y")
        is_valid, msg = validate_coordinates(x, y, f"第{i+1}个点")
        if not is_valid:
            return False, msg, warnings

    # 检查重复点
    seen_points = set()
    for i, p in enumerate(coords):
        key = (round(p.get("x", 0), 2), round(p.get("y", 0), 2))
        if key in seen_points:
            warnings.append(f"第{i+1}个点与之前的点重复")
        seen_points.add(key)

    # 检查多边形是否自相交 (简化检测)
    n = len(coords)
    if n >= 4:
        # 使用边相交检测
        def segments_intersect(p1, p2, p3, p4):
            """检测两条线段是否相交"""
            def ccw(A, B, C):
                return (C[1]-A[1]) * (B[0]-A[0]) > (B[1]-A[1]) * (C[0]-A[0])
            return ccw(p1, p3, p4) != ccw(p2, p3, p4) and ccw(p1, p2, p3) != ccw(p1, p2, p4)

        for i in range(n):
            for j in range(i + 2, n):
                if i == 0 and j == n - 1:
                    continue  # 跳过相邻边
                p1 = (coords[i]["x"], coords[i]["y"])
                p2 = (coords[(i+1) % n]["x"], coords[(i+1) % n]["y"])
                p3 = (coords[j]["x"], coords[j]["y"])
                p4 = (coords[(j+1) % n]["x"], coords[(j+1) % n]["y"])
                if segments_intersect(p1, p2, p3, p4):
                    return False, "工作面多边形边界自相交，请检查坐标顺序", warnings

    return True, "", warnings


def validate_borehole_data(boreholes: List[Dict]) -> tuple:
    """
    验证钻孔数据

    Returns:
        (is_valid: bool, error_message: str, warnings: List[str])
    """
    warnings = []

    if not boreholes:
        return False, "钻孔数据为空", warnings

    # 检查重复ID
    ids = [b.get("id", "") for b in boreholes]
    duplicates = [id for id in set(ids) if ids.count(id) > 1]
    if duplicates:
        warnings.append(f"发现重复的钻孔ID: {', '.join(duplicates[:5])}")

    # 检查每个钻孔
    for i, bh in enumerate(boreholes):
        bh_id = bh.get("id", f"第{i+1}个")

        # 检查坐标
        x, y = bh.get("x"), bh.get("y")
        is_valid, msg = validate_coordinates(x, y, f"钻孔{bh_id}坐标")
        if not is_valid:
            return False, msg, warnings

        # 检查地质参数范围
        Ti = bh.get("Ti", 0)
        if Ti is not None and (Ti < 0 or Ti > 1000):
            warnings.append(f"钻孔{bh_id}的目标层厚度Ti={Ti}m可能异常")

        Hi = bh.get("Hi", 0)
        if Hi is not None and (Hi < 0 or Hi > 2000):
            warnings.append(f"钻孔{bh_id}的间距Hi={Hi}m可能异常")

        Di = bh.get("Di", 0)
        if Di is not None and (Di < 0 or Di > 3000):
            warnings.append(f"钻孔{bh_id}的埋深Di={Di}m可能异常")

        Ei = bh.get("Ei", 10)
        if Ei is not None and (Ei < 0.1 or Ei > 100):
            warnings.append(f"钻孔{bh_id}的弹性模量Ei={Ei}GPa可能异常 (正常范围0.1-100)")

    return True, "", warnings


def validate_layer_data(layers: List[Dict], borehole_id: str) -> tuple:
    """
    验证地层数据

    Returns:
        (is_valid: bool, error_message: str, warnings: List[str])
    """
    warnings = []

    if not layers:
        return False, f"钻孔{borehole_id}的地层数据为空", warnings

    cumulative_depth = 0
    for i, layer in enumerate(layers):
        layer_name = layer.get("name", f"第{i+1}层")

        # 检查厚度
        thickness = layer.get("thickness", 0)
        if thickness is None or thickness < 0:
            return False, f"钻孔{borehole_id}的{layer_name}厚度无效", warnings
        if thickness == 0:
            warnings.append(f"钻孔{borehole_id}的{layer_name}厚度为0")
        if thickness > 500:
            warnings.append(f"钻孔{borehole_id}的{layer_name}厚度{thickness}m可能异常")

        # 检查弹性模量
        modulus = layer.get("elastic_modulus", 10)
        if modulus is not None and (modulus < 0.1 or modulus > 100):
            warnings.append(f"钻孔{borehole_id}的{layer_name}弹性模量{modulus}GPa可能异常")

        cumulative_depth += thickness

    # 检查总深度
    if cumulative_depth > 3000:
        warnings.append(f"钻孔{borehole_id}总深度{cumulative_depth:.1f}m超过3000m，请确认")

    return True, "", warnings


class ScenarioWeights(BaseModel):
    """场景权重配置"""
    wd: float = 0.45
    wo: float = 0.30
    wf: float = 0.25


class DisturbanceRequest(BaseModel):
    """扰动评价请求"""
    scenario: str = "surface_subsidence"  # surface_subsidence, aquifer_disturbance, upward_mining
    mining_height: float = 3.0  # 采高
    step_size: float = 25.0  # 评价点步长
    pillar_width: Optional[float] = None  # 明确给定煤柱宽度（可选）
    neighbor_workfaces: List[List[Dict]] = []  # 相邻工作面多边形列表
    custom_weights: Optional[ScenarioWeights] = None
    borehole_data: List[Dict] = []
    workface_coords: List[Dict] = []
    measured_data: List[Dict] = [] # 实测数据 (可选，用于校准等级)


class MeasuredDataRequest(BaseModel):
    """实测数据请求"""
    measured_points: List[Dict] = []


# 存储计算结果
_calculation_cache = {}

# 计算进度状态 (优化3.2)
_calculation_progress = {
    "status": "idle",      # idle, running, completed, error
    "current": 0,
    "total": 0,
    "message": "",
    "start_time": None
}


def update_progress(current: int, total: int, message: str = ""):
    """更新计算进度"""
    _calculation_progress["current"] = current
    _calculation_progress["total"] = total
    _calculation_progress["message"] = message
    if current > 0 and total > 0:
        _calculation_progress["percent"] = round(current / total * 100, 1)


@router.get("/calculate/progress")
async def get_calculation_progress():
    """获取计算进度 (优化3.2)"""
    return _calculation_progress


@router.get("/scenarios")
async def get_scenarios():
    """获取可用场景列表"""
    return {
        "scenarios": [
            {
                "id": "surface_subsidence",
                "name": "地表下沉",
                "description": "评价地表沉陷风险",
                "default_weights": SCENARIO_WEIGHTS[ScenarioType.SURFACE_SUBSIDENCE]
            },
            {
                "id": "aquifer_disturbance",
                "name": "含水层扰动",
                "description": "预测突水风险",
                "default_weights": SCENARIO_WEIGHTS[ScenarioType.AQUIFER_DISTURBANCE]
            },
            {
                "id": "upward_mining",
                "name": "上行开采可行性",
                "description": "评估上煤层开采难度",
                "default_weights": SCENARIO_WEIGHTS[ScenarioType.UPWARD_MINING]
            }
        ]
    }


@router.get("/weight-matrix")
async def get_weight_matrix():
    """获取权重矩阵"""
    factor_names = ["Di", "Ei", "Hi", "lci", "lpi", "Mi", "Ti", "δi"]
    indicator_names = ["Smax", "DSmax", "Kσ", "Dσmax", "Aσ", "Hf", "Kw", "Bf", "Af"]

    return {
        "factors": factor_names,
        "indicators": indicator_names,
        "matrix": BASE_WEIGHT_MATRIX.tolist(),
        "editable": True
    }


@router.get("/odi-levels")
async def get_odi_levels():
    """获取ODI等级划分标准"""
    return {"levels": ODI_LEVELS}


@router.post("/upload/boreholes")
async def upload_boreholes(file: UploadFile = File(...)):
    """上传钻孔坐标数据"""
    try:
        content = await file.read()

        if file.filename.endswith('.csv'):
            df = read_csv_with_encoding(content)
        else:
            df = pd.read_excel(io.BytesIO(content))

        # 标准化列名
        df.columns = [str(c).strip() for c in df.columns]

        # 尝试识别列
        result = []
        for idx, row in df.iterrows():
            item = {"id": str(row.iloc[0])}

            # 尝试找坐标列
            for col in df.columns:
                col_lower = col.lower()
                if 'x' in col_lower or '坐标' in col:
                    if 'x' in col_lower:
                        item["x"] = float(row[col])
                    elif item.get("x") is None:
                        item["x"] = float(row[col])
                if 'y' in col_lower:
                    item["y"] = float(row[col])

            # 如果只有两列数值，假设是 x, y
            if "x" not in item or "y" not in item:
                numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
                if len(numeric_cols) >= 2:
                    item["x"] = float(row[numeric_cols[0]])
                    item["y"] = float(row[numeric_cols[1]])

            result.append(item)

        return {"success": True, "count": len(result), "data": result}

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"文件解析失败: {str(e)}")


@router.post("/upload/borehole-layers/{borehole_id}")
async def upload_borehole_layers(borehole_id: str, file: UploadFile = File(...)):
    """上传单个钻孔的地层数据"""
    try:
        content = await file.read()

        if file.filename.endswith('.csv'):
            df = read_csv_with_encoding(content)
        else:
            df = pd.read_excel(io.BytesIO(content))

        layers = []
        cumulative_depth = 0

        # 尝试识别列名
        df.columns = [str(c).strip() for c in df.columns]
        col_map = {}
        for col in df.columns:
            col_lower = col.lower()
            if '序号' in col or 'sequence' in col_lower:
                col_map['sequence'] = col
            elif '名称' in col or 'name' in col_lower or '岩性' in col:
                col_map['name'] = col
            elif '厚度' in col or 'thickness' in col_lower:
                col_map['thickness'] = col
            elif '弹性模量' in col or 'modulus' in col_lower or 'gpa' in col_lower:
                col_map['modulus'] = col
            elif '含水' in col or 'aquifer' in col_lower or '富水' in col:
                col_map['aquifer'] = col
            elif '目标' in col or 'target' in col_lower:
                col_map['target'] = col

        for idx, row in df.iterrows():
            # 解析基本信息
            layer = {
                "sequence": int(row[col_map.get('sequence', df.columns[0])]) if col_map.get('sequence') and not pd.isna(row[col_map['sequence']]) else idx + 1,
                "name": str(row[col_map.get('name', df.columns[1])]).strip() if col_map.get('name') or len(df.columns) > 1 else "",
                "thickness": safe_float(row[col_map.get('thickness', df.columns[2])]) if col_map.get('thickness') or len(df.columns) > 2 else 0,
            }

            # 弹性模量：优先使用文件中的值，否则根据岩性映射
            if col_map.get('modulus'):
                file_modulus = safe_float(row[col_map['modulus']], None)
                if file_modulus and file_modulus > 0:
                    layer["elastic_modulus"] = file_modulus
                else:
                    layer["elastic_modulus"] = get_elastic_modulus(layer["name"])
            else:
                layer["elastic_modulus"] = get_elastic_modulus(layer["name"])

            # 识别含水层
            layer["is_aquifer"] = False
            if col_map.get('aquifer'):
                marker = str(row[col_map['aquifer']]).strip() if not pd.isna(row[col_map['aquifer']]) else ""
                layer["aquifer_marker"] = marker
                layer["is_aquifer"] = "含" in marker or "富水" in marker or "aquifer" in marker.lower()
            else:
                # 从名称识别
                layer["is_aquifer"] = "含水" in layer["name"] or "富水" in layer["name"]

            # 识别目标层标记
            if col_map.get('target'):
                target = str(row[col_map['target']]).strip() if not pd.isna(row[col_map['target']]) else ""
                layer["is_target"] = "目标" in target or "target" in target.lower()
            else:
                layer["is_target"] = False

            # 计算深度
            layer["top_depth"] = cumulative_depth
            cumulative_depth += layer["thickness"]
            layer["bottom_depth"] = cumulative_depth

            layers.append(layer)

        # 计算地质参数
        geo_params = calculate_geo_params_from_layers(layers)

        return {
            "success": True,
            "borehole_id": borehole_id,
            "layer_count": len(layers),
            "layers": layers,
            "geo_params": geo_params
        }

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"文件解析失败: {str(e)}")


def calculate_geo_params_from_layers(layers: List[Dict], scenario: ScenarioType = ScenarioType.SURFACE_SUBSIDENCE) -> Dict:
    """从地层数据计算地质参数，并识别目标层、关键层、煤层"""
    if not layers:
        return {"Ti": 0, "Ei": 0, "Hi": 0, "Di": 0, "coal_thickness": 0}

    # 识别含水层（若存在）
    aquifer_layer = next((l for l in layers if l.get("is_aquifer")), None)

    # 识别目标层
    target_layer = identify_target_layer(layers, scenario, aquifer_layer=aquifer_layer)
    key_layer = identify_key_layer(layers)

    # 识别主采煤层：取最厚的含"煤"层
    coal_layer = None
    coal_depth = 0
    cumulative = 0
    for layer in layers:
        name = layer.get("name", "")
        if "煤" in name:
            if coal_layer is None or layer.get("thickness", 0) > coal_layer.get("thickness", 0):
                coal_layer = layer
                coal_depth = cumulative
        cumulative += layer.get("thickness", 0)

    # 目标层埋深
    target_depth = 0
    cumulative = 0
    for layer in layers:
        if layer is target_layer:
            target_depth = cumulative
            break
        cumulative += layer.get("thickness", 0)

    result = {
        "Ti": target_layer.get("thickness", 0) if target_layer else 0,
        "Ei": target_layer.get("elastic_modulus", 10) if target_layer else 10,
        "Di": target_depth,
        "Hi": abs(coal_depth - target_depth) if coal_layer else 0,
        "coal_thickness": coal_layer.get("thickness", 0) if coal_layer else 0,
        "target_layer_name": target_layer.get("name", "") if target_layer else "",
        "key_layer_name": key_layer.get("name", "") if key_layer else "",
        "coal_layer_name": coal_layer.get("name", "") if coal_layer else "",
    }

    return result


@router.post("/upload/workface")
async def upload_workface(file: UploadFile = File(...)):
    """上传工作面坐标"""
    try:
        content = await file.read()

        if file.filename.endswith('.csv'):
            df = read_csv_with_encoding(content)
        else:
            df = pd.read_excel(io.BytesIO(content))

        # 识别列名
        df.columns = [str(c).strip() for c in df.columns]
        x_col = None
        y_col = None
        for col in df.columns:
            col_lower = str(col).lower()
            if x_col is None and ('x' == col_lower or 'x坐标' in col_lower or 'xcoord' in col_lower):
                x_col = col
            if y_col is None and ('y' == col_lower or 'y坐标' in col_lower or 'ycoord' in col_lower):
                y_col = col

        coords = []
        for idx, row in df.iterrows():
            coord = {
                "id": str(row.iloc[0]) if not pd.isna(row.iloc[0]) else f"P{idx}",
            }

            if x_col and y_col:
                coord["x"] = float(row[x_col])
                coord["y"] = float(row[y_col])
            else:
                # 回退：取数值列前两个，但跳过id列若其为数值
                numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
                if numeric_cols and numeric_cols[0] == df.columns[0] and len(numeric_cols) > 2:
                    numeric_cols = numeric_cols[1:]  # 跳过可能的ID列
                if len(numeric_cols) >= 2:
                    coord["x"] = float(row[numeric_cols[0]])
                    coord["y"] = float(row[numeric_cols[1]])
                else:
                    coord["x"] = float(row.iloc[1]) if len(row) > 1 else 0
                    coord["y"] = float(row.iloc[2]) if len(row) > 2 else 0

            coords.append(coord)

        # 根据质心按极角排序，保证多边形顺序一致
        if len(coords) >= 3:
            cx = sum(c["x"] for c in coords) / len(coords)
            cy = sum(c["y"] for c in coords) / len(coords)
            coords.sort(key=lambda c: np.arctan2(c["y"] - cy, c["x"] - cx))

        return {"success": True, "count": len(coords), "data": coords}

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"文件解析失败: {str(e)}")


@router.post("/upload/measured")
async def upload_measured(file: UploadFile = File(...)):
    """上传实测数据"""
    try:
        content = await file.read()

        if file.filename.endswith('.csv'):
            df = read_csv_with_encoding(content)
        else:
            df = pd.read_excel(io.BytesIO(content))

        data = []
        for idx, row in df.iterrows():
            item = {
                "id": str(row.iloc[0]) if not pd.isna(row.iloc[0]) else f"M{idx}",
            }

            # 解析坐标和实测值
            numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
            if len(numeric_cols) >= 3:
                item["x"] = float(row[numeric_cols[0]])
                item["y"] = float(row[numeric_cols[1]])
                item["value"] = float(row[numeric_cols[2]])

            data.append(item)

        return {"success": True, "count": len(data), "data": data}

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"文件解析失败: {str(e)}")


@router.post("/calculate")
async def calculate_odi(request: DisturbanceRequest):
    """计算ODI"""
    import time
    try:
        # 初始化进度 (优化3.2)
        _calculation_progress["status"] = "running"
        _calculation_progress["current"] = 0
        _calculation_progress["total"] = 100
        _calculation_progress["message"] = "正在验证数据..."
        _calculation_progress["start_time"] = time.time()

        # ========== 数据验证 (优化2.4) ==========
        all_warnings = []

        # 验证钻孔数据
        is_valid, error_msg, warnings = validate_borehole_data(request.borehole_data)
        if not is_valid:
            _calculation_progress["status"] = "error"
            _calculation_progress["message"] = error_msg
            raise HTTPException(status_code=400, detail=f"钻孔数据验证失败: {error_msg}")
        all_warnings.extend(warnings)

        # 验证工作面坐标
        is_valid, error_msg, warnings = validate_workface_coords(request.workface_coords)
        if not is_valid:
            _calculation_progress["status"] = "error"
            _calculation_progress["message"] = error_msg
            raise HTTPException(status_code=400, detail=f"工作面坐标验证失败: {error_msg}")
        all_warnings.extend(warnings)

        update_progress(10, 100, "数据验证完成，正在初始化计算器...")

        # ========== 原有计算逻辑 ==========
        # 解析场景
        scenario_map = {
            "surface_subsidence": ScenarioType.SURFACE_SUBSIDENCE,
            "aquifer_disturbance": ScenarioType.AQUIFER_DISTURBANCE,
            "upward_mining": ScenarioType.UPWARD_MINING,
        }
        scenario = scenario_map.get(request.scenario, ScenarioType.SURFACE_SUBSIDENCE)

        # 创建计算器 (使用拟合矩阵模式以匹配验证数据)
        calculator = ODICalculator(scenario, use_fitted_matrix=True)
        calculator.mining_height = request.mining_height
        calculator.step_size = request.step_size
        if request.pillar_width is not None:
            calculator.pillar_width = request.pillar_width

        # 设置自定义权重
        if request.custom_weights:
            calculator.set_custom_weights(
                request.custom_weights.wd,
                request.custom_weights.wo,
                request.custom_weights.wf
            )

        update_progress(20, 100, "正在加载钻孔数据...")

        # 加载钻孔坐标
        calculator.load_borehole_coords(request.borehole_data)

        # 加载钻孔参数
        for bh in request.borehole_data:
            bh_id = bh.get("id", "")
            calculator.load_borehole_params(bh_id, {
                "Ti": bh.get("Ti", 0),
                "Ei": bh.get("Ei", 10.0),
                "Hi": bh.get("Hi", 0),
                "Di": bh.get("Di", 0),
                "coal_thickness": bh.get("coal_thickness", 0),
            })

        update_progress(30, 100, "正在加载工作面坐标...")

        # 加载工作面坐标
        if request.workface_coords:
            calculator.load_workface(request.workface_coords)

        # 加载实测数据 (如果存在)
        if request.measured_data:
            calculator.load_measured_data(request.measured_data)

        update_progress(40, 100, "正在计算ODI...")

        # 计算
        results = calculator.calculate_all()

        update_progress(80, 100, "正在生成等值线...")

        # 生成等值线数据
        contours = generate_contours(results, request.workface_coords)

        update_progress(90, 100, "正在整理结果...")

        # 缓存结果
        _calculation_cache["last_result"] = results
        _calculation_cache["last_contours"] = contours
        _calculation_cache["last_workface_coords"] = request.workface_coords

        # 计算统计信息并清理 nan/inf 值
        odi_values = [r["odi"] for r in results] if results else [0]

        # 计算耗时
        elapsed_time = time.time() - _calculation_progress.get("start_time", time.time())

        response_data = {
            "success": True,
            "point_count": len(results),
            "results": results,
            "contours": contours,
            "scenario": request.scenario,
            "weights": calculator.scenario_weights,
            "statistics": {
                "min_odi": min(odi_values),
                "max_odi": max(odi_values),
                "mean_odi": float(np.mean(odi_values)),
                "level_distribution": count_levels(results)
            },
            "warnings": all_warnings if all_warnings else None,  # 返回验证警告
            "elapsed_time": round(elapsed_time, 2)  # 返回计算耗时
        }

        # 更新进度为完成
        _calculation_progress["status"] = "completed"
        _calculation_progress["current"] = 100
        _calculation_progress["total"] = 100
        _calculation_progress["message"] = f"计算完成，共{len(results)}个评价点，耗时{elapsed_time:.2f}秒"

        # 清理所有 nan/inf 值确保 JSON 可序列化
        return sanitize_for_json(response_data)

    except HTTPException:
        raise  # 重新抛出HTTP异常（来自数据验证）
    except Exception as e:
        _calculation_progress["status"] = "error"
        _calculation_progress["message"] = str(e)
        raise HTTPException(status_code=500, detail=f"计算失败: {str(e)}")


# =============================================================================
# 项目保存与加载 (优化3.3)
# =============================================================================

class ProjectData(BaseModel):
    """项目数据模型"""
    version: str = "1.0"
    scenario: str = "surface_subsidence"
    mining_params: Dict = {}
    custom_weights: Optional[Dict] = None
    borehole_coords: List[Dict] = []
    borehole_layers: Dict = {}
    workface_coords: List[Dict] = []
    measured_data: List[Dict] = []
    results: Optional[List[Dict]] = None
    notes: str = ""


@router.post("/project/save")
async def save_project(project_data: ProjectData):
    """保存项目数据 (优化3.3)"""
    import json
    from datetime import datetime
    from fastapi.responses import Response

    try:
        # 构建项目数据
        project = {
            "version": project_data.version,
            "created_at": datetime.now().isoformat(),
            "scenario": project_data.scenario,
            "mining_params": project_data.mining_params,
            "custom_weights": project_data.custom_weights,
            "borehole_coords": project_data.borehole_coords,
            "borehole_layers": project_data.borehole_layers,
            "workface_coords": project_data.workface_coords,
            "measured_data": project_data.measured_data,
            "results": project_data.results,
            "notes": project_data.notes
        }

        # 清理数据中的NaN/Inf
        project = sanitize_for_json(project)

        # 转换为JSON字符串
        json_str = json.dumps(project, ensure_ascii=False, indent=2)

        # 返回JSON文件下载
        filename = f"odi_project_{datetime.now().strftime('%Y%m%d_%H%M%S')}.odi"
        return Response(
            content=json_str,
            media_type="application/json",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"'
            }
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存项目失败: {str(e)}")


@router.post("/project/load")
async def load_project(file: UploadFile = File(...)):
    """加载项目文件 (优化3.3)"""
    import json

    try:
        content = await file.read()

        # 尝试解析JSON
        try:
            project = json.loads(content.decode('utf-8'))
        except:
            try:
                project = json.loads(content.decode('gbk'))
            except:
                raise ValueError("无法解析项目文件，请确保是有效的ODI项目文件")

        # 验证版本
        version = project.get("version", "1.0")
        if not version.startswith("1."):
            raise ValueError(f"不支持的项目版本: {version}")

        # 返回项目数据
        return {
            "success": True,
            "version": version,
            "created_at": project.get("created_at"),
            "scenario": project.get("scenario", "surface_subsidence"),
            "mining_params": project.get("mining_params", {}),
            "custom_weights": project.get("custom_weights"),
            "borehole_coords": project.get("borehole_coords", []),
            "borehole_layers": project.get("borehole_layers", {}),
            "workface_coords": project.get("workface_coords", []),
            "measured_data": project.get("measured_data", []),
            "results": project.get("results"),
            "notes": project.get("notes", "")
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"加载项目失败: {str(e)}")


@router.get("/contours/geology")
async def get_geology_contours(field: str = "Ti", levels: int = 10):
    """获取地质/采矿参数等值线（依赖最近一次计算结果）"""
    results = _calculation_cache.get("last_result")
    workface_coords = _calculation_cache.get("last_workface_coords", [])
    if not results:
        raise HTTPException(status_code=400, detail="请先完成一次ODI计算")

    contours = generate_param_contours(results, workface_coords, field, levels=levels)
    return sanitize_for_json({"success": True, "field": field, "contours": contours})


def generate_contours(results: List[Dict], workface_coords: List[Dict] = None, levels: int = 10) -> Dict:
    """生成等值线数据，仅在工作面多边形内填充"""
    if not results:
        return {"isolines": [], "bounds": {}}

    # 提取坐标和ODI值
    x = np.array([r["x"] for r in results])
    y = np.array([r["y"] for r in results])
    z = np.array([r["odi_normalized"] for r in results])

    # 计算边界
    bounds = {
        "min_x": float(x.min()),
        "max_x": float(x.max()),
        "min_y": float(y.min()),
        "max_y": float(y.max()),
        "min_z": float(z.min()),
        "max_z": float(z.max())
    }

    # 生成网格
    try:
        from scipy.interpolate import griddata

        # 提高网格密度以获得更平滑的效果 (50 -> 200)
        # 解决"锯齿"和"不平滑"问题
        grid_x = np.linspace(x.min(), x.max(), 200)
        grid_y = np.linspace(y.min(), y.max(), 200)
        grid_xx, grid_yy = np.meshgrid(grid_x, grid_y)

        # 优先使用三次样条插值 (cubic) 以获得平滑曲线
        try:
            grid_z = griddata((x, y), z, (grid_xx, grid_yy), method='cubic')
        except Exception:
            # 如果点数太少或其他原因失败，回退到线性插值
            grid_z = griddata((x, y), z, (grid_xx, grid_yy), method='linear')

        # 限制插值结果在合理范围内 (0-1)
        # cubic插值可能会产生过冲，需要截断
        if grid_z is not None:
            grid_z = np.clip(grid_z, 0, 1)

        # 若有工作面多边形，网格出界处置 NaN - 使用向量化操作加速
        if workface_coords and len(workface_coords) >= 3:
            from matplotlib.path import Path

            poly = np.array([[p.get("x", 0), p.get("y", 0)] for p in workface_coords])
            path = Path(poly)

            # 向量化判断：一次性判断所有网格点
            points = np.column_stack([grid_xx.ravel(), grid_yy.ravel()])
            inside = path.contains_points(points).reshape(grid_z.shape)

            grid_z = np.where(~inside, np.nan, grid_z)
        else:
            # 如果没有提供工作面坐标，或者坐标不足3个点，
            # 为了防止全屏铺满，尝试根据结果中的 Mi=0 区域进行掩膜
            # 这是一个备用策略
            pass

        # 生成等值线级别
        contour_levels = np.linspace(z.min(), z.max(), levels)

        isolines = []
        for level in contour_levels:
            isolines.append({
                "level": float(level),
                "value": float(level)
            })

        return {
            "isolines": isolines,
            "bounds": bounds,
            "grid": {
                "x": grid_x.tolist(),
                "y": grid_y.tolist(),
                "z": grid_z.tolist() if grid_z is not None else []
            }
        }

    except ImportError:
        # scipy不可用时返回简化数据
        return {
            "isolines": [{"level": float(l), "value": float(l)} for l in np.linspace(z.min(), z.max(), levels)],
            "bounds": bounds,
            "grid": None
        }


def generate_param_contours(results: List[Dict], workface_coords: List[Dict], field: str, levels: int = 10) -> Dict:
    """针对指定字段生成等值线网格（Ti/Ei/Hi/Di/Mi/odi/odi_normalized）"""
    if not results:
        return {"isolines": [], "bounds": {}}

    def extract_value(r: Dict) -> float:
        geo = r.get("geo_params", {}) or {}
        mining = r.get("mining_params", {}) or {}
        if field in geo:
            return safe_float(geo.get(field, 0))
        if field in mining:
            return safe_float(mining.get(field, 0))
        return safe_float(r.get(field, 0))

    values = np.array([extract_value(r) for r in results], dtype=float)
    x = np.array([r["x"] for r in results])
    y = np.array([r["y"] for r in results])

    bounds = {
        "min_x": float(x.min()),
        "max_x": float(x.max()),
        "min_y": float(y.min()),
        "max_y": float(y.max()),
        "min_z": float(values.min()),
        "max_z": float(values.max()),
    }

    try:
        from scipy.interpolate import griddata

        # 提高网格密度 (50 -> 200)
        grid_x = np.linspace(x.min(), x.max(), 200)
        grid_y = np.linspace(y.min(), y.max(), 200)
        grid_xx, grid_yy = np.meshgrid(grid_x, grid_y)
        
        # 优先使用 cubic 插值
        try:
            grid_z = griddata((x, y), values, (grid_xx, grid_yy), method='cubic')
        except Exception:
            grid_z = griddata((x, y), values, (grid_xx, grid_yy), method='linear')

        # 限制范围 (对于某些参数如Mi, Ti，不应小于0)
        if field in ["Mi", "Ti", "Hi", "Di", "Ei", "coal_thickness"]:
             if grid_z is not None:
                grid_z = np.clip(grid_z, 0, None)

        # 掩膜工作面外部 - 使用向量化操作加速
        if workface_coords and len(workface_coords) >= 3:
            from matplotlib.path import Path

            poly = np.array([[p.get("x", 0), p.get("y", 0)] for p in workface_coords])
            path = Path(poly)

            # 向量化判断
            points = np.column_stack([grid_xx.ravel(), grid_yy.ravel()])
            inside = path.contains_points(points).reshape(grid_z.shape)

            grid_z = np.where(~inside, np.nan, grid_z)

        contour_levels = np.linspace(values.min(), values.max(), levels) if values.max() != values.min() else np.array([values.min()])

        isolines = [{"level": float(l), "value": float(l)} for l in contour_levels]

        return {
            "isolines": isolines,
            "bounds": bounds,
            "grid": {
                "x": grid_x.tolist(),
                "y": grid_y.tolist(),
                "z": grid_z.tolist() if grid_z is not None else []
            }
        }
    except ImportError:
        return {
            "isolines": [{"level": float(l), "value": float(l)} for l in np.linspace(values.min(), values.max(), levels)],
            "bounds": bounds,
            "grid": None
        }


def count_levels(results: List[Dict]) -> Dict[str, int]:
    """统计各等级数量"""
    counts = {f"level_{i}": 0 for i in range(1, 6)}
    for r in results:
        level = r.get("disturbance_level", 0)
        if 1 <= level <= 5:
            counts[f"level_{level}"] += 1
    return counts


@router.post("/calibrate")
async def calibrate_with_measured(request: MeasuredDataRequest):
    """使用实测数据校准"""
    if "last_result" not in _calculation_cache:
        raise HTTPException(status_code=400, detail="请先执行ODI计算")

    results = _calculation_cache["last_result"]

    # 进行误差分析
    errors = []
    for mp in request.measured_points:
        x, y = mp.get("x", 0), mp.get("y", 0)
        measured = mp.get("value", 0)

        # 找最近的计算点
        min_dist = float('inf')
        nearest_odi = 0
        for r in results:
            dist = np.sqrt((r["x"] - x)**2 + (r["y"] - y)**2)
            if dist < min_dist:
                min_dist = dist
                nearest_odi = r["odi_normalized"]

        errors.append({
            "id": mp.get("id", ""),
            "x": x,
            "y": y,
            "measured": measured,
            "predicted_odi": nearest_odi,
            "error": abs(nearest_odi - measured)
        })

    return {
        "success": True,
        "error_analysis": errors,
        "statistics": {
            "mean_error": np.mean([e["error"] for e in errors]),
            "max_error": max([e["error"] for e in errors]),
            "rmse": np.sqrt(np.mean([e["error"]**2 for e in errors]))
        }
    }


@router.get("/export/results")
async def export_results():
    """导出计算结果"""
    if "last_result" not in _calculation_cache:
        raise HTTPException(status_code=400, detail="无可导出的结果")

    results = _calculation_cache["last_result"]

    # 转换为DataFrame格式
    export_data = []
    for r in results:
        row = {
            "ID": r["id"],
            "X": r["x"],
            "Y": r["y"],
            "类型": r["type"],
            "Ti": r["geo_params"]["Ti"],
            "Ei": r["geo_params"].get("Ei", 10.0),
            "Hi": r["geo_params"]["Hi"],
            "Di": r["geo_params"]["Di"],
            "Mi": r["mining_params"]["Mi"],
            "lpi": r["mining_params"]["lpi"],
            "lci": r["mining_params"].get("lci", 0),
            "delta_i": r["mining_params"].get("delta_i", 75),
            "ODI": r["odi"],
            "ODI归一化": r.get("odi_normalized", 0),
            "扰动等级": r.get("disturbance_level", 0),
            "等级名称": r.get("disturbance_name", ""),
        }
        # 添加9项指标
        for key, val in r["indicators"].items():
            row[key] = val
        # 添加三类响应
        if "responses" in r:
            row["wd"] = r["responses"].get("wd", 0)
            row["wo"] = r["responses"].get("wo", 0)
            row["wf"] = r["responses"].get("wf", 0)
        export_data.append(row)

    return {"success": True, "data": export_data}


@router.get("/heatmap/image")
async def get_heatmap_image(
    field: str = "odi_normalized",
    resolution: int = 500,
    format: str = "png"
):
    """
    生成ODI热力图图片

    使用后端matplotlib生成高质量等值线填充图，解决前端性能和精度问题

    参数:
    - field: 显示的字段 (odi_normalized, odi, Ti, Hi, Di, Mi)
    - resolution: 网格分辨率 (默认500)
    - format: 图片格式 (png/svg)

    返回:
    - base64编码的图片数据
    """
    if "last_result" not in _calculation_cache:
        raise HTTPException(status_code=400, detail="请先执行ODI计算")

    results = _calculation_cache["last_result"]
    workface_coords = _calculation_cache.get("last_workface_coords", [])

    if not results:
        raise HTTPException(status_code=400, detail="无计算结果")

    try:
        import matplotlib
        matplotlib.use('Agg')  # 使用非交互式后端

        # 配置中文字体
        import matplotlib.pyplot as plt
        plt.rcParams['font.sans-serif'] = ['Microsoft YaHei', 'SimHei', 'DejaVu Sans']
        plt.rcParams['axes.unicode_minus'] = False

        from matplotlib.colors import ListedColormap, BoundaryNorm
        from matplotlib.patches import Polygon as MplPolygon
        from scipy.interpolate import griddata

        # 提取坐标和值
        x = np.array([r["x"] for r in results])
        y = np.array([r["y"] for r in results])

        # 根据字段获取值
        if field == "odi_normalized":
            z = np.array([r.get("odi_normalized", 0) for r in results])
        elif field == "odi":
            z = np.array([r.get("odi", 0) for r in results])
        elif field == "Mi":
            z = np.array([r.get("mining_params", {}).get("Mi", 0) for r in results])
        elif field in ["Ti", "Hi", "Di", "Ei"]:
            z = np.array([r.get("geo_params", {}).get(field, 0) for r in results])
        else:
            z = np.array([r.get("odi_normalized", 0) for r in results])

        # 生成高分辨率网格
        min_x, max_x = x.min(), x.max()
        min_y, max_y = y.min(), y.max()

        # 稍微扩展边界
        margin_x = (max_x - min_x) * 0.05
        margin_y = (max_y - min_y) * 0.05

        grid_x = np.linspace(min_x - margin_x, max_x + margin_x, resolution)
        grid_y = np.linspace(min_y - margin_y, max_y + margin_y, resolution)
        grid_xx, grid_yy = np.meshgrid(grid_x, grid_y)

        # 使用cubic插值获得平滑效果
        try:
            grid_z = griddata((x, y), z, (grid_xx, grid_yy), method='cubic')
        except Exception:
            grid_z = griddata((x, y), z, (grid_xx, grid_yy), method='linear')

        # 工作面外部掩膜 - 使用向量化操作加速 (从O(n²)优化到O(n))
        if workface_coords and len(workface_coords) >= 3:
            from matplotlib.path import Path

            poly = np.array([[p.get("x", 0), p.get("y", 0)] for p in workface_coords])
            path = Path(poly)

            # 将网格点展平为 (N, 2) 数组，一次性判断所有点
            points = np.column_stack([grid_xx.ravel(), grid_yy.ravel()])
            inside = path.contains_points(points).reshape(grid_z.shape)

            # 应用掩膜：外部点设为 NaN
            grid_z = np.where(~inside, np.nan, grid_z)

        # 统计信息
        inside_results = [r for r in results if r.get("in_workface", False)]
        if inside_results:
            odi_values = [r.get("odi_normalized", 0) for r in inside_results]
            stats = {
                "min": min(odi_values),
                "max": max(odi_values),
                "mean": np.mean(odi_values),
                "count": len(inside_results)
            }
            # 统计各等级数量
            level_counts = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
            for r in inside_results:
                level = r.get("disturbance_level", 1)
                if level in level_counts:
                    level_counts[level] += 1
        else:
            stats = {"min": 0, "max": 0, "mean": 0, "count": 0}
            level_counts = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}

        # 创建图形 - 增加宽度以容纳信息面板
        fig = plt.figure(figsize=(16, 10), dpi=150)

        # 主图区域
        ax = fig.add_axes([0.08, 0.1, 0.6, 0.8])

        # 根据字段类型选择配色方案
        if field in ["odi_normalized", "odi"]:
            # ODI使用5级分区色带
            colors = ['#3b82f6', '#facc15', '#fb923c', '#f87171', '#dc2626']
            boundaries = [0, 0.045, 0.345, 0.825, 0.847, 1.0]

            cmap = ListedColormap(colors)
            norm = BoundaryNorm(boundaries, cmap.N)

            # 绘制等值线填充
            cf = ax.contourf(grid_xx, grid_yy, grid_z, levels=boundaries,
                           cmap=cmap, norm=norm, extend='both')

            # 添加等值线边界
            cs = ax.contour(grid_xx, grid_yy, grid_z, levels=boundaries[1:-1],
                          colors='white', linewidths=1.5, alpha=0.7)

            # 色标
            cbar_ax = fig.add_axes([0.70, 0.1, 0.02, 0.8])
            cbar = fig.colorbar(cf, cax=cbar_ax)
            cbar.set_label('ODI (归一化扰动指数)', fontsize=12)
            cbar.set_ticks([0.0225, 0.195, 0.585, 0.836, 0.924])
            cbar.set_ticklabels(['I', 'II', 'III', 'IV', 'V'])
        else:
            # 其他字段使用连续渐变色
            cf = ax.contourf(grid_xx, grid_yy, grid_z, levels=20, cmap='RdYlBu_r')
            cs = ax.contour(grid_xx, grid_yy, grid_z, levels=10, colors='black',
                          linewidths=0.5, alpha=0.5)
            cbar_ax = fig.add_axes([0.70, 0.1, 0.02, 0.8])
            cbar = fig.colorbar(cf, cax=cbar_ax)

            field_labels = {
                "Ti": "Ti (米)",
                "Hi": "Hi (米)",
                "Di": "Di (米)",
                "Mi": "Mi (米)",
                "Ei": "Ei (GPa)"
            }
            cbar.set_label(field_labels.get(field, field), fontsize=12)

        # 绘制工作面边界
        if workface_coords and len(workface_coords) >= 3:
            poly_coords = [(p.get("x", 0), p.get("y", 0)) for p in workface_coords]
            workface_patch = MplPolygon(poly_coords, fill=False, edgecolor='#0ea5e9',
                                       linewidth=3, linestyle='-', zorder=10)
            ax.add_patch(workface_patch)

        # 设置坐标轴
        ax.set_xlabel('X (米)', fontsize=12)
        ax.set_ylabel('Y (米)', fontsize=12)
        ax.set_aspect('equal')
        ax.grid(True, alpha=0.3, linestyle='--')

        # 标题
        field_titles = {
            "odi_normalized": "ODI 分布图",
            "odi": "ODI 分布图",
            "Ti": "Ti 分布图",
            "Hi": "Hi 分布图",
            "Di": "Di 分布图",
            "Mi": "Mi 分布图"
        }
        ax.set_title(field_titles.get(field, f"{field} 分布图"), fontsize=14, fontweight='bold')

        # ========== 右侧信息面板 ==========
        info_ax = fig.add_axes([0.75, 0.1, 0.22, 0.8])
        info_ax.axis('off')

        # 信息面板内容
        info_text = []
        info_text.append("=" * 25)
        info_text.append("  统计信息")
        info_text.append("=" * 25)
        info_text.append(f"  点数: {stats['count']}")
        info_text.append(f"  ODI 最小值: {stats['min']:.4f}")
        info_text.append(f"  ODI 最大值: {stats['max']:.4f}")
        info_text.append(f"  ODI 平均值: {stats['mean']:.4f}")
        info_text.append("")
        info_text.append("=" * 25)
        info_text.append("  等级分布")
        info_text.append("=" * 25)

        level_info = [
            ("I", "#3b82f6", "<=0.045", level_counts[1]),
            ("II", "#facc15", "0.045-0.345", level_counts[2]),
            ("III", "#fb923c", "0.345-0.825", level_counts[3]),
            ("IV", "#f87171", "0.825-0.847", level_counts[4]),
            ("V", "#dc2626", ">0.847", level_counts[5]),
        ]

        y_pos = 0.85
        for level_name, color, odi_range, count in level_info:
            pct = (count / stats['count'] * 100) if stats['count'] > 0 else 0
            info_ax.add_patch(plt.Rectangle((0.02, y_pos - 0.02), 0.08, 0.04,
                                           facecolor=color, edgecolor='black', linewidth=0.5))
            info_ax.text(0.12, y_pos, f"{level_name}: {odi_range}", fontsize=9,
                        verticalalignment='center')
            info_ax.text(0.65, y_pos, f"{count} ({pct:.1f}%)", fontsize=9,
                        verticalalignment='center')
            y_pos -= 0.08

        # 添加ODI等级说明
        y_pos -= 0.05
        info_ax.text(0.02, y_pos, "-" * 30, fontsize=8)
        y_pos -= 0.05
        info_ax.text(0.02, y_pos, "等级含义:", fontsize=9, fontweight='bold')
        meanings = [
            "I:  微扰动",
            "II: 弱扰动",
            "III: 中等扰动",
            "IV: 强扰动",
            "V:  剧烈扰动"
        ]
        for meaning in meanings:
            y_pos -= 0.05
            info_ax.text(0.02, y_pos, meaning, fontsize=8)

        info_ax.set_xlim(0, 1)
        info_ax.set_ylim(0, 1)

        # 保存到内存
        buf = io.BytesIO()
        if format == "svg":
            plt.savefig(buf, format='svg', bbox_inches='tight', transparent=True)
            content_type = "image/svg+xml"
        else:
            plt.savefig(buf, format='png', bbox_inches='tight', dpi=150,
                       facecolor='white', edgecolor='none')
            content_type = "image/png"

        plt.close(fig)
        buf.seek(0)

        # 返回base64编码的图片
        img_base64 = base64.b64encode(buf.read()).decode('utf-8')

        return {
            "success": True,
            "format": format,
            "content_type": content_type,
            "image": img_base64,
            "bounds": {
                "min_x": float(min_x),
                "max_x": float(max_x),
                "min_y": float(min_y),
                "max_y": float(max_y)
            },
            "statistics": stats,
            "level_distribution": level_counts
        }

    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"Missing dependency: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image generation failed: {str(e)}")
