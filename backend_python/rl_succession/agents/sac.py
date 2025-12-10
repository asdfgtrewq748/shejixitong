"""
SAC (Soft Actor-Critic) 算法实现 - 带优先经验回放
适用于工作面接续优化的离散动作版本
"""
from dataclasses import dataclass
from typing import List, Dict, Optional, Tuple
import numpy as np
from collections import deque
import heapq


@dataclass
class SACConfig:
    """SAC配置"""
    learning_rate: float = 3e-4
    gamma: float = 0.99
    tau: float = 0.005  # 软更新系数
    alpha: float = 0.2  # 熵系数
    auto_alpha: bool = True  # 自动调整熵系数
    buffer_size: int = 100000
    batch_size: int = 256
    hidden_dim: int = 256
    n_critics: int = 2  # 双Q网络
    target_update_interval: int = 1

    # 优先经验回放参数
    use_per: bool = True  # 是否使用优先经验回放
    per_alpha: float = 0.6  # 优先级指数
    per_beta: float = 0.4  # 重要性采样指数
    per_beta_increment: float = 0.001
    per_epsilon: float = 1e-6


@dataclass
class Experience:
    """经验数据"""
    state: np.ndarray
    action: int
    reward: float
    next_state: np.ndarray
    done: bool
    action_mask: np.ndarray
    next_action_mask: np.ndarray


class SumTree:
    """用于优先经验回放的Sum Tree数据结构"""

    def __init__(self, capacity: int):
        self.capacity = capacity
        self.tree = np.zeros(2 * capacity - 1)
        self.data = np.zeros(capacity, dtype=object)
        self.write = 0
        self.n_entries = 0

    def _propagate(self, idx: int, change: float):
        parent = (idx - 1) // 2
        self.tree[parent] += change
        if parent != 0:
            self._propagate(parent, change)

    def _retrieve(self, idx: int, s: float) -> int:
        left = 2 * idx + 1
        right = left + 1

        if left >= len(self.tree):
            return idx

        if s <= self.tree[left]:
            return self._retrieve(left, s)
        else:
            return self._retrieve(right, s - self.tree[left])

    def total(self) -> float:
        return self.tree[0]

    def add(self, priority: float, data: Experience):
        idx = self.write + self.capacity - 1
        self.data[self.write] = data
        self.update(idx, priority)

        self.write = (self.write + 1) % self.capacity
        self.n_entries = min(self.n_entries + 1, self.capacity)

    def update(self, idx: int, priority: float):
        change = priority - self.tree[idx]
        self.tree[idx] = priority
        self._propagate(idx, change)

    def get(self, s: float) -> Tuple[int, float, Experience]:
        idx = self._retrieve(0, s)
        data_idx = idx - self.capacity + 1
        return idx, self.tree[idx], self.data[data_idx]


class PrioritizedReplayBuffer:
    """优先经验回放缓冲区"""

    def __init__(self, capacity: int, alpha: float = 0.6):
        self.tree = SumTree(capacity)
        self.capacity = capacity
        self.alpha = alpha
        self.max_priority = 1.0

    def add(self, experience: Experience):
        priority = self.max_priority ** self.alpha
        self.tree.add(priority, experience)

    def sample(self, batch_size: int, beta: float = 0.4) -> Tuple[List[Experience], np.ndarray, List[int]]:
        experiences = []
        indices = []
        priorities = []

        segment = self.tree.total() / batch_size

        for i in range(batch_size):
            a = segment * i
            b = segment * (i + 1)
            s = np.random.uniform(a, b)

            idx, priority, data = self.tree.get(s)
            if data is not None and isinstance(data, Experience):
                experiences.append(data)
                indices.append(idx)
                priorities.append(priority)

        if len(experiences) == 0:
            return [], np.array([]), []

        # 计算重要性采样权重
        priorities = np.array(priorities)
        sampling_probs = priorities / self.tree.total()
        weights = (self.tree.n_entries * sampling_probs) ** (-beta)
        weights = weights / weights.max()

        return experiences, weights, indices

    def update_priorities(self, indices: List[int], priorities: np.ndarray):
        for idx, priority in zip(indices, priorities):
            priority = (priority + 1e-6) ** self.alpha
            self.tree.update(idx, priority)
            self.max_priority = max(self.max_priority, priority)

    def __len__(self):
        return self.tree.n_entries


class SimpleReplayBuffer:
    """简单经验回放缓冲区"""

    def __init__(self, capacity: int):
        self.buffer = deque(maxlen=capacity)

    def add(self, experience: Experience):
        self.buffer.append(experience)

    def sample(self, batch_size: int) -> List[Experience]:
        indices = np.random.choice(len(self.buffer), min(batch_size, len(self.buffer)), replace=False)
        return [self.buffer[i] for i in indices]

    def __len__(self):
        return len(self.buffer)


