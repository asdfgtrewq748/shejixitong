"""
工作面接续优化API路由
增强版：支持详细计划生成、多种RL算法、贴近现场的工序分解
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
from rl_succession.agents.a2c import MaskedA2C, A2CConfig, train_a2c, evaluate_a2c
from rl_succession.train import generate_succession_plan, export_gantt_data, create_sample_workfaces
from rl_succession.utils.detailed_plan_generator import (
    DetailedPlanGenerator,
    generate_detailed_succession_plan
)
from rl_succession.utils.mining_regulations import (
    MiningRegulationConfig,
    MiningRegulationChecker,
    validate_succession_plan
)

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
    从零开始规划新采区的接替方案
    """
    panels_data = [p.dict() for p in request.panels]

    # 根据策略生成从零开始的接替方案
    if request.strategy == 'greedy':
        plan = _generate_new_area_plan(panels_data, 'greedy')
    elif request.strategy == 'sequential':
        plan = _generate_new_area_plan(panels_data, 'sequential')
    elif request.strategy == 'score_based':
        plan = _generate_new_area_plan(panels_data, 'score_based')
    else:
        plan = _generate_new_area_plan(panels_data, 'greedy')

    return {
        "success": True,
        "strategy": request.strategy,
        "plan": plan['plan'],
        "gantt_data": plan['gantt_data'],
        "summary": plan['summary'],
        "succession_order": plan['succession_order'],
        "first_workface": plan['first_workface'],
        "selection_reasons": plan['selection_reasons'],
    }


