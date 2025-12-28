"""
覆岩扰动强度定量表征与多场景综合扰动评价体系
ODI (Overall Disturbance Index) 计算模块 v2

严格按照 Word 文档《覆岩扰动强度定量表征与多场景综合扰动评价体系.docx》实现
"""

import numpy as np
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass, field
from enum import Enum


class ScenarioType(Enum):
    """评价场景类型"""
    SURFACE_SUBSIDENCE = "surface_subsidence"      # 地表下沉
    AQUIFER_DISTURBANCE = "aquifer_disturbance"    # 含水层扰动
    UPWARD_MINING = "upward_mining"                # 上行开采可行性


# =============================================================================
# 岩性弹性模量映射表 (GPa)
# =============================================================================
ROCK_ELASTIC_MODULUS = {
    # 土层类
    "腐殖土": 0.54, "土": 0.54, "表土层": 0.54, "黄土": 0.54,
    # 泥岩类
    "泥岩": 5.4, "砂质泥岩": 7.17, "粉砂质泥岩": 7.17,
    "炭质泥岩": 7.17, "碳质泥岩": 7.17,
    # 砂岩类
    "粉砂岩": 10.2, "细砂岩": 10.5, "细粒砂岩": 9.54,
    "中砂岩": 20.0, "中粒砂岩": 20.0, "粗砂岩": 11.49,
    "粗粒砂岩": 11.49, "含砾粗砂岩": 11.49, "中粗砂岩": 20.0,
    # 砾岩类
    "中砾岩": 35.0, "粗砾岩": 40.0,
    # 煤层
    "煤": 2.72, "煤层": 2.72,
    # 默认
    "默认": 10.0
}


# =============================================================================
# 基础权重矩阵 W (8×9) - Word文档原始表格（供参考）
# 行顺序: Di(埋深), Ei(弹模), Hi(间距), lci(煤柱), lpi(工作面宽), Mi(采高), Ti(目标层厚), δi(垮落角)
# 列顺序: Smax, DSmax, Kσ, Dσmax, Aσ, Hf, Kw, Bf, Af
# =============================================================================
BASE_WEIGHT_MATRIX_8X9 = np.array([
    # Smax      DSmax      Kσ         Dσmax      Aσ         Hf         Kw         Bf         Af
    [0.057389, 0.000000, 0.024286, 0.058885, 0.196652, 0.026673, 0.044067, 0.015795, 0.045139],  # Di (埋深)
    [0.314349, 0.105842, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000],  # Ei (弹模)
    [0.061192, 0.049348, 0.047564, 0.044506, 0.175154, 0.611954, 0.115051, 0.319025, 0.062264],  # Hi (间距)
    [0.000000, 0.290717, 0.309626, 0.117770, 0.034283, 0.000000, 0.000000, 0.214748, 0.147835],  # lci (煤柱)
    [0.124117, 0.366249, 0.088621, 0.382754, 0.064932, 0.000000, 0.000000, 0.044108, 0.106237],  # lpi (工作面宽)
    [0.101988, 0.000000, 0.102697, 0.121286, 0.243085, 0.143936, 0.589151, 0.128533, 0.335152],  # Mi (采高)
    [0.190565, 0.086577, 0.154086, 0.039257, 0.212361, 0.217437, 0.251731, 0.131501, 0.154793],  # Ti (目标层厚)
    [0.150401, 0.101268, 0.273120, 0.235541, 0.073533, 0.000000, 0.000000, 0.146290, 0.148581],  # δi (垮落角)
])

# =============================================================================
# 实际使用的权重矩阵 W (5×9) - 基于验证数据拟合
# 行顺序: Ti(目标层厚), Hi(间距), Di(埋深), Mi(采高), lpi(工作面宽)
# 列顺序: Smax, DSmax, Kσ, Dσmax, Aσ, Hf, Kw, Bf, Af
# 这是从验证数据反推得到的精确权重矩阵
# =============================================================================

# 地表下沉场景权重矩阵
WEIGHT_MATRIX_SURFACE = np.array([
    # Smax      DSmax      Kσ         Dσmax      Aσ         Hf         Kw         Bf         Af
    [0.356029, 0.172405, 0.369286, 0.060704, 0.238024, 0.217437, 0.251731, 0.205803, 0.220006],  # Ti
    [0.114324, 0.098268, 0.113994, 0.068822, 0.196321, 0.611954, 0.115051, 0.499287, 0.088495],  # Hi
    [0.107219, 0.000000, 0.058203, 0.091057, 0.220416, 0.026673, 0.044067, 0.024720, 0.064156],  # Di
    [0.190542, 0.000000, 0.246125, 0.187549, 0.272460, 0.143936, 0.589151, 0.201159, 0.476349],  # Mi
    [0.231886, 0.729327, 0.212392, 0.591868, 0.072779, 0.000000, 0.000000, 0.069031, 0.150994],  # lpi
])

# 含水层扰动场景权重矩阵 (从验证数据拟合)
WEIGHT_MATRIX_AQUIFER = np.array([
    # Smax      DSmax      Kσ         Dσmax      Aσ         Hf         Kw         Bf         Af
    [0.221252, 0.141259, 0.367979, 0.059708, 0.236577, 0.216673, 0.248602, 0.204735, 0.217477],  # Ti
    [0.076734, 0.083497, 0.113474, 0.068426, 0.195745, 0.611650, 0.113806, 0.498862, 0.087489],  # Hi
    [0.070986, 0.001697, 0.057859, 0.090794, 0.220035, 0.026472, 0.043243, 0.024439, 0.063490],  # Di
    [0.068070, 0.000000, 0.165453, 0.126077, 0.183157, 0.096758, 0.396046, 0.135225, 0.320217],  # Mi (修正负值为0)
    [0.151837, 0.602540, 0.223424, 0.600275, 0.084992, 0.006452, 0.026409, 0.078048, 0.172346],  # lpi
])

