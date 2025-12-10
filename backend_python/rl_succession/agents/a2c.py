"""
A2C (Advantage Actor-Critic) 算法实现
支持动作掩码的同步优势演员-评论家算法
"""
import numpy as np
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass


@dataclass
class A2CConfig:
    """A2C配置"""
    learning_rate: float = 3e-4
    gamma: float = 0.99                    # 折扣因子
    gae_lambda: float = 0.95               # GAE参数
    entropy_coef: float = 0.01             # 熵系数
    value_coef: float = 0.5                # 价值函数系数
    max_grad_norm: float = 0.5             # 梯度裁剪
    n_steps: int = 5                       # 每次更新的步数
    hidden_dim: int = 256                  # 隐藏层维度
    normalize_advantage: bool = True       # 是否标准化优势
    use_gae: bool = True                   # 是否使用GAE


class MaskedA2C:
    """
    支持动作掩码的A2C算法

    特点:
    - 同步采样，无经验回放
    - 使用GAE计算优势函数
    - 支持离散动作掩码
    - 更简单的实现，适合小规模问题
    """

    def __init__(
        self,
        state_dim: int,
        action_dim: int,
        config: A2CConfig = None
    ):
        self.state_dim = state_dim
        self.action_dim = action_dim
        self.config = config or A2CConfig()

        # 初始化网络参数
        self._init_network()

        # 训练统计
        self.training_step = 0

    def _init_network(self):
        """初始化网络参数"""
        hidden = self.config.hidden_dim

        # 使用Xavier初始化
        def xavier_init(fan_in, fan_out):
            std = np.sqrt(2.0 / (fan_in + fan_out))
            return np.random.randn(fan_in, fan_out) * std

        # 共享特征提取层
        self.W1 = xavier_init(self.state_dim, hidden)
        self.b1 = np.zeros(hidden)
        self.W2 = xavier_init(hidden, hidden)
        self.b2 = np.zeros(hidden)

        # Actor头（策略网络）
        self.W_actor = xavier_init(hidden, self.action_dim)
        self.b_actor = np.zeros(self.action_dim)

        # Critic头（价值网络）
        self.W_critic = xavier_init(hidden, 1)
        self.b_critic = np.zeros(1)

        # 收集所有参数用于优化
        self.params = {
            'W1': self.W1, 'b1': self.b1,
            'W2': self.W2, 'b2': self.b2,
            'W_actor': self.W_actor, 'b_actor': self.b_actor,
            'W_critic': self.W_critic, 'b_critic': self.b_critic
        }

        # Adam优化器状态
        self.adam_m = {k: np.zeros_like(v) for k, v in self.params.items()}
        self.adam_v = {k: np.zeros_like(v) for k, v in self.params.items()}
        self.adam_t = 0

    def _relu(self, x):
        """ReLU激活函数"""
        return np.maximum(0, x)

    def _relu_grad(self, x):
        """ReLU梯度"""
        return (x > 0).astype(float)

    def _softmax(self, x, mask=None):
        """带掩码的Softmax"""
        if mask is not None:
            x = np.where(mask > 0, x, -1e9)
        exp_x = np.exp(x - np.max(x, axis=-1, keepdims=True))
        return exp_x / np.sum(exp_x, axis=-1, keepdims=True)

    def forward(self, state: np.ndarray, action_mask: np.ndarray = None) -> Tuple[np.ndarray, float]:
        """
        前向传播

        Returns:
            (action_probs, value)
        """
        # 共享层
        h1 = self._relu(state @ self.W1 + self.b1)
        h2 = self._relu(h1 @ self.W2 + self.b2)

        # Actor输出
        logits = h2 @ self.W_actor + self.b_actor
        action_probs = self._softmax(logits, action_mask)

        # Critic输出
        value = (h2 @ self.W_critic + self.b_critic)[0]

        return action_probs, value

    def get_action(
        self,
        state: np.ndarray,
        action_mask: np.ndarray = None,
        deterministic: bool = False
    ) -> Tuple[int, float, float]:
        """
        选择动作

        Returns:
            (action, log_prob, value)
        """
        action_probs, value = self.forward(state, action_mask)

        if deterministic:
            action = np.argmax(action_probs)
        else:
            action = np.random.choice(len(action_probs), p=action_probs)

        log_prob = np.log(action_probs[action] + 1e-8)

        return action, log_prob, value

    def compute_gae(
        self,
        rewards: List[float],
        values: List[float],
        dones: List[bool],
        last_value: float
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        计算广义优势估计 (GAE)

        Returns:
            (advantages, returns)
        """
        n_steps = len(rewards)
        advantages = np.zeros(n_steps)
        returns = np.zeros(n_steps)

        gae = 0
        for t in reversed(range(n_steps)):
            if t == n_steps - 1:
                next_value = last_value
                next_non_terminal = 1.0 - float(dones[t])
            else:
                next_value = values[t + 1]
                next_non_terminal = 1.0 - float(dones[t])

            delta = rewards[t] + self.config.gamma * next_value * next_non_terminal - values[t]
            gae = delta + self.config.gamma * self.config.gae_lambda * next_non_terminal * gae
            advantages[t] = gae
            returns[t] = advantages[t] + values[t]

        return advantages, returns

    def update(
        self,
        states: np.ndarray,
        actions: np.ndarray,
        rewards: np.ndarray,
        dones: np.ndarray,
        action_masks: np.ndarray,
        last_state: np.ndarray,
        last_mask: np.ndarray
    ) -> Dict:
        """
        更新策略

        Args:
            states: 状态序列 [n_steps, state_dim]
            actions: 动作序列 [n_steps]
            rewards: 奖励序列 [n_steps]
            dones: 终止标志 [n_steps]
            action_masks: 动作掩码 [n_steps, action_dim]
            last_state: 最后状态
            last_mask: 最后掩码

        Returns:
            训练统计信息
        """
        n_steps = len(rewards)

        # 计算所有值
        values = []
        log_probs = []
        entropies = []

        for i in range(n_steps):
            probs, value = self.forward(states[i], action_masks[i])
            values.append(value)
            log_probs.append(np.log(probs[actions[i]] + 1e-8))
            entropies.append(-np.sum(probs * np.log(probs + 1e-8)))

        # 计算最后一个状态的值
        _, last_value = self.forward(last_state, last_mask)

        # 计算优势和回报
        if self.config.use_gae:
            advantages, returns = self.compute_gae(rewards, values, dones, last_value)
        else:
            # 简单的TD(0)
            returns = np.zeros(n_steps)
            for t in reversed(range(n_steps)):
                if t == n_steps - 1:
                    returns[t] = rewards[t] + self.config.gamma * last_value * (1 - dones[t])
                else:
                    returns[t] = rewards[t] + self.config.gamma * returns[t+1] * (1 - dones[t])
            advantages = returns - np.array(values)

        # 标准化优势
        if self.config.normalize_advantage and len(advantages) > 1:
            advantages = (advantages - np.mean(advantages)) / (np.std(advantages) + 1e-8)

        # 计算损失和梯度
        grads = {k: np.zeros_like(v) for k, v in self.params.items()}

        total_policy_loss = 0
        total_value_loss = 0
        total_entropy = 0

        for i in range(n_steps):
            # 前向传播
            h1_pre = states[i] @ self.W1 + self.b1
            h1 = self._relu(h1_pre)
            h2_pre = h1 @ self.W2 + self.b2
            h2 = self._relu(h2_pre)

            logits = h2 @ self.W_actor + self.b_actor
            probs = self._softmax(logits, action_masks[i])
            value = (h2 @ self.W_critic + self.b_critic)[0]

            # 策略损失 (policy gradient)
            policy_loss = -log_probs[i] * advantages[i]

            # 价值损失
            value_loss = 0.5 * (returns[i] - value) ** 2

            # 熵损失
            entropy = entropies[i]

            total_policy_loss += policy_loss
            total_value_loss += value_loss
            total_entropy += entropy

            # 反向传播
            # Critic梯度
            d_value = -(returns[i] - value) * self.config.value_coef
            grads['W_critic'] += np.outer(h2, d_value)
            grads['b_critic'] += d_value

            # Actor梯度 (策略梯度)
            d_logits = probs.copy()
            d_logits[actions[i]] -= 1  # softmax + cross entropy 梯度
            d_logits *= -advantages[i]  # 乘以优势

            # 熵梯度
            d_entropy = -self.config.entropy_coef * (np.log(probs + 1e-8) + 1) * probs
            d_logits += d_entropy

            grads['W_actor'] += np.outer(h2, d_logits)
            grads['b_actor'] += d_logits

            # 共享层梯度
            d_h2 = d_logits @ self.W_actor.T + d_value * self.W_critic.flatten()
            d_h2 = d_h2 * self._relu_grad(h2_pre)

            grads['W2'] += np.outer(h1, d_h2)
            grads['b2'] += d_h2

            d_h1 = d_h2 @ self.W2.T
            d_h1 = d_h1 * self._relu_grad(h1_pre)

            grads['W1'] += np.outer(states[i], d_h1)
            grads['b1'] += d_h1

        # 平均梯度
        for k in grads:
            grads[k] /= n_steps

        # 梯度裁剪
        total_norm = np.sqrt(sum(np.sum(g**2) for g in grads.values()))
        if total_norm > self.config.max_grad_norm:
            for k in grads:
                grads[k] *= self.config.max_grad_norm / total_norm

        # Adam更新
        self.adam_t += 1
        beta1, beta2 = 0.9, 0.999
        eps = 1e-8

        for k in self.params:
            self.adam_m[k] = beta1 * self.adam_m[k] + (1 - beta1) * grads[k]
            self.adam_v[k] = beta2 * self.adam_v[k] + (1 - beta2) * (grads[k] ** 2)

            m_hat = self.adam_m[k] / (1 - beta1 ** self.adam_t)
            v_hat = self.adam_v[k] / (1 - beta2 ** self.adam_t)

            self.params[k] -= self.config.learning_rate * m_hat / (np.sqrt(v_hat) + eps)

        # 同步参数
        self.W1 = self.params['W1']
        self.b1 = self.params['b1']
        self.W2 = self.params['W2']
        self.b2 = self.params['b2']
        self.W_actor = self.params['W_actor']
        self.b_actor = self.params['b_actor']
        self.W_critic = self.params['W_critic']
        self.b_critic = self.params['b_critic']

        self.training_step += 1

        return {
            'policy_loss': total_policy_loss / n_steps,
            'value_loss': total_value_loss / n_steps,
            'entropy': total_entropy / n_steps,
            'advantages_mean': np.mean(advantages),
            'returns_mean': np.mean(returns),
        }

    def save(self, path: str):
        """保存模型"""
        np.savez(
            path,
            **self.params,
            config_lr=self.config.learning_rate,
            config_gamma=self.config.gamma,
            config_hidden=self.config.hidden_dim,
            adam_t=self.adam_t,
            **{f'adam_m_{k}': v for k, v in self.adam_m.items()},
            **{f'adam_v_{k}': v for k, v in self.adam_v.items()},
        )

    def load(self, path: str):
        """加载模型"""
        data = np.load(path)
        for k in self.params:
            self.params[k] = data[k]
            self.adam_m[k] = data[f'adam_m_{k}']
            self.adam_v[k] = data[f'adam_v_{k}']

        self.W1 = self.params['W1']
        self.b1 = self.params['b1']
        self.W2 = self.params['W2']
        self.b2 = self.params['b2']
        self.W_actor = self.params['W_actor']
        self.b_actor = self.params['b_actor']
        self.W_critic = self.params['W_critic']
        self.b_critic = self.params['b_critic']

        self.adam_t = int(data['adam_t'])


def train_a2c(
    env,
    agent: MaskedA2C,
    n_episodes: int = 1000,
    n_steps: int = 5,
    log_interval: int = 100,
    callback=None
) -> Dict:
    """
    训练A2C智能体

    Args:
        env: 环境
        agent: A2C智能体
        n_episodes: 训练回合数
        n_steps: 每次更新的步数
        log_interval: 日志间隔
        callback: 回调函数

    Returns:
        训练结果
    """
    episode_rewards = []
    best_reward = float('-inf')

    for episode in range(n_episodes):
        state = env.reset()
        episode_reward = 0
        done = False

        while not done:
            # 收集n_steps步数据
            states = []
            actions = []
            rewards = []
            dones = []
            masks = []

            for _ in range(n_steps):
                action_mask = env.get_valid_action_mask()
                action, _, _ = agent.get_action(state, action_mask)

                states.append(state)
                actions.append(action)
                masks.append(action_mask)

                next_state, reward, done, _ = env.step(action)

                rewards.append(reward)
                dones.append(done)
                episode_reward += reward

                state = next_state

                if done:
                    break

            # 更新
            if len(states) > 0:
                last_mask = env.get_valid_action_mask()
                agent.update(
                    np.array(states),
                    np.array(actions),
                    np.array(rewards),
                    np.array(dones),
                    np.array(masks),
                    state,
                    last_mask
                )

        episode_rewards.append(episode_reward)

        if episode_reward > best_reward:
            best_reward = episode_reward

        if (episode + 1) % log_interval == 0:
            avg_reward = np.mean(episode_rewards[-log_interval:])
            if callback:
                callback({
                    'episode': episode + 1,
                    'avg_reward': avg_reward,
                    'best_reward': best_reward
                })

    return {
        'episode_rewards': episode_rewards,
        'best_reward': best_reward,
        'final_avg_reward': np.mean(episode_rewards[-100:]) if len(episode_rewards) >= 100 else np.mean(episode_rewards),
    }


def evaluate_a2c(
    env,
    agent: MaskedA2C,
    n_episodes: int = 10
) -> Dict:
    """评估A2C智能体"""
    rewards = []

    for _ in range(n_episodes):
        state = env.reset()
        episode_reward = 0
        done = False

        while not done:
            action_mask = env.get_valid_action_mask()
            action, _, _ = agent.get_action(state, action_mask, deterministic=True)
            state, reward, done, _ = env.step(action)
            episode_reward += reward

        rewards.append(episode_reward)

    return {
        'mean_reward': np.mean(rewards),
        'std_reward': np.std(rewards),
        'min_reward': np.min(rewards),
        'max_reward': np.max(rewards),
    }
