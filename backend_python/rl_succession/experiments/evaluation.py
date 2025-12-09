"""
实验评估模块

提供完整的实验评估框架，包括：
1. 评估指标计算
2. 统计显著性检验
3. 实验结果可视化
4. 结果导出
"""

from dataclasses import dataclass, field
from typing import List, Dict, Tuple, Optional, Callable
import numpy as np
from scipy import stats
import json
import os
from datetime import datetime


@dataclass
class EvaluationMetrics:
    """评价指标"""
    # 产量指标
    total_production: float = 0.0        # 总产量（吨）
    monthly_production_mean: float = 0.0 # 平均月产量
    monthly_production_std: float = 0.0  # 月产量标准差
    production_variance_coef: float = 0.0 # 产量变异系数
    gap_months: int = 0                  # 产量断档月数

    # 时间指标
    total_duration: int = 0              # 总工期（月）
    avg_prep_time: float = 0.0           # 平均准备时间
    avg_mining_time: float = 0.0         # 平均回采时间
    equipment_utilization: float = 0.0   # 设备利用率
    idle_months: int = 0                 # 设备闲置月数

    # 经济指标
    total_cost: float = 0.0              # 总成本
    cost_per_ton: float = 0.0            # 吨煤成本
    npv: float = 0.0                     # 净现值
    roi: float = 0.0                     # 投资回报率

    # 安全指标
    max_stress_risk: float = 0.0         # 最大应力风险
    avg_stress_risk: float = 0.0         # 平均应力风险
    water_hazard_events: int = 0         # 水害事件数
    safety_violations: int = 0           # 安全违规次数

    # 资源指标
    recovery_rate: float = 0.0           # 资源回收率
    completed_workfaces: int = 0         # 完成工作面数
    total_workfaces: int = 0             # 总工作面数

    # 奖励指标
    total_reward: float = 0.0            # 总奖励
    avg_reward: float = 0.0              # 平均每步奖励


def calculate_metrics(env, production_history: List[float],
                     action_history: List[int] = None) -> EvaluationMetrics:
    """
    计算评估指标

    Args:
        env: 环境实例（已完成episode）
        production_history: 月产量历史
        action_history: 动作历史

    Returns:
        评估指标
    """
    metrics = EvaluationMetrics()
    state = env.state

    # 产量指标
    metrics.total_production = state.cumulative_production
    if production_history:
        metrics.monthly_production_mean = np.mean(production_history)
        metrics.monthly_production_std = np.std(production_history)
        if metrics.monthly_production_mean > 0:
            metrics.production_variance_coef = metrics.monthly_production_std / metrics.monthly_production_mean
        metrics.gap_months = sum(1 for p in production_history if p < state.production_target * 0.1)

    # 时间指标
    metrics.total_duration = state.current_step

    prep_times = []
    mining_times = []
    for wf in state.workfaces:
        if wf.prep_start_time is not None and wf.mining_start_time is not None:
            prep_times.append(wf.mining_start_time - wf.prep_start_time)
        if wf.mining_start_time is not None and wf.status == 4:
            # 估算回采时间
            mining_times.append(wf.advance_length / 100)  # 假设月推进100m

    if prep_times:
        metrics.avg_prep_time = np.mean(prep_times)
    if mining_times:
        metrics.avg_mining_time = np.mean(mining_times)

    # 设备利用率
    if action_history:
        mining_steps = sum(1 for i, a in enumerate(action_history)
                         if i < len(production_history) and production_history[i] > 0)
        metrics.equipment_utilization = mining_steps / max(len(action_history), 1)
        metrics.idle_months = len(action_history) - mining_steps

    # 资源指标
    total_reserves = sum(wf.reserves for wf in state.workfaces)
    if total_reserves > 0:
        metrics.recovery_rate = state.cumulative_production / (total_reserves * 10000)

    metrics.completed_workfaces = sum(1 for wf in state.workfaces if wf.status == 4)
    metrics.total_workfaces = len(state.workfaces)

    # 经济指标（简化计算）
    # 假设：掘进成本500元/m，回采成本50元/吨，煤价500元/吨
    tunneling_cost = sum(wf.transport_lane_length + wf.return_lane_length + wf.cut_length
                        for wf in state.workfaces if wf.status >= 2) * 500
    mining_cost = state.cumulative_production * 50
    metrics.total_cost = tunneling_cost + mining_cost

    if state.cumulative_production > 0:
        metrics.cost_per_ton = metrics.total_cost / state.cumulative_production

    revenue = state.cumulative_production * 500  # 煤价500元/吨
    metrics.npv = revenue - metrics.total_cost
    if metrics.total_cost > 0:
        metrics.roi = metrics.npv / metrics.total_cost

    return metrics


