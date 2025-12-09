"""
工作面接续优化API路由
"""
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import List, Dict, Optional
import os
import json
import asyncio
from datetime import datetime

from rl_succession.envs.mine_env import MineSuccessionEnv, EnvironmentConfig, create_env_from_design
from rl_succession.agents.ppo import MaskedPPO, PPOConfig, train, evaluate
from rl_succession.train import generate_succession_plan, export_gantt_data, create_sample_workfaces

router = APIRouter()

# 全局变量存储训练状态
training_status = {
    'is_training': False,
    'progress': 0,
    'current_episode': 0,
    'total_episodes': 0,
    'best_reward': 0,
    'avg_reward': 0,
    'start_time': None,
    'elapsed_time': 0,
    'message': '',
}

# 存储训练好的模型
trained_agents = {}


class WorkfaceData(BaseModel):
    """工作面数据"""
    id: str
    length: float
    width: float
    center_x: float = 0
    center_y: float = 0
    avgThickness: float = 2.0
    avgScore: float = 75.0


class TrainRequest(BaseModel):
    """训练请求"""
    panels: List[WorkfaceData]
    n_episodes: int = 500
    monthly_target: float = 100000
    max_steps: int = 120


class OptimizeRequest(BaseModel):
    """优化请求"""
    panels: List[WorkfaceData]
    monthly_target: float = 100000


class QuickOptimizeRequest(BaseModel):
    """快速优化请求（使用基线策略）"""
    panels: List[WorkfaceData]
    strategy: str = 'greedy'  # greedy, sequential, score_based


@router.get("/status")
async def get_training_status():
    """获取训练状态"""
    return training_status


@router.post("/train")
async def start_training(request: TrainRequest, background_tasks: BackgroundTasks):
    """
    开始训练接续优化模型

    这是一个异步操作，训练在后台进行
    """
    global training_status

    if training_status['is_training']:
        raise HTTPException(status_code=400, detail="训练正在进行中")

    # 转换数据格式
    panels_data = [p.dict() for p in request.panels]

    # 启动后台训练
    background_tasks.add_task(
        _train_model,
        panels_data,
        request.n_episodes,
        request.monthly_target,
        request.max_steps
    )

    training_status['is_training'] = True
    training_status['progress'] = 0
    training_status['total_episodes'] = request.n_episodes
    training_status['start_time'] = datetime.now().isoformat()
    training_status['message'] = '训练已启动'

    return {"status": "started", "message": "训练已在后台启动"}


async def _train_model(panels_data: List[Dict], n_episodes: int,
                       monthly_target: float, max_steps: int):
    """后台训练任务"""
    global training_status, trained_agents

    try:
        # 创建环境
        env_config = EnvironmentConfig(
            workface_data=panels_data,
            monthly_target=monthly_target,
            max_steps=max_steps,
        )
        env = MineSuccessionEnv(env_config)

        # 创建智能体
        config = PPOConfig(n_epochs=5)  # 减少epoch数以加快训练
        agent = MaskedPPO(env.observation_space_dim, env.action_space_dim, config)

        # 训练回调
        def progress_callback(info):
            training_status['current_episode'] = info['episode']
            training_status['progress'] = info['episode'] / n_episodes * 100
            training_status['avg_reward'] = info['avg_reward']
            training_status['best_reward'] = info['best_reward']

        # 训练
        import time
        start_time = time.time()

        # 简化的训练循环
        all_rewards = []
        best_reward = float('-inf')

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
                    state=state,
                    action=action,
                    reward=reward,
                    log_prob=log_prob,
                    value=value,
                    done=done,
                    action_mask=action_mask
                ))

                state = next_state
                episode_reward += reward

                if done:
                    break

            if len(trajectories) > 0:
                agent.update(trajectories)

            all_rewards.append(episode_reward)
            if episode_reward > best_reward:
                best_reward = episode_reward

            # 更新状态
            if (episode + 1) % 10 == 0:
                training_status['current_episode'] = episode + 1
                training_status['progress'] = (episode + 1) / n_episodes * 100
                training_status['avg_reward'] = sum(all_rewards[-50:]) / min(50, len(all_rewards))
                training_status['best_reward'] = best_reward
                training_status['elapsed_time'] = time.time() - start_time

            # 让出控制权
            await asyncio.sleep(0)

        # 保存模型
        model_id = f"model_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        trained_agents[model_id] = {
            'agent': agent,
            'env_config': env_config,
            'training_stats': {
                'rewards': all_rewards,
                'best_reward': best_reward,
            }
        }

        training_status['is_training'] = False
        training_status['progress'] = 100
        training_status['message'] = f'训练完成! 模型ID: {model_id}'
        training_status['model_id'] = model_id

    except Exception as e:
        training_status['is_training'] = False
        training_status['message'] = f'训练失败: {str(e)}'
        raise


