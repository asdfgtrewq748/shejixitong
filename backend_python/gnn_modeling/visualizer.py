"""
可视化模块
煤层三维模型可视化
"""

import numpy as np
from typing import List, Optional, Tuple, Dict
import json

from .graph_builder import GraphData, Borehole


class CoalSeamVisualizer:
    """
    煤层三维可视化器
    生成可用于前端展示的数据格式
    """

    def __init__(self):
        pass

    def graph_to_json(self, graph: GraphData) -> Dict:
        """
        将图数据转换为JSON格式(用于前端可视化)

        Args:
            graph: 图数据

        Returns:
            JSON格式的图数据
        """
        nodes = []
        for i, borehole_id in enumerate(graph.borehole_ids):
            nodes.append({
                'id': borehole_id,
                'x': float(graph.positions[i, 0]),
                'y': float(graph.positions[i, 1]),
                'z': float(graph.positions[i, 2]),
                'thickness': float(graph.targets[i, 0]),
                'floor': float(graph.targets[i, 1]),
                'roof': float(graph.targets[i, 2]),
                'features': graph.node_features[i].tolist()
            })

        edges = []
        for i in range(graph.edge_index.shape[1]):
            src, dst = graph.edge_index[0, i], graph.edge_index[1, i]
            edges.append({
                'source': graph.borehole_ids[src],
                'target': graph.borehole_ids[dst],
                'distance': float(graph.edge_attr[i, 0]),
                'azimuth': float(graph.edge_attr[i, 1]),
                'dz': float(graph.edge_attr[i, 2]),
                'gradient': float(graph.edge_attr[i, 3])
            })

        return {
            'nodes': nodes,
            'edges': edges,
            'bounds': {
                'x_min': float(graph.positions[:, 0].min()),
                'x_max': float(graph.positions[:, 0].max()),
                'y_min': float(graph.positions[:, 1].min()),
                'y_max': float(graph.positions[:, 1].max()),
                'z_min': float(graph.positions[:, 2].min()),
                'z_max': float(graph.positions[:, 2].max())
            }
        }

    def predictions_to_json(
        self,
        graph: GraphData,
        predictions: np.ndarray
    ) -> Dict:
        """
        将预测结果转换为JSON格式

        Args:
            graph: 图数据
            predictions: [N, 3] 预测结果

        Returns:
            JSON格式的预测数据
        """
        results = []
        for i, borehole_id in enumerate(graph.borehole_ids):
            results.append({
                'id': borehole_id,
                'x': float(graph.positions[i, 0]),
                'y': float(graph.positions[i, 1]),
                'predicted': {
                    'thickness': float(predictions[i, 0]),
                    'floor': float(predictions[i, 1]),
                    'roof': float(predictions[i, 2])
                },
                'actual': {
                    'thickness': float(graph.targets[i, 0]),
                    'floor': float(graph.targets[i, 1]),
                    'roof': float(graph.targets[i, 2])
                },
                'error': {
                    'thickness': float(abs(predictions[i, 0] - graph.targets[i, 0])),
                    'floor': float(abs(predictions[i, 1] - graph.targets[i, 1])),
                    'roof': float(abs(predictions[i, 2] - graph.targets[i, 2]))
                }
            })

        return {'predictions': results}

    def surface_to_mesh(
        self,
        surface_points: np.ndarray,
        resolution: int = 50
    ) -> Dict:
        """
        将表面点云转换为网格数据(用于Three.js等渲染)

        Args:
            surface_points: [N, 3] 表面点云
            resolution: 网格分辨率

        Returns:
            网格数据(顶点、面、法线)
        """
        if len(surface_points) < 4:
            return {'vertices': [], 'faces': [], 'normals': []}

        # 获取XY范围
        x_min, x_max = surface_points[:, 0].min(), surface_points[:, 0].max()
        y_min, y_max = surface_points[:, 1].min(), surface_points[:, 1].max()

        # 创建规则网格
        x_grid = np.linspace(x_min, x_max, resolution)
        y_grid = np.linspace(y_min, y_max, resolution)

        # 插值到规则网格
        from scipy.interpolate import griddata
        xx, yy = np.meshgrid(x_grid, y_grid)
        zz = griddata(
            surface_points[:, :2],
            surface_points[:, 2],
            (xx, yy),
            method='linear',
            fill_value=np.nan
        )

        # 生成顶点
        vertices = []
        vertex_map = {}

        for i in range(resolution):
            for j in range(resolution):
                if not np.isnan(zz[i, j]):
                    vertex_map[(i, j)] = len(vertices)
                    vertices.append([float(xx[i, j]), float(yy[i, j]), float(zz[i, j])])

        # 生成面(三角形)
        faces = []
        for i in range(resolution - 1):
            for j in range(resolution - 1):
                # 检查四个顶点是否都存在
                if all((i+di, j+dj) in vertex_map for di in [0, 1] for dj in [0, 1]):
                    v00 = vertex_map[(i, j)]
                    v01 = vertex_map[(i, j+1)]
                    v10 = vertex_map[(i+1, j)]
                    v11 = vertex_map[(i+1, j+1)]

                    # 两个三角形
                    faces.append([v00, v10, v01])
                    faces.append([v01, v10, v11])

        # 计算法线
        normals = self._compute_normals(vertices, faces)

        return {
            'vertices': vertices,
            'faces': faces,
            'normals': normals
        }

    def _compute_normals(
        self,
        vertices: List[List[float]],
        faces: List[List[int]]
    ) -> List[List[float]]:
        """计算顶点法线"""
        vertices_np = np.array(vertices)
        normals = np.zeros_like(vertices_np)

        for face in faces:
            v0, v1, v2 = vertices_np[face[0]], vertices_np[face[1]], vertices_np[face[2]]

            # 计算面法线
            edge1 = v1 - v0
            edge2 = v2 - v0
            face_normal = np.cross(edge1, edge2)

            # 累加到顶点法线
            for idx in face:
                normals[idx] += face_normal

        # 归一化
        norms = np.linalg.norm(normals, axis=1, keepdims=True)
        norms[norms == 0] = 1
        normals = normals / norms

        return normals.tolist()

    def generate_contour_data(
        self,
        surface_points: np.ndarray,
        attribute: str = 'z',
        num_levels: int = 10
    ) -> Dict:
        """
        生成等值线数据

        Args:
            surface_points: [N, 3+] 表面点(可包含额外属性)
            attribute: 属性名 ('z' 或列索引)
            num_levels: 等值线数量

        Returns:
            等值线数据
        """
        if attribute == 'z':
            values = surface_points[:, 2]
        else:
            values = surface_points[:, int(attribute)]

        # 计算等值线级别
        v_min, v_max = values.min(), values.max()
        levels = np.linspace(v_min, v_max, num_levels)

        return {
            'points': surface_points[:, :2].tolist(),
            'values': values.tolist(),
            'levels': levels.tolist(),
            'bounds': {
                'x_min': float(surface_points[:, 0].min()),
                'x_max': float(surface_points[:, 0].max()),
                'y_min': float(surface_points[:, 1].min()),
                'y_max': float(surface_points[:, 1].max()),
                'v_min': float(v_min),
                'v_max': float(v_max)
            }
        }

    def training_history_to_json(self, history: Dict) -> Dict:
        """
        将训练历史转换为JSON格式(用于图表展示)

        Args:
            history: 训练历史字典

        Returns:
            JSON格式的训练历史
        """
        epochs = list(range(1, len(history['train_loss']) + 1))

        return {
            'epochs': epochs,
            'train_loss': history['train_loss'],
            'val_loss': history['val_loss'],
            'metrics': history.get('metrics', [])
        }


