"""
Masked PPO算法实现
"""
from dataclasses import dataclass, field
from typing import List, Dict, Optional
import numpy as np

from .networks import PolicyNetwork


@dataclass
class PPOConfig:
    """PPO配置"""
    learning_rate: float = 3e-4
    clip_epsilon: float = 0.2
    gamma: float = 0.99
    gae_lambda: float = 0.95
    entropy_coef: float = 0.01
    value_coef: float = 0.5
    n_epochs: int = 10
    batch_size: int = 64
    hidden_dim: int = 256
    max_grad_norm: float = 0.5


@dataclass
class Trajectory:
    """轨迹数据"""
    state: np.ndarray
    action: int
    reward: float
    log_prob: float
    value: float
    done: bool
    action_mask: np.ndarray


class MaskedPPO:
    """带动作掩码的PPO算法"""

    def __init__(self, state_dim: int, action_dim: int, config: PPOConfig = None):
        self.config = config or PPOConfig()
        self.state_dim = state_dim
        self.action_dim = action_dim

        # 创建策略网络
        self.policy = PolicyNetwork(state_dim, action_dim, self.config.hidden_dim)

        # 训练统计
        self.training_stats = {
            'episode_rewards': [],
            'policy_losses': [],
            'value_losses': [],
            'entropies': [],
        }

    def compute_gae(self, rewards: List[float], values: List[float],
                    dones: List[bool]) -> np.ndarray:
        """
        计算广义优势估计 (GAE)

        Args:
            rewards: 奖励序列
            values: 价值估计序列
            dones: 终止标志序列

        Returns:
            优势估计数组
        """
        advantages = []
        gae = 0

        for t in reversed(range(len(rewards))):
            if t == len(rewards) - 1:
                next_value = 0
            else:
                next_value = values[t + 1]

            delta = rewards[t] + self.config.gamma * next_value * (1 - dones[t]) - values[t]
            gae = delta + self.config.gamma * self.config.gae_lambda * (1 - dones[t]) * gae
            advantages.insert(0, gae)

        return np.array(advantages)

    def update(self, trajectories: List[Trajectory]) -> Dict[str, float]:
        """
        PPO策略更新

        Args:
            trajectories: 轨迹列表

        Returns:
            训练统计信息
        """
        # 提取数据
        states = np.array([t.state for t in trajectories])
        actions = np.array([t.action for t in trajectories])
        old_log_probs = np.array([t.log_prob for t in trajectories])
        rewards = [t.reward for t in trajectories]
        values = [t.value for t in trajectories]
        dones = [t.done for t in trajectories]
        action_masks = np.array([t.action_mask for t in trajectories])

        # 计算优势和回报
        advantages = self.compute_gae(rewards, values, dones)
        returns = advantages + np.array(values)

        # 标准化优势
        advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)

        # 多轮更新
        total_policy_loss = 0
        total_value_loss = 0
        total_entropy = 0

        for _ in range(self.config.n_epochs):
            # 随机打乱数据
            indices = np.random.permutation(len(trajectories))

            for start in range(0, len(trajectories), self.config.batch_size):
                end = min(start + self.config.batch_size, len(trajectories))
                batch_indices = indices[start:end]

                batch_states = states[batch_indices]
                batch_actions = actions[batch_indices]
                batch_old_log_probs = old_log_probs[batch_indices]
                batch_advantages = advantages[batch_indices]
                batch_returns = returns[batch_indices]
                batch_masks = action_masks[batch_indices]

                # 计算新的概率和价值
                policy_loss = 0
                value_loss = 0
                entropy = 0

                for i in range(len(batch_indices)):
                    probs, value = self.policy.forward(batch_states[i], batch_masks[i])

                    # 计算新的log概率
                    new_log_prob = np.log(probs[batch_actions[i]] + 1e-10)

                    # 计算比率
                    ratio = np.exp(new_log_prob - batch_old_log_probs[i])

                    # 裁剪目标
                    surr1 = ratio * batch_advantages[i]
                    surr2 = np.clip(ratio, 1 - self.config.clip_epsilon,
                                   1 + self.config.clip_epsilon) * batch_advantages[i]

                    policy_loss -= min(surr1, surr2)
                    value_loss += (value - batch_returns[i]) ** 2

                    # 熵
                    entropy -= np.sum(probs * np.log(probs + 1e-10))

                policy_loss /= len(batch_indices)
                value_loss /= len(batch_indices)
                entropy /= len(batch_indices)

                # 简单的梯度更新（使用数值梯度近似）
                self._update_weights(batch_states, batch_actions, batch_masks,
                                    batch_advantages, batch_returns, batch_old_log_probs)

                total_policy_loss += policy_loss
                total_value_loss += value_loss
                total_entropy += entropy

        n_updates = self.config.n_epochs * (len(trajectories) // self.config.batch_size + 1)

        stats = {
            'policy_loss': total_policy_loss / n_updates,
            'value_loss': total_value_loss / n_updates,
            'entropy': total_entropy / n_updates,
        }

        self.training_stats['policy_losses'].append(stats['policy_loss'])
        self.training_stats['value_losses'].append(stats['value_loss'])
        self.training_stats['entropies'].append(stats['entropy'])

        return stats

    def _update_weights(self, states, actions, masks, advantages, returns, old_log_probs):
        """
        使用简单的策略梯度更新权重
        """
        lr = self.config.learning_rate

        # 计算梯度（简化版本）
        for i in range(len(states)):
            probs, value = self.policy.forward(states[i], masks[i])

            # 策略梯度
            action = actions[i]
            advantage = advantages[i]

            # 计算梯度方向
            grad_direction = np.zeros(self.action_dim)
            grad_direction[action] = advantage

            # 更新策略权重（简化的梯度上升）
            h1 = np.maximum(0, states[i] @ self.policy.W1 + self.policy.b1)
            h2 = np.maximum(0, h1 @ self.policy.W2 + self.policy.b2)

            # 策略头梯度
            self.policy.W_policy += lr * np.outer(h2, grad_direction) * 0.01
            self.policy.b_policy += lr * grad_direction * 0.01

            # 价值头梯度
            value_error = returns[i] - value
            self.policy.W_value += lr * h2.reshape(-1, 1) * value_error * 0.01
            self.policy.b_value += lr * value_error * 0.01

    def get_action(self, state: np.ndarray, action_mask: np.ndarray) -> tuple:
        """获取动作"""
        return self.policy.get_action(state, action_mask)

    def save(self, filepath: str):
        """保存模型"""
        self.policy.save(filepath)

    def load(self, filepath: str):
        """加载模型"""
        self.policy.load(filepath)


def train(env, agent: MaskedPPO, n_episodes: int = 1000,
          log_interval: int = 100, callback=None) -> Dict:
    """
    训练主循环

    Args:
        env: 环境
        agent: PPO智能体
        n_episodes: 训练回合数
        log_interval: 日志间隔
        callback: 回调函数

    Returns:
        训练统计
    """
    all_rewards = []
    best_reward = float('-inf')

    for episode in range(n_episodes):
        state = env.reset()
        trajectories = []
        episode_reward = 0

        while True:
            # 获取动作掩码
            action_mask = env.get_valid_action_mask()

            # 选择动作
            action, log_prob, value = agent.get_action(state, action_mask)

            # 执行动作
            next_state, reward, done, info = env.step(action)

            # 存储轨迹
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

        # 更新策略
        if len(trajectories) > 0:
            stats = agent.update(trajectories)

        all_rewards.append(episode_reward)
        agent.training_stats['episode_rewards'].append(episode_reward)

        # 更新最佳奖励
        if episode_reward > best_reward:
            best_reward = episode_reward

        # 日志
        if (episode + 1) % log_interval == 0:
            avg_reward = np.mean(all_rewards[-log_interval:])
            print(f"Episode {episode + 1}/{n_episodes}, "
                  f"Avg Reward: {avg_reward:.2f}, "
                  f"Best: {best_reward:.2f}")

            if callback:
                callback({
                    'episode': episode + 1,
                    'avg_reward': avg_reward,
                    'best_reward': best_reward,
                    'stats': stats if 'stats' in dir() else {},
                })

    return {
        'rewards': all_rewards,
        'best_reward': best_reward,
        'training_stats': agent.training_stats,
    }


def evaluate(env, agent: MaskedPPO, n_episodes: int = 10) -> Dict:
    """
    评估智能体

    Args:
        env: 环境
        agent: PPO智能体
        n_episodes: 评估回合数

    Returns:
        评估统计
    """
    rewards = []
    infos = []

    for _ in range(n_episodes):
        state = env.reset()
        episode_reward = 0
        episode_info = []

        while True:
            action_mask = env.get_valid_action_mask()
            action, _, _ = agent.get_action(state, action_mask)
            state, reward, done, info = env.step(action)
            episode_reward += reward
            episode_info.append(info)

            if done:
                break

        rewards.append(episode_reward)
        infos.append(episode_info[-1] if episode_info else {})

    return {
        'mean_reward': np.mean(rewards),
        'std_reward': np.std(rewards),
        'min_reward': np.min(rewards),
        'max_reward': np.max(rewards),
        'final_infos': infos,
    }
