"""
不确定性建模模块

实现煤矿工作面接续过程中的多种不确定性因素建模：
1. 地质条件不确定性（煤厚、断层、含水层）
2. 采动应力演化不确定性
3. 顶板破断滞后效应
4. 设备故障随机性
5. 掘进速度波动

参考文献：
- 钱鸣高等. 采矿学. 中国矿业大学出版社, 2019.
- Noriega R, et al. Deep RL for underground mine planning. 2025.
"""

from dataclasses import dataclass, field
from typing import List, Dict, Tuple, Optional
import numpy as np
from scipy import stats


@dataclass
class GeologicalUncertainty:
    """地质条件不确定性参数"""
    # 煤厚不确定性
    thickness_mean: float = 2.5          # 平均煤厚 (m)
    thickness_std: float = 0.3           # 煤厚标准差
    thickness_correlation: float = 0.7   # 空间相关系数

    # 断层不确定性
    fault_probability: float = 0.05      # 遇断层概率
    fault_impact_factor: float = 0.3     # 断层影响系数（产量下降）

    # 含水层不确定性
    water_inrush_base_prob: float = 0.02 # 基础突水概率
    water_inrush_factor: float = 2.0     # 采空区邻近增加系数

    # 瓦斯不确定性
    gas_content_mean: float = 8.0        # 平均瓦斯含量 (m³/t)
    gas_content_std: float = 2.0         # 瓦斯含量标准差
    gas_outburst_threshold: float = 12.0 # 突出危险阈值


@dataclass
class StressUncertainty:
    """采动应力不确定性参数"""
    # 超前支承压力
    abutment_pressure_factor: float = 2.5    # 应力集中系数
    abutment_influence_range: float = 50.0   # 影响范围 (m)

    # 应力叠加
    stress_superposition_factor: float = 1.3  # 叠加系数
    min_safe_distance: float = 300.0          # 最小安全距离 (m)

    # 岩层破断
    first_weighting_interval: float = 40.0    # 初次来压步距 (m)
    periodic_weighting_interval: float = 15.0 # 周期来压步距 (m)
    weighting_std: float = 3.0                # 来压步距标准差


@dataclass
class OperationalUncertainty:
    """生产运营不确定性参数"""
    # 掘进速度
    tunneling_rate_mean: float = 200.0   # 平均月掘进速度 (m)
    tunneling_rate_std: float = 30.0     # 掘进速度标准差

    # 回采速度
    advance_rate_mean: float = 100.0     # 平均月推进速度 (m)
    advance_rate_std: float = 15.0       # 推进速度标准差

    # 设备故障
    equipment_mtbf: float = 720.0        # 平均故障间隔 (小时)
    equipment_mttr: float = 24.0         # 平均修复时间 (小时)
    major_failure_prob: float = 0.02     # 重大故障概率

    # 搬家时间
    relocation_time_mean: float = 30.0   # 平均搬家时间 (天)
    relocation_time_std: float = 7.0     # 搬家时间标准差


