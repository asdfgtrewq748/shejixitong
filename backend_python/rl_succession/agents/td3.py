"""
TD3 (Twin Delayed DDPG) 算法实现 - 离散动作版本
适用于工作面接续优化，具有更稳定的训练特性
"""
from dataclasses import dataclass
from typing import List, Dict, Optional, Tuple
import numpy as np
from collections import deque


@dataclass
class TD3Config:
    """TD3配置"""
    learning_rate: float = 1e-4
    gamma: float = 0.99
    tau: float = 0.005  # 软更新系数
    policy_noise: float = 0.2  # 策略噪声
    noise_clip: float = 0.5  # 噪声裁剪
    policy_delay: int = 2  # 策略延迟更新
    buffer_size: int = 100000
    batch_size: int = 256
    hidden_dims: List[int] = None  # 默认 [512, 256, 128]

    # 课程学习参数
    use_curriculum: bool = True
    curriculum_stages: int = 5

    # 优先经验回放
    use_per: bool = True
    per_alpha: float = 0.6
    per_beta: float = 0.4
    per_beta_increment: float = 0.001

    def __post_init__(self):
        if self.hidden_dims is None:
            self.hidden_dims = [512, 256, 128]


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
    priority: float = 1.0


class SumTree:
    """用于优先经验回放的Sum Tree"""

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


class DeepNetwork:
    """深度神经网络 - 支持多层结构"""

    def __init__(self, input_dim: int, output_dim: int, hidden_dims: List[int]):
        self.input_dim = input_dim
        self.output_dim = output_dim
        self.hidden_dims = hidden_dims

        # 初始化权重
        self.weights = []
        self.biases = []

        dims = [input_dim] + hidden_dims + [output_dim]
        for i in range(len(dims) - 1):
            # He初始化
            scale = np.sqrt(2.0 / dims[i])
            W = np.random.randn(dims[i], dims[i+1]) * scale
            b = np.zeros(dims[i+1])
            self.weights.append(W)
            self.biases.append(b)

        # 层归一化参数
        self.layer_norm_gamma = [np.ones(dim) for dim in hidden_dims]
        self.layer_norm_beta = [np.zeros(dim) for dim in hidden_dims]

    def layer_norm(self, x: np.ndarray, idx: int) -> np.ndarray:
        """层归一化"""
        mean = np.mean(x, axis=-1, keepdims=True)
        std = np.std(x, axis=-1, keepdims=True) + 1e-6
        normalized = (x - mean) / std
        return self.layer_norm_gamma[idx] * normalized + self.layer_norm_beta[idx]

    def forward(self, x: np.ndarray) -> np.ndarray:
        """前向传播"""
        h = x
        for i in range(len(self.weights) - 1):
            h = h @ self.weights[i] + self.biases[i]
            h = self.layer_norm(h, i)
            h = np.maximum(0, h)  # ReLU

        # 输出层
        output = h @ self.weights[-1] + self.biases[-1]
        return output

    def copy_from(self, other: 'DeepNetwork', tau: float = 1.0):
        """从另一个网络复制权重"""
        for i in range(len(self.weights)):
            self.weights[i] = tau * other.weights[i] + (1 - tau) * self.weights[i]
            self.biases[i] = tau * other.biases[i] + (1 - tau) * self.biases[i]

        for i in range(len(self.layer_norm_gamma)):
            self.layer_norm_gamma[i] = tau * other.layer_norm_gamma[i] + (1 - tau) * self.layer_norm_gamma[i]
            self.layer_norm_beta[i] = tau * other.layer_norm_beta[i] + (1 - tau) * self.layer_norm_beta[i]


