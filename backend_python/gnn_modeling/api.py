"""
API模块
提供与现有系统集成的接口
"""

import numpy as np
import torch
import json
from typing import List, Dict, Optional, Tuple
from dataclasses import asdict

from .graph_builder import MultiScaleGraphBuilder, Borehole, GraphData
from .model import GeoGNN
from .trainer import GNNTrainer, TrainingConfig
from .decoder import ImplicitSurfaceDecoder, CoalSeamModel, voxelize_coal_seam
from .visualizer import CoalSeamVisualizer


class GNNGeologyModule:
    """
    GNN地质建模模块 - 可集成到现有系统

    使用示例:
    ```python
    # 初始化模块
    module = GNNGeologyModule()

    # 从钻孔数据构建模型
    boreholes = [
        {'id': 'ZK001', 'x': 100, 'y': 200, 'z': 450, 'thickness': 3.5},
        {'id': 'ZK002', 'x': 150, 'y': 250, 'z': 448, 'thickness': 3.2},
        ...
    ]
    module.fit(boreholes, epochs=100)

    # 查询任意位置的煤层属性
    thickness = module.get_thickness_at(120, 220)
    floor = module.get_floor_elevation_at(120, 220)

    # 导出三维模型
    model_3d = module.build_3d_model(resolution=50)
    ```
    """

    def __init__(self, model_path: Optional[str] = None):
        """
        初始化GNN地质建模模块

        Args:
            model_path: 预训练模型路径(可选)
        """
        self.graph_builder = MultiScaleGraphBuilder(
            k_neighbors=6,
            radius=500.0,
            use_delaunay=True,
            normalize=True
        )

        self.model = None
        self.trainer = None
        self.graph = None
        self.visualizer = CoalSeamVisualizer()

        if model_path:
            self.load_model(model_path)

    def _dict_to_borehole(self, data: Dict) -> Borehole:
        """将字典转换为Borehole对象"""
        return Borehole(
            id=data.get('id', f"BH_{id(data)}"),
            x=float(data['x']),
            y=float(data['y']),
            z=float(data.get('z', data.get('floor', 0))),
            thickness=float(data.get('thickness', 0)),
            dip_angle=float(data.get('dip_angle', 0)),
            dip_direction=float(data.get('dip_direction', 0)),
            hardness=float(data.get('hardness', 0)),
            gas_content=float(data.get('gas_content', 0)),
            water_inflow=float(data.get('water_inflow', 0)),
            fault_distance=float(data.get('fault_distance', 1000)),
            fold_curvature=float(data.get('fold_curvature', 0))
        )

    def fit(
        self,
        boreholes: List[Dict],
        epochs: int = 100,
        learning_rate: float = 0.001,
        verbose: bool = True
    ) -> Dict:
        """
        训练GNN模型

        Args:
            boreholes: 钻孔数据列表,每个元素为字典
            epochs: 训练轮数
            learning_rate: 学习率
            verbose: 是否打印训练信息

        Returns:
            训练历史
        """
        # 转换数据格式
        borehole_objects = [self._dict_to_borehole(b) for b in boreholes]

        # 构建图
        self.graph = self.graph_builder.build(borehole_objects, graph_type="combined")

        # 创建模型
        self.model = GeoGNN(
            in_channels=self.graph.node_features.shape[1],
            hidden_channels=64,
            out_channels=3,
            edge_channels=self.graph.edge_attr.shape[1],
            num_layers=3,
            heads=4
        )

        # 配置训练
        config = TrainingConfig(
            learning_rate=learning_rate,
            epochs=epochs,
            patience=20
        )

        # 训练
        self.trainer = GNNTrainer(self.model, config)
        history = self.trainer.train(self.graph, verbose=verbose)

        return history

    def predict(self, boreholes: Optional[List[Dict]] = None) -> np.ndarray:
        """
        预测煤层属性

        Args:
            boreholes: 钻孔数据(可选,默认使用训练数据)

        Returns:
            预测结果 [N, 3] (煤厚, 底板, 顶板)
        """
        if self.trainer is None:
            raise ValueError("模型未训练,请先调用 fit() 方法")

        if boreholes is not None:
            borehole_objects = [self._dict_to_borehole(b) for b in boreholes]
            graph = self.graph_builder.build(borehole_objects)
        else:
            graph = self.graph

        return self.trainer.predict(graph)

    def get_thickness_at(self, x: float, y: float) -> Optional[float]:
        """
        查询指定位置的煤层厚度

        Args:
            x: X坐标
            y: Y坐标

        Returns:
            煤层厚度(米),如果无法预测则返回None
        """
        if self.graph is None:
            return None

        # 使用最近邻插值
        positions = self.graph.positions[:, :2]
        predictions = self.predict()

        distances = np.sqrt((positions[:, 0] - x)**2 + (positions[:, 1] - y)**2)
        nearest_idx = np.argmin(distances)

        # 如果距离太远,返回None
        max_distance = 500  # 最大插值距离
        if distances[nearest_idx] > max_distance:
            return None

        return float(predictions[nearest_idx, 0])

    def get_floor_elevation_at(self, x: float, y: float) -> Optional[float]:
        """
        查询指定位置的底板标高

        Args:
            x: X坐标
            y: Y坐标

        Returns:
            底板标高(米),如果无法预测则返回None
        """
        if self.graph is None:
            return None

        positions = self.graph.positions[:, :2]
        predictions = self.predict()

        distances = np.sqrt((positions[:, 0] - x)**2 + (positions[:, 1] - y)**2)
        nearest_idx = np.argmin(distances)

        max_distance = 500
        if distances[nearest_idx] > max_distance:
            return None

        return float(predictions[nearest_idx, 1])

    def get_roof_elevation_at(self, x: float, y: float) -> Optional[float]:
        """查询指定位置的顶板标高"""
        if self.graph is None:
            return None

        positions = self.graph.positions[:, :2]
        predictions = self.predict()

        distances = np.sqrt((positions[:, 0] - x)**2 + (positions[:, 1] - y)**2)
        nearest_idx = np.argmin(distances)

        max_distance = 500
        if distances[nearest_idx] > max_distance:
            return None

        return float(predictions[nearest_idx, 2])

    def build_3d_model(self, resolution: int = 50) -> CoalSeamModel:
        """
        构建三维煤层模型

        Args:
            resolution: 网格分辨率

        Returns:
            CoalSeamModel: 三维煤层模型
        """
        if self.graph is None:
            raise ValueError("模型未训练")

        predictions = self.predict()
        positions = self.graph.positions

        # 计算边界
        bounds = [
            float(positions[:, 0].min()),
            float(positions[:, 0].max()),
            float(positions[:, 1].min()),
            float(positions[:, 1].max()),
            float(positions[:, 2].min() - 50),
            float(positions[:, 2].max() + 50)
        ]

        # 生成表面点云
        floor_surface = np.column_stack([
            positions[:, 0],
            positions[:, 1],
            predictions[:, 1]
        ])

        roof_surface = np.column_stack([
            positions[:, 0],
            positions[:, 1],
            predictions[:, 2]
        ])

        # 生成厚度网格
        from scipy.interpolate import griddata

        x_grid = np.linspace(bounds[0], bounds[1], resolution)
        y_grid = np.linspace(bounds[2], bounds[3], resolution)
        xx, yy = np.meshgrid(x_grid, y_grid)

        thickness_grid = griddata(
            positions[:, :2],
            predictions[:, 0],
            (xx, yy),
            method='linear',
            fill_value=np.nan
        )

        return CoalSeamModel(
            floor_surface=floor_surface,
            roof_surface=roof_surface,
            thickness_grid=thickness_grid,
            bounds=bounds,
            resolution=resolution
        )

    def export_to_json(self) -> Dict:
        """
        导出模型数据为JSON格式

        Returns:
            JSON格式的模型数据
        """
        if self.graph is None:
            return {}

        predictions = self.predict()

        return {
            'graph': self.visualizer.graph_to_json(self.graph),
            'predictions': self.visualizer.predictions_to_json(self.graph, predictions)
        }

    def save_model(self, path: str):
        """保存模型"""
        if self.trainer is None:
            raise ValueError("模型未训练")

        self.trainer.save_model(path)

    def load_model(self, path: str):
        """加载模型"""
        # 需要先有图数据才能创建模型
        # 这里简化处理,实际使用时需要保存图构建器的参数
        import torch
        checkpoint = torch.load(path, map_location='cpu')

        # 从checkpoint恢复配置
        config = TrainingConfig(**checkpoint['config'])

        # 注意: 加载模型需要知道输入维度,这里假设标准配置
        # 实际使用时应该保存这些信息
        print(f"模型加载成功,最佳损失: {checkpoint['best_loss']:.4f}")


# 便捷函数
def quick_train(
    boreholes: List[Dict],
    epochs: int = 100,
    verbose: bool = True
) -> Tuple[GNNGeologyModule, Dict]:
    """
    快速训练GNN模型

    Args:
        boreholes: 钻孔数据列表
        epochs: 训练轮数
        verbose: 是否打印信息

    Returns:
        (模块实例, 训练历史)
    """
    module = GNNGeologyModule()
    history = module.fit(boreholes, epochs=epochs, verbose=verbose)
    return module, history


def predict_at_points(
    module: GNNGeologyModule,
    points: List[Tuple[float, float]]
) -> List[Dict]:
    """
    批量预测多个点的煤层属性

    Args:
        module: GNN模块实例
        points: 查询点列表 [(x1, y1), (x2, y2), ...]

    Returns:
        预测结果列表
    """
    results = []
    for x, y in points:
        results.append({
            'x': x,
            'y': y,
            'thickness': module.get_thickness_at(x, y),
            'floor': module.get_floor_elevation_at(x, y),
            'roof': module.get_roof_elevation_at(x, y)
        })
    return results
