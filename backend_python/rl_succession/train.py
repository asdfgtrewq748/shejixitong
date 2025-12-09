"""
训练脚本
"""
import os
import json
import time
from datetime import datetime
from typing import Dict, List, Optional

from .envs.mine_env import MineSuccessionEnv, EnvironmentConfig, create_env_from_design
from .agents.ppo import MaskedPPO, PPOConfig, train, evaluate


def create_sample_workfaces(n_workfaces: int = 10) -> List[Dict]:
    """创建示例工作面数据"""
    import numpy as np

    workfaces = []
    base_x = 0
    base_y = 0

    for i in range(n_workfaces):
        # 随机生成工作面参数
        length = np.random.uniform(150, 250)  # 工作面长度
        width = np.random.uniform(800, 1500)  # 推进长度
        thickness = np.random.uniform(1.5, 4.0)  # 煤厚
        score = np.random.uniform(50, 95)  # 地质评分

        # 布置位置（简单的网格布局）
        row = i // 3
        col = i % 3
        center_x = base_x + col * 400
        center_y = base_y + row * 1200

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


def train_succession_optimizer(
    design_result: Optional[Dict] = None,
    n_episodes: int = 1000,
    save_path: str = None,
    config: PPOConfig = None
) -> Dict:
    """
    训练接续优化器

    Args:
        design_result: 工作面设计结果（可选，如果为None则使用示例数据）
        n_episodes: 训练回合数
        save_path: 模型保存路径
        config: PPO配置

    Returns:
        训练结果
    """
    print("=" * 50)
    print("开始训练工作面接续优化器")
    print("=" * 50)

    # 创建环境
    if design_result is None:
        print("使用示例工作面数据...")
        workface_data = create_sample_workfaces(10)
        env_config = EnvironmentConfig(
            workface_data=workface_data,
            monthly_target=100000,
            max_steps=120,
        )
        env = MineSuccessionEnv(env_config)
    else:
        print(f"使用设计结果，共 {len(design_result.get('panels', []))} 个工作面")
        env = create_env_from_design(design_result)

    print(f"状态空间维度: {env.observation_space_dim}")
    print(f"动作空间维度: {env.action_space_dim}")

    # 创建智能体
    if config is None:
        config = PPOConfig()

    agent = MaskedPPO(env.observation_space_dim, env.action_space_dim, config)

    # 训练
    start_time = time.time()

    def progress_callback(info):
        elapsed = time.time() - start_time
        print(f"  [进度] Episode {info['episode']}, "
              f"平均奖励: {info['avg_reward']:.2f}, "
              f"用时: {elapsed:.1f}s")

    training_result = train(
        env, agent,
        n_episodes=n_episodes,
        log_interval=max(1, n_episodes // 10),
        callback=progress_callback
    )

    elapsed_time = time.time() - start_time
    print(f"\n训练完成! 用时: {elapsed_time:.1f}s")

    # 评估
    print("\n评估训练结果...")
    eval_result = evaluate(env, agent, n_episodes=10)
    print(f"评估奖励: {eval_result['mean_reward']:.2f} ± {eval_result['std_reward']:.2f}")

    # 保存模型
    if save_path:
        os.makedirs(os.path.dirname(save_path) if os.path.dirname(save_path) else '.', exist_ok=True)
        agent.save(save_path)
        print(f"模型已保存到: {save_path}")

    return {
        'training_result': training_result,
        'eval_result': eval_result,
        'elapsed_time': elapsed_time,
    }


def generate_succession_plan(
    env: MineSuccessionEnv,
    agent: MaskedPPO,
    verbose: bool = True
) -> Dict:
    """
    使用训练好的智能体生成接续方案

    Args:
        env: 环境
        agent: 训练好的智能体
        verbose: 是否打印详细信息

    Returns:
        接续方案
    """
    state = env.reset()
    plan = {
        'steps': [],
        'timeline': [],
        'workface_schedule': {},
        'summary': {},
    }

    step = 0
    while True:
        action_mask = env.get_valid_action_mask()
        action, _, _ = agent.get_action(state, action_mask)

        # 解析动作
        action_type, target_id = env._decode_action(action)
        action_names = ['等待', '开始准备', '开始回采', '设备搬家']

        # 记录步骤
        step_info = {
            'step': step,
            'month': env.state.current_step,
            'action': action_names[action_type],
            'target': target_id,
            'state': env.render(),
        }
        plan['steps'].append(step_info)

        if verbose and action_type != 0:  # 不打印等待动作
            print(f"月份 {env.state.current_step}: {action_names[action_type]} - {target_id}")

        # 执行动作
        state, reward, done, info = env.step(action)
        step += 1

        if done:
            break

    # 生成时间线
    for wf in env.state.workfaces:
        plan['workface_schedule'][wf.id] = {
            'prep_start': wf.prep_start_time,
            'mining_start': wf.mining_start_time,
            'status': ['待准备', '准备中', '待采', '在采', '已采'][wf.status],
        }

    # 汇总
    plan['summary'] = {
        'total_steps': step,
        'total_months': env.state.current_step,
        'cumulative_production': env.state.cumulative_production,
        'completed_workfaces': len([wf for wf in env.state.workfaces if wf.status == 4]),
        'total_workfaces': len(env.state.workfaces),
    }

    return plan


def export_gantt_data(plan: Dict) -> List[Dict]:
    """
    导出甘特图数据

    Args:
        plan: 接续方案

    Returns:
        甘特图数据列表
    """
    gantt_data = []

    for wf_id, schedule in plan['workface_schedule'].items():
        # 准备阶段
        if schedule['prep_start'] is not None:
            prep_end = schedule['mining_start'] if schedule['mining_start'] else schedule['prep_start'] + 6
            gantt_data.append({
                'workface': wf_id,
                'task': '准备',
                'start': schedule['prep_start'],
                'end': prep_end,
                'type': 'preparation',
            })

        # 回采阶段
        if schedule['mining_start'] is not None:
            # 估算回采结束时间
            mining_end = schedule['mining_start'] + 12  # 假设12个月
            gantt_data.append({
                'workface': wf_id,
                'task': '回采',
                'start': schedule['mining_start'],
                'end': mining_end,
                'type': 'mining',
            })

    return gantt_data


if __name__ == '__main__':
    # 测试训练
    result = train_succession_optimizer(
        n_episodes=500,
        save_path='models/succession_ppo.npz'
    )

    print("\n" + "=" * 50)
    print("训练统计:")
    print(f"  最佳奖励: {result['training_result']['best_reward']:.2f}")
    print(f"  评估奖励: {result['eval_result']['mean_reward']:.2f}")
    print("=" * 50)
