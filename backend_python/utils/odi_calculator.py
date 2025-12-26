"""
覆岩扰动强度定量表征与多场景综合扰动评价体系
ODI (Overall Disturbance Index) 计算模块
"""

import numpy as np
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass, field
from enum import Enum


class ScenarioType(Enum):
    """评价场景类型"""
    SURFACE_SUBSIDENCE = "surface_subsidence"  # 地表下沉
    AQUIFER_DISTURBANCE = "aquifer_disturbance"  # 含水层扰动
    UPWARD_MINING = "upward_mining"  # 上行开采可行性


# 岩性弹性模量映射表 (GPa) - 基于汇总表实测数据
ROCK_ELASTIC_MODULUS = {
    # 土层类
    "腐殖土": 0.54,
    "土": 0.54,
    "表土层": 0.54,
    "黄土": 0.54,
    # 泥岩类
    "泥岩": 5.4,
    "砂质泥岩": 7.17,
    "粉砂质泥岩": 7.17,
    "炭质泥岩": 7.17,
    "碳质泥岩": 7.17,
    # 砂岩类
    "粉砂岩": 10.2,
    "细砂岩": 10.5,
    "细粒砂岩": 9.54,
    "中砂岩": 20.0,
    "中粒砂岩": 20.0,
    "粗砂岩": 11.49,
    "粗粒砂岩": 11.49,
    "含砾粗砂岩": 11.49,
    "中粗砂岩": 20.0,
    # 砾岩类
    "中砾岩": 35.0,
    "粗砾岩": 40.0,
    # 煤层
    "煤": 2.72,
    "煤层": 2.72,
    # 默认
    "默认": 10.0
}


@dataclass
class GeologicalParams:
    """地质因素参数"""
    Ti: float = 0.0  # 目标层厚度 (m)
    Ei: float = 0.0  # 目标层弹性模量 (GPa)
    Hi: float = 0.0  # 煤层与目标层间距 (m)
    Di: float = 0.0  # 目标层埋深 (m)


@dataclass
class MiningParams:
    """开采因素参数"""
    Mi: float = 0.0  # 采高 (m)
    delta_i: float = 75.0  # 顶板岩层垮落角 (度)
    lpi: float = 0.0  # 工作面宽度 (m)
    lci: float = 0.0  # 区段煤柱 (m)
    lei: float = 0.0  # 工作面推进长度 (m) - 暂不使用


@dataclass
class EvaluationPoint:
    """评价点数据结构"""
    id: str
    x: float
    y: float
    geo_params: GeologicalParams = field(default_factory=GeologicalParams)
    mining_params: MiningParams = field(default_factory=MiningParams)
    indicators: Dict[str, float] = field(default_factory=dict)  # 9项指标
    odi: float = 0.0
    odi_normalized: float = 0.0
    disturbance_level: int = 0  # 扰动等级 1-5


# 基础权重矩阵 W (8x9) - 8个输入因素 x 9个响应指标
# 行顺序: Di, Ei, Hi, lci, lpi, Mi, Ti, δi
# 列顺序: Smax, DSmax, Kσ, Dσmax, Aσ, Hf, Kw, Bf, Af
BASE_WEIGHT_MATRIX = np.array([
    [0.057389, 0.000000, 0.024286, 0.058885, 0.196652, 0.026673, 0.044067, 0.015795, 0.045139],  # Di
    [0.314349, 0.105842, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000],  # Ei
    [0.061192, 0.049348, 0.047564, 0.044506, 0.175154, 0.611954, 0.115051, 0.319025, 0.062264],  # Hi
    [0.000000, 0.290717, 0.309626, 0.117770, 0.034283, 0.000000, 0.000000, 0.214748, 0.147835],  # lci
    [0.124117, 0.366249, 0.088621, 0.382754, 0.064932, 0.000000, 0.000000, 0.044108, 0.106237],  # lpi
    [0.101988, 0.000000, 0.102697, 0.121286, 0.243085, 0.143936, 0.589151, 0.128533, 0.335152],  # Mi
    [0.190565, 0.086577, 0.154086, 0.039257, 0.212361, 0.217437, 0.251731, 0.131501, 0.154793],  # Ti
    [0.150401, 0.101268, 0.273120, 0.235541, 0.073533, 0.000000, 0.000000, 0.146290, 0.148581],  # δi
])

