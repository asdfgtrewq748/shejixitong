"""
图构建模块
将钻孔数据转换为图结构
"""

import numpy as np
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass
from scipy.spatial import Delaunay, KDTree


@dataclass
class Borehole:
    """钻孔数据类"""
    id: str
    x: float  # X坐标
    y: float  # Y坐标
    z: float  # 煤层底板标高
    thickness: float  # 煤层厚度
    dip_angle: float = 0.0  # 煤层倾角
    dip_direction: float = 0.0  # 煤层倾向
    hardness: float = 0.0  # 顶板岩性硬度
    gas_content: float = 0.0  # 瓦斯含量
    water_inflow: float = 0.0  # 涌水量
    fault_distance: float = 1000.0  # 距最近断层距离
    fold_curvature: float = 0.0  # 褶曲曲率


@dataclass
class GraphData:
    """图数据结构"""
    node_features: np.ndarray  # [N, F] 节点特征
    edge_index: np.ndarray  # [2, E] 边索引
    edge_attr: np.ndarray  # [E, D] 边特征
    positions: np.ndarray  # [N, 3] 节点位置
    targets: np.ndarray  # [N, T] 目标值
    borehole_ids: List[str]  # 钻孔ID列表


class MultiScaleGraphBuilder:
    """
    多尺度图构建器
    - 局部图: 捕捉邻近钻孔的细节变化
    - 区域图: 学习中等尺度的地质趋势
    - 全局图: 建模整体构造特征
    """

    def __init__(
        self,
        k_neighbors: int = 6,
        radius: float = 500.0,
        use_delaunay: bool = True,
        normalize: bool = True
    ):
        """
        初始化图构建器

        Args:
            k_neighbors: K近邻图的邻居数
            radius: 区域图的半径(米)
            use_delaunay: 是否使用Delaunay三角剖分
            normalize: 是否归一化特征
        """
        self.k_neighbors = k_neighbors
        self.radius = radius
        self.use_delaunay = use_delaunay
        self.normalize = normalize

        # 归一化参数
        self.feature_mean = None
        self.feature_std = None
        self.position_min = None
        self.position_max = None

    def build(
        self,
        boreholes: List[Borehole],
        graph_type: str = "combined"
    ) -> GraphData:
        """
        构建图数据

        Args:
            boreholes: 钻孔数据列表
            graph_type: 图类型 ("local", "regional", "global", "combined")

        Returns:
            GraphData: 图数据结构
        """
        # 提取位置和特征
        positions = np.array([[b.x, b.y, b.z] for b in boreholes])
        features = self._extract_features(boreholes)
        targets = self._extract_targets(boreholes)
        borehole_ids = [b.id for b in boreholes]

        # 归一化
        if self.normalize:
            positions_norm = self._normalize_positions(positions)
            features_norm = self._normalize_features(features)
        else:
            positions_norm = positions
            features_norm = features

        # 合并位置和特征作为节点特征
        node_features = np.concatenate([positions_norm, features_norm], axis=1)

        # 构建边
        if graph_type == "local":
            edge_index = self._build_knn_edges(positions)
        elif graph_type == "regional":
            edge_index = self._build_radius_edges(positions)
        elif graph_type == "global":
            edge_index = self._build_delaunay_edges(positions)
        else:  # combined
            edge_index = self._build_combined_edges(positions)

        # 计算边特征
        edge_attr = self._compute_edge_features(positions, boreholes, edge_index)

        return GraphData(
            node_features=node_features.astype(np.float32),
            edge_index=edge_index.astype(np.int64),
            edge_attr=edge_attr.astype(np.float32),
            positions=positions.astype(np.float32),
            targets=targets.astype(np.float32),
            borehole_ids=borehole_ids
        )

    def _extract_features(self, boreholes: List[Borehole]) -> np.ndarray:
        """提取节点特征"""
        features = []
        for b in boreholes:
            features.append([
                b.dip_angle,
                b.dip_direction,
                b.hardness,
                b.gas_content,
                b.water_inflow,
                b.fault_distance,
                b.fold_curvature
            ])
        return np.array(features)

    def _extract_targets(self, boreholes: List[Borehole]) -> np.ndarray:
        """提取目标值"""
        targets = []
        for b in boreholes:
            targets.append([
                b.thickness,  # 煤层厚度
                b.z,  # 底板标高
                b.z + b.thickness  # 顶板标高
            ])
        return np.array(targets)

    def _normalize_positions(self, positions: np.ndarray) -> np.ndarray:
        """归一化位置坐标"""
        if self.position_min is None:
            self.position_min = positions.min(axis=0)
            self.position_max = positions.max(axis=0)

        # 避免除零
        range_vals = self.position_max - self.position_min
        range_vals[range_vals == 0] = 1.0

        return (positions - self.position_min) / range_vals

    def _normalize_features(self, features: np.ndarray) -> np.ndarray:
        """归一化特征"""
        if self.feature_mean is None:
            self.feature_mean = features.mean(axis=0)
            self.feature_std = features.std(axis=0)
            self.feature_std[self.feature_std == 0] = 1.0

        return (features - self.feature_mean) / self.feature_std

    def _build_knn_edges(self, positions: np.ndarray) -> np.ndarray:
        """构建K近邻图"""
        xy_positions = positions[:, :2]  # 只用XY坐标
        tree = KDTree(xy_positions)

        edges = []
        k = min(self.k_neighbors + 1, len(positions))

        for i in range(len(positions)):
            distances, indices = tree.query(xy_positions[i], k=k)
            for j in indices[1:]:  # 排除自身
                edges.append([i, j])
                edges.append([j, i])  # 无向图

        # 去重
        edges = list(set(tuple(e) for e in edges))
        return np.array(edges).T if edges else np.zeros((2, 0), dtype=np.int64)

    def _build_radius_edges(self, positions: np.ndarray) -> np.ndarray:
        """构建半径图"""
        xy_positions = positions[:, :2]
        tree = KDTree(xy_positions)

        edges = []
        for i in range(len(positions)):
            indices = tree.query_ball_point(xy_positions[i], self.radius)
            for j in indices:
                if i != j:
                    edges.append([i, j])

        return np.array(edges).T if edges else np.zeros((2, 0), dtype=np.int64)

    def _build_delaunay_edges(self, positions: np.ndarray) -> np.ndarray:
        """构建Delaunay三角剖分图"""
        if len(positions) < 3:
            return self._build_knn_edges(positions)

        xy_positions = positions[:, :2]

        try:
            tri = Delaunay(xy_positions)
            edges = set()

            for simplex in tri.simplices:
                for i in range(3):
                    for j in range(i + 1, 3):
                        edges.add((simplex[i], simplex[j]))
                        edges.add((simplex[j], simplex[i]))

            return np.array(list(edges)).T
        except Exception:
            # 如果Delaunay失败，回退到KNN
            return self._build_knn_edges(positions)

    def _build_combined_edges(self, positions: np.ndarray) -> np.ndarray:
        """构建组合图(合并多种边)"""
        knn_edges = self._build_knn_edges(positions)
        delaunay_edges = self._build_delaunay_edges(positions)

        # 合并边
        all_edges = set()

        for i in range(knn_edges.shape[1]):
            all_edges.add((knn_edges[0, i], knn_edges[1, i]))

        for i in range(delaunay_edges.shape[1]):
            all_edges.add((delaunay_edges[0, i], delaunay_edges[1, i]))

        return np.array(list(all_edges)).T if all_edges else np.zeros((2, 0), dtype=np.int64)

    def _compute_edge_features(
        self,
        positions: np.ndarray,
        boreholes: List[Borehole],
        edge_index: np.ndarray
    ) -> np.ndarray:
        """
        计算边特征

        边特征包括:
        - 欧氏距离
        - 方位角
        - 高程差
        - 煤厚梯度
        """
        if edge_index.shape[1] == 0:
            return np.zeros((0, 4), dtype=np.float32)

        edge_features = []

        for e in range(edge_index.shape[1]):
            i, j = edge_index[0, e], edge_index[1, e]

            # 欧氏距离
            dx = positions[j, 0] - positions[i, 0]
            dy = positions[j, 1] - positions[i, 1]
            distance = np.sqrt(dx**2 + dy**2)

            # 方位角
            azimuth = np.arctan2(dy, dx)

            # 高程差
            dz = positions[j, 2] - positions[i, 2]

            # 煤厚梯度
            thickness_diff = boreholes[j].thickness - boreholes[i].thickness
            thickness_gradient = thickness_diff / max(distance, 1e-6)

            edge_features.append([
                distance,
                azimuth,
                dz,
                thickness_gradient
            ])

        return np.array(edge_features)

    def denormalize_positions(self, positions_norm: np.ndarray) -> np.ndarray:
        """反归一化位置坐标"""
        if self.position_min is None:
            return positions_norm

        range_vals = self.position_max - self.position_min
        return positions_norm * range_vals + self.position_min