class ExperimentRunner:
    """
    实验运行器

    支持多种算法对比实验
    """

    def __init__(self, env_factory: Callable, n_runs: int = 10, seed: int = 42):
        """
        初始化实验运行器

        Args:
            env_factory: 环境工厂函数
            n_runs: 每个算法运行次数
            seed: 随机种子
        """
        self.env_factory = env_factory
        self.n_runs = n_runs
        self.seed = seed
        self.results = {}

    def run_baseline(self, policy, name: str = None) -> Dict:
        """
        运行基线策略实验

        Args:
            policy: 策略实例
            name: 策略名称

        Returns:
            实验结果
        """
        if name is None:
            name = policy.name

        results = []

        for run in range(self.n_runs):
            np.random.seed(self.seed + run)
            env = self.env_factory()

            # 运行episode
            episode_result = policy.run_episode(env)

            # 计算指标
            metrics = calculate_metrics(
                env,
                episode_result.get('production_history', []),
                episode_result.get('action_history', [])
            )

            results.append({
                'run': run,
                'metrics': metrics,
                'episode_result': episode_result,
            })

        self.results[name] = results
        return self._summarize_results(results, name)

    def run_rl_agent(self, agent, name: str = "RL-PPO") -> Dict:
        """
        运行RL智能体实验

        Args:
            agent: RL智能体
            name: 算法名称

        Returns:
            实验结果
        """
        results = []

        for run in range(self.n_runs):
            np.random.seed(self.seed + run)
            env = self.env_factory()

            state = env.reset()
            total_reward = 0
            production_history = []
            action_history = []

            while True:
                action_mask = env.get_valid_action_mask()
                action, _, _ = agent.get_action(state, action_mask)

                state, reward, done, info = env.step(action)

                total_reward += reward
                production_history.append(info.get('monthly_production', 0))
                action_history.append(action)

                if done:
                    break

            metrics = calculate_metrics(env, production_history, action_history)
            metrics.total_reward = total_reward
            metrics.avg_reward = total_reward / len(action_history) if action_history else 0

            results.append({
                'run': run,
                'metrics': metrics,
                'production_history': production_history,
                'action_history': action_history,
            })

        self.results[name] = results
        return self._summarize_results(results, name)

    def run_optimizer(self, optimizer, name: str = None, n_iterations: int = 100) -> Dict:
        """
        运行优化算法实验

        Args:
            optimizer: 优化器实例
            name: 算法名称
            n_iterations: 迭代次数

        Returns:
            实验结果
        """
        if name is None:
            name = optimizer.name

        results = []

        for run in range(self.n_runs):
            np.random.seed(self.seed + run)

            # 运行优化
            opt_result = optimizer.optimize(self.env_factory, n_iterations)

            # 使用最优解运行一次完整episode
            env = self.env_factory()
            state = env.reset()
            total_reward = 0
            production_history = []

            while True:
                action_mask = env.get_valid_action_mask()
                # 简化：使用贪心策略配合最优序列
                action = self._sequence_to_action(env, opt_result['best_solution'], action_mask)
                state, reward, done, info = env.step(action)
                total_reward += reward
                production_history.append(info.get('monthly_production', 0))
                if done:
                    break

            metrics = calculate_metrics(env, production_history)
            metrics.total_reward = total_reward

            results.append({
                'run': run,
                'metrics': metrics,
                'optimization_result': {
                    'best_fitness': opt_result['best_fitness'],
                    'history': opt_result['history'][-10:],  # 只保留最后10条
                },
            })

        self.results[name] = results
        return self._summarize_results(results, name)

    def _sequence_to_action(self, env, sequence, action_mask) -> int:
        """将序列转换为动作（简化实现）"""
        n_wf = len(env.workfaces)

        # 优先开始回采
        for i, wf in enumerate(env.state.workfaces):
            if wf.status == 2 and wf.equipment_installed:
                action_idx = 1 + n_wf + i
                if action_mask[action_idx] > 0:
                    return action_idx

        # 搬家
        for i, wf in enumerate(env.state.workfaces):
            if wf.status == 2 and not wf.equipment_installed:
                action_idx = 1 + 2 * n_wf + i
                if action_mask[action_idx] > 0:
                    return action_idx

        # 按序列准备
        for idx in sequence:
            if idx < len(env.state.workfaces):
                wf = env.state.workfaces[idx]
                if wf.status == 0:
                    action_idx = 1 + idx
                    if action_mask[action_idx] > 0:
                        return action_idx

        return 0

    def _summarize_results(self, results: List[Dict], name: str) -> Dict:
        """汇总实验结果"""
        metrics_list = [r['metrics'] for r in results]

        summary = {
            'name': name,
            'n_runs': len(results),
            'metrics': {},
        }

        # 汇总各指标
        metric_names = [
            'total_production', 'monthly_production_mean', 'production_variance_coef',
            'total_duration', 'equipment_utilization', 'recovery_rate',
            'total_cost', 'cost_per_ton', 'npv', 'roi',
            'completed_workfaces', 'total_reward'
        ]

        for metric_name in metric_names:
            values = [getattr(m, metric_name) for m in metrics_list]
            summary['metrics'][metric_name] = {
                'mean': np.mean(values),
                'std': np.std(values),
                'min': np.min(values),
                'max': np.max(values),
                'median': np.median(values),
            }

        return summary

    def compare_algorithms(self, metric_name: str = 'total_reward') -> Dict:
        """
        比较不同算法的性能

        Args:
            metric_name: 比较的指标名称

        Returns:
            比较结果
        """
        comparison = {
            'metric': metric_name,
            'algorithms': {},
            'statistical_tests': {},
        }

        # 提取各算法的指标值
        for name, results in self.results.items():
            values = [getattr(r['metrics'], metric_name) for r in results]
            comparison['algorithms'][name] = {
                'values': values,
                'mean': np.mean(values),
                'std': np.std(values),
            }

        # 统计显著性检验
        algorithm_names = list(self.results.keys())

        for i, name1 in enumerate(algorithm_names):
            for name2 in algorithm_names[i+1:]:
                values1 = comparison['algorithms'][name1]['values']
                values2 = comparison['algorithms'][name2]['values']

                # t检验
                t_stat, p_value = stats.ttest_ind(values1, values2)

                # Mann-Whitney U检验（非参数）
                u_stat, u_p_value = stats.mannwhitneyu(values1, values2, alternative='two-sided')

                comparison['statistical_tests'][f'{name1}_vs_{name2}'] = {
                    't_test': {'statistic': t_stat, 'p_value': p_value},
                    'mann_whitney': {'statistic': u_stat, 'p_value': u_p_value},
                    'significant': p_value < 0.05,
                }

        return comparison

    def generate_report(self, output_dir: str = 'results') -> str:
        """
        生成实验报告

        Args:
            output_dir: 输出目录

        Returns:
            报告文件路径
        """
        os.makedirs(output_dir, exist_ok=True)

        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        report_path = os.path.join(output_dir, f'experiment_report_{timestamp}.json')

        report = {
            'timestamp': timestamp,
            'config': {
                'n_runs': self.n_runs,
                'seed': self.seed,
            },
            'summaries': {},
            'comparisons': {},
        }

        # 添加各算法汇总
        for name, results in self.results.items():
            report['summaries'][name] = self._summarize_results(results, name)

        # 添加比较结果
        for metric in ['total_reward', 'total_production', 'recovery_rate', 'equipment_utilization']:
            report['comparisons'][metric] = self.compare_algorithms(metric)

        with open(report_path, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2, ensure_ascii=False, default=str)

        return report_path


