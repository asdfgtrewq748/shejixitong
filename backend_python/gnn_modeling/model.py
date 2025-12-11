"""
GNN模型模块
地质感知图神经网络实现
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Optional, Tuple


class EdgeConv(nn.Module):
    """
    边卷积层
    考虑边特征的消息传递
    """

    def __init__(self, in_channels: int, out_channels: int, edge_channels: int):
        super().__init__()

        self.mlp = nn.Sequential(
            nn.Linear(2 * in_channels + edge_channels, out_channels),
            nn.ReLU(),
            nn.Linear(out_channels, out_channels)
        )

    def forward(
        self,
        x: torch.Tensor,
        edge_index: torch.Tensor,
        edge_attr: torch.Tensor
    ) -> torch.Tensor:
        """
        Args:
            x: [N, in_channels] 节点特征
            edge_index: [2, E] 边索引
            edge_attr: [E, edge_channels] 边特征

        Returns:
            [N, out_channels] 更新后的节点特征
        """
        row, col = edge_index

        # 构建消息: [源节点特征, 目标节点特征, 边特征]
        messages = torch.cat([x[row], x[col], edge_attr], dim=-1)

        # MLP处理消息
        messages = self.mlp(messages)

        # 聚合消息(均值聚合)
        out = torch.zeros(x.size(0), messages.size(1), device=x.device)
        count = torch.zeros(x.size(0), 1, device=x.device)

        out.scatter_add_(0, col.unsqueeze(-1).expand_as(messages), messages)
        count.scatter_add_(0, col.unsqueeze(-1), torch.ones_like(col.unsqueeze(-1).float()))

        count = count.clamp(min=1)
        out = out / count

        return out


class GraphAttentionLayer(nn.Module):
    """
    图注意力层
    学习邻居节点的重要性权重
    """

    def __init__(
        self,
        in_channels: int,
        out_channels: int,
        edge_channels: int,
        heads: int = 4,
        dropout: float = 0.1
    ):
        super().__init__()

        self.heads = heads
        self.out_channels = out_channels
        self.dropout = dropout

        # 线性变换
        self.W = nn.Linear(in_channels, heads * out_channels, bias=False)
        self.W_edge = nn.Linear(edge_channels, heads, bias=False)

        # 注意力参数
        self.a = nn.Parameter(torch.zeros(heads, 2 * out_channels))
        nn.init.xavier_uniform_(self.a)

        self.leaky_relu = nn.LeakyReLU(0.2)

    def forward(
        self,
        x: torch.Tensor,
        edge_index: torch.Tensor,
        edge_attr: torch.Tensor
    ) -> torch.Tensor:
        """
        Args:
            x: [N, in_channels] 节点特征
            edge_index: [2, E] 边索引
            edge_attr: [E, edge_channels] 边特征

        Returns:
            [N, heads * out_channels] 更新后的节点特征
        """
        N = x.size(0)
        row, col = edge_index

        # 线性变换
        x = self.W(x).view(N, self.heads, self.out_channels)

        # 计算注意力分数
        x_i = x[row]  # [E, heads, out_channels]
        x_j = x[col]  # [E, heads, out_channels]

        # 拼接并计算注意力
        alpha = (torch.cat([x_i, x_j], dim=-1) * self.a).sum(dim=-1)  # [E, heads]

        # 加入边特征的影响
        edge_weight = self.W_edge(edge_attr)  # [E, heads]
        alpha = alpha + edge_weight

        alpha = self.leaky_relu(alpha)

        # Softmax归一化(按目标节点)
        alpha = self._softmax(alpha, col, N)

        # Dropout
        alpha = F.dropout(alpha, p=self.dropout, training=self.training)

        # 加权聚合
        out = torch.zeros(N, self.heads, self.out_channels, device=x.device)
        alpha = alpha.unsqueeze(-1)  # [E, heads, 1]

        out.scatter_add_(0, col.view(-1, 1, 1).expand(-1, self.heads, self.out_channels), x_j * alpha)

        # 展平多头输出
        return out.view(N, -1)

    def _softmax(self, alpha: torch.Tensor, index: torch.Tensor, num_nodes: int) -> torch.Tensor:
        """按目标节点进行softmax"""
        alpha_max = torch.zeros(num_nodes, alpha.size(1), device=alpha.device)
        alpha_max.scatter_reduce_(0, index.unsqueeze(-1).expand_as(alpha), alpha, reduce='amax', include_self=False)
        alpha = alpha - alpha_max[index]
        alpha = alpha.exp()

        alpha_sum = torch.zeros(num_nodes, alpha.size(1), device=alpha.device)
        alpha_sum.scatter_add_(0, index.unsqueeze(-1).expand_as(alpha), alpha)
        alpha_sum = alpha_sum.clamp(min=1e-10)

        return alpha / alpha_sum[index]


class GeologicalConstraintLayer(nn.Module):
    """
    地质约束层 - 融入领域知识
    确保输出满足地质合理性
    """

    def __init__(self, channels: int):
        super().__init__()

        # 可学习的约束权重
        self.smoothness_weight = nn.Parameter(torch.tensor(0.1))
        self.continuity_weight = nn.Parameter(torch.tensor(0.1))

        # 特征变换
        self.transform = nn.Sequential(
            nn.Linear(channels, channels),
            nn.ReLU(),
            nn.Linear(channels, channels)
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        应用地质约束

        Args:
            x: [N, channels] 节点特征

        Returns:
            [N, channels] 约束后的特征
        """
        # 特征变换
        x_transformed = self.transform(x)

        # 残差连接
        return x + self.smoothness_weight * x_transformed