def create_sample_boreholes(n: int = 50, seed: int = 42) -> List[Borehole]:
    """
    创建示例钻孔数据用于测试

    Args:
        n: 钻孔数量
        seed: 随机种子

    Returns:
        钻孔数据列表
    """
    np.random.seed(seed)

    boreholes = []

    # 生成随机位置
    x_coords = np.random.uniform(0, 2000, n)
    y_coords = np.random.uniform(0, 1500, n)

    # 生成带有空间相关性的煤层属性
    for i in range(n):
        x, y = x_coords[i], y_coords[i]

        # 底板标高(带有倾斜趋势)
        z = 500 - 0.05 * x - 0.03 * y + np.random.normal(0, 10)

        # 煤层厚度(带有空间变化)
        thickness = 3.0 + 0.5 * np.sin(x / 500) + 0.3 * np.cos(y / 400) + np.random.normal(0, 0.3)
        thickness = max(0.5, thickness)  # 确保非负

        borehole = Borehole(
            id=f"ZK{i+1:03d}",
            x=x,
            y=y,
            z=z,
            thickness=thickness,
            dip_angle=np.random.uniform(5, 15),
            dip_direction=np.random.uniform(0, 360),
            hardness=np.random.uniform(3, 8),
            gas_content=np.random.uniform(0, 15),
            water_inflow=np.random.uniform(0, 50),
            fault_distance=np.random.uniform(100, 1000),
            fold_curvature=np.random.uniform(-0.01, 0.01)
        )
        boreholes.append(borehole)

    return boreholes
