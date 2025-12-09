"""
多目标优化模块

实现工作面接续的多目标优化框架：
1. 产量最大化
2. 成本最小化
3. 风险最小化
4. 资源回收率最大化

支持：
- 加权求和法
- 帕累托前沿
- 约束处理
"""

from dataclasses import dataclass, field
from typing import List, Dict, Tuple, Optional, Callable
import numpy as np
from enum import Enum


class ObjectiveType(Enum):
    """目标类型"""
    MAXIMIZE = 1
    MINIMIZE = -1


@dataclass
class Objective:
    """优化目标定义"""
    name: str
    type: ObjectiveType
    weight: float = 1.0
    normalize: bool = True
    min_value: float = 0.0
    max_value: float = 1.0

    def normalize_value(self, value: float) -> float:
        """归一化目标值"""
        if not self.normalize:
            return value
        if self.max_value == self.min_value:
            return 0.0
        normalized = (value - self.min_value) / (self.max_value - self.min_value)
        return np.clip(normalized, 0.0, 1.0)


@dataclass
class MultiObjectiveConfig:
    """多目标优化配置"""
    # 目标权重
    production_weight: float = 0.35      # 产量权重
    cost_weight: float = 0.20            # 成本权重
    risk_weight: float = 0.25            # 风险权重
    recovery_weight: float = 0.20        # 回收率权重

    # 约束阈值
    min_monthly_production: float = 50000    # 最低月产量 (吨)
    max_production_variance: float = 0.3     # 最大产量波动率
    max_risk_score: float = 50.0             # 最大风险分数
    min_recovery_rate: float = 0.85          # 最低回收率

    # 惩罚系数
    constraint_penalty: float = 100.0        # 约束违反惩罚


