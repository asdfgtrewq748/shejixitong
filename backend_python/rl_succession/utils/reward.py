"""
奖励函数模块 - 包含不确定性建模
"""
from dataclasses import dataclass
from typing import Optional
import numpy as np

from .state import MineState, WorkfaceState


@dataclass
class RewardConfig:
    """奖励权重配置"""
    # 正向奖励
    REWARD_PRODUCTION_TARGET: float = 10.0      # 完成月度产量目标
    REWARD_SUCCESSION_READY: float = 5.0        # 接续准备就绪
    REWARD_COMPLETION: float = 100.0            # 完成所有开采
    REWARD_EARLY_COMPLETION: float = 2.0        # 提前完成（每月）

    # 负向惩罚
    PENALTY_LOW_PRODUCTION: float = 20.0        # 产量不足
    PENALTY_PRODUCTION_FLUCTUATION: float = 5.0 # 产量波动
    PENALTY_NO_SUCCESSION: float = 30.0         # 无接续工作面
    PENALTY_EQUIPMENT_IDLE: float = 15.0        # 设备闲置
    PENALTY_SAFETY_RISK: float = 25.0           # 安全风险
    PENALTY_MOVE_COST: float = 1.0              # 搬家成本

    # 不确定性相关惩罚
    PENALTY_STRESS_OVERLAP: float = 20.0        # 应力叠加风险
    PENALTY_WATER_HAZARD: float = 30.0          # 水害风险
    PENALTY_ROOF_DELAY: float = 10.0            # 顶板破断延迟风险

    # 阈值
    RISK_THRESHOLD: float = 50.0                # 安全风险阈值
    MIN_SAFE_DISTANCE: float = 300.0            # 最小安全距离(m)


def calculate_reward(
    state: MineState,
    action_type: int,
    target_workface_id: Optional[str],
    next_state: MineState,
    config: RewardConfig = None
) -> float:
    """
    计算即时奖励

    Args:
        state: 当前状态
        action_type: 动作类型
        target_workface_id: 目标工作面ID
        next_state: 下一状态
        config: 奖励配置

    Returns:
        即时奖励值
    """
    if config is None:
        config = RewardConfig()

    reward = 0.0

    # ============ 1. 产量奖励 ============
    production_rate = next_state.monthly_production / max(next_state.production_target, 1)

    if production_rate >= 1.0:
        reward += config.REWARD_PRODUCTION_TARGET * min(production_rate, 1.2)
    elif production_rate >= 0.8:
        reward += config.REWARD_PRODUCTION_TARGET * (production_rate - 0.5)
    else:
        reward -= config.PENALTY_LOW_PRODUCTION * (1.0 - production_rate) ** 2

    # ============ 2. 产量连续性奖励 ============
    if state.monthly_production > 0:
        production_change = abs(next_state.monthly_production - state.monthly_production)
        change_rate = production_change / state.monthly_production
        if change_rate > 0.3:
            reward -= config.PENALTY_PRODUCTION_FLUCTUATION * change_rate

    # ============ 3. 接续及时性奖励 ============
    mining_faces = [wf for wf in next_state.workfaces if wf.status == 3]
    ready_faces = [wf for wf in next_state.workfaces if wf.status == 2]

    for mining_wf in mining_faces:
        remaining_months = _estimate_remaining_months(mining_wf)
        if remaining_months <= 3:
            if len(ready_faces) == 0:
                reward -= config.PENALTY_NO_SUCCESSION * (4 - remaining_months)
            else:
                reward += config.REWARD_SUCCESSION_READY

    # ============ 4. 设备利用率奖励 ============
    if next_state.equipment_status == 0:
        if any(wf.status == 2 and wf.equipment_installed for wf in next_state.workfaces):
            reward -= config.PENALTY_EQUIPMENT_IDLE

    # ============ 5. 安全约束奖励 (应力叠加) ============
    adjacency_risk = _calculate_adjacency_risk(next_state, config)
    if adjacency_risk > config.RISK_THRESHOLD:
        reward -= config.PENALTY_SAFETY_RISK * (adjacency_risk / 100.0)

    # ============ 6. 搬家成本惩罚 ============
    if action_type == 3 and target_workface_id:  # MOVE_EQUIPMENT
        move_distance = _calculate_move_distance(state, target_workface_id)
        reward -= config.PENALTY_MOVE_COST * move_distance / 1000

    # ============ 7. 不确定性相关奖励 ============
    # 7.1 应力叠加效应
    stress_risk = _calculate_stress_overlap_risk(next_state, config)
    if stress_risk > 0:
        reward -= config.PENALTY_STRESS_OVERLAP * stress_risk

    # 7.2 水害风险
    water_risk = _calculate_water_hazard_risk(next_state)
    if water_risk > 0:
        reward -= config.PENALTY_WATER_HAZARD * water_risk

    # 7.3 顶板破断延迟风险
    roof_risk = _calculate_roof_delay_risk(next_state)
    if roof_risk > 0:
        reward -= config.PENALTY_ROOF_DELAY * roof_risk

    # ============ 8. 终止奖励 ============
    if _is_terminal(next_state):
        total_reserves = sum(wf.reserves for wf in next_state.workfaces)
        if total_reserves > 0:
            total_recovery = next_state.cumulative_production / (total_reserves * 10000)
            reward += config.REWARD_COMPLETION * min(total_recovery, 1.0)

    return reward


