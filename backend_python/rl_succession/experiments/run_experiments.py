"""
完整实验运行脚本

运行所有对比实验并生成论文所需的结果
"""

import os
import sys
import json
import time
import numpy as np
from datetime import datetime

# 添加父目录到路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rl_succession.envs.mine_env import MineSuccessionEnv, EnvironmentConfig
from rl_succession.agents.ppo import MaskedPPO, PPOConfig, train
from rl_succession.baselines.heuristics import (
    GreedyPolicy, SequentialPolicy, ScoreBasedPolicy,
    RandomPolicy, RuleBasedPolicy, DistanceBasedPolicy
)
from rl_succession.baselines.optimization import (
    GeneticAlgorithm, SimulatedAnnealing, ParticleSwarmOptimization
)
from rl_succession.experiments.evaluation import (
    ExperimentRunner, calculate_metrics, StatisticalAnalysis
)
from rl_succession.experiments.visualization import (
    generate_full_report, plot_training_curves
)
from rl_succession.utils.uncertainty import (
    UncertaintyModel, MonteCarloSimulator,
    GeologicalUncertainty, StressUncertainty, OperationalUncertainty
)


def create_test_scenarios():
    """创建测试场景"""
    scenarios = {}

    # 场景1：简单场景（5个工作面，规则布局）
    scenarios['simple'] = {
        'n_workfaces': 5,
        'layout': 'regular',
        'geological_variance': 'low',
        'description': '简单场景：5个工作面，规则布局，地质条件均一',
    }

    # 场景2：中等场景（10个工作面，中等复杂度）
    scenarios['medium'] = {
        'n_workfaces': 10,
        'layout': 'irregular',
        'geological_variance': 'medium',
        'description': '中等场景：10个工作面，不规则边界，地质条件差异',
    }

    # 场景3：复杂场景（15个工作面，高不确定性）
    scenarios['complex'] = {
        'n_workfaces': 15,
        'layout': 'complex',
        'geological_variance': 'high',
        'description': '复杂场景：15个工作面，复杂约束，高不确定性',
    }

    # 场景4：极端场景（20个工作面，紧迫工期）
    scenarios['extreme'] = {
        'n_workfaces': 20,
        'layout': 'mixed',
        'geological_variance': 'very_high',
        'description': '极端场景：20个工作面，紧迫工期，极端地质条件',
    }

    return scenarios