class MultiObjectiveReward:
    """
    多目标奖励计算器

    将多个优化目标整合为单一奖励信号
    """

    def __init__(self, config: MultiObjectiveConfig = None):
        self.config = config or MultiObjectiveConfig()

        # 定义目标
        self.objectives = {
            'production': Objective(
                name='产量',
                type=ObjectiveType.MAXIMIZE,
                weight=self.config.production_weight,
                min_value=0,
                max_value=200000  # 月产20万吨
            ),
            'cost': Objective(
                name='成本',
                type=ObjectiveType.MINIMIZE,
                weight=self.config.cost_weight,
                min_value=0,
                max_value=1000000  # 月成本100万
            ),
            'risk': Objective(
                name='风险',
                type=ObjectiveType.MINIMIZE,
                weight=self.config.risk_weight,
                min_value=0,
                max_value=100
            ),
            'recovery': Objective(
                name='回收率',
                type=ObjectiveType.MAXIMIZE,
                weight=self.config.recovery_weight,
                min_value=0,
                max_value=1.0
            ),
        }

    def calculate_production_score(self, state, next_state) -> Tuple[float, Dict]:
        """
        计算产量目标得分

        Returns:
            (得分, 详细信息)
        """
        monthly_prod = next_state.monthly_production
        target = next_state.production_target

        # 基础得分：完成率
        completion_rate = monthly_prod / target if target > 0 else 0

        # 连续性奖励
        if state.monthly_production > 0:
            variance = abs(monthly_prod - state.monthly_production) / state.monthly_production
            continuity_bonus = max(0, 1 - variance)
        else:
            continuity_bonus = 0.5

        score = completion_rate * 0.7 + continuity_bonus * 0.3

        return score, {
            'monthly_production': monthly_prod,
            'completion_rate': completion_rate,
            'continuity_bonus': continuity_bonus,
        }

    def calculate_cost_score(self, state, action_type, target_id, next_state) -> Tuple[float, Dict]:
        """
        计算成本目标得分

        Returns:
            (得分, 详细信息)
        """
        cost = 0.0
        details = {}

        # 1. 掘进成本
        tunneling_cost = 0
        for wf in next_state.workfaces:
            if wf.status == 1:  # 准备中
                # 假设掘进成本 500元/m
                monthly_tunneling = 200  # m
                tunneling_cost += monthly_tunneling * 500
        details['tunneling_cost'] = tunneling_cost
        cost += tunneling_cost

        # 2. 回采成本
        mining_cost = 0
        for wf in next_state.workfaces:
            if wf.status == 3:  # 在采
                # 假设回采成本 50元/吨
                mining_cost += next_state.monthly_production * 50 / max(1, len([w for w in next_state.workfaces if w.status == 3]))
        details['mining_cost'] = mining_cost
        cost += mining_cost

        # 3. 搬家成本
        relocation_cost = 0
        if action_type == 3:  # MOVE_EQUIPMENT
            relocation_cost = 500000  # 固定搬家成本50万
        details['relocation_cost'] = relocation_cost
        cost += relocation_cost

        # 4. 设备闲置成本
        idle_cost = 0
        if next_state.equipment_status == 0:  # 空闲
            idle_cost = 100000  # 月闲置成本10万
        details['idle_cost'] = idle_cost
        cost += idle_cost

        details['total_cost'] = cost

        # 归一化得分（成本越低得分越高）
        obj = self.objectives['cost']
        normalized_cost = obj.normalize_value(cost)
        score = 1 - normalized_cost  # 反转，因为成本是最小化目标

        return score, details

    def calculate_risk_score(self, state, next_state) -> Tuple[float, Dict]:
        """
        计算风险目标得分

        Returns:
            (得分, 详细信息)
        """
        risk_score = 0.0
        details = {}

        # 1. 应力叠加风险
        stress_risk = self._calculate_stress_risk(next_state)
        details['stress_risk'] = stress_risk
        risk_score += stress_risk * 0.3

        # 2. 水害风险
        water_risk = self._calculate_water_risk(next_state)
        details['water_risk'] = water_risk
        risk_score += water_risk * 0.25

        # 3. 接续断档风险
        succession_risk = self._calculate_succession_risk(next_state)
        details['succession_risk'] = succession_risk
        risk_score += succession_risk * 0.25

        # 4. 顶板管理风险
        roof_risk = self._calculate_roof_risk(next_state)
        details['roof_risk'] = roof_risk
        risk_score += roof_risk * 0.2

        details['total_risk'] = risk_score

        # 归一化得分（风险越低得分越高）
        obj = self.objectives['risk']
        normalized_risk = obj.normalize_value(risk_score)
        score = 1 - normalized_risk

        return score, details

    def _calculate_stress_risk(self, state) -> float:
        """计算应力叠加风险"""
        risk = 0.0
        mining_faces = [wf for wf in state.workfaces if wf.status == 3]
        completed_faces = [wf for wf in state.workfaces if wf.status == 4]

        MIN_SAFE_DISTANCE = 300.0

        for mining_wf in mining_faces:
            # 与其他在采工作面的距离
            for other_wf in mining_faces:
                if mining_wf.id != other_wf.id:
                    distance = np.sqrt(
                        (mining_wf.center_x - other_wf.center_x)**2 +
                        (mining_wf.center_y - other_wf.center_y)**2
                    )
                    if distance < MIN_SAFE_DISTANCE:
                        risk += (MIN_SAFE_DISTANCE - distance) / MIN_SAFE_DISTANCE * 50

            # 与已采工作面的距离
            for completed_wf in completed_faces:
                distance = np.sqrt(
                    (mining_wf.center_x - completed_wf.center_x)**2 +
                    (mining_wf.center_y - completed_wf.center_y)**2
                )
                if distance < MIN_SAFE_DISTANCE * 0.5:
                    risk += (MIN_SAFE_DISTANCE * 0.5 - distance) / (MIN_SAFE_DISTANCE * 0.5) * 30

        return min(risk, 100.0)

    def _calculate_water_risk(self, state) -> float:
        """计算水害风险"""
        risk = 0.0
        mining_faces = [wf for wf in state.workfaces if wf.status == 3]

        for wf in mining_faces:
            # 地质评分低的工作面水害风险更高
            if wf.avg_score < 60:
                risk += (60 - wf.avg_score) * 0.5

            # 检查相邻采空区数量
            adjacent_goaf = sum(
                1 for other in state.workfaces
                if other.status == 4 and
                np.sqrt((wf.center_x - other.center_x)**2 +
                       (wf.center_y - other.center_y)**2) < 500
            )
            if adjacent_goaf >= 2:
                risk += 20

        return min(risk, 100.0)

    def _calculate_succession_risk(self, state) -> float:
        """计算接续断档风险"""
        risk = 0.0

        mining_faces = [wf for wf in state.workfaces if wf.status == 3]
        ready_faces = [wf for wf in state.workfaces if wf.status == 2]
        preparing_faces = [wf for wf in state.workfaces if wf.status == 1]

        # 检查在采工作面的剩余寿命
        for wf in mining_faces:
            remaining = wf.advance_length - wf.current_advance
            remaining_months = remaining / 100  # 假设月推进100m

            if remaining_months <= 3:
                if len(ready_faces) == 0:
                    risk += 50  # 严重风险
                elif len(ready_faces) == 1 and len(preparing_faces) == 0:
                    risk += 20  # 中等风险

        # 如果没有在采工作面
        if len(mining_faces) == 0:
            if len(ready_faces) == 0:
                risk += 80  # 产量断档

        return min(risk, 100.0)

    def _calculate_roof_risk(self, state) -> float:
        """计算顶板管理风险"""
        risk = 0.0

        for wf in state.workfaces:
            if wf.status == 3:  # 在采
                # 推进速度过快的风险
                if wf.mining_start_time is not None:
                    months = state.current_step - wf.mining_start_time
                    if months > 0:
                        advance_rate = wf.current_advance / months
                        if advance_rate > 150:  # 月推进超过150m
                            risk += (advance_rate - 150) / 150 * 30

                # 煤厚大的工作面风险更高
                if wf.avg_thickness > 4.0:
                    risk += (wf.avg_thickness - 4.0) * 10

        return min(risk, 100.0)

    def calculate_recovery_score(self, state, next_state) -> Tuple[float, Dict]:
        """
        计算资源回收率得分

        Returns:
            (得分, 详细信息)
        """
        total_reserves = sum(wf.reserves for wf in next_state.workfaces)
        recovered = next_state.cumulative_production / 10000  # 转换为万吨

        if total_reserves > 0:
            recovery_rate = recovered / total_reserves
        else:
            recovery_rate = 0

        # 考虑时间效率
        if next_state.current_step > 0:
            time_efficiency = min(1.0, 60 / next_state.current_step)  # 60个月为基准
        else:
            time_efficiency = 1.0

        score = recovery_rate * 0.7 + time_efficiency * 0.3

        return score, {
            'total_reserves': total_reserves,
            'recovered': recovered,
            'recovery_rate': recovery_rate,
            'time_efficiency': time_efficiency,
        }

    def calculate_reward(self, state, action_type, target_id, next_state) -> Tuple[float, Dict]:
        """
        计算综合奖励

        Args:
            state: 当前状态
            action_type: 动作类型
            target_id: 目标工作面ID
            next_state: 下一状态

        Returns:
            (综合奖励, 详细信息)
        """
        details = {}

        # 计算各目标得分
        prod_score, prod_details = self.calculate_production_score(state, next_state)
        cost_score, cost_details = self.calculate_cost_score(state, action_type, target_id, next_state)
        risk_score, risk_details = self.calculate_risk_score(state, next_state)
        recovery_score, recovery_details = self.calculate_recovery_score(state, next_state)

        details['production'] = {'score': prod_score, **prod_details}
        details['cost'] = {'score': cost_score, **cost_details}
        details['risk'] = {'score': risk_score, **risk_details}
        details['recovery'] = {'score': recovery_score, **recovery_details}

        # 加权求和
        weighted_reward = (
            prod_score * self.config.production_weight +
            cost_score * self.config.cost_weight +
            risk_score * self.config.risk_weight +
            recovery_score * self.config.recovery_weight
        )

        # 约束惩罚
        penalty = 0.0

        # 最低产量约束
        if next_state.monthly_production < self.config.min_monthly_production:
            penalty += self.config.constraint_penalty * \
                      (self.config.min_monthly_production - next_state.monthly_production) / \
                      self.config.min_monthly_production

        # 风险约束
        if risk_details['total_risk'] > self.config.max_risk_score:
            penalty += self.config.constraint_penalty * \
                      (risk_details['total_risk'] - self.config.max_risk_score) / 100

        details['penalty'] = penalty
        details['weighted_reward'] = weighted_reward

        final_reward = weighted_reward * 100 - penalty  # 放大奖励尺度

        return final_reward, details


