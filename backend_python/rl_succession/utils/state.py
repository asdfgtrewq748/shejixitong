"""
状态定义模块
"""
from dataclasses import dataclass, field
from typing import Optional, List
import numpy as np


@dataclass
class WorkfaceState:
    """单个工作面状态"""
    id: str                          # 工作面编号
    status: int                      # 状态: 0-待准备, 1-准备中, 2-待采, 3-在采, 4-已采

    # 几何属性
    length: float                    # 工作面长度 (m)
    advance_length: float            # 设计推进长度 (m)
    current_advance: float = 0.0     # 当前推进位置 (m)

    # 地质属性
    avg_thickness: float = 2.0       # 平均煤厚 (m)
    avg_score: float = 75.0          # 地质评分 (0-100)
    reserves: float = 0.0            # 可采储量 (万吨)

    # 空间属性
    center_x: float = 0.0            # 中心X坐标
    center_y: float = 0.0            # 中心Y坐标

    # 准备进度
    transport_lane_length: float = 1000.0  # 运输顺槽长度
    return_lane_length: float = 1000.0     # 回风顺槽长度
    cut_length: float = 200.0              # 开切眼长度

    transport_lane_progress: float = 0.0   # 运输顺槽掘进进度 (0-1)
    return_lane_progress: float = 0.0      # 回风顺槽掘进进度 (0-1)
    cut_progress: float = 0.0              # 开切眼掘进进度 (0-1)
    equipment_installed: bool = False      # 设备是否安装

    # 时间属性
    prep_start_time: Optional[int] = None   # 准备开始时间步
    mining_start_time: Optional[int] = None # 开采开始时间步
    estimated_end_time: Optional[int] = None# 预计结束时间步


@dataclass
class MineState:
    """矿井全局状态"""
    # 时间
    current_step: int = 0            # 当前时间步 (月)

    # 工作面集合
    workfaces: List[WorkfaceState] = field(default_factory=list)

    # 设备状态
    equipment_location: Optional[str] = None  # 综采设备当前位置
    equipment_status: int = 0        # 0-空闲, 1-生产中, 2-搬家中
    equipment_arrival_time: Optional[int] = None  # 设备到达时间

    # 生产状态
    monthly_production: float = 0.0   # 当月产量 (吨)
    cumulative_production: float = 0.0 # 累计产量 (吨)
    production_target: float = 100000  # 月度目标产量 (吨)

    # 系统状态
    ventilation_capacity: float = 5000  # 通风能力 (m³/min)
    transport_capacity: float = 1000    # 运输能力 (t/h)

    # 经济状态
    cumulative_cost: float = 0.0       # 累计成本
    cumulative_revenue: float = 0.0    # 累计收入


def encode_state(mine_state: MineState, max_workfaces: int = 30) -> np.ndarray:
    """
    状态编码为特征向量

    Args:
        mine_state: 矿井状态
        max_workfaces: 最大工作面数量

    Returns:
        特征向量 (numpy数组)
    """
    features = []

    # 1. 全局特征 (6维)
    features.extend([
        mine_state.current_step / 120.0,  # 归一化时间 (假设最大120个月)
        mine_state.monthly_production / mine_state.production_target,  # 产量完成率
        mine_state.equipment_status / 2.0,  # 设备状态
        mine_state.cumulative_production / 1e7,  # 累计产量归一化
        len([wf for wf in mine_state.workfaces if wf.status == 3]) / max(len(mine_state.workfaces), 1),  # 在采工作面比例
        len([wf for wf in mine_state.workfaces if wf.status == 2]) / max(len(mine_state.workfaces), 1),  # 待采工作面比例
    ])

    # 2. 各工作面特征 (每个工作面12维)
    for i in range(max_workfaces):
        if i < len(mine_state.workfaces):
            wf = mine_state.workfaces[i]
            features.extend([
                wf.status / 4.0,  # 状态编码
                wf.current_advance / max(wf.advance_length, 1),  # 推进进度
                wf.reserves / 100.0,  # 储量 (假设最大100万吨)
                wf.avg_score / 100.0,  # 地质评分
                wf.transport_lane_progress,  # 运顺进度
                wf.return_lane_progress,  # 回顺进度
                wf.cut_progress,  # 切眼进度
                float(wf.equipment_installed),  # 设备安装
                _time_to_ready(wf, mine_state) / 12.0,  # 准备剩余时间(归一化)
                _adjacency_risk(wf, mine_state) / 100.0,  # 相邻风险
                wf.avg_thickness / 5.0,  # 煤厚
                _distance_to_equipment(wf, mine_state) / 1000.0,  # 设备距离
            ])
        else:
            # 填充零向量
            features.extend([0.0] * 12)

    return np.array(features, dtype=np.float32)


def _time_to_ready(wf: WorkfaceState, state: MineState) -> float:
    """计算工作面准备就绪剩余时间(月)"""
    if wf.status >= 2:
        return 0.0

    MONTHLY_TUNNELING = 200.0  # 月掘进进度 (m)

    remaining_transport = max(0, wf.transport_lane_length * (1 - wf.transport_lane_progress))
    remaining_return = max(0, wf.return_lane_length * (1 - wf.return_lane_progress))
    remaining_cut = max(0, wf.cut_length * (1 - wf.cut_progress))

    total_remaining = max(remaining_transport, remaining_return) + remaining_cut
    return total_remaining / MONTHLY_TUNNELING


def _adjacency_risk(wf: WorkfaceState, state: MineState) -> float:
    """计算相邻工作面应力叠加风险"""
    risk = 0.0
    MIN_SAFE_DISTANCE = 300.0  # 最小安全距离 (m)

    for other_wf in state.workfaces:
        if other_wf.id == wf.id:
            continue

        # 计算距离
        distance = np.sqrt((wf.center_x - other_wf.center_x)**2 +
                          (wf.center_y - other_wf.center_y)**2)

        # 如果两个工作面都在开采，且距离很近
        if wf.status == 3 and other_wf.status == 3 and distance < MIN_SAFE_DISTANCE:
            risk += (MIN_SAFE_DISTANCE - distance) / MIN_SAFE_DISTANCE * 100

    return min(risk, 100.0)


def _distance_to_equipment(wf: WorkfaceState, state: MineState) -> float:
    """计算工作面到当前设备位置的距离"""
    if state.equipment_location is None:
        return 0.0

    # 找到设备所在工作面
    for other_wf in state.workfaces:
        if other_wf.id == state.equipment_location:
            return np.sqrt((wf.center_x - other_wf.center_x)**2 +
                          (wf.center_y - other_wf.center_y)**2)

    return 0.0


def get_state_dim(max_workfaces: int = 30) -> int:
    """获取状态空间维度"""
    return 6 + 12 * max_workfaces