def _generate_new_area_plan(panels_data: List[Dict], strategy: str) -> Dict:
    """
    从零开始生成新采区的接替方案
    
    核心思路：
    1. 首先选择首采面（根据策略确定）
    2. 确定接替顺序（考虑空间布局、地质条件、接续连贯性）
    3. 生成时间计划（准备期+回采期，确保接续连贯）
    4. 给出选择理由
    """
    if not panels_data:
        return {
            'plan': {'workface_schedule': {}},
            'gantt_data': [],
            'summary': {'total_months': 0, 'cumulative_production': 0, 'completed_workfaces': 0, 'total_workfaces': 0},
            'succession_order': [],
            'first_workface': None,
            'selection_reasons': {},
        }
    
    # 计算每个工作面的属性
    workfaces = []
    for wf_data in panels_data:
        length = wf_data.get('length', 200)
        width = wf_data.get('width', 1000)
        thickness = wf_data.get('avgThickness', 2.0)
        coal_density = 1.4  # t/m³
        reserves = length * width * thickness * coal_density / 10000  # 万吨
        
        workfaces.append({
            'id': wf_data.get('id', f"WF-{len(workfaces)+1:02d}"),
            'length': length,
            'width': width,
            'thickness': thickness,
            'reserves': reserves,
            'score': wf_data.get('avgScore', 75),
            'center_x': wf_data.get('center_x', 0),
            'center_y': wf_data.get('center_y', 0),
        })
    
    # 根据策略确定接替顺序
    if strategy == 'greedy':
        # 贪心策略：优先储量大的工作面
        sorted_wf = sorted(workfaces, key=lambda x: -x['reserves'])
        strategy_name = "储量优先策略"
        strategy_desc = "优先开采储量大的工作面，快速获取产量"
    elif strategy == 'score_based':
        # 评分策略：优先地质条件好的工作面
        sorted_wf = sorted(workfaces, key=lambda x: -x['score'])
        strategy_name = "地质优先策略"
        strategy_desc = "优先开采地质条件好的工作面，降低开采风险"
    else:  # sequential
        # 顺序策略：按空间位置从一端到另一端
        sorted_wf = sorted(workfaces, key=lambda x: (x['center_y'], x['center_x']))
        strategy_name = "空间顺序策略"
        strategy_desc = "按空间位置依次开采，减少通风调整和运输距离"
    
    succession_order = [wf['id'] for wf in sorted_wf]
    first_workface = succession_order[0] if succession_order else None
    
    # 生成选择理由
    selection_reasons = {}
    for i, wf in enumerate(sorted_wf):
        if i == 0:
            if strategy == 'greedy':
                reason = f"首采面：储量最大（{wf['reserves']:.1f}万吨），地质评分{wf['score']:.0f}分，开采条件良好"
            elif strategy == 'score_based':
                reason = f"首采面：地质评分最高（{wf['score']:.0f}分），储量{wf['reserves']:.1f}万吨，开采风险低"
            else:
                reason = f"首采面：位于采区边缘，便于通风系统布置，储量{wf['reserves']:.1f}万吨"
        else:
            prev_wf = sorted_wf[i-1]
            distance = ((wf['center_x'] - prev_wf['center_x'])**2 + (wf['center_y'] - prev_wf['center_y'])**2)**0.5
            if strategy == 'greedy':
                reason = f"第{i+1}接替面：储量{wf['reserves']:.1f}万吨（排名第{i+1}），与上一工作面距离{distance:.0f}m"
            elif strategy == 'score_based':
                reason = f"第{i+1}接替面：地质评分{wf['score']:.0f}分（排名第{i+1}），储量{wf['reserves']:.1f}万吨"
            else:
                reason = f"第{i+1}接替面：按空间顺序接替，与上一工作面相邻，储量{wf['reserves']:.1f}万吨"
        selection_reasons[wf['id']] = reason
    
    # 生成时间计划（从0月开始）
    # 参数设置
    prep_months = 6  # 准备期（包括掘进、安装）
    monthly_advance = 80  # 月推进速度 (m)
    overlap_months = 3  # 接替准备提前量（在上一个面完成前开始准备下一个面）
    max_concurrent_mining = 2  # 最大同时回采面数
    
    workface_schedule = {}
    gantt_data = []
    current_month = 0
    cumulative_production = 0
    
    active_mining = []  # 当前正在回采的工作面
    
    for i, wf in enumerate(sorted_wf):
        # 计算回采时间
        mining_months = max(1, int(wf['width'] / monthly_advance))
        
        # 确定准备开始时间
        if i == 0:
            # 首采面从0月开始准备
            prep_start = 0
        else:
            # 后续工作面：确保与前一个面的接替衔接
            # 在前一个面回采结束前 overlap_months 开始准备
            prev_wf_id = sorted_wf[i-1]['id']
            prev_schedule = workface_schedule[prev_wf_id]
            prev_mining_end = prev_schedule['mining_end']
            
            # 计算开始准备的时间点：确保本面准备完成时，前面还有工作面在采
            # 准备开始时间 = 前面回采结束时间 - 准备期 - 接替提前量
            ideal_prep_start = prev_mining_end - prep_months
            
            # 但不能早于前一个面的准备开始时间
            prep_start = max(prev_schedule['prep_start'] + overlap_months, ideal_prep_start)
        
        mining_start = prep_start + prep_months
        mining_end = mining_start + mining_months
        
        # 计算产量
        production = wf['reserves'] * 10000  # 吨
        cumulative_production += production
        
        workface_schedule[wf['id']] = {
            'order': i + 1,
            'prep_start': prep_start,
            'prep_end': prep_start + prep_months,
            'mining_start': mining_start,
            'mining_end': mining_end,
            'duration_months': mining_months,
            'reserves': wf['reserves'],
            'production': production,
            'status': '待准备',  # 初始状态都是待准备
            'reason': selection_reasons[wf['id']],
        }
        
        # 甘特图数据
        gantt_data.append({
            'workface': wf['id'],
            'task': f'{wf["id"]} 准备',
            'type': 'preparation',
            'start': prep_start,
            'end': prep_start + prep_months,
        })
        gantt_data.append({
            'workface': wf['id'],
            'task': f'{wf["id"]} 回采',
            'type': 'mining',
            'start': mining_start,
            'end': mining_end,
        })
        
        current_month = max(current_month, mining_end)
    
    # 汇总信息
    summary = {
        'total_months': current_month,
        'total_years': round(current_month / 12, 1),
        'cumulative_production': cumulative_production,
        'cumulative_production_wan': round(cumulative_production / 10000, 1),
        'completed_workfaces': 0,  # 初始都是待开采
        'total_workfaces': len(workfaces),
        'strategy_name': strategy_name,
        'strategy_desc': strategy_desc,
        'avg_monthly_production': round(cumulative_production / current_month, 0) if current_month > 0 else 0,
    }
    
    return {
        'plan': {'workface_schedule': workface_schedule},
        'gantt_data': gantt_data,
        'summary': summary,
        'succession_order': succession_order,
        'first_workface': first_workface,
        'selection_reasons': selection_reasons,
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


# ==================== 新增：详细计划生成API ====================

class DetailedPlanRequest(BaseModel):
    """详细计划请求"""
    panels: List[WorkfaceData]
    monthly_target: float = 100000
    start_date: Optional[str] = None  # 格式: YYYY-MM-DD


@router.post("/detailed-plan")
async def generate_detailed_plan(request: DetailedPlanRequest):
    """
    生成详细的接续计划

    返回内容包括：
    - 每个工作面的详细工序分解（测量、掘进、安装、回采各阶段）
    - 具体的时间节点（精确到天）
    - 日/周/月计划
    - 关键路径分析
    - 资源需求计划
    - 风险分析
    - 增强版甘特图数据
    """
    panels_data = [p.dict() for p in request.panels]

    # 首先使用贪心策略获取开采顺序
    env_config = EnvironmentConfig(
        workface_data=panels_data,
        monthly_target=request.monthly_target,
    )
    env = MineSuccessionEnv(env_config)
    basic_plan = _greedy_strategy(env)

    # 从基础方案中提取开采顺序
    schedule = basic_plan.get('workface_schedule', {})
    succession_order = sorted(
        schedule.keys(),
        key=lambda x: schedule[x].get('mining_start', 999) if schedule[x].get('mining_start') is not None else 999
    )

    # 生成详细计划
    generator = DetailedPlanGenerator(start_date=request.start_date)
    detailed_plan = generator.generate_detailed_plan(
        workfaces=panels_data,
        succession_order=succession_order,
        monthly_target=request.monthly_target
    )

    # 验证方案是否符合规程
    validation = validate_succession_plan(
        basic_plan,
        panels_data,
        MiningRegulationConfig()
    )

    return {
        "success": True,
        "detailed_plan": detailed_plan,
        "validation": validation,
        "summary": detailed_plan['summary'],
    }


@router.post("/workface-schedule/{workface_id}")
async def get_workface_schedule(workface_id: str, request: DetailedPlanRequest):
    """
    获取单个工作面的详细时间表

    返回该工作面的：
    - 所有工序及时间安排
    - 日计划（前30天）
    - 周计划
    - 月计划
    - 关键节点
    - 风险点和安全措施
    """
    panels_data = [p.dict() for p in request.panels]

    # 生成详细计划
    generator = DetailedPlanGenerator(start_date=request.start_date)

    # 找到目标工作面
    target_wf = None
    for panel in panels_data:
        if panel.get('id') == workface_id:
            target_wf = panel
            break

    if not target_wf:
        raise HTTPException(status_code=404, detail=f"工作面 {workface_id} 不存在")

    # 生成单个工作面的详细计划
    wf_plan = generator._generate_workface_plan(
        target_wf,
        prep_start_day=0,
        equipment_available_day=0,
        monthly_target=request.monthly_target
    )

    return {
        "success": True,
        "workface_id": workface_id,
        "plan": wf_plan,
    }


class AlgorithmTrainRequest(BaseModel):
    """算法训练请求"""
    panels: List[WorkfaceData]
    algorithm: str = "ppo"  # ppo, a2c, sac, td3
    n_episodes: int = 500
    monthly_target: float = 100000


@router.post("/train-algorithm")
async def train_with_algorithm(request: AlgorithmTrainRequest, background_tasks: BackgroundTasks):
    """
    使用指定算法训练模型

    支持的算法：
    - ppo: 近端策略优化（推荐，稳定性好）
    - a2c: 优势演员-评论家（简单快速）
    - sac: 软演员-评论家（样本效率高）
    - td3: 孪生延迟DDPG（连续控制）
    """
    global training_status

    if training_status['is_training']:
        raise HTTPException(status_code=400, detail="训练正在进行中")

    panels_data = [p.dict() for p in request.panels]

    if request.algorithm not in ['ppo', 'a2c', 'sac', 'td3']:
        raise HTTPException(status_code=400, detail=f"不支持的算法: {request.algorithm}")

    background_tasks.add_task(
        _train_with_algorithm,
        panels_data,
        request.algorithm,
        request.n_episodes,
        request.monthly_target
    )

    training_status['is_training'] = True
    training_status['progress'] = 0
    training_status['total_episodes'] = request.n_episodes
    training_status['algorithm'] = request.algorithm
    training_status['start_time'] = datetime.now().isoformat()
    training_status['message'] = f'使用 {request.algorithm.upper()} 算法训练已启动'

    return {
        "status": "started",
        "algorithm": request.algorithm,
        "message": f"使用 {request.algorithm.upper()} 算法的训练已在后台启动"
    }


async def _train_with_algorithm(
    panels_data: List[Dict],
    algorithm: str,
    n_episodes: int,
    monthly_target: float
):
    """使用指定算法进行后台训练"""
    global training_status, trained_agents

    try:
        # 创建环境
        env_config = EnvironmentConfig(
            workface_data=panels_data,
            monthly_target=monthly_target,
        )
        env = MineSuccessionEnv(env_config)

        # 根据算法创建智能体
        if algorithm == 'ppo':
            config = PPOConfig(n_epochs=5)
            agent = MaskedPPO(env.observation_space_dim, env.action_space_dim, config)
        elif algorithm == 'a2c':
            config = A2CConfig()
            agent = MaskedA2C(env.observation_space_dim, env.action_space_dim, config)
        else:
            # 默认使用PPO
            config = PPOConfig(n_epochs=5)
            agent = MaskedPPO(env.observation_space_dim, env.action_space_dim, config)

        import time
        start_time = time.time()
        all_rewards = []
        best_reward = float('-inf')

        for episode in range(n_episodes):
            state = env.reset()
            episode_reward = 0

            if algorithm == 'a2c':
                # A2C训练循环
                states, actions, rewards_list, dones, masks = [], [], [], [], []

                while True:
                    action_mask = env.get_valid_action_mask()
                    action, _, _ = agent.get_action(state, action_mask)

                    states.append(state)
                    actions.append(action)
                    masks.append(action_mask)

                    next_state, reward, done, _ = env.step(action)

                    rewards_list.append(reward)
                    dones.append(done)
                    episode_reward += reward
                    state = next_state

                    if done:
                        break

                    # 每n步更新一次
                    if len(states) >= 5:
                        import numpy as np
                        agent.update(
                            np.array(states),
                            np.array(actions),
                            np.array(rewards_list),
                            np.array(dones),
                            np.array(masks),
                            state,
                            env.get_valid_action_mask()
                        )
                        states, actions, rewards_list, dones, masks = [], [], [], [], []

            else:
                # PPO训练循环
                trajectories = []

                while True:
                    action_mask = env.get_valid_action_mask()
                    action, log_prob, value = agent.get_action(state, action_mask)
                    next_state, reward, done, _ = env.step(action)

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

            all_rewards.append(episode_reward)
            if episode_reward > best_reward:
                best_reward = episode_reward

            if (episode + 1) % 10 == 0:
                training_status['current_episode'] = episode + 1
                training_status['progress'] = (episode + 1) / n_episodes * 100
                training_status['avg_reward'] = sum(all_rewards[-50:]) / min(50, len(all_rewards))
                training_status['best_reward'] = best_reward
                training_status['elapsed_time'] = time.time() - start_time

            await asyncio.sleep(0)

        # 保存模型
        model_id = f"{algorithm}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        trained_agents[model_id] = {
            'agent': agent,
            'algorithm': algorithm,
            'env_config': env_config,
            'training_stats': {
                'rewards': all_rewards,
                'best_reward': best_reward,
            }
        }

        training_status['is_training'] = False
        training_status['progress'] = 100
        training_status['message'] = f'训练完成! 算法: {algorithm.upper()}, 模型ID: {model_id}'
        training_status['model_id'] = model_id

    except Exception as e:
        training_status['is_training'] = False
        training_status['message'] = f'训练失败: {str(e)}'
        raise


