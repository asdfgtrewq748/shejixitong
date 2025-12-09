"""
启发式基线策略

实现多种启发式策略用于对比实验：
1. 贪心策略 (Greedy)
2. 顺序策略 (Sequential)
3. 评分优先策略 (Score-based)
4. 随机策略 (Random)
5. 规则策略 (Rule-based)
"""

from abc import ABC, abstractmethod
from typing import Dict, List, Tuple, Optional
import numpy as np


class BasePolicy(ABC):
    """基线策略基类"""

    def __init__(self, name: str):
        self.name = name

    @abstractmethod
    def select_action(self, env, action_mask: np.ndarray) -> int:
        """
        选择动作

        Args:
            env: 环境实例
            action_mask: 合法动作掩码

        Returns:
            动作索引
        """
        pass

    def run_episode(self, env) -> Dict:
        """
        运行一个完整episode

        Args:
            env: 环境实例

        Returns:
            episode结果
        """
        state = env.reset()
        total_reward = 0
        steps = 0
        production_history = []
        action_history = []

        while True:
            action_mask = env.get_valid_action_mask()
            action = self.select_action(env, action_mask)

            state, reward, done, info = env.step(action)

            total_reward += reward
            steps += 1
            production_history.append(info.get('monthly_production', 0))
            action_history.append(action)

            if done:
                break

        return {
            'total_reward': total_reward,
            'steps': steps,
            'cumulative_production': env.state.cumulative_production,
            'completed_workfaces': len([wf for wf in env.state.workfaces if wf.status == 4]),
            'total_workfaces': len(env.state.workfaces),
            'production_history': production_history,
            'action_history': action_history,
            'final_state': env.render(),
        }


class GreedyPolicy(BasePolicy):
    """
    贪心策略

    优先选择储量最大的工作面进行准备和开采
    """

    def __init__(self):
        super().__init__("Greedy")

    def select_action(self, env, action_mask: np.ndarray) -> int:
        n_wf = len(env.workfaces)

        # 优先级1：开始回采（设备就位的待采工作面）
        for i, wf in enumerate(env.state.workfaces):
            if wf.status == 2 and wf.equipment_installed:
                action_idx = 1 + n_wf + i
                if action_mask[action_idx] > 0:
                    return action_idx

        # 优先级2：设备搬家（选择储量最大的待采工作面）
        best_idx = -1
        best_reserves = -1
        for i, wf in enumerate(env.state.workfaces):
            if wf.status == 2 and not wf.equipment_installed:
                action_idx = 1 + 2 * n_wf + i
                if action_mask[action_idx] > 0 and wf.reserves > best_reserves:
                    best_reserves = wf.reserves
                    best_idx = action_idx
        if best_idx >= 0:
            return best_idx

        # 优先级3：开始准备（选择储量最大的待准备工作面）
        best_idx = -1
        best_reserves = -1
        for i, wf in enumerate(env.state.workfaces):
            if wf.status == 0:
                action_idx = 1 + i
                if action_mask[action_idx] > 0 and wf.reserves > best_reserves:
                    best_reserves = wf.reserves
                    best_idx = action_idx
        if best_idx >= 0:
            return best_idx

        # 默认：等待
        return 0


class SequentialPolicy(BasePolicy):
    """
    顺序策略

    按工作面编号顺序依次开采
    """

    def __init__(self):
        super().__init__("Sequential")
        self.current_target = 0

    def select_action(self, env, action_mask: np.ndarray) -> int:
        n_wf = len(env.workfaces)

        # 更新当前目标（跳过已完成的）
        while self.current_target < n_wf:
            if env.state.workfaces[self.current_target].status == 4:
                self.current_target += 1
            else:
                break

        if self.current_target >= n_wf:
            return 0  # 所有工作面已完成

        wf = env.state.workfaces[self.current_target]
        i = self.current_target

        # 按状态选择动作
        if wf.status == 0:  # 待准备
            action_idx = 1 + i
            if action_mask[action_idx] > 0:
                return action_idx

        elif wf.status == 2:  # 待采
            if not wf.equipment_installed:
                action_idx = 1 + 2 * n_wf + i
                if action_mask[action_idx] > 0:
                    return action_idx
            else:
                action_idx = 1 + n_wf + i
                if action_mask[action_idx] > 0:
                    return action_idx

        return 0

    def run_episode(self, env) -> Dict:
        self.current_target = 0  # 重置
        return super().run_episode(env)


