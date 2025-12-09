"""
强化学习工作面接续优化模块

基于深度强化学习的煤矿工作面接续智能优化系统

主要功能：
1. MDP建模：将接续决策建模为马尔可夫决策过程
2. 不确定性建模：地质条件、应力演化、设备故障等
3. 多目标优化：产量、成本、风险、回收率
4. Masked PPO算法：带动作掩码的近端策略优化
5. 注意力机制：捕捉工作面间的空间关系

作者：Mining Design System Team
版本：1.0.0
"""

__version__ = '1.0.0'

from .envs.mine_env import MineSuccessionEnv, EnvironmentConfig, create_env_from_design
from .agents.ppo import MaskedPPO, PPOConfig, train, evaluate
from .agents.networks import PolicyNetwork
from .agents.attention_network import AttentionPolicyNetwork
from .utils.state import WorkfaceState, MineState, encode_state, get_state_dim
from .utils.reward import RewardConfig, calculate_reward
from .utils.uncertainty import UncertaintyModel, MonteCarloSimulator
from .utils.multi_objective import MultiObjectiveReward, ParetoFrontier

__all__ = [
    # 环境
    'MineSuccessionEnv',
    'EnvironmentConfig',
    'create_env_from_design',
    # 智能体
    'MaskedPPO',
    'PPOConfig',
    'PolicyNetwork',
    'AttentionPolicyNetwork',
    # 状态
    'WorkfaceState',
    'MineState',
    'encode_state',
    'get_state_dim',
    # 奖励
    'RewardConfig',
    'calculate_reward',
    'MultiObjectiveReward',
    # 不确定性
    'UncertaintyModel',
    'MonteCarloSimulator',
    # 多目标
    'ParetoFrontier',
    # 训练
    'train',
    'evaluate',
]