class GeoGNN(nn.Module):
    """
    地质感知图神经网络
    结合注意力机制和地质先验知识
    """

    def __init__(
        self,
        in_channels: int,
        hidden_channels: int = 64,
        out_channels: int = 3,
        edge_channels: int = 4,
        num_layers: int = 3,
        heads: int = 4,
        dropout: float = 0.2
    ):
        """
        Args:
            in_channels: 输入节点特征维度
            hidden_channels: 隐藏层维度
            out_channels: 输出维度(煤厚、底板标高、顶板标高)
            edge_channels: 边特征维度
            num_layers: GNN层数
            heads: 注意力头数
            dropout: Dropout率
        """
        super().__init__()

        self.dropout = dropout

        # 输入投影
        self.input_proj = nn.Linear(in_channels, hidden_channels)

        # 边特征投影
        self.edge_proj = nn.Linear(edge_channels, hidden_channels)

        # 图注意力层
        self.gat_layers = nn.ModuleList()
        self.gat_layers.append(
            GraphAttentionLayer(hidden_channels, hidden_channels, hidden_channels, heads=heads)
        )

        for _ in range(num_layers - 2):
            self.gat_layers.append(
                GraphAttentionLayer(hidden_channels * heads, hidden_channels, hidden_channels, heads=heads)
            )

        self.gat_layers.append(
            GraphAttentionLayer(hidden_channels * heads, hidden_channels, hidden_channels, heads=1)
        )

        # 地质约束层
        self.geo_constraint = GeologicalConstraintLayer(hidden_channels)

        # 输出解码器
        self.decoder = nn.Sequential(
            nn.Linear(hidden_channels, hidden_channels),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_channels, hidden_channels // 2),
            nn.ReLU(),
            nn.Linear(hidden_channels // 2, out_channels)
        )

        # 初始化
        self._init_weights()

    def _init_weights(self):
        """初始化权重"""
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight)
                if m.bias is not None:
                    nn.init.zeros_(m.bias)

    def forward(
        self,
        x: torch.Tensor,
        edge_index: torch.Tensor,
        edge_attr: torch.Tensor
    ) -> torch.Tensor:
        """
        前向传播

        Args:
            x: [N, in_channels] 节点特征
            edge_index: [2, E] 边索引
            edge_attr: [E, edge_channels] 边特征

        Returns:
            [N, out_channels] 预测输出
        """
        # 输入投影
        x = self.input_proj(x)
        edge_attr = self.edge_proj(edge_attr)

        # 图注意力层
        for i, gat in enumerate(self.gat_layers):
            x_new = gat(x, edge_index, edge_attr)
            x_new = F.elu(x_new)

            if i < len(self.gat_layers) - 1:
                x_new = F.dropout(x_new, p=self.dropout, training=self.training)

            # 残差连接(如果维度匹配)
            if x.size(-1) == x_new.size(-1):
                x = x + x_new
            else:
                x = x_new

        # 应用地质约束
        x = self.geo_constraint(x)

        # 解码输出
        out = self.decoder(x)

        return out

    def get_embeddings(
        self,
        x: torch.Tensor,
        edge_index: torch.Tensor,
        edge_attr: torch.Tensor
    ) -> torch.Tensor:
        """
        获取节点嵌入(用于可视化或下游任务)

        Returns:
            [N, hidden_channels] 节点嵌入
        """
        x = self.input_proj(x)
        edge_attr = self.edge_proj(edge_attr)

        for i, gat in enumerate(self.gat_layers):
            x_new = gat(x, edge_index, edge_attr)
            x_new = F.elu(x_new)

            if x.size(-1) == x_new.size(-1):
                x = x + x_new
            else:
                x = x_new

        return self.geo_constraint(x)


class MultiScaleGeoGNN(nn.Module):
    """
    多尺度地质GNN
    融合局部、区域、全局三个尺度的特征
    """

    def __init__(
        self,
        in_channels: int,
        hidden_channels: int = 64,
        out_channels: int = 3,
        edge_channels: int = 4
    ):
        super().__init__()

        # 三个尺度的GNN
        self.local_gnn = GeoGNN(in_channels, hidden_channels, hidden_channels, edge_channels, num_layers=2)
        self.regional_gnn = GeoGNN(in_channels, hidden_channels, hidden_channels, edge_channels, num_layers=2)
        self.global_gnn = GeoGNN(in_channels, hidden_channels, hidden_channels, edge_channels, num_layers=2)

        # 多尺度融合
        self.fusion = nn.Sequential(
            nn.Linear(hidden_channels * 3, hidden_channels * 2),
            nn.ReLU(),
            nn.Linear(hidden_channels * 2, hidden_channels),
            nn.ReLU(),
            nn.Linear(hidden_channels, out_channels)
        )

    def forward(
        self,
        x: torch.Tensor,
        local_edge_index: torch.Tensor,
        local_edge_attr: torch.Tensor,
        regional_edge_index: torch.Tensor,
        regional_edge_attr: torch.Tensor,
        global_edge_index: torch.Tensor,
        global_edge_attr: torch.Tensor
    ) -> torch.Tensor:
        """
        多尺度前向传播

        Returns:
            [N, out_channels] 预测输出
        """
        # 各尺度特征提取
        local_feat = self.local_gnn(x, local_edge_index, local_edge_attr)
        regional_feat = self.regional_gnn(x, regional_edge_index, regional_edge_attr)
        global_feat = self.global_gnn(x, global_edge_index, global_edge_attr)

        # 特征融合
        fused = torch.cat([local_feat, regional_feat, global_feat], dim=-1)

        return self.fusion(fused)