class ParetoFrontier:
    """
    帕累托前沿计算

    用于多目标优化的解集分析
    """

    def __init__(self):
        self.solutions = []

    def add_solution(self, objectives: Dict[str, float], solution_data: any):
        """添加解"""
        self.solutions.append({
            'objectives': objectives,
            'data': solution_data,
        })

    def compute_pareto_front(self) -> List[Dict]:
        """
        计算帕累托前沿

        Returns:
            帕累托最优解列表
        """
        if not self.solutions:
            return []

        pareto_front = []

        for i, sol_i in enumerate(self.solutions):
            is_dominated = False

            for j, sol_j in enumerate(self.solutions):
                if i == j:
                    continue

                if self._dominates(sol_j['objectives'], sol_i['objectives']):
                    is_dominated = True
                    break

            if not is_dominated:
                pareto_front.append(sol_i)

        return pareto_front

    def _dominates(self, obj_a: Dict, obj_b: Dict) -> bool:
        """
        检查解A是否支配解B

        A支配B当且仅当：A在所有目标上不差于B，且至少在一个目标上严格优于B
        """
        dominated = True
        strictly_better = False

        for key in obj_a:
            if key not in obj_b:
                continue

            if obj_a[key] < obj_b[key]:
                dominated = False
                break
            elif obj_a[key] > obj_b[key]:
                strictly_better = True

        return dominated and strictly_better

    def compute_hypervolume(self, reference_point: Dict[str, float]) -> float:
        """
        计算超体积指标

        Args:
            reference_point: 参考点

        Returns:
            超体积值
        """
        pareto_front = self.compute_pareto_front()

        if not pareto_front:
            return 0.0

        # 简化的2D超体积计算
        # 对于更高维度需要更复杂的算法
        objectives = list(pareto_front[0]['objectives'].keys())

        if len(objectives) == 2:
            return self._compute_2d_hypervolume(pareto_front, reference_point, objectives)

        # 对于高维情况，使用近似方法
        return self._approximate_hypervolume(pareto_front, reference_point)

    def _compute_2d_hypervolume(self, front, ref_point, objectives) -> float:
        """计算2D超体积"""
        obj1, obj2 = objectives

        # 按第一个目标排序
        sorted_front = sorted(front, key=lambda x: x['objectives'][obj1])

        hv = 0.0
        prev_obj2 = ref_point[obj2]

        for sol in sorted_front:
            width = ref_point[obj1] - sol['objectives'][obj1]
            height = prev_obj2 - sol['objectives'][obj2]
            if width > 0 and height > 0:
                hv += width * height
            prev_obj2 = sol['objectives'][obj2]

        return hv

    def _approximate_hypervolume(self, front, ref_point) -> float:
        """近似计算高维超体积"""
        # 使用蒙特卡洛采样近似
        n_samples = 10000
        count = 0

        objectives = list(ref_point.keys())
        bounds = {obj: (0, ref_point[obj]) for obj in objectives}

        for _ in range(n_samples):
            # 随机采样点
            sample = {obj: np.random.uniform(bounds[obj][0], bounds[obj][1])
                     for obj in objectives}

            # 检查是否被任一帕累托解支配
            for sol in front:
                if all(sol['objectives'].get(obj, 0) >= sample[obj] for obj in objectives):
                    count += 1
                    break

        # 计算体积
        total_volume = np.prod([bounds[obj][1] - bounds[obj][0] for obj in objectives])
        return total_volume * count / n_samples