# 不含Di的权重矩阵 (用于某些场景)
WEIGHT_MATRIX_NO_DI = np.array([
    [0.333487161, 0.105841908, 0.000000000, 0.000000000, 0.000000000, 0.000000000, 0.000000000, 0.000000000, 0.000000000],  # Ei
    [0.064917352, 0.049347743, 0.048748316, 0.047291039, 0.218030244, 0.628724069, 0.120354763, 0.324145364, 0.065207105],  # Hi
    [0.000000000, 0.290717228, 0.317332746, 0.125139360, 0.042674689, 0.000000000, 0.000000000, 0.218194172, 0.154823461],  # lci
    [0.131673648, 0.366248612, 0.090826911, 0.406702907, 0.080826944, 0.000000000, 0.000000000, 0.044815901, 0.111258708],  # lpi
    [0.108196903, 0.000000000, 0.105252762, 0.128874861, 0.302589944, 0.147880231, 0.616310242, 0.130595757, 0.350995160],  # Mi
    [0.202166687, 0.086576993, 0.157921002, 0.041713120, 0.264345388, 0.223395700, 0.263334995, 0.133611143, 0.162110339],  # Ti
    [0.159558249, 0.101267516, 0.279918264, 0.250278713, 0.091532791, 0.000000000, 0.000000000, 0.148637663, 0.155605228],  # δi
])

# 场景权重配置
SCENARIO_WEIGHTS = {
    ScenarioType.SURFACE_SUBSIDENCE: {"wd": 0.45, "wo": 0.30, "wf": 0.25},
    ScenarioType.AQUIFER_DISTURBANCE: {"wd": 0.60, "wo": 0.25, "wf": 0.15},
    ScenarioType.UPWARD_MINING: {"wd": 0.20, "wo": 0.45, "wf": 0.35},
}

# 校准系数（基于提供的验证数据集，保持场景权重结构不变，仅做线性缩放）
SURFACE_CALIBRATION = {"scale": 0.005017, "bias": -0.683559}

# ODI等级划分 (地表下沉场景)
ODI_LEVELS = [
    {"level": 1, "name": "I级", "meaning": "轻微扰动", "odi_max": 0.045, "subsidence_max": 0.30},
    {"level": 2, "name": "II级", "meaning": "较弱扰动", "odi_max": 0.345, "subsidence_max": 1.20},
    {"level": 3, "name": "III级", "meaning": "中等扰动", "odi_max": 0.825, "subsidence_max": 2.80},
    {"level": 4, "name": "IV级", "meaning": "较强扰动", "odi_max": 0.847, "subsidence_max": 4.20},
    {"level": 5, "name": "V级", "meaning": "强扰动", "odi_max": 1.0, "subsidence_max": 99999.0},
]


def get_elastic_modulus(rock_name: str) -> float:
    """根据岩性名称获取弹性模量"""
    for key, value in ROCK_ELASTIC_MODULUS.items():
        if key in rock_name:
            return value
    return ROCK_ELASTIC_MODULUS["默认"]


def identify_key_layer(layers: List[Dict]) -> Optional[Dict]:
    """
    识别关键层：最厚且弹性模量最大的岩层
    关键层理论：能够控制覆岩运动的厚硬岩层
    """
    if not layers:
        return None
    
    # 排除土层和煤层
    valid_layers = [
        layer for layer in layers
        if "土" not in layer.get("name", "") and "煤" not in layer.get("name", "")
    ]
    
    if not valid_layers:
        return None
    
    # 计算综合指标：厚度 × 弹性模量
    max_score = 0
    key_layer = None
    
    for layer in valid_layers:
        thickness = layer.get("thickness", 0)
        modulus = layer.get("elastic_modulus", 0)
        score = thickness * modulus
        
        if score > max_score:
            max_score = score
            key_layer = layer
    
    return key_layer


