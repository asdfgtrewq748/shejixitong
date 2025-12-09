"""
神经网络模块
"""
import numpy as np
from typing import Tuple


class PolicyNetwork:
    """
    策略网络：使用NumPy实现的简单神经网络
    支持动作掩码的策略梯度方法
    """

    def __init__(self, state_dim: int, action_dim: int, hidden_dim: int = 256):
        self.state_dim = state_dim
        self.action_dim = action_dim
        self.hidden_dim = hidden_dim

        # 初始化权重 (Xavier初始化)
        self.W1 = np.random.randn(state_dim, hidden_dim) * np.sqrt(2.0 / state_dim)
        self.b1 = np.zeros(hidden_dim)

        self.W2 = np.random.randn(hidden_dim, hidden_dim) * np.sqrt(2.0 / hidden_dim)
        self.b2 = np.zeros(hidden_dim)

        # 策略头
        self.W_policy = np.random.randn(hidden_dim, action_dim) * np.sqrt(2.0 / hidden_dim)
        self.b_policy = np.zeros(action_dim)

        # 价值头
        self.W_value = np.random.randn(hidden_dim, 1) * np.sqrt(2.0 / hidden_dim)
        self.b_value = np.zeros(1)

    def forward(self, state: np.ndarray, action_mask: np.ndarray) -> Tuple[np.ndarray, float]:
        """
        前向传播

        Args:
            state: 状态向量
            action_mask: 动作掩码

        Returns:
            (动作概率分布, 状态价值)
        """
        # 特征提取
        h1 = np.maximum(0, state @ self.W1 + self.b1)  # ReLU
        h2 = np.maximum(0, h1 @ self.W2 + self.b2)     # ReLU

        # 策略输出
        logits = h2 @ self.W_policy + self.b_policy

        # 应用动作掩码
        masked_logits = np.where(action_mask > 0, logits, -1e9)

        # Softmax
        exp_logits = np.exp(masked_logits - np.max(masked_logits))
        probs = exp_logits / np.sum(exp_logits)

        # 价值输出
        value = float(h2 @ self.W_value + self.b_value)

        return probs, value

    def get_action(self, state: np.ndarray, action_mask: np.ndarray) -> Tuple[int, float, float]:
        """
        采样动作

        Args:
            state: 状态向量
            action_mask: 动作掩码

        Returns:
            (动作索引, log概率, 状态价值)
        """
        probs, value = self.forward(state, action_mask)

        # 采样动作
        action = np.random.choice(len(probs), p=probs)
        log_prob = np.log(probs[action] + 1e-10)

        return action, log_prob, value

    def get_params(self) -> dict:
        """获取所有参数"""
        return {
            'W1': self.W1.copy(),
            'b1': self.b1.copy(),
            'W2': self.W2.copy(),
            'b2': self.b2.copy(),
            'W_policy': self.W_policy.copy(),
            'b_policy': self.b_policy.copy(),
            'W_value': self.W_value.copy(),
            'b_value': self.b_value.copy(),
        }

    def set_params(self, params: dict):
        """设置所有参数"""
        self.W1 = params['W1'].copy()
        self.b1 = params['b1'].copy()
        self.W2 = params['W2'].copy()
        self.b2 = params['b2'].copy()
        self.W_policy = params['W_policy'].copy()
        self.b_policy = params['b_policy'].copy()
        self.W_value = params['W_value'].copy()
        self.b_value = params['b_value'].copy()

    def save(self, filepath: str):
        """保存模型"""
        np.savez(filepath, **self.get_params())

    def load(self, filepath: str):
        """加载模型"""
        data = np.load(filepath)
        self.set_params({k: data[k] for k in data.files})


class PolicyNetworkTorch:
    """
    PyTorch版本的策略网络（可选，需要安装torch）
    """

    def __init__(self, state_dim: int, action_dim: int, hidden_dim: int = 256):
        try:
            import torch
            import torch.nn as nn

            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

            # 共享特征提取层
            self.feature_extractor = nn.Sequential(
                nn.Linear(state_dim, hidden_dim),
                nn.ReLU(),
                nn.Linear(hidden_dim, hidden_dim),
                nn.ReLU(),
            ).to(self.device)

            # 策略头
            self.policy_head = nn.Sequential(
                nn.Linear(hidden_dim, hidden_dim),
                nn.ReLU(),
                nn.Linear(hidden_dim, action_dim),
            ).to(self.device)

            # 价值头
            self.value_head = nn.Sequential(
                nn.Linear(hidden_dim, hidden_dim),
                nn.ReLU(),
                nn.Linear(hidden_dim, 1),
            ).to(self.device)

            self.torch_available = True
            self.torch = torch
            self.nn = nn

        except ImportError:
            self.torch_available = False
            print("PyTorch not available, using NumPy implementation")

    def forward(self, state, action_mask):
        if not self.torch_available:
            raise RuntimeError("PyTorch not available")

        torch = self.torch

        if isinstance(state, np.ndarray):
            state = torch.tensor(state, dtype=torch.float32).to(self.device)
        if isinstance(action_mask, np.ndarray):
            action_mask = torch.tensor(action_mask, dtype=torch.float32).to(self.device)

        features = self.feature_extractor(state)

        # 策略输出
        logits = self.policy_head(features)

        # 应用动作掩码
        masked_logits = logits.masked_fill(action_mask == 0, -1e9)
        probs = torch.softmax(masked_logits, dim=-1)

        # 价值输出
        value = self.value_head(features)

        return probs, value

    def get_action(self, state, action_mask):
        if not self.torch_available:
            raise RuntimeError("PyTorch not available")

        torch = self.torch

        with torch.no_grad():
            probs, value = self.forward(state, action_mask)
            dist = torch.distributions.Categorical(probs)
            action = dist.sample()
            log_prob = dist.log_prob(action)

        return action.item(), log_prob.item(), value.item()