@router.post("/optimize")
async def optimize_succession(request: OptimizeRequest):
    """
    使用训练好的模型优化接续方案

    如果没有训练好的模型，将使用快速训练
    """
    panels_data = [p.dict() for p in request.panels]

    # 创建环境
    env_config = EnvironmentConfig(
        workface_data=panels_data,
        monthly_target=request.monthly_target,
    )
    env = MineSuccessionEnv(env_config)

    # 检查是否有训练好的模型
    if trained_agents:
        # 使用最新的模型
        model_id = list(trained_agents.keys())[-1]
        agent = trained_agents[model_id]['agent']
    else:
        # 快速训练一个简单模型
        config = PPOConfig(n_epochs=3)
        agent = MaskedPPO(env.observation_space_dim, env.action_space_dim, config)

        # 快速训练100回合
        for _ in range(100):
            state = env.reset()
            trajectories = []

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
                if done:
                    break

            if trajectories:
                agent.update(trajectories)

    # 生成接续方案
    plan = generate_succession_plan(env, agent, verbose=False)

    # 导出甘特图数据
    gantt_data = export_gantt_data(plan)

    return {
        "success": True,
        "plan": plan,
        "gantt_data": gantt_data,
        "summary": plan['summary'],
    }


@router.post("/quick-optimize")
async def quick_optimize(request: QuickOptimizeRequest):
    """
    使用基线策略快速优化（不需要训练）
    """
    panels_data = [p.dict() for p in request.panels]

    # 创建环境
    env_config = EnvironmentConfig(workface_data=panels_data)
    env = MineSuccessionEnv(env_config)

    # 根据策略生成方案
    if request.strategy == 'greedy':
        plan = _greedy_strategy(env)
    elif request.strategy == 'sequential':
        plan = _sequential_strategy(env)
    elif request.strategy == 'score_based':
        plan = _score_based_strategy(env)
    else:
        plan = _greedy_strategy(env)

    gantt_data = export_gantt_data(plan)

    return {
        "success": True,
        "strategy": request.strategy,
        "plan": plan,
        "gantt_data": gantt_data,
        "summary": plan['summary'],
    }


def _greedy_strategy(env: MineSuccessionEnv) -> Dict:
    """贪心策略：优先选择储量最大的工作面"""
    state = env.reset()
    plan = {'steps': [], 'timeline': [], 'workface_schedule': {}, 'summary': {}}

    while True:
        action_mask = env.get_valid_action_mask()

        # 找到最佳动作
        best_action = 0  # 默认等待

        # 优先开始回采
        n_wf = len(env.workfaces)
        for i, wf in enumerate(env.state.workfaces):
            if wf.status == 2 and wf.equipment_installed and action_mask[1 + n_wf + i] > 0:
                best_action = 1 + n_wf + i
                break

        # 其次搬家
        if best_action == 0:
            for i, wf in enumerate(env.state.workfaces):
                if wf.status == 2 and not wf.equipment_installed and action_mask[1 + 2*n_wf + i] > 0:
                    best_action = 1 + 2*n_wf + i
                    break

        # 最后开始准备（选择储量最大的）
        if best_action == 0:
            max_reserves = -1
            for i, wf in enumerate(env.state.workfaces):
                if wf.status == 0 and action_mask[1 + i] > 0:
                    if wf.reserves > max_reserves:
                        max_reserves = wf.reserves
                        best_action = 1 + i

        state, reward, done, info = env.step(best_action)

        if done:
            break

    # 生成方案
    for wf in env.state.workfaces:
        plan['workface_schedule'][wf.id] = {
            'prep_start': wf.prep_start_time,
            'mining_start': wf.mining_start_time,
            'status': ['待准备', '准备中', '待采', '在采', '已采'][wf.status],
        }

    plan['summary'] = {
        'total_months': env.state.current_step,
        'cumulative_production': env.state.cumulative_production,
        'completed_workfaces': len([wf for wf in env.state.workfaces if wf.status == 4]),
        'total_workfaces': len(env.state.workfaces),
    }

    return plan