def identify_target_layer(layers: List[Dict], scenario: ScenarioType, aquifer_layer: Optional[Dict] = None) -> Optional[Dict]:
    """
    识别目标层
    地表下沉: 最上层不带"土"字符的岩层
    含水层扰动: 选定含水层下方最近的关键层
    上行开采: 上煤层
    """
    if scenario == ScenarioType.SURFACE_SUBSIDENCE:
        # 地表下沉：最上层不带"土"的岩层
        for layer in layers:
            name = layer.get("name", "")
            if "土" not in name and "煤" not in name:
                return layer
                
    elif scenario == ScenarioType.AQUIFER_DISTURBANCE:
        # 含水层扰动：需要找含水层下方最近的关键层
        if aquifer_layer is None:
            # 如果未指定含水层，查找标记为含水层的
            aquifer_candidates = [
                layer for layer in layers
                if layer.get("is_aquifer", False) or "含水" in layer.get("name", "")
            ]
            if aquifer_candidates:
                aquifer_layer = aquifer_candidates[0]  # 取第一个含水层
        
        if aquifer_layer:
            aquifer_depth = aquifer_layer.get("bottom_depth", 0)
            # 找含水层下方的所有岩层
            layers_below = [
                layer for layer in layers
                if layer.get("top_depth", 0) >= aquifer_depth
                and "土" not in layer.get("name", "")
                and "煤" not in layer.get("name", "")
            ]
            if layers_below:
                # 返回最近的关键层（厚度×弹模最大）
                max_score = 0
                target = None
                for layer in layers_below:
                    score = layer.get("thickness", 0) * layer.get("elastic_modulus", 0)
                    if score > max_score:
                        max_score = score
                        target = layer
                if target:
                    return target
        
        # 兜底：返回关键层
        return identify_key_layer(layers)
        
    elif scenario == ScenarioType.UPWARD_MINING:
        # 上行开采：返回上煤层（第一个煤层）
        for layer in layers:
            name = layer.get("name", "")
            if "煤" in name:
                return layer
                
    return None


def calculate_indicators(params: np.ndarray, weight_matrix: np.ndarray) -> np.ndarray:
    """
    计算9个响应指标
    params: 8个输入参数向量 [Di, Ei, Hi, lci, lpi, Mi, Ti, δi]
    返回: 9个指标 [Smax, DSmax, Kσ, Dσmax, Aσ, Hf, Kw, Bf, Af]
    """
    # params 与 weight_matrix 的行数必须对齐（动态剔除恒定因素后可能小于8）
    return np.dot(params, weight_matrix)


def calculate_odi(
    indicators: np.ndarray,
    scenario: ScenarioType,
    custom_weights: Optional[Dict[str, float]] = None
) -> float:
    """
    计算ODI值
    indicators: 9个响应指标
    scenario: 场景类型
    custom_weights: 自定义权重 (可选)
    """
    # 获取场景权重
    weights = custom_weights or SCENARIO_WEIGHTS[scenario]

    # 分类汇总
    # 位移响应: wd = Smax + DSmax
    wd = indicators[0] + indicators[1]

    # 力学响应: wo = Kσ + Dσmax + Aσ
    wo = indicators[2] + indicators[3] + indicators[4]

    # 水力响应: wf = Hf + Kw + Bf + Af
    wf = indicators[5] + indicators[6] + indicators[7] + indicators[8]

    # 计算ODI
    odi = weights["wd"] * wd + weights["wo"] * wo + weights["wf"] * wf

    # 依据验证数据的线性校准（只针对地表下沉场景）
    if scenario == ScenarioType.SURFACE_SUBSIDENCE:
        odi = odi * SURFACE_CALIBRATION["scale"] + SURFACE_CALIBRATION["bias"]

    return odi


def get_disturbance_level(odi_normalized: float) -> Tuple[int, str, str]:
    """根据归一化ODI获取扰动等级"""
    for level_info in ODI_LEVELS:
        if odi_normalized <= level_info["odi_max"]:
            return level_info["level"], level_info["name"], level_info["meaning"]
    return 5, "V级", "强扰动"


def get_constant_factor_rows(param_matrix: np.ndarray) -> List[int]:
    """找出在所有评价点上取值恒定（或全0）的因素行索引"""
    if param_matrix.size == 0:
        return []
    rows_to_exclude = []
    for i in range(param_matrix.shape[0]):
        row = param_matrix[i, :]
        if np.allclose(row, row[0]):  # 全相同（含全0）
            rows_to_exclude.append(i)
    return rows_to_exclude