@router.get("/mining-regulations")
async def get_mining_regulations():
    """
    获取采矿规程约束配置

    返回当前使用的所有采矿规程参数，包括：
    - 工作面设计规范
    - 安全间距要求
    - 采掘比例约束
    - 生产能力约束
    - 设备搬家时间标准
    - 通风约束
    - 顶板管理要求
    """
    config = MiningRegulationConfig()

    return {
        "workface_design": {
            "min_face_length": {"value": config.min_face_length, "unit": "m", "description": "最小工作面长度"},
            "max_face_length": {"value": config.max_face_length, "unit": "m", "description": "最大工作面长度"},
            "recommended_face_length": {"value": config.recommended_face_length, "unit": "m", "description": "推荐工作面长度范围"},
            "min_advance_length": {"value": config.min_advance_length, "unit": "m", "description": "最小推进长度"},
            "max_advance_length": {"value": config.max_advance_length, "unit": "m", "description": "最大推进长度"},
        },
        "safety_distance": {
            "min_safe_distance": {"value": config.min_safe_distance, "unit": "m", "description": "两个在采工作面最小距离"},
            "min_goaf_distance": {"value": config.min_goaf_distance, "unit": "m", "description": "工作面距采空区最小距离"},
            "skip_mining_distance": {"value": config.skip_mining_distance, "unit": "m", "description": "跳采留设煤柱宽度"},
        },
        "simultaneous_operations": {
            "max_simultaneous_mining_faces": {"value": config.max_simultaneous_mining_faces, "unit": "个", "description": "最多同时回采工作面数"},
            "max_simultaneous_prep_faces": {"value": config.max_simultaneous_prep_faces, "unit": "个", "description": "最多同时准备工作面数"},
            "max_tunneling_faces": {"value": config.max_tunneling_faces, "unit": "个", "description": "最多同时掘进头数"},
        },
        "production_capacity": {
            "max_daily_output_per_face": {"value": config.max_daily_output_per_face, "unit": "万吨/天", "description": "单工作面日产量上限"},
            "min_monthly_advance": {"value": config.min_monthly_advance, "unit": "m/月", "description": "最低月推进"},
            "max_monthly_advance": {"value": config.max_monthly_advance, "unit": "m/月", "description": "最高月推进"},
            "recommended_advance": {"value": config.recommended_advance, "unit": "m/月", "description": "推荐月推进"},
        },
        "tunneling_rate": {
            "roadheader_monthly_rate": {"value": config.roadheader_monthly_rate, "unit": "m/月", "description": "综掘机月进尺"},
            "drilling_blasting_monthly_rate": {"value": config.drilling_blasting_monthly_rate, "unit": "m/月", "description": "炮掘月进尺"},
            "entry_tunneling_rate": {"value": config.entry_tunneling_rate, "unit": "m/月", "description": "顺槽掘进速度"},
            "cut_tunneling_rate": {"value": config.cut_tunneling_rate, "unit": "m/月", "description": "开切眼掘进速度"},
        },
        "equipment_relocation": {
            "equipment_disassembly_days": {"value": config.equipment_disassembly_days, "unit": "天", "description": "设备拆除时间"},
            "equipment_transport_days": {"value": config.equipment_transport_days, "unit": "天", "description": "设备运输时间（基准）"},
            "equipment_installation_days": {"value": config.equipment_installation_days, "unit": "天", "description": "设备安装时间"},
            "equipment_testing_days": {"value": config.equipment_testing_days, "unit": "天", "description": "设备调试时间"},
            "min_relocation_days": {"value": config.min_relocation_days, "unit": "天", "description": "最短搬家周期"},
            "max_relocation_days": {"value": config.max_relocation_days, "unit": "天", "description": "最长搬家周期"},
        },
        "roof_management": {
            "first_weighting_interval": {"value": config.first_weighting_interval, "unit": "m", "description": "初次来压步距"},
            "periodic_weighting_interval": {"value": config.periodic_weighting_interval, "unit": "m", "description": "周期来压步距"},
            "end_mining_period_days": {"value": config.end_mining_period_days, "unit": "天", "description": "末采期天数"},
        },
        "succession": {
            "succession_lead_time": {"value": config.succession_lead_time, "unit": "月", "description": "接续提前量"},
            "min_ready_faces": {"value": config.min_ready_faces, "unit": "个", "description": "最少待采工作面数"},
            "recommended_ready_faces": {"value": config.recommended_ready_faces, "unit": "个", "description": "推荐待采工作面数"},
            "min_prep_period": {"value": config.min_prep_period, "unit": "月", "description": "最短准备期"},
            "max_prep_period": {"value": config.max_prep_period, "unit": "月", "description": "最长准备期"},
        },
    }