class ScoreBasedPolicy(BasePolicy):
    """
    评分优先策略

    优先选择地质评分高的工作面
    """

    def __init__(self):
        super().__init__("ScoreBased")

    def select_action(self, env, action_mask: np.ndarray) -> int:
        n_wf = len(env.workfaces)

        # 优先级1：开始回采
        for i, wf in enumerate(env.state.workfaces):
            if wf.status == 2 and wf.equipment_installed:
                action_idx = 1 + n_wf + i
                if action_mask[action_idx] > 0:
                    return action_idx

        # 优先级2：设备搬家（选择评分最高的）
        best_idx = -1
        best_score = -1
        for i, wf in enumerate(env.state.workfaces):
            if wf.status == 2 and not wf.equipment_installed:
                action_idx = 1 + 2 * n_wf + i
                if action_mask[action_idx] > 0 and wf.avg_score > best_score:
                    best_score = wf.avg_score
                    best_idx = action_idx
        if best_idx >= 0:
            return best_idx

        # 优先级3：开始准备（选择评分最高的）
        best_idx = -1
        best_score = -1
        for i, wf in enumerate(env.state.workfaces):
            if wf.status == 0:
                action_idx = 1 + i
                if action_mask[action_idx] > 0 and wf.avg_score > best_score:
                    best_score = wf.avg_score
                    best_idx = action_idx
        if best_idx >= 0:
            return best_idx

        return 0


class RandomPolicy(BasePolicy):
    """
    随机策略

    在合法动作中随机选择
    """

    def __init__(self, seed: int = None):
        super().__init__("Random")
        if seed is not None:
            np.random.seed(seed)

    def select_action(self, env, action_mask: np.ndarray) -> int:
        valid_actions = np.where(action_mask > 0)[0]
        if len(valid_actions) == 0:
            return 0
        return np.random.choice(valid_actions)


class RuleBasedPolicy(BasePolicy):
    """
    规则策略

    基于专家规则的启发式策略，模拟实际矿井的接续决策逻辑
    """

    def __init__(self):
        super().__init__("RuleBased")

    def select_action(self, env, action_mask: np.ndarray) -> int:
        n_wf = len(env.workfaces)
        state = env.state

        # 规则1：确保至少有一个工作面在采
        mining_count = sum(1 for wf in state.workfaces if wf.status == 3)
        if mining_count == 0:
            # 紧急启动回采
            for i, wf in enumerate(state.workfaces):
                if wf.status == 2 and wf.equipment_installed:
                    action_idx = 1 + n_wf + i
                    if action_mask[action_idx] > 0:
                        return action_idx

            # 紧急搬家
            for i, wf in enumerate(state.workfaces):
                if wf.status == 2 and not wf.equipment_installed:
                    action_idx = 1 + 2 * n_wf + i
                    if action_mask[action_idx] > 0:
                        return action_idx

        # 规则2：检查接续紧张度
        for wf in state.workfaces:
            if wf.status == 3:  # 在采
                remaining = wf.advance_length - wf.current_advance
                remaining_months = remaining / 100  # 假设月推进100m

                if remaining_months <= 6:  # 6个月内结束
                    # 确保有后续工作面
                    ready_count = sum(1 for w in state.workfaces if w.status == 2)
                    preparing_count = sum(1 for w in state.workfaces if w.status == 1)

                    if ready_count == 0 and preparing_count < 2:
                        # 紧急开始准备
                        best_idx = self._select_best_for_prep(env, action_mask, n_wf)
                        if best_idx >= 0:
                            return best_idx

        # 规则3：避免同时开采相邻工作面
        # 检查是否有安全的工作面可以开始回采
        for i, wf in enumerate(state.workfaces):
            if wf.status == 2 and wf.equipment_installed:
                if self._is_safe_to_mine(wf, state):
                    action_idx = 1 + n_wf + i
                    if action_mask[action_idx] > 0:
                        return action_idx

        # 规则4：设备搬家（选择距离最近且安全的）
        best_idx = self._select_best_for_relocation(env, action_mask, n_wf)
        if best_idx >= 0:
            return best_idx

        # 规则5：开始准备（平衡储量和评分）
        best_idx = self._select_best_for_prep(env, action_mask, n_wf)
        if best_idx >= 0:
            return best_idx

        return 0

    def _select_best_for_prep(self, env, action_mask, n_wf) -> int:
        """选择最佳准备工作面"""
        best_idx = -1
        best_score = -1

        for i, wf in enumerate(env.state.workfaces):
            if wf.status == 0:
                action_idx = 1 + i
                if action_mask[action_idx] > 0:
                    # 综合评分 = 地质评分 * 0.6 + 储量归一化 * 0.4
                    combined_score = wf.avg_score * 0.6 + (wf.reserves / 50) * 0.4
                    if combined_score > best_score:
                        best_score = combined_score
                        best_idx = action_idx

        return best_idx

    def _select_best_for_relocation(self, env, action_mask, n_wf) -> int:
        """选择最佳搬家目标"""
        best_idx = -1
        best_score = float('inf')

        current_location = env.state.equipment_location
        if current_location is None:
            # 设备位置未知，选择评分最高的
            for i, wf in enumerate(env.state.workfaces):
                if wf.status == 2 and not wf.equipment_installed:
                    action_idx = 1 + 2 * n_wf + i
                    if action_mask[action_idx] > 0:
                        if wf.avg_score > best_score:
                            best_score = wf.avg_score
                            best_idx = action_idx
        else:
            # 选择距离最近的
            current_wf = None
            for wf in env.state.workfaces:
                if wf.id == current_location:
                    current_wf = wf
                    break

            if current_wf:
                for i, wf in enumerate(env.state.workfaces):
                    if wf.status == 2 and not wf.equipment_installed:
                        action_idx = 1 + 2 * n_wf + i
                        if action_mask[action_idx] > 0:
                            distance = np.sqrt(
                                (wf.center_x - current_wf.center_x)**2 +
                                (wf.center_y - current_wf.center_y)**2
                            )
                            if distance < best_score:
                                best_score = distance
                                best_idx = action_idx

        return best_idx

    def _is_safe_to_mine(self, wf, state) -> bool:
        """检查开采是否安全"""
        MIN_SAFE_DISTANCE = 300.0

        for other_wf in state.workfaces:
            if other_wf.id == wf.id:
                continue

            if other_wf.status == 3:  # 其他在采工作面
                distance = np.sqrt(
                    (wf.center_x - other_wf.center_x)**2 +
                    (wf.center_y - other_wf.center_y)**2
                )
                if distance < MIN_SAFE_DISTANCE:
                    return False

        return True


