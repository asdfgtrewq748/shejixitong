"""
增强神经网络架构

实现带注意力机制的策略网络，用于处理工作面间的空间关系
"""

import numpy as np
from typing import Tuple, List, Optional


class SelfAttention:
    """
    自注意力机制（NumPy实现）

    用于捕捉工作面之间的相互关系
    """

    def __init__(self, embed_dim: int, num_heads: int = 4):
        self.embed_dim = embed_dim
        self.num_heads = num_heads
        self.head_dim = embed_dim // num_heads

        # 初始化权重
        scale = np.sqrt(2.0 / embed_dim)
        self.W_q = np.random.randn(embed_dim, embed_dim) * scale
        self.W_k = np.random.randn(embed_dim, embed_dim) * scale
        self.W_v = np.random.randn(embed_dim, embed_dim) * scale
        self.W_o = np.random.randn(embed_dim, embed_dim) * scale

    def forward(self, x: np.ndarray, mask: np.ndarray = None) -> np.ndarray:
        """
        前向传播

        Args:
            x: 输入 (seq_len, embed_dim)
            mask: 注意力掩码

        Returns:
            输出 (seq_len, embed_dim)
        """
        seq_len = x.shape[0]

        # 计算Q, K, V
        Q = x @ self.W_q  # (seq_len, embed_dim)
        K = x @ self.W_k
        V = x @ self.W_v

        # 多头注意力
        Q = Q.reshape(seq_len, self.num_heads, self.head_dim)
        K = K.reshape(seq_len, self.num_heads, self.head_dim)
        V = V.reshape(seq_len, self.num_heads, self.head_dim)

        # 计算注意力分数
        scores = np.zeros((self.num_heads, seq_len, seq_len))
        for h in range(self.num_heads):
            scores[h] = Q[:, h, :] @ K[:, h, :].T / np.sqrt(self.head_dim)

        # 应用掩码
        if mask is not None:
            scores = np.where(mask, scores, -1e9)

        # Softmax
        attention = np.exp(scores - np.max(scores, axis=-1, keepdims=True))
        attention = attention / np.sum(attention, axis=-1, keepdims=True)

        # 加权求和
        output = np.zeros((seq_len, self.embed_dim))
        for h in range(self.num_heads):
            head_output = attention[h] @ V[:, h, :]  # (seq_len, head_dim)
            output[:, h*self.head_dim:(h+1)*self.head_dim] = head_output

        # 输出投影
        output = output @ self.W_o

        return output


class WorkfaceEncoder:
    """
    工作面编码器

    将工作面特征编码为固定维度的向量
    """

    def __init__(self, input_dim: int = 12, embed_dim: int = 64):
        self.input_dim = input_dim
        self.embed_dim = embed_dim

        # 编码层
        scale = np.sqrt(2.0 / input_dim)
        self.W1 = np.random.randn(input_dim, embed_dim) * scale
        self.b1 = np.zeros(embed_dim)
        self.W2 = np.random.randn(embed_dim, embed_dim) * scale
        self.b2 = np.zeros(embed_dim)

    def forward(self, x: np.ndarray) -> np.ndarray:
        """
        编码工作面特征

        Args:
            x: 工作面特征 (n_workfaces, input_dim)

        Returns:
            编码向量 (n_workfaces, embed_dim)
        """
        h = np.maximum(0, x @ self.W1 + self.b1)  # ReLU
        h = np.maximum(0, h @ self.W2 + self.b2)
        return h