class SACNetwork:
    """SAC网络（NumPy实现）"""

    def __init__(self, state_dim: int, action_dim: int, hidden_dim: int = 256):
        self.state_dim = state_dim
        self.action_dim = action_dim
        self.hidden_dim = hidden_dim

        # 初始化权重
        scale = np.sqrt(2.0 / state_dim)
        self.W1 = np.random.randn(state_dim, hidden_dim) * scale
        self.b1 = np.zeros(hidden_dim)

        scale = np.sqrt(2.0 / hidden_dim)
        self.W2 = np.random.randn(hidden_dim, hidden_dim) * scale
        self.b2 = np.zeros(hidden_dim)

        # 策略头
        self.W_policy = np.random.randn(hidden_dim, action_dim) * 0.01
        self.b_policy = np.zeros(action_dim)

        # Q网络1
        self.W_q1 = np.random.randn(hidden_dim, action_dim) * 0.01
        self.b_q1 = np.zeros(action_dim)

        # Q网络2
        self.W_q2 = np.random.randn(hidden_dim, action_dim) * 0.01
        self.b_q2 = np.zeros(action_dim)

    def forward_policy(self, state: np.ndarray, action_mask: np.ndarray) -> np.ndarray:
        """前向传播策略网络"""
        h1 = np.maximum(0, state @ self.W1 + self.b1)
        h2 = np.maximum(0, h1 @ self.W2 + self.b2)

        logits = h2 @ self.W_policy + self.b_policy

        # 应用动作掩码
        masked_logits = np.where(action_mask > 0, logits, -1e9)

        # Softmax
        exp_logits = np.exp(masked_logits - np.max(masked_logits))
        probs = exp_logits / (np.sum(exp_logits) + 1e-10)

        return probs

    def forward_q(self, state: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """前向传播Q网络"""
        h1 = np.maximum(0, state @ self.W1 + self.b1)
        h2 = np.maximum(0, h1 @ self.W2 + self.b2)

        q1 = h2 @ self.W_q1 + self.b_q1
        q2 = h2 @ self.W_q2 + self.b_q2

        return q1, q2

    def get_action(self, state: np.ndarray, action_mask: np.ndarray,
                   deterministic: bool = False) -> Tuple[int, float]:
        """获取动作"""
        probs = self.forward_policy(state, action_mask)

        if deterministic:
            action = np.argmax(probs)
        else:
            action = np.random.choice(len(probs), p=probs)

        log_prob = np.log(probs[action] + 1e-10)

        return action, log_prob

    def copy_weights_from(self, other: 'SACNetwork', tau: float = 1.0):
        """从另一个网络复制权重（软更新）"""
        self.W1 = tau * other.W1 + (1 - tau) * self.W1
        self.b1 = tau * other.b1 + (1 - tau) * self.b1
        self.W2 = tau * other.W2 + (1 - tau) * self.W2
        self.b2 = tau * other.b2 + (1 - tau) * self.b2
        self.W_policy = tau * other.W_policy + (1 - tau) * self.W_policy
        self.b_policy = tau * other.b_policy + (1 - tau) * self.b_policy
        self.W_q1 = tau * other.W_q1 + (1 - tau) * self.W_q1
        self.b_q1 = tau * other.b_q1 + (1 - tau) * self.b_q1
        self.W_q2 = tau * other.W_q2 + (1 - tau) * self.W_q2
        self.b_q2 = tau * other.b_q2 + (1 - tau) * self.b_q2


class DiscreteSAC:
    """离散动作空间的SAC算法"""

    def __init__(self, state_dim: int, action_dim: int, config: SACConfig = None):
        self.config = config or SACConfig()
        self.state_dim = state_dim
        self.action_dim = action_dim

        # 创建网络
        self.network = SACNetwork(state_dim, action_dim, self.config.hidden_dim)
        self.target_network = SACNetwork(state_dim, action_dim, self.config.hidden_dim)
        self.target_network.copy_weights_from(self.network)

        # 经验回放
        if self.config.use_per:
            self.buffer = PrioritizedReplayBuffer(
                self.config.buffer_size,
                self.config.per_alpha
            )
        else:
            self.buffer = SimpleReplayBuffer(self.config.buffer_size)

        # 熵系数
        self.alpha = self.config.alpha
        self.target_entropy = -np.log(1.0 / action_dim) * 0.98
        self.log_alpha = np.log(self.alpha)

        # 训练统计
        self.training_stats = {
            'episode_rewards': [],
            'q_losses': [],
            'policy_losses': [],
            'alpha_values': [],
        }

        self.update_count = 0
        self.per_beta = self.config.per_beta

    def get_action(self, state: np.ndarray, action_mask: np.ndarray,
                   deterministic: bool = False) -> Tuple[int, float, float]:
        """获取动作"""
        action, log_prob = self.network.get_action(state, action_mask, deterministic)

        # 计算Q值作为价值估计
        q1, q2 = self.network.forward_q(state)
        value = min(q1[action], q2[action])

        return action, log_prob, value

    def store_experience(self, state: np.ndarray, action: int, reward: float,
                        next_state: np.ndarray, done: bool,
                        action_mask: np.ndarray, next_action_mask: np.ndarray):
        """存储经验"""
        exp = Experience(
            state=state,
            action=action,
            reward=reward,
            next_state=next_state,
            done=done,
            action_mask=action_mask,
            next_action_mask=next_action_mask
        )
        self.buffer.add(exp)

    def update(self) -> Dict[str, float]:
        """更新网络"""
        if len(self.buffer) < self.config.batch_size:
            return {}

        # 采样
        if self.config.use_per:
            experiences, weights, indices = self.buffer.sample(
                self.config.batch_size, self.per_beta
            )
            self.per_beta = min(1.0, self.per_beta + self.config.per_beta_increment)
        else:
            experiences = self.buffer.sample(self.config.batch_size)
            weights = np.ones(len(experiences))
            indices = None

        if len(experiences) == 0:
            return {}

        # 提取数据
        states = np.array([e.state for e in experiences])
        actions = np.array([e.action for e in experiences])
        rewards = np.array([e.reward for e in experiences])
        next_states = np.array([e.next_state for e in experiences])
        dones = np.array([e.done for e in experiences], dtype=np.float32)
        next_action_masks = np.array([e.next_action_mask for e in experiences])

        # 计算目标Q值
        td_errors = []
        q_loss = 0
        policy_loss = 0

        for i in range(len(experiences)):
            # 下一状态的策略
            next_probs = self.network.forward_policy(next_states[i], next_action_masks[i])
            next_log_probs = np.log(next_probs + 1e-10)

            # 目标Q值
            target_q1, target_q2 = self.target_network.forward_q(next_states[i])
            target_q = np.minimum(target_q1, target_q2)

            # V(s') = E[Q(s',a') - alpha * log(pi(a'|s'))]
            next_v = np.sum(next_probs * (target_q - self.alpha * next_log_probs))

            # TD目标
            target = rewards[i] + self.config.gamma * (1 - dones[i]) * next_v

            # 当前Q值
            q1, q2 = self.network.forward_q(states[i])

            # TD误差
            td_error = abs(target - q1[actions[i]]) + abs(target - q2[actions[i]])
            td_errors.append(td_error)

            # Q损失
            q_loss += weights[i] * ((q1[actions[i]] - target) ** 2 +
                                    (q2[actions[i]] - target) ** 2)

            # 策略损失
            probs = self.network.forward_policy(states[i], experiences[i].action_mask)
            log_probs = np.log(probs + 1e-10)
            q_min = np.minimum(q1, q2)

            policy_loss += weights[i] * np.sum(probs * (self.alpha * log_probs - q_min))

        q_loss /= len(experiences)
        policy_loss /= len(experiences)

        # 更新优先级
        if self.config.use_per and indices is not None:
            self.buffer.update_priorities(indices, np.array(td_errors))

        # 更新网络权重
        self._update_weights(experiences, weights, q_loss, policy_loss)

        # 软更新目标网络
        self.update_count += 1
        if self.update_count % self.config.target_update_interval == 0:
            self.target_network.copy_weights_from(self.network, self.config.tau)

        # 自动调整熵系数
        if self.config.auto_alpha:
            self._update_alpha(experiences)

        stats = {
            'q_loss': q_loss,
            'policy_loss': policy_loss,
            'alpha': self.alpha,
        }

        self.training_stats['q_losses'].append(q_loss)
        self.training_stats['policy_losses'].append(policy_loss)
        self.training_stats['alpha_values'].append(self.alpha)

        return stats

    def _update_weights(self, experiences: List[Experience], weights: np.ndarray,
                       q_loss: float, policy_loss: float):
        """更新网络权重"""
        lr = self.config.learning_rate

        for i, exp in enumerate(experiences):
            state = exp.state
            action = exp.action

            # 计算梯度方向
            h1 = np.maximum(0, state @ self.network.W1 + self.network.b1)
            h2 = np.maximum(0, h1 @ self.network.W2 + self.network.b2)

            # Q网络梯度
            q1, q2 = self.network.forward_q(state)
            probs = self.network.forward_policy(state, exp.action_mask)

            # 简化的梯度更新
            grad_q = np.zeros(self.action_dim)
            grad_q[action] = weights[i] * 0.01

            self.network.W_q1 -= lr * np.outer(h2, grad_q)
            self.network.b_q1 -= lr * grad_q
            self.network.W_q2 -= lr * np.outer(h2, grad_q)
            self.network.b_q2 -= lr * grad_q

            # 策略梯度
            q_min = np.minimum(q1, q2)
            advantage = q_min - np.sum(probs * q_min)

            grad_policy = np.zeros(self.action_dim)
            grad_policy[action] = weights[i] * advantage * 0.01

            self.network.W_policy += lr * np.outer(h2, grad_policy)
            self.network.b_policy += lr * grad_policy

    def _update_alpha(self, experiences: List[Experience]):
        """更新熵系数"""
        total_entropy = 0
        for exp in experiences:
            probs = self.network.forward_policy(exp.state, exp.action_mask)
            entropy = -np.sum(probs * np.log(probs + 1e-10))
            total_entropy += entropy

        avg_entropy = total_entropy / len(experiences)

        # 调整alpha使熵接近目标熵
        alpha_loss = -self.log_alpha * (avg_entropy - self.target_entropy)
        self.log_alpha -= self.config.learning_rate * alpha_loss * 0.01
        self.alpha = np.exp(self.log_alpha)
        self.alpha = np.clip(self.alpha, 0.01, 1.0)

    def save(self, filepath: str):
        """保存模型"""
        np.savez(filepath,
                 W1=self.network.W1, b1=self.network.b1,
                 W2=self.network.W2, b2=self.network.b2,
                 W_policy=self.network.W_policy, b_policy=self.network.b_policy,
                 W_q1=self.network.W_q1, b_q1=self.network.b_q1,
                 W_q2=self.network.W_q2, b_q2=self.network.b_q2,
                 alpha=self.alpha, log_alpha=self.log_alpha)

    def load(self, filepath: str):
        """加载模型"""
        data = np.load(filepath)
        self.network.W1 = data['W1']
        self.network.b1 = data['b1']
        self.network.W2 = data['W2']
        self.network.b2 = data['b2']
        self.network.W_policy = data['W_policy']
        self.network.b_policy = data['b_policy']
        self.network.W_q1 = data['W_q1']
        self.network.b_q1 = data['b_q1']
        self.network.W_q2 = data['W_q2']
        self.network.b_q2 = data['b_q2']
        self.alpha = float(data['alpha'])
        self.log_alpha = float(data['log_alpha'])

        self.target_network.copy_weights_from(self.network)


def train_sac(env, agent: DiscreteSAC, n_episodes: int = 1000,
              warmup_steps: int = 1000, update_every: int = 1,
              log_interval: int = 100, callback=None) -> Dict:
    """
    SAC训练主循环

    Args:
        env: 环境
        agent: SAC智能体
        n_episodes: 训练回合数
        warmup_steps: 预热步数（只收集经验不更新）
        update_every: 更新频率
        log_interval: 日志间隔
        callback: 回调函数

    Returns:
        训练统计
    """
    all_rewards = []
    best_reward = float('-inf')
    total_steps = 0

    for episode in range(n_episodes):
        state = env.reset()
        episode_reward = 0

        while True:
            action_mask = env.get_valid_action_mask()

            # 选择动作
            action, log_prob, value = agent.get_action(state, action_mask)

            # 执行动作
            next_state, reward, done, info = env.step(action)
            next_action_mask = env.get_valid_action_mask()

            # 存储经验
            agent.store_experience(
                state, action, reward, next_state, done,
                action_mask, next_action_mask
            )

            total_steps += 1

            # 更新网络
            if total_steps > warmup_steps and total_steps % update_every == 0:
                agent.update()

            state = next_state
            episode_reward += reward

            if done:
                break

        all_rewards.append(episode_reward)
        agent.training_stats['episode_rewards'].append(episode_reward)

        if episode_reward > best_reward:
            best_reward = episode_reward

        # 日志
        if (episode + 1) % log_interval == 0:
            avg_reward = np.mean(all_rewards[-log_interval:])
            print(f"Episode {episode + 1}/{n_episodes}, "
                  f"Avg Reward: {avg_reward:.2f}, "
                  f"Best: {best_reward:.2f}, "
                  f"Alpha: {agent.alpha:.4f}")

            if callback:
                callback({
                    'episode': episode + 1,
                    'avg_reward': avg_reward,
                    'best_reward': best_reward,
                    'alpha': agent.alpha,
                })

    return {
        'rewards': all_rewards,
        'best_reward': best_reward,
        'training_stats': agent.training_stats,
    }