class DistanceBasedPolicy(BasePolicy):
    """
    距离优先策略

    优先选择距离当前设备位置最近的工作面，减少搬家成本
    """

    def __init__(self):
        super().__init__("DistanceBased")

    def select_action(self, env, action_mask: np.ndarray) -> int:
        n_wf = len(env.workfaces)
        state = env.state

        # 优先级1：开始回采
        for i, wf in enumerate(state.workfaces):
            if wf.status == 2 and wf.equipment_installed:
                action_idx = 1 + n_wf + i
                if action_mask[action_idx] > 0:
                    return action_idx

        # 获取当前设备位置
        current_pos = self._get_equipment_position(state)

        # 优先级2：搬家到最近的待采工作面
        if current_pos is not None:
            best_idx = -1
            min_distance = float('inf')

            for i, wf in enumerate(state.workfaces):
                if wf.status == 2 and not wf.equipment_installed:
                    action_idx = 1 + 2 * n_wf + i
                    if action_mask[action_idx] > 0:
                        distance = np.sqrt(
                            (wf.center_x - current_pos[0])**2 +
                            (wf.center_y - current_pos[1])**2
                        )
                        if distance < min_distance:
                            min_distance = distance
                            best_idx = action_idx

            if best_idx >= 0:
                return best_idx

        # 优先级3：开始准备最近的工作面
        if current_pos is not None:
            best_idx = -1
            min_distance = float('inf')

            for i, wf in enumerate(state.workfaces):
                if wf.status == 0:
                    action_idx = 1 + i
                    if action_mask[action_idx] > 0:
                        distance = np.sqrt(
                            (wf.center_x - current_pos[0])**2 +
                            (wf.center_y - current_pos[1])**2
                        )
                        if distance < min_distance:
                            min_distance = distance
                            best_idx = action_idx

            if best_idx >= 0:
                return best_idx

        return 0

    def _get_equipment_position(self, state) -> Optional[Tuple[float, float]]:
        """获取设备当前位置"""
        if state.equipment_location is None:
            return None

        for wf in state.workfaces:
            if wf.id == state.equipment_location:
                return (wf.center_x, wf.center_y)

        return None