class AttentionPolicyNetwork:
    """
    带注意力机制的策略网络

    架构：
    1. 工作面编码器：将每个工作面特征编码为向量
    2. 自注意力层：捕捉工作面间的关系
    3. 全局特征融合：结合全局状态
    4. 策略头和价值头
    """

    def __init__(
        self,
        global_dim: int = 6,
        workface_dim: int = 12,
        max_workfaces: int = 30,
        embed_dim: int = 64,
        hidden_dim: int = 256,
        num_heads: int = 4,
    ):
        self.global_dim = global_dim
        self.workface_dim = workface_dim
        self.max_workfaces = max_workfaces
        self.embed_dim = embed_dim
        self.hidden_dim = hidden_dim

        # 工作面编码器
        self.workface_encoder = WorkfaceEncoder(workface_dim, embed_dim)

        # 自注意力层
        self.attention = SelfAttention(embed_dim, num_heads)

        # 全局特征编码
        scale = np.sqrt(2.0 / global_dim)
        self.W_global = np.random.randn(global_dim, embed_dim) * scale
        self.b_global = np.zeros(embed_dim)

        # 特征融合
        fusion_input_dim = embed_dim * 2  # 全局 + 聚合的工作面特征
        scale = np.sqrt(2.0 / fusion_input_dim)
        self.W_fusion1 = np.random.randn(fusion_input_dim, hidden_dim) * scale
        self.b_fusion1 = np.zeros(hidden_dim)
        self.W_fusion2 = np.random.randn(hidden_dim, hidden_dim) * scale
        self.b_fusion2 = np.zeros(hidden_dim)

        # 策略头
        action_dim = 1 + 3 * max_workfaces
        scale = np.sqrt(2.0 / hidden_dim)
        self.W_policy = np.random.randn(hidden_dim, action_dim) * scale
        self.b_policy = np.zeros(action_dim)

        # 价值头
        self.W_value = np.random.randn(hidden_dim, 1) * scale
        self.b_value = np.zeros(1)

    def forward(self, state: np.ndarray, action_mask: np.ndarray) -> Tuple[np.ndarray, float]:
        """
        前向传播

        Args:
            state: 状态向量 (global_dim + max_workfaces * workface_dim)
            action_mask: 动作掩码

        Returns:
            (动作概率分布, 状态价值)
        """
        # 1. 分离全局特征和工作面特征
        global_features = state[:self.global_dim]
        workface_features = state[self.global_dim:].reshape(self.max_workfaces, self.workface_dim)

        # 2. 编码工作面
        workface_embeddings = self.workface_encoder.forward(workface_features)  # (n_wf, embed_dim)

        # 3. 自注意力
        # 创建有效工作面掩码（非零特征的工作面）
        valid_mask = np.sum(np.abs(workface_features), axis=1) > 0.01
        n_valid = np.sum(valid_mask)

        if n_valid > 0:
            valid_embeddings = workface_embeddings[valid_mask]
            attended = self.attention.forward(valid_embeddings)

            # 聚合（平均池化）
            aggregated = np.mean(attended, axis=0)
        else:
            aggregated = np.zeros(self.embed_dim)

        # 4. 编码全局特征
        global_encoded = np.maximum(0, global_features @ self.W_global + self.b_global)

        # 5. 特征融合
        fused = np.concatenate([global_encoded, aggregated])
        h = np.maximum(0, fused @ self.W_fusion1 + self.b_fusion1)
        h = np.maximum(0, h @ self.W_fusion2 + self.b_fusion2)

        # 6. 策略输出
        logits = h @ self.W_policy + self.b_policy

        # 应用动作掩码
        masked_logits = np.where(action_mask > 0, logits, -1e9)
        exp_logits = np.exp(masked_logits - np.max(masked_logits))
        probs = exp_logits / np.sum(exp_logits)

        # 7. 价值输出
        value = float(h @ self.W_value + self.b_value)

        return probs, value

    def get_action(self, state: np.ndarray, action_mask: np.ndarray) -> Tuple[int, float, float]:
        """采样动作"""
        probs, value = self.forward(state, action_mask)
        action = np.random.choice(len(probs), p=probs)
        log_prob = np.log(probs[action] + 1e-10)
        return action, log_prob, value

    def get_attention_weights(self, state: np.ndarray) -> np.ndarray:
        """
        获取注意力权重（用于可解释性分析）

        Returns:
            注意力权重矩阵
        """
        workface_features = state[self.global_dim:].reshape(self.max_workfaces, self.workface_dim)
        workface_embeddings = self.workface_encoder.forward(workface_features)

        valid_mask = np.sum(np.abs(workface_features), axis=1) > 0.01
        n_valid = np.sum(valid_mask)

        if n_valid > 0:
            valid_embeddings = workface_embeddings[valid_mask]

            # 计算注意力分数
            Q = valid_embeddings @ self.attention.W_q
            K = valid_embeddings @ self.attention.W_k

            scores = Q @ K.T / np.sqrt(self.embed_dim)
            attention = np.exp(scores - np.max(scores, axis=-1, keepdims=True))
            attention = attention / np.sum(attention, axis=-1, keepdims=True)

            return attention

        return np.array([])

    def get_params(self) -> dict:
        """获取所有参数"""
        return {
            'workface_encoder_W1': self.workface_encoder.W1.copy(),
            'workface_encoder_b1': self.workface_encoder.b1.copy(),
            'workface_encoder_W2': self.workface_encoder.W2.copy(),
            'workface_encoder_b2': self.workface_encoder.b2.copy(),
            'attention_W_q': self.attention.W_q.copy(),
            'attention_W_k': self.attention.W_k.copy(),
            'attention_W_v': self.attention.W_v.copy(),
            'attention_W_o': self.attention.W_o.copy(),
            'W_global': self.W_global.copy(),
            'b_global': self.b_global.copy(),
            'W_fusion1': self.W_fusion1.copy(),
            'b_fusion1': self.b_fusion1.copy(),
            'W_fusion2': self.W_fusion2.copy(),
            'b_fusion2': self.b_fusion2.copy(),
            'W_policy': self.W_policy.copy(),
            'b_policy': self.b_policy.copy(),
            'W_value': self.W_value.copy(),
            'b_value': self.b_value.copy(),
        }

    def set_params(self, params: dict):
        """设置所有参数"""
        self.workface_encoder.W1 = params['workface_encoder_W1'].copy()
        self.workface_encoder.b1 = params['workface_encoder_b1'].copy()
        self.workface_encoder.W2 = params['workface_encoder_W2'].copy()
        self.workface_encoder.b2 = params['workface_encoder_b2'].copy()
        self.attention.W_q = params['attention_W_q'].copy()
        self.attention.W_k = params['attention_W_k'].copy()
        self.attention.W_v = params['attention_W_v'].copy()
        self.attention.W_o = params['attention_W_o'].copy()
        self.W_global = params['W_global'].copy()
        self.b_global = params['b_global'].copy()
        self.W_fusion1 = params['W_fusion1'].copy()
        self.b_fusion1 = params['b_fusion1'].copy()
        self.W_fusion2 = params['W_fusion2'].copy()
        self.b_fusion2 = params['b_fusion2'].copy()
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