class StatisticalAnalysis:
    """统计分析工具"""

    @staticmethod
    def compute_confidence_interval(data: List[float], confidence: float = 0.95) -> Tuple[float, float]:
        """计算置信区间"""
        n = len(data)
        mean = np.mean(data)
        se = stats.sem(data)
        h = se * stats.t.ppf((1 + confidence) / 2, n - 1)
        return mean - h, mean + h

    @staticmethod
    def compute_effect_size(group1: List[float], group2: List[float]) -> float:
        """计算Cohen's d效应量"""
        n1, n2 = len(group1), len(group2)
        var1, var2 = np.var(group1, ddof=1), np.var(group2, ddof=1)

        pooled_std = np.sqrt(((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2))

        return (np.mean(group1) - np.mean(group2)) / pooled_std

    @staticmethod
    def anova_test(groups: Dict[str, List[float]]) -> Dict:
        """单因素方差分析"""
        group_values = list(groups.values())
        f_stat, p_value = stats.f_oneway(*group_values)

        return {
            'f_statistic': f_stat,
            'p_value': p_value,
            'significant': p_value < 0.05,
        }

    @staticmethod
    def kruskal_wallis_test(groups: Dict[str, List[float]]) -> Dict:
        """Kruskal-Wallis检验（非参数）"""
        group_values = list(groups.values())
        h_stat, p_value = stats.kruskal(*group_values)

        return {
            'h_statistic': h_stat,
            'p_value': p_value,
            'significant': p_value < 0.05,
        }
