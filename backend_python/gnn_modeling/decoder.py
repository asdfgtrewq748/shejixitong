"""
三维重建解码器模块
神经隐式曲面表示和体素化
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
from typing import Tuple, Optional, List
from dataclasses import dataclass


class PositionalEncoding(nn.Module):
    """
    位置编码
    提升高频细节表达能力
    """

    def __init__(self, input_dim: int = 3, num_frequencies: int = 10):
        """
        Args:
            input_dim: 输入维度
            num_frequencies: 频率数量
        """
        super().__init__()

        self.input_dim = input_dim
        self.num_frequencies = num_frequencies

        # 频率
        frequencies = 2.0 ** torch.linspace(0, num_frequencies - 1, num_frequencies)
        self.register_buffer('frequencies', frequencies)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: [N, input_dim] 输入坐标

        Returns:
            [N, input_dim * num_frequencies * 2] 位置编码
        """
        # x: [N, D]
        # frequencies: [F]
        # 扩展: [N, D, F]
        x_expanded = x.unsqueeze(-1) * self.frequencies

        # sin和cos编码
        sin_enc = torch.sin(x_expanded * np.pi)
        cos_enc = torch.cos(x_expanded * np.pi)

        # 拼接: [N, D * F * 2]
        encoding = torch.cat([sin_enc, cos_enc], dim=-1)
        encoding = encoding.view(x.size(0), -1)

        return encoding

    @property
    def output_dim(self) -> int:
        return self.input_dim * self.num_frequencies * 2


class ImplicitSurfaceDecoder(nn.Module):
    """
    神经隐式曲面解码器
    输入: 任意3D坐标点
    输出: 该点的煤层属性(厚度、是否在煤层内等)
    """

    def __init__(
        self,
        latent_dim: int,
        hidden_dim: int = 256,
        num_layers: int = 4,
        num_frequencies: int = 10
    ):
        """
        Args:
            latent_dim: 图特征维度
            hidden_dim: 隐藏层维度
            num_layers: MLP层数
            num_frequencies: 位置编码频率数
        """
        super().__init__()

        # 位置编码
        self.positional_encoding = PositionalEncoding(3, num_frequencies)
        pos_enc_dim = self.positional_encoding.output_dim

        # MLP解码器
        layers = []
        input_dim = latent_dim + pos_enc_dim

        for i in range(num_layers):
            if i == 0:
                layers.append(nn.Linear(input_dim, hidden_dim))
            elif i == num_layers - 1:
                layers.append(nn.Linear(hidden_dim, 4))  # 输出: [煤厚, 底板标高, 顶板标高, 置信度]
            else:
                layers.append(nn.Linear(hidden_dim, hidden_dim))

            if i < num_layers - 1:
                layers.append(nn.ReLU())
                layers.append(nn.LayerNorm(hidden_dim))

        self.mlp = nn.Sequential(*layers)

    def forward(
        self,
        query_points: torch.Tensor,
        graph_features: torch.Tensor
    ) -> torch.Tensor:
        """
        Args:
            query_points: [N, 3] 查询点坐标
            graph_features: [latent_dim] 或 [N, latent_dim] 图特征

        Returns:
            [N, 4] 预测属性 (煤厚, 底板标高, 顶板标高, 置信度)
        """
        # 位置编码
        pos_enc = self.positional_encoding(query_points)

        # 扩展图特征
        if graph_features.dim() == 1:
            graph_features = graph_features.unsqueeze(0).expand(len(query_points), -1)

        # 拼接
        x = torch.cat([pos_enc, graph_features], dim=-1)

        # MLP解码
        output = self.mlp(x)

        # 后处理: 确保物理合理性
        thickness = F.softplus(output[:, 0:1])  # 非负
        floor = output[:, 1:2]
        roof = floor + thickness  # 确保 roof > floor
        confidence = torch.sigmoid(output[:, 3:4])  # 0-1

        return torch.cat([thickness, floor, roof, confidence], dim=-1)


class InterpolationDecoder(nn.Module):
    """
    基于插值的解码器
    使用GNN节点特征进行空间插值
    """

    def __init__(self, feature_dim: int, hidden_dim: int = 128):
        """
        Args:
            feature_dim: 节点特征维度
            hidden_dim: 隐藏层维度
        """
        super().__init__()

        self.attention = nn.Sequential(
            nn.Linear(feature_dim + 3, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, 1)
        )

        self.decoder = nn.Sequential(
            nn.Linear(feature_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, 3)  # 煤厚, 底板, 顶板
        )

    def forward(
        self,
        query_points: torch.Tensor,
        node_features: torch.Tensor,
        node_positions: torch.Tensor
    ) -> torch.Tensor:
        """
        Args:
            query_points: [Q, 3] 查询点坐标
            node_features: [N, feature_dim] 节点特征
            node_positions: [N, 3] 节点位置

        Returns:
            [Q, 3] 预测属性
        """
        Q = query_points.size(0)
        N = node_features.size(0)

        # 计算查询点到所有节点的距离
        # query_points: [Q, 1, 3], node_positions: [1, N, 3]
        diff = query_points.unsqueeze(1) - node_positions.unsqueeze(0)  # [Q, N, 3]
        distances = torch.norm(diff[:, :, :2], dim=-1, keepdim=True)  # XY距离 [Q, N, 1]

        # 基于距离的权重
        weights = 1.0 / (distances + 1e-6)  # [Q, N, 1]

        # 注意力权重
        node_features_expanded = node_features.unsqueeze(0).expand(Q, -1, -1)  # [Q, N, F]
        attn_input = torch.cat([node_features_expanded, diff], dim=-1)  # [Q, N, F+3]
        attn_weights = self.attention(attn_input)  # [Q, N, 1]
        attn_weights = F.softmax(attn_weights * weights, dim=1)

        # 加权聚合
        aggregated = (attn_weights * node_features_expanded).sum(dim=1)  # [Q, F]

        # 解码
        return self.decoder(aggregated)