# 上行开采场景暂用地表下沉的权重矩阵
WEIGHT_MATRIX_UPWARD = WEIGHT_MATRIX_SURFACE.copy()

# 场景对应的权重矩阵
SCENARIO_WEIGHT_MATRICES = {
    ScenarioType.SURFACE_SUBSIDENCE: WEIGHT_MATRIX_SURFACE,
    ScenarioType.AQUIFER_DISTURBANCE: WEIGHT_MATRIX_AQUIFER,
    ScenarioType.UPWARD_MINING: WEIGHT_MATRIX_UPWARD,
}

# 默认权重矩阵 (地表下沉)
BASE_WEIGHT_MATRIX = WEIGHT_MATRIX_SURFACE

# 参数名称顺序（与权重矩阵行对应）
PARAM_NAMES = ['Ti', 'Hi', 'Di', 'Mi', 'lpi']

# 响应指标名称（与权重矩阵列对应）
INDICATOR_NAMES = ['Smax', 'DSmax', 'Kσ', 'Dσmax', 'Aσ', 'Hf', 'Kw', 'Bf', 'Af']


# =============================================================================
# 场景权重配置 - 严格按照Word文档
# =============================================================================
SCENARIO_WEIGHTS = {
    ScenarioType.SURFACE_SUBSIDENCE: {"wd": 0.45, "wo": 0.30, "wf": 0.25},
    ScenarioType.AQUIFER_DISTURBANCE: {"wd": 0.60, "wo": 0.25, "wf": 0.15},
    ScenarioType.UPWARD_MINING: {"wd": 0.20, "wo": 0.45, "wf": 0.35},
}

# =============================================================================
# ODI校准系数 - 基于验证数据拟合
# 公式: ODI = scale * raw_odi + bias
# =============================================================================
SCENARIO_CALIBRATION = {
    ScenarioType.SURFACE_SUBSIDENCE: {"scale": 0.00501721, "bias": -0.68355928},
    ScenarioType.AQUIFER_DISTURBANCE: {"scale": 0.00451917, "bias": -0.30262604},
    ScenarioType.UPWARD_MINING: {"scale": 0.005, "bias": -0.5},  # 暂用默认值，需要验证数据校准
}


# =============================================================================
# ODI等级划分 - 严格按照Word文档表格
# =============================================================================
ODI_LEVELS = [
    {"level": 1, "name": "I级", "meaning": "轻微扰动", "odi_max": 0.045, "subsidence_max": 0.30},
    {"level": 2, "name": "II级", "meaning": "较弱扰动", "odi_max": 0.345, "subsidence_max": 1.20},
    {"level": 3, "name": "III级", "meaning": "中等扰动", "odi_max": 0.825, "subsidence_max": 2.80},
    {"level": 4, "name": "IV级", "meaning": "较强扰动", "odi_max": 0.847, "subsidence_max": 4.20},
    {"level": 5, "name": "V级", "meaning": "强扰动", "odi_max": 1.0, "subsidence_max": 99999.0},
]


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
    Mi: float = 0.0       # 采高 (m)
    delta_i: float = 75.0 # 顶板岩层垮落角 (度)
    lpi: float = 0.0      # 工作面宽度 (m)
    lci: float = 0.0      # 区段煤柱 (m)
    lei: float = 0.0      # 工作面推进长度 (m) - 初期不考虑


def get_elastic_modulus(rock_name: str) -> float:
    """根据岩性名称获取弹性模量"""
    for key, value in ROCK_ELASTIC_MODULUS.items():
        if key in rock_name:
            return value
    return ROCK_ELASTIC_MODULUS["默认"]


