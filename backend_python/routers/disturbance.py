"""
覆岩扰动评价系统 - API路由
"""

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from typing import List, Dict, Optional
import pandas as pd
import numpy as np
import io
import json


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

from utils.odi_calculator import (
    ODICalculator,
    ScenarioType,
    BASE_WEIGHT_MATRIX,
    WEIGHT_MATRIX_NO_DI,
    SCENARIO_WEIGHTS,
    ODI_LEVELS,
    get_elastic_modulus,
    identify_target_layer,
    identify_key_layer,
    is_point_in_polygon,
)

router = APIRouter()


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


class MeasuredDataRequest(BaseModel):
    """实测数据请求"""
    measured_points: List[Dict] = []


# 存储计算结果
_calculation_cache = {}


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
    try:
        # 解析场景
        scenario_map = {
            "surface_subsidence": ScenarioType.SURFACE_SUBSIDENCE,
            "aquifer_disturbance": ScenarioType.AQUIFER_DISTURBANCE,
            "upward_mining": ScenarioType.UPWARD_MINING,
        }
        scenario = scenario_map.get(request.scenario, ScenarioType.SURFACE_SUBSIDENCE)

        # 创建计算器
        calculator = ODICalculator(scenario)
        calculator.mining_height = request.mining_height
        calculator.step_size = request.step_size
        if request.pillar_width is not None:
            calculator.pillar_width = request.pillar_width
        if request.neighbor_workfaces:
            calculator.load_neighbor_workfaces(request.neighbor_workfaces)

        # 设置自定义权重
        if request.custom_weights:
            calculator.set_custom_weights(
                request.custom_weights.wd,
                request.custom_weights.wo,
                request.custom_weights.wf
            )

        # 加载数据
        calculator.load_borehole_data(request.borehole_data)
        calculator.load_workface_coords(request.workface_coords)

        # 计算
        results = calculator.calculate_all()

        # 生成等值线数据
        contours = generate_contours(results, request.workface_coords)

        # 缓存结果
        _calculation_cache["last_result"] = results
        _calculation_cache["last_contours"] = contours
        _calculation_cache["last_workface_coords"] = request.workface_coords

        # 计算统计信息并清理 nan/inf 值
        odi_values = [r["odi"] for r in results] if results else [0]
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
            }
        }

        # 清理所有 nan/inf 值确保 JSON 可序列化
        return sanitize_for_json(response_data)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"计算失败: {str(e)}")


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

        grid_x = np.linspace(x.min(), x.max(), 50)
        grid_y = np.linspace(y.min(), y.max(), 50)
        grid_xx, grid_yy = np.meshgrid(grid_x, grid_y)

        grid_z = griddata((x, y), z, (grid_xx, grid_yy), method='linear')

        # 若有工作面多边形，网格出界处置 NaN
        if workface_coords and len(workface_coords) >= 3:
            poly = np.array([[p.get("x", 0), p.get("y", 0)] for p in workface_coords])
            mask = np.zeros_like(grid_z, dtype=bool)
            for i in range(grid_z.shape[0]):
                for j in range(grid_z.shape[1]):
                    if not is_point_in_polygon(grid_xx[i, j], grid_yy[i, j], poly):
                        mask[i, j] = True
            grid_z = np.where(mask, np.nan, grid_z)

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

        grid_x = np.linspace(x.min(), x.max(), 50)
        grid_y = np.linspace(y.min(), y.max(), 50)
        grid_xx, grid_yy = np.meshgrid(grid_x, grid_y)
        grid_z = griddata((x, y), values, (grid_xx, grid_yy), method='linear')

        # 掩膜工作面外部
        if workface_coords and len(workface_coords) >= 3:
            poly = np.array([[p.get("x", 0), p.get("y", 0)] for p in workface_coords])
            mask = np.zeros_like(grid_z, dtype=bool)
            for i in range(grid_z.shape[0]):
                for j in range(grid_z.shape[1]):
                    if not is_point_in_polygon(grid_xx[i, j], grid_yy[i, j], poly):
                        mask[i, j] = True
            grid_z = np.where(mask, np.nan, grid_z)

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
            "Ei": r["geo_params"]["Ei"],
            "Hi": r["geo_params"]["Hi"],
            "Di": r["geo_params"]["Di"],
            "Mi": r["mining_params"]["Mi"],
            "lpi": r["mining_params"]["lpi"],
            "ODI": r["odi"],
            "ODI归一化": r["odi_normalized"],
            "扰动等级": r["disturbance_level"],
            "等级名称": r.get("disturbance_name", ""),
        }
        # 添加9项指标
        for key, val in r["indicators"].items():
            row[key] = val
        export_data.append(row)

    return {"success": True, "data": export_data}