def _estimate_remaining_months(wf: WorkfaceState) -> float:
    """估计工作面剩余开采月数"""
    if wf.status != 3:
        return float('inf')

    remaining = wf.advance_length - wf.current_advance
    MONTHLY_ADVANCE = 100.0  # 月推进速度 (m)
    return remaining / MONTHLY_ADVANCE


def _calculate_adjacency_risk(state: MineState, config: RewardConfig) -> float:
    """计算相邻工作面同时开采风险"""
    risk = 0.0
    mining_faces = [wf for wf in state.workfaces if wf.status == 3]

    for i, wf1 in enumerate(mining_faces):
        for wf2 in mining_faces[i+1:]:
            distance = np.sqrt((wf1.center_x - wf2.center_x)**2 +
                              (wf1.center_y - wf2.center_y)**2)
            if distance < config.MIN_SAFE_DISTANCE:
                risk += (config.MIN_SAFE_DISTANCE - distance) / config.MIN_SAFE_DISTANCE * 100

    return min(risk, 100.0)


def _calculate_move_distance(state: MineState, target_id: str) -> float:
    """计算设备搬家距离"""
    if state.equipment_location is None:
        return 0.0

    source_wf = None
    target_wf = None

    for wf in state.workfaces:
        if wf.id == state.equipment_location:
            source_wf = wf
        if wf.id == target_id:
            target_wf = wf

    if source_wf and target_wf:
        return np.sqrt((source_wf.center_x - target_wf.center_x)**2 +
                      (source_wf.center_y - target_wf.center_y)**2)
    return 0.0


def _calculate_stress_overlap_risk(state: MineState, config: RewardConfig) -> float:
    """
    计算应力叠加效应风险

    相邻工作面的开采会导致煤柱和围岩应力场叠加
    """
    risk = 0.0
    mining_faces = [wf for wf in state.workfaces if wf.status == 3]
    completed_faces = [wf for wf in state.workfaces if wf.status == 4]

    for mining_wf in mining_faces:
        # 检查与已采工作面的距离
        for completed_wf in completed_faces:
            distance = np.sqrt((mining_wf.center_x - completed_wf.center_x)**2 +
                              (mining_wf.center_y - completed_wf.center_y)**2)

            # 如果距离太近，存在应力叠加风险
            if distance < config.MIN_SAFE_DISTANCE * 1.5:
                # 风险与距离成反比，与地质评分成反比
                risk += (1 - distance / (config.MIN_SAFE_DISTANCE * 1.5)) * \
                       (100 - mining_wf.avg_score) / 100

    return min(risk, 1.0)


def _calculate_water_hazard_risk(state: MineState) -> float:
    """
    计算水害风险

    基于工作面地质评分和相邻采空区情况
    """
    risk = 0.0
    mining_faces = [wf for wf in state.workfaces if wf.status == 3]

    for wf in mining_faces:
        # 地质评分低的工作面水害风险更高
        if wf.avg_score < 60:
            risk += (60 - wf.avg_score) / 60 * 0.5

        # 检查是否有相邻的已采工作面（可能形成导水通道）
        completed_nearby = 0
        for other_wf in state.workfaces:
            if other_wf.status == 4:
                distance = np.sqrt((wf.center_x - other_wf.center_x)**2 +
                                  (wf.center_y - other_wf.center_y)**2)
                if distance < 500:  # 500m范围内
                    completed_nearby += 1

        if completed_nearby >= 2:
            risk += 0.3  # 多个相邻采空区增加水害风险

    return min(risk, 1.0)


def _calculate_roof_delay_risk(state: MineState) -> float:
    """
    计算顶板破断延迟风险

    采场上方覆岩从初始破裂到稳定存在一个滞后过程
    """
    risk = 0.0
    mining_faces = [wf for wf in state.workfaces if wf.status == 3]

    for wf in mining_faces:
        # 推进速度过快可能导致顶板来压滞后
        if wf.mining_start_time is not None:
            months_mining = state.current_step - wf.mining_start_time
            if months_mining > 0:
                advance_rate = wf.current_advance / months_mining
                # 月推进超过150m认为过快
                if advance_rate > 150:
                    risk += (advance_rate - 150) / 150 * 0.5

        # 煤厚大的工作面顶板管理更困难
        if wf.avg_thickness > 3.5:
            risk += (wf.avg_thickness - 3.5) / 3.5 * 0.3

    return min(risk, 1.0)


def _is_terminal(state: MineState) -> bool:
    """判断是否终止"""
    return all(wf.status == 4 for wf in state.workfaces)