def generate_workface_data(scenario_config: dict, seed: int = 42) -> list:
    """根据场景配置生成工作面数据"""
    np.random.seed(seed)

    n_workfaces = scenario_config['n_workfaces']
    layout = scenario_config['layout']
    variance = scenario_config['geological_variance']

    # 地质条件参数
    variance_map = {
        'low': (75, 10),      # (mean_score, std)
        'medium': (70, 15),
        'high': (65, 20),
        'very_high': (60, 25),
    }
    score_mean, score_std = variance_map.get(variance, (70, 15))

    workfaces = []
    for i in range(n_workfaces):
        # 布局位置
        if layout == 'regular':
            row = i // 3
            col = i % 3
            center_x = col * 400
            center_y = row * 1200
        elif layout == 'irregular':
            center_x = np.random.uniform(0, 1000)
            center_y = np.random.uniform(0, n_workfaces * 400)
        elif layout == 'complex':
            # 多区段布局
            zone = i // 5
            local_idx = i % 5
            center_x = zone * 600 + np.random.uniform(-50, 50)
            center_y = local_idx * 300 + np.random.uniform(-50, 50)
        else:  # mixed
            if i < n_workfaces // 2:
                center_x = (i % 4) * 350
                center_y = (i // 4) * 1000
            else:
                center_x = np.random.uniform(0, 1200)
                center_y = np.random.uniform(n_workfaces * 200, n_workfaces * 400)

        # 工作面参数
        length = np.random.uniform(150, 250)
        width = np.random.uniform(800, 1500)
        thickness = np.random.uniform(1.5, 4.0)
        score = np.clip(np.random.normal(score_mean, score_std), 30, 95)

        workfaces.append({
            'id': f'WF-{i+1:02d}',
            'length': length,
            'width': width,
            'avgThickness': thickness,
            'avgScore': score,
            'center_x': center_x,
            'center_y': center_y,
        })

    return workfaces


def create_env_factory(workface_data: list, monthly_target: float = 100000):
    """创建环境工厂函数"""
    def factory():
        config = EnvironmentConfig(
            workface_data=workface_data,
            monthly_target=monthly_target,
            max_steps=120,
        )
        return MineSuccessionEnv(config)
    return factory


def train_rl_agent(env_factory, n_episodes: int = 2000, verbose: bool = True):
    """训练RL智能体"""
    env = env_factory()

    config = PPOConfig(
        learning_rate=3e-4,
        clip_epsilon=0.2,
        gamma=0.99,
        gae_lambda=0.95,
        n_epochs=10,
    )

    agent = MaskedPPO(env.observation_space_dim, env.action_space_dim, config)

    training_rewards = []

    for episode in range(n_episodes):
        state = env.reset()
        trajectories = []
        episode_reward = 0

        while True:
            action_mask = env.get_valid_action_mask()
            action, log_prob, value = agent.get_action(state, action_mask)
            next_state, reward, done, info = env.step(action)

            from rl_succession.agents.ppo import Trajectory
            trajectories.append(Trajectory(
                state=state, action=action, reward=reward,
                log_prob=log_prob, value=value, done=done,
                action_mask=action_mask
            ))

            state = next_state
            episode_reward += reward

            if done:
                break

        if trajectories:
            agent.update(trajectories)

        training_rewards.append(episode_reward)

        if verbose and (episode + 1) % 100 == 0:
            avg_reward = np.mean(training_rewards[-100:])
            print(f"  Episode {episode + 1}/{n_episodes}, Avg Reward: {avg_reward:.2f}")

    return agent, training_rewards


def run_experiment(scenario_name: str, scenario_config: dict, output_dir: str,
                  n_runs: int = 10, n_training_episodes: int = 2000):
    """运行单个场景的完整实验"""
    print(f"\n{'='*60}")
    print(f"Running experiment: {scenario_name}")
    print(f"Description: {scenario_config['description']}")
    print(f"{'='*60}")

    # 生成工作面数据
    workface_data = generate_workface_data(scenario_config)
    env_factory = create_env_factory(workface_data)

    # 创建实验运行器
    runner = ExperimentRunner(env_factory, n_runs=n_runs, seed=42)

    results = {
        'scenario': scenario_name,
        'config': scenario_config,
        'workface_data': workface_data,
        'algorithms': {},
        'training_curves': {},
    }

    # 1. 训练RL智能体
    print("\n1. Training RL agent...")
    start_time = time.time()
    agent, training_rewards = train_rl_agent(env_factory, n_training_episodes, verbose=True)
    training_time = time.time() - start_time
    print(f"   Training completed in {training_time:.1f}s")

    results['training_curves']['RL-PPO'] = training_rewards

    # 评估RL智能体
    print("   Evaluating RL agent...")
    rl_summary = runner.run_rl_agent(agent, "RL-PPO")
    results['algorithms']['RL-PPO'] = rl_summary
    print(f"   RL-PPO: Reward = {rl_summary['metrics']['total_reward']['mean']:.2f} ± {rl_summary['metrics']['total_reward']['std']:.2f}")

    # 2. 运行基线策略
    print("\n2. Running baseline policies...")
    baselines = [
        (GreedyPolicy(), "Greedy"),
        (SequentialPolicy(), "Sequential"),
        (ScoreBasedPolicy(), "ScoreBased"),
        (RuleBasedPolicy(), "RuleBased"),
        (DistanceBasedPolicy(), "DistanceBased"),
        (RandomPolicy(seed=42), "Random"),
    ]

    for policy, name in baselines:
        summary = runner.run_baseline(policy, name)
        results['algorithms'][name] = summary
        print(f"   {name}: Reward = {summary['metrics']['total_reward']['mean']:.2f} ± {summary['metrics']['total_reward']['std']:.2f}")

    # 3. 运行优化算法
    print("\n3. Running optimization algorithms...")
    optimizers = [
        (GeneticAlgorithm(population_size=30), "GA", 100),
        (SimulatedAnnealing(), "SA", 500),
        (ParticleSwarmOptimization(n_particles=20), "PSO", 100),
    ]

    for optimizer, name, n_iter in optimizers:
        summary = runner.run_optimizer(optimizer, name, n_iter)
        results['algorithms'][name] = summary
        print(f"   {name}: Reward = {summary['metrics']['total_reward']['mean']:.2f} ± {summary['metrics']['total_reward']['std']:.2f}")

    # 4. 统计分析
    print("\n4. Statistical analysis...")
    comparison = runner.compare_algorithms('total_reward')
    results['statistical_analysis'] = comparison

    # 显示显著性检验结果
    for test_name, test_result in comparison['statistical_tests'].items():
        sig = "***" if test_result['p_value'] < 0.001 else "**" if test_result['p_value'] < 0.01 else "*" if test_result['p_value'] < 0.05 else ""
        print(f"   {test_name}: p={test_result['p_value']:.4f} {sig}")

    # 5. 保存结果
    scenario_dir = os.path.join(output_dir, scenario_name)
    os.makedirs(scenario_dir, exist_ok=True)

    # 保存完整结果
    results_path = os.path.join(scenario_dir, 'results.json')
    with open(results_path, 'w', encoding='utf-8') as f:
        # 转换为可序列化格式
        serializable_results = convert_to_serializable(results)
        json.dump(serializable_results, f, indent=2, ensure_ascii=False)

    # 生成可视化
    report_files = generate_full_report({
        'summaries': results['algorithms'],
        'training_curves': results['training_curves'],
    }, scenario_dir)

    print(f"\n   Results saved to: {scenario_dir}")

    return results


def convert_to_serializable(obj):
    """转换对象为可JSON序列化格式"""
    if isinstance(obj, dict):
        return {k: convert_to_serializable(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_to_serializable(v) for v in obj]
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, (np.int64, np.int32)):
        return int(obj)
    elif isinstance(obj, (np.float64, np.float32)):
        return float(obj)
    elif hasattr(obj, '__dict__'):
        return convert_to_serializable(obj.__dict__)
    else:
        return obj


def run_monte_carlo_analysis(env_factory, agent, n_simulations: int = 100):
    """运行蒙特卡洛分析"""
    print("\nRunning Monte Carlo analysis...")

    uncertainty = UncertaintyModel(
        geological=GeologicalUncertainty(),
        stress=StressUncertainty(),
        operational=OperationalUncertainty(),
    )

    simulator = MonteCarloSimulator(uncertainty, n_simulations)
    mc_results = simulator.run_monte_carlo(env_factory, agent)

    print(f"  Reward: {mc_results['reward']['mean']:.2f} ± {mc_results['reward']['std']:.2f}")
    print(f"  Production: {mc_results['production']['mean']:.0f} ± {mc_results['production']['std']:.0f}")
    print(f"  5th percentile reward: {mc_results['reward']['percentile_5']:.2f}")
    print(f"  95th percentile reward: {mc_results['reward']['percentile_95']:.2f}")

    return mc_results


def main():
    """主函数"""
    print("="*60)
    print("Reinforcement Learning for Mining Workface Succession Optimization")
    print("Complete Experiment Suite")
    print("="*60)

    # 配置
    output_dir = 'experiment_results'
    n_runs = 10
    n_training_episodes = 1000  # 可调整

    os.makedirs(output_dir, exist_ok=True)

    # 获取测试场景
    scenarios = create_test_scenarios()

    all_results = {}

    # 运行各场景实验
    for scenario_name, scenario_config in scenarios.items():
        results = run_experiment(
            scenario_name,
            scenario_config,
            output_dir,
            n_runs=n_runs,
            n_training_episodes=n_training_episodes
        )
        all_results[scenario_name] = results

    # 生成汇总报告
    print("\n" + "="*60)
    print("Generating summary report...")
    print("="*60)

    summary_path = os.path.join(output_dir, 'summary_report.json')
    summary = {
        'timestamp': datetime.now().isoformat(),
        'config': {
            'n_runs': n_runs,
            'n_training_episodes': n_training_episodes,
        },
        'scenarios': list(scenarios.keys()),
        'results_summary': {},
    }

    # 汇总各场景的最佳算法
    for scenario_name, results in all_results.items():
        best_algo = max(
            results['algorithms'].items(),
            key=lambda x: x[1]['metrics']['total_reward']['mean']
        )
        summary['results_summary'][scenario_name] = {
            'best_algorithm': best_algo[0],
            'best_reward': best_algo[1]['metrics']['total_reward']['mean'],
        }

    with open(summary_path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    print(f"\nAll experiments completed!")
    print(f"Results saved to: {output_dir}")
    print(f"Summary report: {summary_path}")

    # 打印最终汇总
    print("\n" + "="*60)
    print("FINAL SUMMARY")
    print("="*60)
    for scenario_name, result in summary['results_summary'].items():
        print(f"  {scenario_name}: Best = {result['best_algorithm']} (Reward: {result['best_reward']:.2f})")


if __name__ == '__main__':
    main()