def voxelize_coal_seam(
    model: nn.Module,
    graph_features: torch.Tensor,
    bounds: List[float],
    resolution: int = 50,
    device: str = "cpu"
) -> np.ndarray:
    """
    将隐式表示转换为显式体素网格

    Args:
        model: 训练好的解码器模型
        graph_features: 图特征
        bounds: 边界范围 [x_min, x_max, y_min, y_max, z_min, z_max]
        resolution: 网格分辨率
        device: 计算设备

    Returns:
        voxel_grid: [resolution, resolution, resolution, 4] 体素网格
    """
    model.eval()

    # 生成查询网格
    x = np.linspace(bounds[0], bounds[1], resolution)
    y = np.linspace(bounds[2], bounds[3], resolution)
    z = np.linspace(bounds[4], bounds[5], resolution)

    # 创建网格点
    xx, yy, zz = np.meshgrid(x, y, z, indexing='ij')
    grid_points = np.stack([xx.ravel(), yy.ravel(), zz.ravel()], axis=-1)

    # 转换为张量
    grid_tensor = torch.tensor(grid_points, dtype=torch.float32).to(device)
    graph_features = graph_features.to(device)

    # 批量预测(避免内存溢出)
    batch_size = 10000
    predictions = []

    with torch.no_grad():
        for i in range(0, len(grid_tensor), batch_size):
            batch = grid_tensor[i:i+batch_size]
            pred = model(batch, graph_features)
            predictions.append(pred.cpu().numpy())

    predictions = np.concatenate(predictions, axis=0)

    # 重塑为3D网格
    voxel_grid = predictions.reshape(resolution, resolution, resolution, -1)

    return voxel_grid


def extract_coal_seam_surface(
    voxel_grid: np.ndarray,
    bounds: List[float],
    threshold: float = 0.5
) -> Tuple[np.ndarray, np.ndarray]:
    """
    从体素网格提取煤层表面

    Args:
        voxel_grid: [X, Y, Z, 4] 体素网格
        bounds: 边界范围
        threshold: 置信度阈值

    Returns:
        floor_surface: 底板表面点云
        roof_surface: 顶板表面点云
    """
    resolution = voxel_grid.shape[0]

    x = np.linspace(bounds[0], bounds[1], resolution)
    y = np.linspace(bounds[2], bounds[3], resolution)

    floor_points = []
    roof_points = []

    for i in range(resolution):
        for j in range(resolution):
            # 取该XY位置的平均预测
            column = voxel_grid[i, j, :, :]
            confidence = column[:, 3]

            if confidence.max() > threshold:
                # 加权平均
                weights = confidence / confidence.sum()
                thickness = (column[:, 0] * weights).sum()
                floor_z = (column[:, 1] * weights).sum()
                roof_z = (column[:, 2] * weights).sum()

                floor_points.append([x[i], y[j], floor_z])
                roof_points.append([x[i], y[j], roof_z])

    return np.array(floor_points), np.array(roof_points)


@dataclass
class CoalSeamModel:
    """煤层三维模型数据结构"""
    floor_surface: np.ndarray  # 底板表面点云
    roof_surface: np.ndarray  # 顶板表面点云
    thickness_grid: np.ndarray  # 厚度网格
    bounds: List[float]  # 边界范围
    resolution: int  # 分辨率

    def get_thickness_at(self, x: float, y: float) -> Optional[float]:
        """查询指定位置的煤层厚度"""
        # 计算网格索引
        x_idx = int((x - self.bounds[0]) / (self.bounds[1] - self.bounds[0]) * (self.resolution - 1))
        y_idx = int((y - self.bounds[2]) / (self.bounds[3] - self.bounds[2]) * (self.resolution - 1))

        if 0 <= x_idx < self.resolution and 0 <= y_idx < self.resolution:
            return float(self.thickness_grid[x_idx, y_idx])
        return None

    def get_floor_elevation_at(self, x: float, y: float) -> Optional[float]:
        """查询指定位置的底板标高"""
        # 简单最近邻查询
        if len(self.floor_surface) == 0:
            return None

        distances = np.sqrt((self.floor_surface[:, 0] - x)**2 + (self.floor_surface[:, 1] - y)**2)
        nearest_idx = np.argmin(distances)

        if distances[nearest_idx] < (self.bounds[1] - self.bounds[0]) / self.resolution * 2:
            return float(self.floor_surface[nearest_idx, 2])
        return None