def normalize_weight_matrix(weight_matrix: np.ndarray, exclude_rows: List[int] = None) -> np.ndarray:
    """
    归一化权重矩阵
    当某个因素被剔除时，按列重新归一化
    """
    if exclude_rows:
        mask = np.ones(weight_matrix.shape[0], dtype=bool)
        mask[exclude_rows] = False
        reduced_matrix = weight_matrix[mask]
    else:
        reduced_matrix = weight_matrix.copy()

    # 按列归一化
    col_sums = reduced_matrix.sum(axis=0)
    col_sums[col_sums == 0] = 1  # 避免除零
    normalized = reduced_matrix / col_sums

    return normalized


def generate_evaluation_points(
    workface_coords: List[Dict],
    step_size: float = 25.0
) -> List[Dict]:
    """
    生成工作面评价点
    根据工作面四角坐标，按步长生成内部控制点
    """
    if len(workface_coords) < 4:
        return []

    # 提取坐标
    coords = np.array([[p["x"], p["y"]] for p in workface_coords])

    # 计算边界盒
    min_x, min_y = coords.min(axis=0)
    max_x, max_y = coords.max(axis=0)

    points = []
    point_id = 0

    # 1) 边界加密：沿多边形边每 step_size 生成一个边界点
    n = len(coords)
    for i in range(n):
        j = (i + 1) % n
        p1 = coords[i]
        p2 = coords[j]
        edge_vec = p2 - p1
        edge_len = np.linalg.norm(edge_vec)
        if edge_len == 0:
            continue
        num_seg = max(1, int(np.ceil(edge_len / step_size)))
        for k in range(num_seg + 1):
            t = k / num_seg
            x = p1[0] + t * edge_vec[0]
            y = p1[1] + t * edge_vec[1]
            points.append({
                "id": f"BP_{point_id}",
                "x": x,
                "y": y,
                "type": "boundary"
            })
            point_id += 1

    # 2) 内部网格点
    x = min_x
    while x <= max_x:
        y = min_y
        while y <= max_y:
            if is_point_in_polygon(x, y, coords):
                points.append({
                    "id": f"EP_{point_id}",
                    "x": x,
                    "y": y,
                    "type": "workface_interior"
                })
                point_id += 1
            y += step_size
        x += step_size

    return points


def is_point_in_polygon(x: float, y: float, polygon: np.ndarray) -> bool:
    """判断点是否在多边形内 (射线法)"""
    n = len(polygon)
    inside = False

    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]
        xj, yj = polygon[j]

        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i

    return inside


def _segment_distance(p1: np.ndarray, p2: np.ndarray, q1: np.ndarray, q2: np.ndarray) -> float:
    """计算两条线段的最短距离"""
    # 向量
    u = p2 - p1
    v = q2 - q1
    w0 = p1 - q1

    a = np.dot(u, u)
    b = np.dot(u, v)
    c = np.dot(v, v)
    d = np.dot(u, w0)
    e = np.dot(v, w0)

    denom = a * c - b * b
    sc, sN, sD = 0.0, denom, denom
    tc, tN, tD = 0.0, denom, denom

    if denom < 1e-9:
        sN = 0.0
        sD = 1.0
        tN = e
        tD = c
    else:
        sN = (b * e - c * d)
        tN = (a * e - b * d)
        if sN < 0:
            sN = 0.0
            tN = e
            tD = c
        elif sN > sD:
            sN = sD
            tN = e + b
            tD = c

    if tN < 0:
        tN = 0.0
        if -d < 0:
            sN = 0.0
        elif -d > a:
            sN = sD
        else:
            sN = -d
            sD = a
    elif tN > tD:
        tN = tD
        if (-d + b) < 0:
            sN = 0
        elif (-d + b) > a:
            sN = sD
        else:
            sN = (-d + b)
            sD = a

    sc = 0.0 if abs(sN) < 1e-9 else sN / sD
    tc = 0.0 if abs(tN) < 1e-9 else tN / tD

    dP = w0 + (sc * u) - (tc * v)
    return float(np.sqrt(np.dot(dP, dP)))


def polygon_min_distance(poly1: np.ndarray, poly2: np.ndarray) -> float:
    """计算两个多边形间最短距离"""
    if poly1.size == 0 or poly2.size == 0:
        return float('inf')

    min_dist = float('inf')
    n1, n2 = len(poly1), len(poly2)
    for i in range(n1):
        p1, p2 = poly1[i], poly1[(i + 1) % n1]
        for j in range(n2):
            q1, q2 = poly2[j], poly2[(j + 1) % n2]
            dist = _segment_distance(p1, p2, q1, q2)
            if dist < min_dist:
                min_dist = dist
    return min_dist