class GraphAttentionLayer:
    """
    图注意力层

    将工作面视为图节点，根据空间关系构建边
    """

    def __init__(self, in_features: int, out_features: int, alpha: float = 0.2):
        self.in_features = in_features
        self.out_features = out_features
        self.alpha = alpha

        # 权重初始化
        scale = np.sqrt(2.0 / in_features)
        self.W = np.random.randn(in_features, out_features) * scale
        self.a = np.random.randn(2 * out_features, 1) * scale

    def forward(self, x: np.ndarray, adj: np.ndarray) -> np.ndarray:
        """
        前向传播

        Args:
            x: 节点特征 (n_nodes, in_features)
            adj: 邻接矩阵 (n_nodes, n_nodes)

        Returns:
            输出特征 (n_nodes, out_features)
        """
        n_nodes = x.shape[0]

        # 线性变换
        h = x @ self.W  # (n_nodes, out_features)

        # 计算注意力系数
        a_input = np.zeros((n_nodes, n_nodes, 2 * self.out_features))
        for i in range(n_nodes):
            for j in range(n_nodes):
                a_input[i, j] = np.concatenate([h[i], h[j]])

        e = np.zeros((n_nodes, n_nodes))
        for i in range(n_nodes):
            for j in range(n_nodes):
                e[i, j] = self._leaky_relu(float(a_input[i, j] @ self.a))

        # 掩码（只考虑邻接节点）
        e = np.where(adj > 0, e, -1e9)

        # Softmax
        attention = np.exp(e - np.max(e, axis=1, keepdims=True))
        attention = attention / np.sum(attention, axis=1, keepdims=True)

        # 聚合
        output = attention @ h

        return output

    def _leaky_relu(self, x: float) -> float:
        return x if x > 0 else self.alpha * x


def build_adjacency_matrix(workface_positions: np.ndarray, threshold: float = 500.0) -> np.ndarray:
    """
    根据工作面位置构建邻接矩阵

    Args:
        workface_positions: 工作面位置 (n_workfaces, 2)
        threshold: 距离阈值

    Returns:
        邻接矩阵 (n_workfaces, n_workfaces)
    """
    n = len(workface_positions)
    adj = np.zeros((n, n))

    for i in range(n):
        for j in range(n):
            if i != j:
                dist = np.sqrt(np.sum((workface_positions[i] - workface_positions[j])**2))
                if dist < threshold:
                    adj[i, j] = 1.0

    # 添加自环
    adj += np.eye(n)

    return adj