def plot_training_history(history: Dict, save_path: Optional[str] = None):
    """
    绘制训练历史曲线(需要matplotlib)

    Args:
        history: 训练历史
        save_path: 保存路径(可选)
    """
    try:
        import matplotlib.pyplot as plt

        fig, axes = plt.subplots(1, 2, figsize=(12, 4))

        # 损失曲线
        axes[0].plot(history['train_loss'], label='Train Loss')
        axes[0].plot(history['val_loss'], label='Val Loss')
        axes[0].set_xlabel('Epoch')
        axes[0].set_ylabel('Loss')
        axes[0].set_title('Training Loss')
        axes[0].legend()
        axes[0].grid(True)

        # 指标曲线
        if history.get('metrics'):
            metrics = history['metrics']
            thickness_mae = [m['thickness_mae'] for m in metrics]
            thickness_r2 = [m['thickness_r2'] for m in metrics]

            axes[1].plot(thickness_mae, label='Thickness MAE')
            axes[1].set_xlabel('Epoch')
            axes[1].set_ylabel('MAE')
            axes[1].set_title('Thickness Prediction Error')
            axes[1].legend()
            axes[1].grid(True)

        plt.tight_layout()

        if save_path:
            plt.savefig(save_path, dpi=150, bbox_inches='tight')
        else:
            plt.show()

        plt.close()

    except ImportError:
        print("matplotlib not installed. Skipping plot.")


def plot_prediction_comparison(
    graph: GraphData,
    predictions: np.ndarray,
    save_path: Optional[str] = None
):
    """
    绘制预测对比图(需要matplotlib)

    Args:
        graph: 图数据
        predictions: 预测结果
        save_path: 保存路径(可选)
    """
    try:
        import matplotlib.pyplot as plt

        fig, axes = plt.subplots(1, 3, figsize=(15, 4))

        targets = graph.targets
        attr_names = ['Thickness', 'Floor Elevation', 'Roof Elevation']

        for i, (ax, name) in enumerate(zip(axes, attr_names)):
            actual = targets[:, i]
            pred = predictions[:, i]

            ax.scatter(actual, pred, alpha=0.6, s=20)

            # 对角线
            min_val = min(actual.min(), pred.min())
            max_val = max(actual.max(), pred.max())
            ax.plot([min_val, max_val], [min_val, max_val], 'r--', label='Perfect')

            ax.set_xlabel(f'Actual {name}')
            ax.set_ylabel(f'Predicted {name}')
            ax.set_title(f'{name} Prediction')
            ax.legend()
            ax.grid(True)

            # 计算R2
            ss_res = np.sum((actual - pred) ** 2)
            ss_tot = np.sum((actual - actual.mean()) ** 2)
            r2 = 1 - ss_res / (ss_tot + 1e-10)
            ax.text(0.05, 0.95, f'R² = {r2:.3f}', transform=ax.transAxes, va='top')

        plt.tight_layout()

        if save_path:
            plt.savefig(save_path, dpi=150, bbox_inches='tight')
        else:
            plt.show()

        plt.close()

    except ImportError:
        print("matplotlib not installed. Skipping plot.")