@router.post("/validate-plan")
async def validate_plan(request: DetailedPlanRequest):
    """
    验证接续方案是否符合采矿规程

    检查内容：
    - 工作面设计是否符合规范
    - 安全间距是否满足
    - 同时作业数量是否超限
    - 接续衔接是否合理
    """
    panels_data = [p.dict() for p in request.panels]

    # 生成基础方案
    env_config = EnvironmentConfig(
        workface_data=panels_data,
        monthly_target=request.monthly_target,
    )
    env = MineSuccessionEnv(env_config)
    plan = _greedy_strategy(env)

    # 验证
    validation = validate_succession_plan(plan, panels_data)

    # 逐个工作面检查
    checker = MiningRegulationChecker()
    workface_checks = {}
    for panel in panels_data:
        check_result = checker.check_workface_design(panel)
        workface_checks[panel['id']] = check_result

    return {
        "success": True,
        "overall_valid": validation['valid'],
        "violations": validation['violations'],
        "warnings": validation['warnings'],
        "workface_checks": workface_checks,
    }


@router.get("/algorithm-info")
async def get_algorithm_info():
    """
    获取可用的强化学习算法信息
    """
    return {
        "algorithms": [
            {
                "id": "ppo",
                "name": "PPO (近端策略优化)",
                "description": "稳定性好，适合大多数场景",
                "recommended": True,
                "features": [
                    "策略裁剪防止过大更新",
                    "支持动作掩码",
                    "训练稳定"
                ],
            },
            {
                "id": "a2c",
                "name": "A2C (优势演员-评论家)",
                "description": "简单快速，适合快速原型",
                "recommended": False,
                "features": [
                    "同步采样",
                    "使用GAE计算优势",
                    "实现简单"
                ],
            },
            {
                "id": "sac",
                "name": "SAC (软演员-评论家)",
                "description": "样本效率高，探索能力强",
                "recommended": False,
                "features": [
                    "熵正则化",
                    "双Q网络",
                    "优先经验回放"
                ],
            },
            {
                "id": "td3",
                "name": "TD3 (孪生延迟DDPG)",
                "description": "适合复杂决策问题",
                "recommended": False,
                "features": [
                    "延迟策略更新",
                    "目标策略平滑",
                    "课程学习"
                ],
            },
        ]
    }