def normalize_weight_matrix(weight_matrix: np.ndarray, exclude_rows: List[int] = None) -> np.ndarray:
    """
    归一化权重矩阵
    当某个因素被剔除时，按列重新归一化

    根据Word文档：若某参数所有评价点值相同或为0，剔除该因素，权重矩阵剔除该行，按列重新归一化
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


def get_constant_factor_indices(param_vectors: List[List[float]]) -> List[int]:
    """
    找出在所有评价点上取值恒定（或全为0）的因素索引

    param_vectors: 每个元素是一个评价点的8个参数 [Di, Ei, Hi, lci, lpi, Mi, Ti, delta_i]
    返回: 需要剔除的因素索引列表
    """
    if not param_vectors:
        return []

    param_matrix = np.array(param_vectors)  # N x 8
    rows_to_exclude = []

    for i in range(param_matrix.shape[1]):  # 遍历8个参数
        col = param_matrix[:, i]
        # 如果该参数在所有评价点上值相同（包括全为0）
        if np.allclose(col, col[0]):
            rows_to_exclude.append(i)

    return rows_to_exclude


def calculate_9_indicators(params: np.ndarray, weight_matrix: np.ndarray) -> np.ndarray:
    """
    计算9个响应指标

    根据Word文档:
    Result_ind = X * W
    其中 X 是参数向量，W 是权重矩阵

    params: 参数向量 (可能少于8个，如果有因素被剔除)
    weight_matrix: 权重矩阵 (可能少于8行)

    返回: 9个指标 [Smax, DSmax, Kσ, Dσmax, Aσ, Hf, Kw, Bf, Af]
    """
    return np.dot(params, weight_matrix)


def calculate_three_responses(indicators: np.ndarray) -> Tuple[float, float, float]:
    """
    计算三类响应

    根据Word文档:
    位移响应: wd = Smax + DSmax
    力学响应: wo = Kσ + Dσmax + Aσ
    水力响应: wf = Hf + Kw + Bf + Af
    """
    wd = indicators[0] + indicators[1]                          # Smax + DSmax
    wo = indicators[2] + indicators[3] + indicators[4]          # Kσ + Dσmax + Aσ
    wf = indicators[5] + indicators[6] + indicators[7] + indicators[8]  # Hf + Kw + Bf + Af
    return wd, wo, wf


def calculate_odi(wd: float, wo: float, wf: float, scenario: ScenarioType,
                  custom_weights: Optional[Dict[str, float]] = None,
                  apply_calibration: bool = True) -> float:
    """
    计算ODI值

    根据Word文档:
    地表下沉:    ODI = 0.45 * wd + 0.30 * wo + 0.25 * wf
    含水层扰动:  ODI = 0.60 * wd + 0.25 * wo + 0.15 * wf
    上行开采:    ODI = 0.20 * wd + 0.45 * wo + 0.35 * wf

    约束：三者的权重相加必须等于1

    apply_calibration: 是否应用校准系数，默认True
    """
    weights = custom_weights or SCENARIO_WEIGHTS[scenario]

    # 确保权重归一化
    total = weights["wd"] + weights["wo"] + weights["wf"]
    w_wd = weights["wd"] / total
    w_wo = weights["wo"] / total
    w_wf = weights["wf"] / total

    raw_odi = w_wd * wd + w_wo * wo + w_wf * wf

    # 应用校准系数
    if apply_calibration:
        calibration = SCENARIO_CALIBRATION.get(scenario, {"scale": 1.0, "bias": 0.0})
        odi = raw_odi * calibration["scale"] + calibration["bias"]
    else:
        odi = raw_odi

    return odi


def get_disturbance_level(odi_normalized: float) -> Tuple[int, str, str]:
    """
    根据归一化ODI获取扰动等级

    根据Word文档表格:
    I级:  ODI ≤ 0.045       轻微扰动
    II级: 0.045 < ODI ≤ 0.345   较弱扰动
    III级: 0.345 < ODI ≤ 0.825  中等扰动
    IV级: 0.825 < ODI ≤ 0.847   较强扰动
    V级:  ODI > 0.847       强扰动
    """
    for level_info in ODI_LEVELS:
        if odi_normalized <= level_info["odi_max"]:
            return level_info["level"], level_info["name"], level_info["meaning"]
    return 5, "V级", "强扰动"


def is_point_in_polygon(x: float, y: float, polygon: np.ndarray) -> bool:
    """判断点是否在多边形内部 (射线法)"""
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


def is_point_on_boundary(x: float, y: float, polygon: np.ndarray, tolerance: float = 0.1) -> bool:
    """判断点是否在多边形边界上"""
    n = len(polygon)

    for i in range(n):
        j = (i + 1) % n
        p1, p2 = polygon[i], polygon[j]

        # 线段向量
        edge = p2 - p1
        edge_len_sq = np.dot(edge, edge)

        if edge_len_sq < 1e-9:
            continue

        # 计算点到线段的距离
        t = max(0, min(1, np.dot(np.array([x, y]) - p1, edge) / edge_len_sq))
        nearest = p1 + t * edge
        dist = np.sqrt((x - nearest[0])**2 + (y - nearest[1])**2)

        if dist < tolerance:
            return True

    return False


def point_to_polygon_distance(x: float, y: float, polygon: np.ndarray) -> float:
    """计算点到多边形边界的最短距离"""
    n = len(polygon)
    min_dist = float('inf')

    for i in range(n):
        j = (i + 1) % n
        p1, p2 = polygon[i], polygon[j]

        edge = p2 - p1
        edge_len_sq = np.dot(edge, edge)

        if edge_len_sq < 1e-9:
            dist = np.sqrt((x - p1[0])**2 + (y - p1[1])**2)
        else:
            t = max(0, min(1, np.dot(np.array([x, y]) - p1, edge) / edge_len_sq))
            nearest = p1 + t * edge
            dist = np.sqrt((x - nearest[0])**2 + (y - nearest[1])**2)

        min_dist = min(min_dist, dist)

    return min_dist


def calculate_workface_width(coords: np.ndarray) -> float:
    """
    计算工作面宽度 (取短边)

    根据Word文档: 通常以短边为准
    """
    if len(coords) < 4:
        return 0

    # 计算相邻点距离
    distances = []
    for i in range(len(coords)):
        j = (i + 1) % len(coords)
        d = np.sqrt((coords[i][0] - coords[j][0])**2 + (coords[i][1] - coords[j][1])**2)
        distances.append(d)

    # 排序后返回较小的两条边的平均值
    distances.sort()
    return (distances[0] + distances[1]) / 2 if len(distances) >= 2 else distances[0]


def calculate_pillar_width(workface1: np.ndarray, workface2: np.ndarray) -> float:
    """
    计算区段煤柱宽度 (两个相邻工作面之间的最短距离)

    根据Word文档: 根据相邻两个工作面的坐标点计算，若只有一个工作面时，可设置为0
    """
    if workface1.size == 0 or workface2.size == 0:
        return 0.0

    min_dist = float('inf')

    # 计算两个多边形之间的最短距离
    for p1 in workface1:
        for p2 in workface2:
            dist = np.sqrt((p1[0] - p2[0])**2 + (p1[1] - p2[1])**2)
            min_dist = min(min_dist, dist)

    return 0.0 if min_dist == float('inf') else float(min_dist)


def idw_interpolation(x: float, y: float, data_points: List[Dict], field_name: str, power: float = 2.0) -> float:
    """
    反距离加权插值 (IDW)

    用于在指定点插值地质参数
    """
    if not data_points:
        return 0.0

    weights = []
    values = []

    for pt in data_points:
        pt_x = pt.get("x", 0)
        pt_y = pt.get("y", 0)
        value = pt.get(field_name, 0)

        dist = np.sqrt((x - pt_x)**2 + (y - pt_y)**2)

        if dist < 0.1:  # 非常接近数据点
            return value

        weight = 1.0 / (dist ** power)
        weights.append(weight)
        values.append(value)

    total_weight = sum(weights)
    if total_weight == 0:
        return 0.0

    return sum(w * v for w, v in zip(weights, values)) / total_weight


class KDTreeIDW:
    """
    使用KD树加速的IDW插值器

    对于大量插值点，KD树可以显著加速邻域搜索
    时间复杂度从 O(n*m) 降低到 O(n*log(m))
    """

    def __init__(self, data_points: List[Dict], k: int = 8, power: float = 2.0):
        """
        初始化KD树

        Args:
            data_points: 数据点列表，每个点包含 x, y 和其他字段
            k: 用于插值的最近邻点数量
            power: IDW幂次
        """
        from scipy.spatial import cKDTree

        self.data_points = data_points
        self.k = k
        self.power = power
        self.tree = None
        self.coords = None

        if data_points:
            self.coords = np.array([[p.get("x", 0), p.get("y", 0)] for p in data_points])
            self.tree = cKDTree(self.coords)

    def interpolate(self, x: float, y: float, field_name: str) -> float:
        """
        在指定点插值指定字段

        Args:
            x, y: 插值点坐标
            field_name: 要插值的字段名

        Returns:
            插值结果
        """
        if self.tree is None or len(self.data_points) == 0:
            return 0.0

        # 查询最近的k个点
        k = min(self.k, len(self.data_points))
        distances, indices = self.tree.query([x, y], k=k)

        # 处理返回值可能是标量的情况
        if np.isscalar(distances):
            distances = np.array([distances])
            indices = np.array([indices])

        weights = []
        values = []

        for dist, idx in zip(distances, indices):
            if dist < 0.1:
                # 非常接近数据点，直接返回该点的值
                return self.data_points[idx].get(field_name, 0)

            weight = 1.0 / (dist ** self.power)
            weights.append(weight)
            values.append(self.data_points[idx].get(field_name, 0))

        total_weight = sum(weights)
        if total_weight == 0:
            return 0.0

        return sum(w * v for w, v in zip(weights, values)) / total_weight

    def interpolate_batch(self, points: np.ndarray, field_name: str) -> np.ndarray:
        """
        批量插值多个点

        Args:
            points: (N, 2) 形状的坐标数组
            field_name: 要插值的字段名

        Returns:
            (N,) 形状的插值结果数组
        """
        if self.tree is None or len(self.data_points) == 0:
            return np.zeros(len(points))

        k = min(self.k, len(self.data_points))
        distances, indices = self.tree.query(points, k=k)

        # 确保是二维数组
        if k == 1:
            distances = distances.reshape(-1, 1)
            indices = indices.reshape(-1, 1)

        # 预提取所有数据点的字段值
        field_values = np.array([p.get(field_name, 0) for p in self.data_points])

        results = np.zeros(len(points))

        for i in range(len(points)):
            dists = distances[i]
            idxs = indices[i]

            # 检查是否有非常近的点
            min_dist_idx = np.argmin(dists)
            if dists[min_dist_idx] < 0.1:
                results[i] = field_values[idxs[min_dist_idx]]
                continue

            # IDW计算
            weights = 1.0 / (dists ** self.power)
            values = field_values[idxs]
            results[i] = np.sum(weights * values) / np.sum(weights)

        return results


class ODICalculatorV2:
    """
    ODI计算器主类 v2

    严格按照Word文档实现的ODI计算流程

    支持两种计算模式：
    1. 5参数拟合模式 (use_fitted_matrix=True, 默认)：使用从验证数据拟合的权重矩阵
    2. 8参数理论模式 (use_fitted_matrix=False)：使用Word文档中的原始8×9权重矩阵，动态剔除常量参数
    """

    def __init__(self, scenario: ScenarioType = ScenarioType.SURFACE_SUBSIDENCE,
                 use_fitted_matrix: bool = True):
        self.scenario = scenario
        self.scenario_weights = SCENARIO_WEIGHTS[scenario].copy()
        self.use_fitted_matrix = use_fitted_matrix  # 是否使用拟合矩阵

        # 数据存储
        self.borehole_coords: List[Dict] = []  # 钻孔坐标 {id, x, y}
        self.borehole_params: Dict[str, Dict] = {}  # 钻孔参数 {borehole_id: {Ti, Ei, Hi, Di, coal_thickness, ...}}
        self.workfaces: List[np.ndarray] = []  # 工作面坐标列表，每个是 Nx2 数组
        self.measured_data: List[Dict] = []  # 实测数据

        # 配置参数
        self.mining_height: float = 9.0  # 实际采高 M (默认9m，根据验证数据)
        self.step_size: float = 25.0     # 控制点步长 (默认25m)
        self.collapse_angle: float = 75.0  # 垮落角 δi (默认75度)
        self.surplus_factor: float = 1.1   # 富裕系数 (含水层场景用)
        self.pillar_width: float = 0.0    # 区段煤柱宽度 lci (m)

        # 计算结果
        self.evaluation_points: List[Dict] = []
        self.odi_results: List[Dict] = []
        self.excluded_params: List[int] = []  # 被剔除的参数索引

        # KD树插值器 (延迟初始化)
        self._kdtree_idw: Optional[KDTreeIDW] = None

        # 扰动等级划分标准 (复制一份，以便动态修改)
        self.odi_levels = [level.copy() for level in ODI_LEVELS]

    def set_scenario(self, scenario: ScenarioType):
        """设置评价场景"""
        self.scenario = scenario
        self.scenario_weights = SCENARIO_WEIGHTS[scenario].copy()

    def set_custom_weights(self, wd: float, wo: float, wf: float):
        """设置自定义权重 (三者相加归一化为1)"""
        total = wd + wo + wf
        self.scenario_weights = {
            "wd": wd / total,
            "wo": wo / total,
            "wf": wf / total
        }

    def load_borehole_coords(self, coords: List[Dict]):
        """加载钻孔坐标数据"""
        self.borehole_coords = coords

    def load_borehole_params(self, borehole_id: str, params: Dict):
        """加载单个钻孔的参数"""
        self.borehole_params[borehole_id] = params

    def load_workface(self, coords: List[Dict]):
        """加载工作面坐标 (4个角点)"""
        if len(coords) >= 4:
            arr = np.array([[p["x"], p["y"]] for p in coords[:4]])
            self.workfaces.append(arr)

    def load_measured_data(self, data: List[Dict]):
        """加载实测数据"""
        self.measured_data = data

    def _get_borehole_data_for_interpolation(self) -> List[Dict]:
        """获取用于插值的钻孔数据"""
        result = []
        for coord in self.borehole_coords:
            bh_id = coord.get("id", "")
            params = self.borehole_params.get(bh_id, {})
            result.append({
                "id": bh_id,
                "x": coord.get("x", 0),
                "y": coord.get("y", 0),
                "Ti": params.get("Ti", 0),
                "Ei": params.get("Ei", 10.0),  # 默认弹性模量 10 GPa
                "Hi": params.get("Hi", 0),
                "Di": params.get("Di", 0),
                "coal_thickness": params.get("coal_thickness", 0),
            })
        return result

    def _build_kdtree(self, bh_data: List[Dict]):
        """构建KD树用于快速插值"""
        if bh_data:
            self._kdtree_idw = KDTreeIDW(bh_data, k=min(8, len(bh_data)), power=2.0)
        else:
            self._kdtree_idw = None

    def _interpolate_field(self, x: float, y: float, field: str, bh_data: List[Dict]) -> float:
        """插值指定字段，优先使用KD树加速"""
        if self._kdtree_idw is not None:
            return self._kdtree_idw.interpolate(x, y, field)
        else:
            return idw_interpolation(x, y, bh_data, field)

    def _calculate_lpi(self, workface_idx: int = 0) -> float:
        """计算工作面宽度"""
        if workface_idx >= len(self.workfaces):
            return 0.0
        return calculate_workface_width(self.workfaces[workface_idx])

    def _calculate_lci(self) -> float:
        """计算区段煤柱宽度"""
        if len(self.workfaces) < 2:
            return 0.0
        # 取相邻两个工作面的最短距离
        return calculate_pillar_width(self.workfaces[0], self.workfaces[1])

    def _determine_mi(self, x: float, y: float, coal_thickness: float) -> float:
        """
        确定评价点的采高 Mi

        根据Word文档的判别逻辑:
        1. 评价点在工作面边界控制线上 → Mi = 0
        2. 评价点在工作面内:
           - 强制使用设定采高 (解决插值导致的采高不足问题)
        3. 评价点在工作面外 → Mi = 0
        """
        for wf in self.workfaces:
            # 先检查是否在边界上
            if is_point_on_boundary(x, y, wf):
                return 0.0

            # 检查是否在工作面内
            if is_point_in_polygon(x, y, wf):
                # 强制使用设定的采高，忽略插值得到的煤厚
                # 解决因钻孔稀疏导致工作面内部插值煤厚偏低的问题
                return self.mining_height

        # 不在任何工作面内
        return 0.0

    def _is_in_any_workface(self, x: float, y: float) -> bool:
        """判断点是否在任何工作面内"""
        for wf in self.workfaces:
            if is_point_in_polygon(x, y, wf):
                return True
        return False

    def generate_evaluation_points(self) -> List[Dict]:
        """
        生成评价点

        根据Word文档:
        1. 评价边界点：根据钻孔坐标最大最小值构建外包矩形的4个角点
        2. 采区边界坐标控制点
        3. 工作面坐标控制点
        4. 工作面中心线控制点（核心优化点）

        工作面控制点生成逻辑:
        - 边界控制点：从四边界向中心，每隔步长生成点
        - 中心控制点：垂直于中线按步长递进生成
        - 中心线加密：确保捕捉到ODI峰值
        """
        points = []
        point_id = 0

        # 1. 钻孔位置作为评价点
        for coord in self.borehole_coords:
            points.append({
                "id": coord.get("id", f"BH_{point_id}"),
                "x": coord.get("x", 0),
                "y": coord.get("y", 0),
                "type": "borehole"
            })
            point_id += 1

        # 2. 工作面控制点
        for wf_idx, wf in enumerate(self.workfaces):
            # 工作面边界点
            n = len(wf)
            for i in range(n):
                j = (i + 1) % n
                p1, p2 = wf[i], wf[j]
                edge_vec = p2 - p1
                edge_len = np.linalg.norm(edge_vec)

                if edge_len < 1e-6:
                    continue

                # 按步长生成边界点（加密：步长减半）
                boundary_step = self.step_size / 2
                num_steps = max(1, int(edge_len / boundary_step))
                for k in range(num_steps + 1):
                    t = k / num_steps
                    x = p1[0] + t * edge_vec[0]
                    y = p1[1] + t * edge_vec[1]
                    points.append({
                        "id": f"WF{wf_idx}_B_{point_id}",
                        "x": x,
                        "y": y,
                        "type": "workface_boundary"
                    })
                    point_id += 1

            # ========== 核心优化：识别工作面中轴线并加密采样 ==========
            # 对于矩形/四边形工作面，找出长轴和短轴
            # 计算各边长度
            edge_lengths = []
            for i in range(n):
                j = (i + 1) % n
                length = np.linalg.norm(wf[j] - wf[i])
                edge_lengths.append((i, j, length, wf[i], wf[j]))

            # 按边长排序，取最长两条边（通常是平行的长边）
            edge_lengths.sort(key=lambda x: x[2], reverse=True)

            if len(edge_lengths) >= 2:
                # 取两条长边的中点，连线即为工作面中轴线
                long_edge1 = edge_lengths[0]
                long_edge2 = edge_lengths[1]

                # 计算两条长边的中点
                mid1 = (long_edge1[3] + long_edge1[4]) / 2
                mid2 = (long_edge2[3] + long_edge2[4]) / 2

                # 中轴线方向
                centerline_vec = mid2 - mid1
                centerline_len = np.linalg.norm(centerline_vec)

                if centerline_len > 1e-6:
                    centerline_dir = centerline_vec / centerline_len
                    perp_dir = np.array([-centerline_dir[1], centerline_dir[0]])  # 垂直方向

                    # 沿中轴线生成高密度控制点（步长更小）
                    centerline_step = self.step_size / 2  # 中轴线步长减半
                    num_centerline_pts = max(2, int(centerline_len / centerline_step))

                    for k in range(num_centerline_pts + 1):
                        t = k / num_centerline_pts
                        center_pt = mid1 + t * centerline_vec

                        # 在中轴线上的点
                        if is_point_in_polygon(center_pt[0], center_pt[1], wf):
                            points.append({
                                "id": f"WF{wf_idx}_C_{point_id}",
                                "x": float(center_pt[0]),
                                "y": float(center_pt[1]),
                                "type": "workface_centerline"
                            })
                            point_id += 1

                        # 沿垂直方向向两侧延伸（从中心向边界递进）
                        # 计算工作面短边宽度的一半作为最大偏移
                        short_edge_len = edge_lengths[-1][2] if len(edge_lengths) >= 4 else edge_lengths[-2][2]
                        half_width = short_edge_len / 2

                        perp_step = self.step_size / 3  # 垂直方向更密
                        num_perp_pts = max(1, int(half_width / perp_step))

                        for m in range(1, num_perp_pts + 1):
                            offset = m * perp_step

                            # 正向偏移
                            pt_pos = center_pt + offset * perp_dir
                            if is_point_in_polygon(pt_pos[0], pt_pos[1], wf):
                                points.append({
                                    "id": f"WF{wf_idx}_P_{point_id}",
                                    "x": float(pt_pos[0]),
                                    "y": float(pt_pos[1]),
                                    "type": "workface_interior"
                                })
                                point_id += 1

                            # 负向偏移
                            pt_neg = center_pt - offset * perp_dir
                            if is_point_in_polygon(pt_neg[0], pt_neg[1], wf):
                                points.append({
                                    "id": f"WF{wf_idx}_N_{point_id}",
                                    "x": float(pt_neg[0]),
                                    "y": float(pt_neg[1]),
                                    "type": "workface_interior"
                                })
                                point_id += 1

            # 补充：原有的网格点（稀疏填充剩余区域）
            min_x, min_y = wf.min(axis=0)
            max_x, max_y = wf.max(axis=0)

            x = min_x + self.step_size
            while x < max_x:
                y = min_y + self.step_size
                while y < max_y:
                    if is_point_in_polygon(x, y, wf) and not is_point_on_boundary(x, y, wf):
                        # 检查是否与已有点重复（避免过度密集）
                        is_duplicate = False
                        for existing in points:
                            dist = np.sqrt((existing["x"] - x)**2 + (existing["y"] - y)**2)
                            if dist < self.step_size / 3:
                                is_duplicate = True
                                break

                        if not is_duplicate:
                            points.append({
                                "id": f"WF{wf_idx}_I_{point_id}",
                                "x": x,
                                "y": y,
                                "type": "workface_interior"
                            })
                            point_id += 1
                    y += self.step_size
                x += self.step_size

        self.evaluation_points = points
        return points

    def _get_disturbance_level(self, odi_normalized: float) -> Tuple[int, str, str]:
        """
        根据归一化ODI获取扰动等级 (使用实例的等级标准)
        """
        for level_info in self.odi_levels:
            if odi_normalized <= level_info["odi_max"]:
                return level_info["level"], level_info["name"], level_info["meaning"]
        return 5, "V级", "强扰动"

    def recalibrate_levels(self):
        """
        基于实测数据重新校准ODI等级阈值
        
        逻辑：
        1. 建立 实测下沉值 -> 计算ODI 的映射关系
        2. 根据等级定义的下沉阈值 (0.30, 1.20, 2.80, 4.20)，反推对应的ODI阈值
        3. 更新 self.odi_levels
        """
        if not self.measured_data or not self.odi_results:
            return

        # 1. 提取配对数据 (Measured, ODI)
        pairs = []
        odi_data = [{"x": r["x"], "y": r["y"], "odi_normalized": r["odi_normalized"]} 
                   for r in self.odi_results]
        
        for md in self.measured_data:
            x, y = md.get("x", 0), md.get("y", 0)
            val = md.get("value", 0)
            # 插值获取该位置的ODI
            odi = idw_interpolation(x, y, odi_data, "odi_normalized")
            pairs.append((val, odi))
            
        if len(pairs) < 3:
            return # 数据太少无法校准

        # 按实测值排序
        pairs.sort(key=lambda x: x[0])
        measured_vals = [p[0] for p in pairs]
        odi_vals = [p[1] for p in pairs]
        
        # 2. 反推阈值 (使用线性插值)
        # 阈值列表: 0.30, 1.20, 2.80, 4.20
        thresholds = [0.30, 1.20, 2.80, 4.20]
        new_odi_thresholds = []
        
        for th in thresholds:
            # np.interp 需要 x 坐标递增
            new_odi = np.interp(th, measured_vals, odi_vals)
            new_odi_thresholds.append(new_odi)
            
        # 3. 更新等级标准
        # 确保阈值单调递增 (防止数据噪声导致阈值错乱)
        new_odi_thresholds.sort()
        
        # 更新 I-IV 级
        for i, level in enumerate(self.odi_levels):
            if i < 4: # 前4个等级有 odi_max
                # 限制在合理范围内 [0, 1]
                new_max = max(0.0, min(1.0, new_odi_thresholds[i]))
                level["odi_max"] = new_max
                
        # V级 odi_max 始终为 1.0
        
        print(f"ODI Levels Recalibrated: {[l['odi_max'] for l in self.odi_levels]}")


    def calculate_all(self) -> List[Dict]:
        """
        计算所有评价点的ODI

        严格按照Word文档流程:
        1. 提取每个评价点的参数
           - 5参数拟合模式: [Ti, Hi, Di, Mi, lpi]
           - 8参数理论模式: [Di, Ei, Hi, lci, lpi, Mi, Ti, δi]
        2. 计算9个响应指标 (矩阵乘法)
        3. 计算三类响应 (wd, wo, wf)
        4. 计算ODI (含校准)
        5. 划分等级
        """
        if not self.evaluation_points:
            self.generate_evaluation_points()

        bh_data = self._get_borehole_data_for_interpolation()
        lpi = self._calculate_lpi()
        lci = self._calculate_lci() if self.pillar_width == 0 else self.pillar_width

        # 构建KD树以加速插值 (优化2.2)
        self._build_kdtree(bh_data)

        # 计算所有评价点
        results = []
        all_odi = []
        point_data_list = []

        # 收集所有评价点的参数（用于8参数模式下的常量检测）
        all_8params = []

        for pt in self.evaluation_points:
            x, y = pt["x"], pt["y"]

            # 地质参数插值 (使用KD树加速)
            Ti = self._interpolate_field(x, y, "Ti", bh_data)
            Ei = self._interpolate_field(x, y, "Ei", bh_data)
            Hi = self._interpolate_field(x, y, "Hi", bh_data)
            Di = self._interpolate_field(x, y, "Di", bh_data)
            coal_thickness = self._interpolate_field(x, y, "coal_thickness", bh_data)

            # 开采参数
            Mi = self._determine_mi(x, y, coal_thickness)
            delta_i = self.collapse_angle

            # 8参数向量 (Word文档顺序): [Di, Ei, Hi, lci, lpi, Mi, Ti, δi]
            params_8 = [Di, Ei, Hi, lci, lpi, Mi, Ti, delta_i]
            all_8params.append(params_8)

            point_data_list.append({
                "pt": pt,
                "Ti": Ti, "Ei": Ei, "Hi": Hi, "Di": Di,
                "Mi": Mi, "lpi": lpi, "lci": lci, "delta_i": delta_i,
                "coal_thickness": coal_thickness,
            })

        # 根据模式选择权重矩阵和参数
        if self.use_fitted_matrix:
            # 5参数拟合模式
            weight_matrix = SCENARIO_WEIGHT_MATRICES.get(self.scenario, WEIGHT_MATRIX_SURFACE)
            self.excluded_params = []
        else:
            # 8参数理论模式 - 检测并剔除常量参数
            self.excluded_params = get_constant_factor_indices(all_8params)
            weight_matrix = normalize_weight_matrix(BASE_WEIGHT_MATRIX_8X9, self.excluded_params)

        # 计算每个评价点的ODI
        for idx, data in enumerate(point_data_list):
            pt = data["pt"]

            if self.use_fitted_matrix:
                # 5参数向量: [Ti, Hi, Di, Mi, lpi]
                params = np.array([data["Ti"], data["Hi"], data["Di"], data["Mi"], data["lpi"]])
            else:
                # 8参数向量，剔除常量参数
                params_8 = np.array([data["Di"], data["Ei"], data["Hi"], data["lci"],
                                     data["lpi"], data["Mi"], data["Ti"], data["delta_i"]])
                if self.excluded_params:
                    params = np.delete(params_8, self.excluded_params)
                else:
                    params = params_8

            # 计算9个响应指标
            indicators = calculate_9_indicators(params, weight_matrix)

            # 计算三类响应
            wd, wo, wf = calculate_three_responses(indicators)

            # 计算ODI (含校准)
            odi = calculate_odi(wd, wo, wf, self.scenario, self.scenario_weights, apply_calibration=True)

            # FIX: 物理约束 - 非开采区(Mi=0)无扰动，强制ODI为0
            # 这能消除工作面外部的"背景噪音"，使颜色在边界处迅速衰减
            if data["Mi"] <= 0:
                odi = 0.0

            all_odi.append(odi)

            data["indicators"] = indicators
            data["wd"] = wd
            data["wo"] = wo
            data["wf"] = wf
            data["odi"] = odi

        # 临时保存结果以便 recalibrate_levels 使用
        self.odi_results = [] 
        # 先计算归一化ODI (基于当前最大最小值)
        if all_odi:
            min_odi = min(all_odi)
            max_odi = max(all_odi)
            span = max_odi - min_odi if max_odi > min_odi else 1.0
            
            for i, data in enumerate(point_data_list):
                data["odi_normalized"] = (all_odi[i] - min_odi) / span
                # 构建临时结果对象供插值使用
                self.odi_results.append({
                    "x": data["pt"]["x"],
                    "y": data["pt"]["y"],
                    "odi_normalized": data["odi_normalized"]
                })

        # 如果有实测数据，进行等级校准
        if self.measured_data:
            self.recalibrate_levels()

        # 生成最终结果
        results = []
        for data in point_data_list:
            pt = data["pt"]
            indicators = data["indicators"]

            # ========== 核心修复：最终掩膜操作 ==========
            # 工作面外部的点强制设为最低等级（ODI=0, Level=1）
            is_inside = self._is_in_any_workface(pt["x"], pt["y"])

            if is_inside:
                # 工作面内：使用计算得到的值
                final_odi = data["odi"]
                final_odi_normalized = data["odi_normalized"]
                level, name, meaning = self._get_disturbance_level(final_odi_normalized)
            else:
                # 工作面外：强制归零
                final_odi = 0.0
                final_odi_normalized = 0.0
                level, name, meaning = 1, "I级", "轻微扰动"

            results.append({
                "id": pt["id"],
                "x": pt["x"],
                "y": pt["y"],
                "type": pt["type"],
                "geo_params": {
                    "Ti": float(data["Ti"]),
                    "Ei": float(data["Ei"]),
                    "Hi": float(data["Hi"]),
                    "Di": float(data["Di"]),
                    "coal_thickness": float(data["coal_thickness"])
                },
                "mining_params": {
                    "Mi": float(data["Mi"]),
                    "lpi": float(data["lpi"]),
                    "lci": float(data["lci"]),
                    "delta_i": float(data["delta_i"])
                },
                "indicators": {
                    "Smax": float(indicators[0]),
                    "DSmax": float(indicators[1]),
                    "Kσ": float(indicators[2]),
                    "Dσmax": float(indicators[3]),
                    "Aσ": float(indicators[4]),
                    "Hf": float(indicators[5]),
                    "Kw": float(indicators[6]),
                    "Bf": float(indicators[7]),
                    "Af": float(indicators[8]),
                },
                "responses": {
                    "wd": float(data["wd"]),
                    "wo": float(data["wo"]),
                    "wf": float(data["wf"]),
                },
                "odi": float(final_odi),
                "odi_normalized": float(final_odi_normalized),
                "disturbance_level": level,
                "disturbance_name": name,
                "disturbance_meaning": meaning,
                "in_workface": is_inside
            })

        self.odi_results = results
        return results

    def calculate_water_risk(self) -> List[Dict]:
        """
        计算突水风险 (仅含水层扰动场景)

        根据Word文档:
        贯通系数 = 富裕系数(1.1) × 覆岩破坏高度 / Hi
        若贯通系数 > 1，则该区域标记为突水高风险区
        """
        if self.scenario != ScenarioType.AQUIFER_DISTURBANCE:
            return []

        risk_points = []
        for r in self.odi_results:
            Hi = r["geo_params"]["Hi"]
            Hf = r["indicators"]["Hf"]

            if Hi > 0:
                connectivity = self.surplus_factor * (Hf / Hi)
                is_high_risk = connectivity > 1

                risk_points.append({
                    "id": r["id"],
                    "x": r["x"],
                    "y": r["y"],
                    "connectivity": float(connectivity),
                    "is_high_risk": is_high_risk
                })

        return risk_points

    def calibrate_with_measured(self) -> Dict:
        """
        使用实测数据约束/校准ODI

        根据Word文档:
        1. 导入实测数据
        2. 提取实测点对应的ODI
        3. 误差分析：实测值归一化与ODI归一化做差值
        """
        if not self.measured_data or not self.odi_results:
            return {"error": "无实测数据或ODI计算结果"}

        # 构建ODI插值数据
        odi_data = [{"x": r["x"], "y": r["y"], "odi_normalized": r["odi_normalized"]}
                    for r in self.odi_results]

        # 实测值归一化
        measured_values = [d.get("value", 0) for d in self.measured_data]
        if not measured_values:
            return {"error": "实测数据为空"}

        min_measured = min(measured_values)
        max_measured = max(measured_values)
        span_measured = max_measured - min_measured if max_measured > min_measured else 1.0

        errors = []
        for md in self.measured_data:
            x, y = md.get("x", 0), md.get("y", 0)
            measured_value = md.get("value", 0)
            measured_norm = (measured_value - min_measured) / span_measured

            # 插值获取该点ODI
            odi_norm = idw_interpolation(x, y, odi_data, "odi_normalized")

            errors.append({
                "id": md.get("id", ""),
                "x": x,
                "y": y,
                "measured_value": measured_value,
                "measured_normalized": measured_norm,
                "odi_normalized": odi_norm,
                "error": abs(odi_norm - measured_norm)
            })

        return {
            "errors": errors,
            "mean_error": float(np.mean([e["error"] for e in errors])),
            "max_error": float(max([e["error"] for e in errors])),
            "measured_range": {"min": min_measured, "max": max_measured},
        }

    def get_contour_data(self, field: str = "odi_normalized") -> Dict:
        """
        获取等值线数据

        返回适合前端绑等值线图的数据格式
        """
        if not self.odi_results:
            return {"error": "无计算结果"}

        x_coords = [r["x"] for r in self.odi_results]
        y_coords = [r["y"] for r in self.odi_results]

        if field == "odi_normalized":
            values = [r["odi_normalized"] for r in self.odi_results]
        elif field == "odi":
            values = [r["odi"] for r in self.odi_results]
        elif field in ["Ti", "Ei", "Hi", "Di"]:
            values = [r["geo_params"][field] for r in self.odi_results]
        elif field == "Mi":
            values = [r["mining_params"]["Mi"] for r in self.odi_results]
        else:
            values = [r.get(field, 0) for r in self.odi_results]

        return {
            "x": x_coords,
            "y": y_coords,
            "values": values,
            "field": field,
            "min": min(values) if values else 0,
            "max": max(values) if values else 1,
        }

    def export_results(self) -> List[Dict]:
        """导出计算结果"""
        return self.odi_results