def interpolate_params_at_point(
    x: float, y: float,
    borehole_data: List[Dict],
    param_name: str
) -> float:
    """
    在指定点插值地质参数
    使用反距离权重法 (IDW)
    """
    if not borehole_data:
        return 0.0

    weights = []
    values = []

    for bh in borehole_data:
        bh_x = bh.get("x", 0)
        bh_y = bh.get("y", 0)
        value = bh.get(param_name, 0)

        dist = np.sqrt((x - bh_x)**2 + (y - bh_y)**2)
        if dist < 0.1:  # 非常接近钻孔点
            return value

        weight = 1.0 / (dist ** 2)
        weights.append(weight)
        values.append(value)

    if sum(weights) == 0:
        return 0.0

    return sum(w * v for w, v in zip(weights, values)) / sum(weights)


class ODICalculator:
    """ODI计算器主类"""

    def __init__(self, scenario: ScenarioType = ScenarioType.SURFACE_SUBSIDENCE):
        self.scenario = scenario
        self.weight_matrix = BASE_WEIGHT_MATRIX.copy()
        self.scenario_weights = SCENARIO_WEIGHTS[scenario].copy()
        self.evaluation_points: List[EvaluationPoint] = []
        self.borehole_data: List[Dict] = []
        self.workface_coords: List[Dict] = []
        self.neighbor_workfaces: List[List[Dict]] = []  # 相邻工作面多边形
        self.measured_data: List[Dict] = []
        self.mining_height: float = 3.0  # 默认采高
        self.step_size: float = 25.0  # 评价点步长
        self.pillar_width: Optional[float] = None  # 手工指定煤柱宽度（lci）

    def set_scenario(self, scenario: ScenarioType):
        """设置评价场景"""
        self.scenario = scenario
        self.scenario_weights = SCENARIO_WEIGHTS[scenario].copy()

    def set_custom_weights(self, wd: float, wo: float, wf: float):
        """设置自定义权重"""
        total = wd + wo + wf
        self.scenario_weights = {
            "wd": wd / total,
            "wo": wo / total,
            "wf": wf / total
        }

    def load_borehole_data(self, data: List[Dict]):
        """加载钻孔数据"""
        self.borehole_data = data

    def load_workface_coords(self, coords: List[Dict]):
        """加载工作面坐标"""
        self.workface_coords = coords

    def load_neighbor_workfaces(self, faces: List[List[Dict]]):
        """加载相邻工作面多边形，用于计算煤柱宽度 lci"""
        self.neighbor_workfaces = faces or []

    def load_measured_data(self, data: List[Dict]):
        """加载实测数据"""
        self.measured_data = data

    def generate_points(self) -> List[Dict]:
        """生成所有评价点"""
        points = generate_evaluation_points(self.workface_coords, self.step_size)

        # 添加钻孔位置作为评价点
        for bh in self.borehole_data:
            points.append({
                "id": bh.get("id", f"BH_{len(points)}"),
                "x": bh.get("x", 0),
                "y": bh.get("y", 0),
                "type": "borehole"
            })

        return points

    def _compute_pillar_width(self) -> float:
        """计算区段煤柱宽度 lci；若用户指定则直接使用"""
        if self.pillar_width is not None:
            return float(self.pillar_width)

        if not self.neighbor_workfaces:
            return 0.0

        current = np.array([[p["x"], p["y"]] for p in self.workface_coords]) if self.workface_coords else np.array([])
        if current.size == 0:
            return 0.0

        min_dist = float('inf')
        for face in self.neighbor_workfaces:
            poly = np.array([[p.get("x", 0), p.get("y", 0)] for p in face if p is not None])
            if poly.size == 0:
                continue
            dist = polygon_min_distance(current, poly)
            if dist < min_dist:
                min_dist = dist

        return 0.0 if min_dist == float('inf') else float(min_dist)

    def calculate_all(self) -> List[Dict]:
        """计算所有评价点的ODI"""
        points = self.generate_points()
        results = []

        # 计算工作面中心和特征尺寸
        workface_center, workface_radius = self._get_workface_geometry()
        pillar_width_val = self._compute_pillar_width()

        # 预先收集参数矩阵以判断恒定因素
        param_vectors = []
        geo_cache = []
        mining_cache = []

        for pt in points:
            # 地质参数获取/插值
            if pt["type"] == "borehole":
                bh = next((b for b in self.borehole_data if b.get("id") == pt.get("id")), None)
                geo = GeologicalParams(
                    Ti=bh.get("Ti", 0) if bh else 0,
                    Ei=bh.get("Ei", 0) if bh else 0,
                    Hi=bh.get("Hi", 0) if bh else 0,
                    Di=bh.get("Di", 0) if bh else 0,
                )
                coal_thk = bh.get("coal_thickness", 0) if bh else 0
            else:
                geo = GeologicalParams(
                    Ti=interpolate_params_at_point(pt["x"], pt["y"], self.borehole_data, "Ti"),
                    Ei=interpolate_params_at_point(pt["x"], pt["y"], self.borehole_data, "Ei"),
                    Hi=interpolate_params_at_point(pt["x"], pt["y"], self.borehole_data, "Hi"),
                    Di=interpolate_params_at_point(pt["x"], pt["y"], self.borehole_data, "Di"),
                )
                coal_thk = interpolate_params_at_point(pt["x"], pt["y"], self.borehole_data, "coal_thickness")

            in_workface = self._is_in_workface(pt["x"], pt["y"])
            # Mi：工作面内取 min(采高, 煤厚)，外部/边界为0
            Mi_val = min(self.mining_height, coal_thk) if (in_workface and coal_thk > 0) else (self.mining_height if in_workface else 0)
            mining = MiningParams(
                Mi=Mi_val,
                lpi=self._calculate_workface_width(),
                lci=pillar_width_val or 0,
            )

            geo_cache.append(geo)
            mining_cache.append((mining, in_workface))

            param_vectors.append([
                geo.Di, geo.Ei, geo.Hi,
                mining.lci, mining.lpi, mining.Mi,
                geo.Ti, mining.delta_i
            ])

        param_matrix = np.array(param_vectors).T  # 8 x N
        rows_to_exclude = get_constant_factor_rows(param_matrix)
        weight_matrix_used = normalize_weight_matrix(self.weight_matrix, exclude_rows=rows_to_exclude)

        all_odi = []

        for idx, pt in enumerate(points):
            geo = geo_cache[idx]
            mining, in_workface = mining_cache[idx]

            params = np.array([
                geo.Di, geo.Ei, geo.Hi,
                mining.lci, mining.lpi, mining.Mi,
                geo.Ti, mining.delta_i
            ])

            if rows_to_exclude:
                params = np.delete(params, rows_to_exclude, axis=0)

            indicators = calculate_indicators(params, weight_matrix_used)

            base_odi = calculate_odi(indicators, self.scenario, self.scenario_weights)
            base_odi = max(base_odi, 0.0)

            # 距离衰减
            dist_to_boundary = self._distance_to_workface_boundary(pt["x"], pt["y"])
            if in_workface:
                distance_factor = 1.0 - 0.1 * (1 - min(dist_to_boundary / (workface_radius * 0.5 + 1e-6), 1))
            else:
                decay_length = workface_radius * 2.0
                distance_factor = np.exp(-dist_to_boundary / (decay_length + 1e-6))

            odi = base_odi * distance_factor

            all_odi.append(odi)

            # 突水预警：贯通系数 > 1 标记
            water_risk = False
            if self.scenario == ScenarioType.AQUIFER_DISTURBANCE:
                # 贯通系数 = 富裕系数(1.1) * 裂隙带高度 / Hi
                frac_height = indicators[5]  # Hf
                water_risk = (frac_height / (geo.Hi + 1e-6)) * 1.1 > 1

            results.append({
                "id": pt["id"],
                "x": pt["x"],
                "y": pt["y"],
                "type": pt["type"],
                "in_workface": in_workface,
                "distance_factor": distance_factor,
                "geo_params": {
                    "Ti": geo.Ti, "Ei": geo.Ei, "Hi": geo.Hi, "Di": geo.Di,
                    "coal_thickness": coal_thk
                },
                "mining_params": {
                    "Mi": mining.Mi, "lpi": mining.lpi, "lci": mining.lci
                },
                "indicators": {
                    "Smax": indicators[0],
                    "DSmax": indicators[1],
                    "Kσ": indicators[2],
                    "Dσmax": indicators[3],
                    "Aσ": indicators[4],
                    "Hf": indicators[5],
                    "Kw": indicators[6],
                    "Bf": indicators[7],
                    "Af": indicators[8],
                },
                "odi": odi,
                "water_risk": water_risk
            })

        # 归一化ODI
        if all_odi:
            max_odi = max(all_odi) if max(all_odi) > 0 else 1
            min_odi = min(all_odi)
            span = max_odi - min_odi if max_odi - min_odi > 0 else 1
            for i, r in enumerate(results):
                r["odi_normalized"] = (all_odi[i] - min_odi) / span
                level, name, meaning = get_disturbance_level(r["odi_normalized"])
                r["disturbance_level"] = level
                r["disturbance_name"] = name
                r["disturbance_meaning"] = meaning

        return results

    def _is_in_workface(self, x: float, y: float) -> bool:
        """判断点是否在工作面范围内"""
        if len(self.workface_coords) < 3:
            return False
        coords = np.array([[p["x"], p["y"]] for p in self.workface_coords])
        return is_point_in_polygon(x, y, coords)

    def _calculate_workface_width(self) -> float:
        """计算工作面宽度 (取短边)"""
        if len(self.workface_coords) < 4:
            return 0

        coords = np.array([[p["x"], p["y"]] for p in self.workface_coords])

        # 计算相邻点距离
        distances = []
        for i in range(len(coords)):
            j = (i + 1) % len(coords)
            d = np.sqrt((coords[i][0] - coords[j][0])**2 + (coords[i][1] - coords[j][1])**2)
            distances.append(d)

        # 返回较小的两条边的平均值
        distances.sort()
        return (distances[0] + distances[1]) / 2 if len(distances) >= 2 else distances[0]

    def _get_workface_geometry(self) -> Tuple[Tuple[float, float], float]:
        """获取工作面几何信息：中心点和特征半径"""
        if len(self.workface_coords) < 3:
            return (0, 0), 100  # 默认值

        coords = np.array([[p["x"], p["y"]] for p in self.workface_coords])

        # 计算中心
        center_x = coords[:, 0].mean()
        center_y = coords[:, 1].mean()

        # 计算特征半径（到各顶点的平均距离）
        distances = np.sqrt((coords[:, 0] - center_x)**2 + (coords[:, 1] - center_y)**2)
        radius = distances.mean()

        return (center_x, center_y), radius

    def _distance_to_workface_boundary(self, x: float, y: float) -> float:
        """计算点到工作面边界的最短距离"""
        if len(self.workface_coords) < 3:
            return 0

        coords = np.array([[p["x"], p["y"]] for p in self.workface_coords])
        n = len(coords)

        min_dist = float('inf')

        # 计算到每条边的距离
        for i in range(n):
            j = (i + 1) % n
            p1 = coords[i]
            p2 = coords[j]

            # 线段向量
            edge = p2 - p1
            edge_len_sq = np.dot(edge, edge)

            if edge_len_sq == 0:
                # 退化为点
                dist = np.sqrt((x - p1[0])**2 + (y - p1[1])**2)
            else:
                # 计算投影参数
                t = max(0, min(1, np.dot(np.array([x, y]) - p1, edge) / edge_len_sq))
                # 最近点
                nearest = p1 + t * edge
                dist = np.sqrt((x - nearest[0])**2 + (y - nearest[1])**2)

            min_dist = min(min_dist, dist)

        return min_dist

    def calibrate_with_measured(self) -> Dict:
        """使用实测数据约束/校准ODI分区"""
        if not self.measured_data:
            return {"error": "无实测数据"}

        # 计算误差分析
        errors = []
        for md in self.measured_data:
            x, y = md.get("x", 0), md.get("y", 0)
            measured_value = md.get("value", 0)

            # 插值获取该点ODI
            odi = interpolate_params_at_point(x, y,
                [{"x": r["x"], "y": r["y"], "odi_normalized": r["odi_normalized"]}
                 for r in self.evaluation_points], "odi_normalized")

            errors.append({
                "id": md.get("id", ""),
                "x": x, "y": y,
                "measured": measured_value,
                "odi": odi,
                "error": abs(odi - measured_value)
            })

        return {
            "errors": errors,
            "mean_error": np.mean([e["error"] for e in errors]),
            "max_error": max([e["error"] for e in errors])
        }