def _sequential_strategy(env: MineSuccessionEnv) -> Dict:
    """顺序策略：按编号顺序开采"""
    state = env.reset()
    plan = {'steps': [], 'timeline': [], 'workface_schedule': {}, 'summary': {}}

    current_target = 0  # 当前目标工作面索引

    while True:
        action_mask = env.get_valid_action_mask()
        n_wf = len(env.workfaces)

        best_action = 0

        # 按顺序处理工作面
        if current_target < n_wf:
            wf = env.state.workfaces[current_target]

            if wf.status == 0 and action_mask[1 + current_target] > 0:
                best_action = 1 + current_target  # 开始准备
            elif wf.status == 2 and not wf.equipment_installed and action_mask[1 + 2*n_wf + current_target] > 0:
                best_action = 1 + 2*n_wf + current_target  # 搬家
            elif wf.status == 2 and wf.equipment_installed and action_mask[1 + n_wf + current_target] > 0:
                best_action = 1 + n_wf + current_target  # 开始回采
            elif wf.status == 4:
                current_target += 1  # 移动到下一个工作面

        state, reward, done, info = env.step(best_action)

        if done:
            break

    for wf in env.state.workfaces:
        plan['workface_schedule'][wf.id] = {
            'prep_start': wf.prep_start_time,
            'mining_start': wf.mining_start_time,
            'status': ['待准备', '准备中', '待采', '在采', '已采'][wf.status],
        }

    plan['summary'] = {
        'total_months': env.state.current_step,
        'cumulative_production': env.state.cumulative_production,
        'completed_workfaces': len([wf for wf in env.state.workfaces if wf.status == 4]),
        'total_workfaces': len(env.state.workfaces),
    }

    return plan


def _score_based_strategy(env: MineSuccessionEnv) -> Dict:
    """评分策略：优先选择地质评分高的工作面"""
    state = env.reset()
    plan = {'steps': [], 'timeline': [], 'workface_schedule': {}, 'summary': {}}

    while True:
        action_mask = env.get_valid_action_mask()
        n_wf = len(env.workfaces)

        best_action = 0

        # 优先开始回采
        for i, wf in enumerate(env.state.workfaces):
            if wf.status == 2 and wf.equipment_installed and action_mask[1 + n_wf + i] > 0:
                best_action = 1 + n_wf + i
                break

        # 其次搬家
        if best_action == 0:
            for i, wf in enumerate(env.state.workfaces):
                if wf.status == 2 and not wf.equipment_installed and action_mask[1 + 2*n_wf + i] > 0:
                    best_action = 1 + 2*n_wf + i
                    break

        # 最后开始准备（选择评分最高的）
        if best_action == 0:
            max_score = -1
            for i, wf in enumerate(env.state.workfaces):
                if wf.status == 0 and action_mask[1 + i] > 0:
                    if wf.avg_score > max_score:
                        max_score = wf.avg_score
                        best_action = 1 + i

        state, reward, done, info = env.step(best_action)

        if done:
            break

    for wf in env.state.workfaces:
        plan['workface_schedule'][wf.id] = {
            'prep_start': wf.prep_start_time,
            'mining_start': wf.mining_start_time,
            'status': ['待准备', '准备中', '待采', '在采', '已采'][wf.status],
        }

    plan['summary'] = {
        'total_months': env.state.current_step,
        'cumulative_production': env.state.cumulative_production,
        'completed_workfaces': len([wf for wf in env.state.workfaces if wf.status == 4]),
        'total_workfaces': len(env.state.workfaces),
    }

    return plan


@router.get("/demo")
async def get_demo_optimization():
    """获取演示优化结果（使用示例数据）"""
    # 创建示例工作面
    sample_workfaces = create_sample_workfaces(8)

    # 创建环境
    env_config = EnvironmentConfig(workface_data=sample_workfaces)
    env = MineSuccessionEnv(env_config)

    # 使用贪心策略
    plan = _greedy_strategy(env)
    gantt_data = export_gantt_data(plan)

    return {
        "success": True,
        "workfaces": sample_workfaces,
        "plan": plan,
        "gantt_data": gantt_data,
        "summary": plan['summary'],
    }


@router.post("/compare-strategies")
async def compare_strategies(request: OptimizeRequest):
    """比较不同策略的效果"""
    panels_data = [p.dict() for p in request.panels]

    results = {}

    for strategy in ['greedy', 'sequential', 'score_based']:
        env_config = EnvironmentConfig(
            workface_data=panels_data,
            monthly_target=request.monthly_target,
        )
        env = MineSuccessionEnv(env_config)

        if strategy == 'greedy':
            plan = _greedy_strategy(env)
        elif strategy == 'sequential':
            plan = _sequential_strategy(env)
        else:
            plan = _score_based_strategy(env)

        results[strategy] = {
            'summary': plan['summary'],
            'gantt_data': export_gantt_data(plan),
        }

    return {
        "success": True,
        "comparison": results,
    }