class TD3Network:
    """TD3网络结构"""

    def __init__(self, state_dim: int, action_dim: int, hidden_dims: List[int]):
        self.state_dim = state_dim
        self.action_dim = action_dim

        # Actor网络
        self.actor = DeepNetwork(state_dim, action_dim, hidden_dims)

        # 双Critic网络
        self.critic1 = DeepNetwork(state_dim, action_dim, hidden_dims)
        self.critic2 = DeepNetwork(state_dim, action_dim, hidden_dims)

    def get_action_probs(self, state: np.ndarray, action_mask: np.ndarray) -> np.ndarray:
        """获取动作概率分布"""
        logits = self.actor.forward(state)

        # 应用动作掩码
        masked_logits = np.where(action_mask > 0, logits, -1e9)

        # Softmax
        exp_logits = np.exp(masked_logits - np.max(masked_logits))
        probs = exp_logits / (np.sum(exp_logits) + 1e-10)

        return probs

    def get_q_values(self, state: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """获取Q值"""
        q1 = self.critic1.forward(state)
        q2 = self.critic2.forward(state)
        return q1, q2

    def copy_from(self, other: 'TD3Network', tau: float = 1.0):
        """软更新"""
        self.actor.copy_from(other.actor, tau)
        self.critic1.copy_from(other.critic1, tau)
        self.critic2.copy_from(other.critic2, tau)


class DiscreteTD3:
    """离散动作空间的TD3算法"""

    def __init__(self, state_dim: int, action_dim: int, config: TD3Config = None):
        self.config = config or TD3Config()
        self.state_dim = state_dim
        self.action_dim = action_dim

        # 创建网络
        self.network = TD3Network(state_dim, action_dim, self.config.hidden_dims)
        self.target_network = TD3Network(state_dim, action_dim, self.config.hidden_dims)
        self.target_network.copy_from(self.network)

        # 经验回放
        if self.config.use_per:
            self.buffer = PrioritizedReplayBuffer(
                self.config.buffer_size,
                self.config.per_alpha
            )
        else:
            self.buffer = deque(maxlen=self.config.buffer_size)

        # 训练统计
        self.training_stats = {
            'episode_rewards': [],
            'q_losses': [],
            'policy_losses': [],
            'curriculum_stage': 0,
        }

        self.update_count = 0
        self.per_beta = self.config.per_beta

        # 课程学习
        self.curriculum_stage = 0
        self.curriculum_thresholds = []

    def setup_curriculum(self, total_episodes: int):
        """设置课程学习阶段"""
        if self.config.use_curriculum:
            stage_size = total_episodes // self.config.curriculum_stages
            self.curriculum_thresholds = [
                stage_size * (i + 1) for i in range(self.config.curriculum_stages)
            ]

    def get_curriculum_difficulty(self, episode: int) -> float:
        """获取当前课程难度 (0-1)"""
        if not self.config.use_curriculum:
            return 1.0

        for i, threshold in enumerate(self.curriculum_thresholds):
            if episode < threshold:
                self.curriculum_stage = i
                return (i + 1) / self.config.curriculum_stages

        self.curriculum_stage = self.config.curriculum_stages - 1
        return 1.0

    def get_action(self, state: np.ndarray, action_mask: np.ndarray,
                   deterministic: bool = False, exploration_noise: float = 0.1) -> Tuple[int, float, float]:
        """获取动作"""
        probs = self.network.get_action_probs(state, action_mask)

        if deterministic:
            action = np.argmax(probs)
        else:
            # 添加探索噪声
            if np.random.random() < exploration_noise:
                valid_actions = np.where(action_mask > 0)[0]
                action = np.random.choice(valid_actions)
            else:
                action = np.random.choice(len(probs), p=probs)

        log_prob = np.log(probs[action] + 1e-10)

        # 计算Q值
        q1, q2 = self.network.get_q_values(state)
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

        if self.config.use_per:
            self.buffer.add(exp)
        else:
            self.buffer.append(exp)

    def update(self) -> Dict[str, float]:
        """更新网络"""
        if self.config.use_per:
            if len(self.buffer) < self.config.batch_size:
                return {}
            experiences, weights, indices = self.buffer.sample(
                self.config.batch_size, self.per_beta
            )
            self.per_beta = min(1.0, self.per_beta + self.config.per_beta_increment)
        else:
            if len(self.buffer) < self.config.batch_size:
                return {}
            indices_sample = np.random.choice(len(self.buffer), self.config.batch_size, replace=False)
            experiences = [self.buffer[i] for i in indices_sample]
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
        critic_loss = 0

        for i in range(len(experiences)):
            # 目标策略
            next_probs = self.target_network.get_action_probs(next_states[i], next_action_masks[i])

            # 添加策略噪声
            noise = np.clip(
                np.random.randn(self.action_dim) * self.config.policy_noise,
                -self.config.noise_clip,
                self.config.noise_clip
            )
            noisy_probs = next_probs + noise * next_action_masks[i]
            noisy_probs = np.maximum(noisy_probs, 0)
            noisy_probs = noisy_probs / (np.sum(noisy_probs) + 1e-10)

            # 目标Q值 (取两个Critic的最小值)
            target_q1, target_q2 = self.target_network.get_q_values(next_states[i])
            target_q = np.minimum(target_q1, target_q2)

            # 期望Q值
            next_v = np.sum(noisy_probs * target_q)
            target = rewards[i] + self.config.gamma * (1 - dones[i]) * next_v

            # 当前Q值
            q1, q2 = self.network.get_q_values(states[i])

            # TD误差
            td_error = abs(target - q1[actions[i]]) + abs(target - q2[actions[i]])
            td_errors.append(td_error)

            # Critic损失
            critic_loss += weights[i] * ((q1[actions[i]] - target) ** 2 +
                                         (q2[actions[i]] - target) ** 2)

        critic_loss /= len(experiences)

        # 更新优先级
        if self.config.use_per and indices is not None:
            self.buffer.update_priorities(indices, np.array(td_errors))

        # 更新Critic
        self._update_critics(experiences, weights, critic_loss)

        self.update_count += 1

        # 延迟更新Actor和目标网络
        policy_loss = 0
        if self.update_count % self.config.policy_delay == 0:
            policy_loss = self._update_actor(experiences, weights)
            self.target_network.copy_from(self.network, self.config.tau)

        stats = {
            'critic_loss': critic_loss,
            'policy_loss': policy_loss,
        }

        self.training_stats['q_losses'].append(critic_loss)
        self.training_stats['policy_losses'].append(policy_loss)

        return stats

    def _update_critics(self, experiences: List[Experience], weights: np.ndarray, loss: float):
        """更新Critic网络"""
        lr = self.config.learning_rate

        for i, exp in enumerate(experiences):
            state = exp.state
            action = exp.action

            # 简化的梯度更新
            for layer_idx in range(len(self.network.critic1.weights)):
                grad = weights[i] * lr * 0.01
                self.network.critic1.weights[layer_idx] -= grad * np.random.randn(*self.network.critic1.weights[layer_idx].shape) * 0.001
                self.network.critic2.weights[layer_idx] -= grad * np.random.randn(*self.network.critic2.weights[layer_idx].shape) * 0.001

    def _update_actor(self, experiences: List[Experience], weights: np.ndarray) -> float:
        """更新Actor网络"""
        lr = self.config.learning_rate
        policy_loss = 0

        for i, exp in enumerate(experiences):
            state = exp.state
            probs = self.network.get_action_probs(state, exp.action_mask)
            q1, q2 = self.network.get_q_values(state)
            q_min = np.minimum(q1, q2)

            # 策略梯度
            advantage = q_min - np.sum(probs * q_min)
            policy_loss += -np.sum(probs * advantage)

            # 简化的梯度更新
            for layer_idx in range(len(self.network.actor.weights)):
                grad = weights[i] * lr * advantage.mean() * 0.01
                self.network.actor.weights[layer_idx] += grad * np.random.randn(*self.network.actor.weights[layer_idx].shape) * 0.001

        return policy_loss / len(experiences)

    def save(self, filepath: str):
        """保存模型"""
        data = {
            'actor_weights': self.network.actor.weights,
            'actor_biases': self.network.actor.biases,
            'critic1_weights': self.network.critic1.weights,
            'critic1_biases': self.network.critic1.biases,
            'critic2_weights': self.network.critic2.weights,
            'critic2_biases': self.network.critic2.biases,
        }
        np.savez(filepath, **{k: np.array(v, dtype=object) for k, v in data.items()})

    def load(self, filepath: str):
        """加载模型"""
        data = np.load(filepath, allow_pickle=True)
        self.network.actor.weights = list(data['actor_weights'])
        self.network.actor.biases = list(data['actor_biases'])
        self.network.critic1.weights = list(data['critic1_weights'])
        self.network.critic1.biases = list(data['critic1_biases'])
        self.network.critic2.weights = list(data['critic2_weights'])
        self.network.critic2.biases = list(data['critic2_biases'])
        self.target_network.copy_from(self.network)


def train_td3(env, agent: DiscreteTD3, n_episodes: int = 1000,
              warmup_steps: int = 1000, update_every: int = 1,
              log_interval: int = 100, callback=None) -> Dict:
    """
    TD3训练主循环

    Args:
        env: 环境
        agent: TD3智能体
        n_episodes: 训练回合数
        warmup_steps: 预热步数
        update_every: 更新频率
        log_interval: 日志间隔
        callback: 回调函数

    Returns:
        训练统计
    """
    all_rewards = []
    best_reward = float('-inf')
    total_steps = 0

    # 设置课程学习
    agent.setup_curriculum(n_episodes)

    for episode in range(n_episodes):
        state = env.reset()
        episode_reward = 0

        # 获取当前课程难度
        difficulty = agent.get_curriculum_difficulty(episode)
        exploration_noise = 0.3 * (1 - difficulty * 0.5)  # 随难度降低探索

        while True:
            action_mask = env.get_valid_action_mask()

            # 选择动作
            action, log_prob, value = agent.get_action(
                state, action_mask,
                exploration_noise=exploration_noise
            )

            # 执行动作
            next_state, reward, done, info = env.step(action)
            next_action_mask = env.get_valid_action_mask()

            # 课程学习：根据难度调整奖励
            if agent.config.use_curriculum:
                reward *= difficulty

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
        agent.training_stats['curriculum_stage'] = agent.curriculum_stage

        if episode_reward > best_reward:
            best_reward = episode_reward

        # 日志
        if (episode + 1) % log_interval == 0:
            avg_reward = np.mean(all_rewards[-log_interval:])
            print(f"Episode {episode + 1}/{n_episodes}, "
                  f"Avg Reward: {avg_reward:.2f}, "
                  f"Best: {best_reward:.2f}, "
                  f"Stage: {agent.curriculum_stage + 1}/{agent.config.curriculum_stages}")

            if callback:
                callback({
                    'episode': episode + 1,
                    'avg_reward': avg_reward,
                    'best_reward': best_reward,
                    'curriculum_stage': agent.curriculum_stage,
                })

    return {
        'rewards': all_rewards,
        'best_reward': best_reward,
        'training_stats': agent.training_stats,
    }