class UncertaintyModel:
    """
    综合不确定性模型

    整合地质、应力、运营三类不确定性，提供：
    1. 随机采样方法
    2. 风险评估方法
    3. 蒙特卡洛模拟支持
    """

    def __init__(
        self,
        geological: GeologicalUncertainty = None,
        stress: StressUncertainty = None,
        operational: OperationalUncertainty = None,
        seed: int = None
    ):
        self.geological = geological or GeologicalUncertainty()
        self.stress = stress or StressUncertainty()
        self.operational = operational or OperationalUncertainty()

        if seed is not None:
            np.random.seed(seed)

    def sample_coal_thickness(self, base_thickness: float, n_samples: int = 1) -> np.ndarray:
        """
        采样煤厚（考虑空间相关性）

        Args:
            base_thickness: 基准煤厚
            n_samples: 采样数量

        Returns:
            煤厚采样值数组
        """
        # 使用截断正态分布，确保煤厚为正
        samples = stats.truncnorm.rvs(
            (0.5 - base_thickness) / self.geological.thickness_std,
            (5.0 - base_thickness) / self.geological.thickness_std,
            loc=base_thickness,
            scale=self.geological.thickness_std,
            size=n_samples
        )
        return samples

    def sample_fault_encounter(self, geological_score: float) -> Tuple[bool, float]:
        """
        采样是否遇到断层

        Args:
            geological_score: 地质评分 (0-100)

        Returns:
            (是否遇断层, 影响系数)
        """
        # 地质评分低的区域断层概率更高
        adjusted_prob = self.geological.fault_probability * (100 - geological_score) / 50

        if np.random.random() < adjusted_prob:
            # 遇到断层，影响系数在0.2-0.5之间
            impact = np.random.uniform(0.2, 0.5)
            return True, impact
        return False, 0.0

    def sample_water_inrush_risk(
        self,
        geological_score: float,
        adjacent_goaf_count: int,
        distance_to_aquifer: float
    ) -> float:
        """
        计算突水风险概率

        Args:
            geological_score: 地质评分
            adjacent_goaf_count: 相邻采空区数量
            distance_to_aquifer: 距含水层距离 (m)

        Returns:
            突水风险概率 (0-1)
        """
        base_prob = self.geological.water_inrush_base_prob

        # 地质条件影响
        geology_factor = (100 - geological_score) / 100

        # 采空区影响
        goaf_factor = 1 + adjacent_goaf_count * 0.3

        # 含水层距离影响（距离越近风险越高）
        if distance_to_aquifer < 50:
            aquifer_factor = 3.0
        elif distance_to_aquifer < 100:
            aquifer_factor = 2.0
        elif distance_to_aquifer < 200:
            aquifer_factor = 1.5
        else:
            aquifer_factor = 1.0

        risk = base_prob * geology_factor * goaf_factor * aquifer_factor
        return min(risk, 1.0)

    def sample_gas_content(self, base_content: float) -> float:
        """采样瓦斯含量"""
        return max(0, np.random.normal(base_content, self.geological.gas_content_std))

    def calculate_stress_concentration(
        self,
        distance_to_goaf: float,
        goaf_count: int,
        coal_pillar_width: float
    ) -> float:
        """
        计算应力集中系数

        Args:
            distance_to_goaf: 距采空区距离 (m)
            goaf_count: 周围采空区数量
            coal_pillar_width: 煤柱宽度 (m)

        Returns:
            应力集中系数 (1.0-4.0)
        """
        base_factor = 1.0

        # 距离影响
        if distance_to_goaf < self.stress.abutment_influence_range:
            distance_factor = self.stress.abutment_pressure_factor * \
                             (1 - distance_to_goaf / self.stress.abutment_influence_range)
            base_factor += distance_factor

        # 多采空区叠加
        if goaf_count > 1:
            base_factor *= (1 + (goaf_count - 1) * 0.2)

        # 煤柱宽度影响（窄煤柱应力更集中）
        if coal_pillar_width < 20:
            base_factor *= 1.5
        elif coal_pillar_width < 30:
            base_factor *= 1.2

        return min(base_factor, 4.0)

    def sample_roof_weighting(self, current_advance: float, is_first: bool = False) -> Tuple[bool, float]:
        """
        采样顶板来压事件

        Args:
            current_advance: 当前推进距离 (m)
            is_first: 是否为初次来压

        Returns:
            (是否来压, 来压强度系数)
        """
        if is_first:
            interval = self.stress.first_weighting_interval
        else:
            interval = self.stress.periodic_weighting_interval

        # 添加随机性
        actual_interval = np.random.normal(interval, self.stress.weighting_std)

        # 检查是否达到来压步距
        if current_advance % actual_interval < 5:  # 5m容差
            intensity = np.random.uniform(0.8, 1.2)
            return True, intensity

        return False, 0.0

    def sample_tunneling_rate(self, base_rate: float, geological_score: float) -> float:
        """
        采样掘进速度

        Args:
            base_rate: 基准掘进速度
            geological_score: 地质评分

        Returns:
            实际掘进速度
        """
        # 地质条件影响
        geology_factor = 0.7 + 0.3 * geological_score / 100

        # 随机波动
        rate = np.random.normal(
            base_rate * geology_factor,
            self.operational.tunneling_rate_std
        )

        return max(50, rate)  # 最低50m/月

    def sample_advance_rate(self, base_rate: float, geological_score: float,
                           stress_factor: float) -> float:
        """
        采样回采推进速度

        Args:
            base_rate: 基准推进速度
            geological_score: 地质评分
            stress_factor: 应力集中系数

        Returns:
            实际推进速度
        """
        # 地质条件影响
        geology_factor = 0.7 + 0.3 * geological_score / 100

        # 应力影响（高应力降低推进速度）
        stress_impact = 1.0 / (1 + 0.1 * (stress_factor - 1))

        # 随机波动
        rate = np.random.normal(
            base_rate * geology_factor * stress_impact,
            self.operational.advance_rate_std
        )

        return max(30, rate)  # 最低30m/月

    def sample_equipment_failure(self, operating_hours: float) -> Tuple[bool, float]:
        """
        采样设备故障

        Args:
            operating_hours: 累计运行小时数

        Returns:
            (是否故障, 停机时间)
        """
        # 指数分布故障模型
        failure_prob = 1 - np.exp(-operating_hours / self.operational.equipment_mtbf)

        if np.random.random() < failure_prob * 0.1:  # 月度故障概率
            # 故障发生，采样修复时间
            repair_time = np.random.exponential(self.operational.equipment_mttr)

            # 检查是否为重大故障
            if np.random.random() < self.operational.major_failure_prob:
                repair_time *= 5  # 重大故障修复时间更长

            return True, repair_time

        return False, 0.0

    def sample_relocation_time(self, distance: float) -> float:
        """
        采样设备搬家时间

        Args:
            distance: 搬家距离 (m)

        Returns:
            搬家时间 (天)
        """
        # 基础时间与距离相关
        base_time = self.operational.relocation_time_mean * (1 + distance / 1000)

        # 添加随机性
        time = np.random.normal(base_time, self.operational.relocation_time_std)

        return max(15, time)  # 最少15天


class MonteCarloSimulator:
    """
    蒙特卡洛模拟器

    用于评估接续方案在不确定性条件下的鲁棒性
    """

    def __init__(self, uncertainty_model: UncertaintyModel, n_simulations: int = 1000):
        self.uncertainty = uncertainty_model
        self.n_simulations = n_simulations

    def simulate_scenario(self, env, agent, seed: int = None) -> Dict:
        """
        模拟单个场景

        Args:
            env: 环境实例
            agent: 智能体
            seed: 随机种子

        Returns:
            场景结果
        """
        if seed is not None:
            np.random.seed(seed)

        state = env.reset()
        total_reward = 0
        production_history = []
        risk_events = []

        step = 0
        while True:
            action_mask = env.get_valid_action_mask()
            action, _, _ = agent.get_action(state, action_mask)

            # 应用不确定性
            self._apply_uncertainty(env)

            state, reward, done, info = env.step(action)
            total_reward += reward
            production_history.append(info.get('monthly_production', 0))

            # 记录风险事件
            if self._check_risk_event(env):
                risk_events.append({
                    'step': step,
                    'type': 'risk',
                    'details': self._get_risk_details(env)
                })

            step += 1
            if done:
                break

        return {
            'total_reward': total_reward,
            'total_production': sum(production_history),
            'production_variance': np.var(production_history) if production_history else 0,
            'total_months': step,
            'risk_events': len(risk_events),
            'production_history': production_history,
        }

    def _apply_uncertainty(self, env):
        """应用不确定性到环境"""
        for wf in env.state.workfaces:
            if wf.status == 3:  # 在采
                # 采样实际推进速度
                stress_factor = self.uncertainty.calculate_stress_concentration(
                    distance_to_goaf=300,  # 简化
                    goaf_count=1,
                    coal_pillar_width=20
                )
                # 这里可以修改环境的推进速度参数

    def _check_risk_event(self, env) -> bool:
        """检查是否发生风险事件"""
        # 简化实现
        return np.random.random() < 0.05

    def _get_risk_details(self, env) -> Dict:
        """获取风险事件详情"""
        return {'type': 'general_risk'}

    def run_monte_carlo(self, env_factory, agent) -> Dict:
        """
        运行蒙特卡洛模拟

        Args:
            env_factory: 环境工厂函数
            agent: 智能体

        Returns:
            模拟统计结果
        """
        results = []

        for i in range(self.n_simulations):
            env = env_factory()
            result = self.simulate_scenario(env, agent, seed=i)
            results.append(result)

        # 统计分析
        rewards = [r['total_reward'] for r in results]
        productions = [r['total_production'] for r in results]
        durations = [r['total_months'] for r in results]
        risks = [r['risk_events'] for r in results]

        return {
            'n_simulations': self.n_simulations,
            'reward': {
                'mean': np.mean(rewards),
                'std': np.std(rewards),
                'min': np.min(rewards),
                'max': np.max(rewards),
                'percentile_5': np.percentile(rewards, 5),
                'percentile_95': np.percentile(rewards, 95),
            },
            'production': {
                'mean': np.mean(productions),
                'std': np.std(productions),
                'min': np.min(productions),
                'max': np.max(productions),
            },
            'duration': {
                'mean': np.mean(durations),
                'std': np.std(durations),
            },
            'risk': {
                'mean_events': np.mean(risks),
                'max_events': np.max(risks),
                'zero_risk_prob': sum(1 for r in risks if r == 0) / len(risks),
            },
            'raw_results': results,
        }


def calculate_var(returns: List[float], confidence: float = 0.95) -> float:
    """
    计算风险价值 (Value at Risk)

    Args:
        returns: 收益序列
        confidence: 置信水平

    Returns:
        VaR值
    """
    return np.percentile(returns, (1 - confidence) * 100)


def calculate_cvar(returns: List[float], confidence: float = 0.95) -> float:
    """
    计算条件风险价值 (Conditional VaR / Expected Shortfall)

    Args:
        returns: 收益序列
        confidence: 置信水平

    Returns:
        CVaR值
    """
    var = calculate_var(returns, confidence)
    return np.mean([r for r in returns if r <= var])
