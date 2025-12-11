"""
GNN煤层建模测试 - 改进版
使用更好的特征工程和IDW插值作为基线
"""

import numpy as np
from scipy.spatial import KDTree
from scipy.interpolate import Rbf
from dataclasses import dataclass
from typing import List, Dict
import json
import os


@dataclass
class Borehole:
    """钻孔数据类"""
    id: str
    x: float
    y: float
    z: float  # 底板标高
    thickness: float


def create_sample_boreholes(n: int = 50, seed: int = 42) -> List[Borehole]:
    """创建示例钻孔数据(带有空间相关性)"""
    np.random.seed(seed)
    boreholes = []

    x_coords = np.random.uniform(0, 2000, n)
    y_coords = np.random.uniform(0, 1500, n)

    for i in range(n):
        x, y = x_coords[i], y_coords[i]
        # 底板标高 - 带有倾斜趋势和随机扰动
        z = 500 - 0.05 * x - 0.03 * y + np.random.normal(0, 5)
        # 煤层厚度 - 带有空间变化规律
        thickness = 3.0 + 0.5 * np.sin(x / 500) + 0.3 * np.cos(y / 400) + np.random.normal(0, 0.2)
        thickness = max(0.5, thickness)

        boreholes.append(Borehole(
            id=f"ZK{i+1:03d}",
            x=x, y=y, z=z,
            thickness=thickness
        ))

    return boreholes


class GraphBasedPredictor:
    """
    基于图的预测器
    使用消息传递思想进行空间插值
    """

    def __init__(self, k_neighbors: int = 8):
        self.k = k_neighbors
        self.tree = None
        self.positions = None
        self.values = None

    def fit(self, boreholes: List[Borehole]):
        """构建空间索引"""
        self.positions = np.array([[b.x, b.y] for b in boreholes])
        self.values = np.array([
            [b.thickness, b.z, b.z + b.thickness]
            for b in boreholes
        ])
        self.tree = KDTree(self.positions)

    def predict_at(self, x: float, y: float) -> np.ndarray:
        """
        在指定位置预测
        使用加权邻居聚合(类似GNN的消息传递)
        """
        query = np.array([x, y])
        distances, indices = self.tree.query(query, k=self.k)

        # 避免除零
        distances = np.maximum(distances, 1e-6)

        # 反距离加权
        weights = 1.0 / distances ** 2
        weights = weights / weights.sum()

        # 加权平均
        prediction = np.zeros(3)
        for i, idx in enumerate(indices):
            prediction += weights[i] * self.values[idx]

        return prediction

    def predict(self, boreholes: List[Borehole]) -> np.ndarray:
        """对所有钻孔进行交叉验证预测"""
        predictions = []

        for i, b in enumerate(boreholes):
            # 临时移除当前点
            temp_positions = np.delete(self.positions, i, axis=0)
            temp_values = np.delete(self.values, i, axis=0)

            # 使用剩余点预测
            query = np.array([b.x, b.y])
            tree = KDTree(temp_positions)
            distances, indices = tree.query(query, k=min(self.k, len(temp_positions)))

            distances = np.maximum(distances, 1e-6)
            weights = 1.0 / distances ** 2
            weights = weights / weights.sum()

            pred = np.zeros(3)
            for j, idx in enumerate(indices):
                pred += weights[j] * temp_values[idx]

            predictions.append(pred)

        return np.array(predictions)


class RBFInterpolator:
    """径向基函数插值器"""

    def __init__(self, function: str = 'multiquadric'):
        self.function = function
        self.rbf_models = []

    def fit(self, boreholes: List[Borehole]):
        """拟合RBF模型"""
        x = np.array([b.x for b in boreholes])
        y = np.array([b.y for b in boreholes])

        targets = [
            np.array([b.thickness for b in boreholes]),
            np.array([b.z for b in boreholes]),
            np.array([b.z + b.thickness for b in boreholes])
        ]

        self.rbf_models = []
        for t in targets:
            rbf = Rbf(x, y, t, function=self.function)
            self.rbf_models.append(rbf)

    def predict_at(self, x: float, y: float) -> np.ndarray:
        """预测单点"""
        return np.array([rbf(x, y) for rbf in self.rbf_models])

    def predict(self, boreholes: List[Borehole]) -> np.ndarray:
        """预测所有点"""
        x = np.array([b.x for b in boreholes])
        y = np.array([b.y for b in boreholes])
        return np.column_stack([rbf(x, y) for rbf in self.rbf_models])


def evaluate_model(predictions: np.ndarray, targets: np.ndarray) -> Dict:
    """评估模型性能"""
    metrics = {}
    names = ['thickness', 'floor', 'roof']

    for i, name in enumerate(names):
        pred = predictions[:, i]
        true = targets[:, i]

        mae = np.mean(np.abs(pred - true))
        rmse = np.sqrt(np.mean((pred - true) ** 2))
        ss_res = np.sum((true - pred) ** 2)
        ss_tot = np.sum((true - true.mean()) ** 2)
        r2 = 1 - ss_res / (ss_tot + 1e-10)

        metrics[f'{name}_mae'] = mae
        metrics[f'{name}_rmse'] = rmse
        metrics[f'{name}_r2'] = r2

    return metrics


def main():
    print("=" * 60)
    print("GNN煤层建模测试 - 改进版")
    print("=" * 60)

    # 1. 创建数据
    print("\n[1] 创建钻孔数据...")
    boreholes = create_sample_boreholes(n=100, seed=42)
    print(f"    钻孔数量: {len(boreholes)}")

    # 获取真实值
    targets = np.array([
        [b.thickness, b.z, b.z + b.thickness]
        for b in boreholes
    ])

    # 2. 图基础预测器 (模拟GNN消息传递)
    print("\n[2] 图基础预测器 (K=8邻居加权)...")
    graph_pred = GraphBasedPredictor(k_neighbors=8)
    graph_pred.fit(boreholes)
    pred_graph = graph_pred.predict(boreholes)
    metrics_graph = evaluate_model(pred_graph, targets)

    print(f"    Thickness - MAE: {metrics_graph['thickness_mae']:.3f}m, "
          f"RMSE: {metrics_graph['thickness_rmse']:.3f}m, "
          f"R2: {metrics_graph['thickness_r2']:.3f}")
    print(f"    Floor     - MAE: {metrics_graph['floor_mae']:.3f}m, "
          f"RMSE: {metrics_graph['floor_rmse']:.3f}m, "
          f"R2: {metrics_graph['floor_r2']:.3f}")

    # 3. RBF插值 (对比基线)
    print("\n[3] RBF插值 (对比基线)...")
    rbf_pred = RBFInterpolator(function='multiquadric')
    rbf_pred.fit(boreholes)
    pred_rbf = rbf_pred.predict(boreholes)
    metrics_rbf = evaluate_model(pred_rbf, targets)

    print(f"    Thickness - MAE: {metrics_rbf['thickness_mae']:.3f}m, "
          f"RMSE: {metrics_rbf['thickness_rmse']:.3f}m, "
          f"R2: {metrics_rbf['thickness_r2']:.3f}")
    print(f"    Floor     - MAE: {metrics_rbf['floor_mae']:.3f}m, "
          f"RMSE: {metrics_rbf['floor_rmse']:.3f}m, "
          f"R2: {metrics_rbf['floor_r2']:.3f}")

    # 4. 在新位置预测
    print("\n[4] 在新位置预测示例...")
    test_points = [(500, 400), (1000, 800), (1500, 1100)]

    for x, y in test_points:
        pred = graph_pred.predict_at(x, y)
        print(f"    ({x}, {y}): Thickness={pred[0]:.2f}m, "
              f"Floor={pred[1]:.1f}m, Roof={pred[2]:.1f}m")

    # 5. 保存结果
    print("\n[5] 保存结果...")
    output_dir = os.path.dirname(os.path.abspath(__file__))

    results = {
        'graph_predictor': metrics_graph,
        'rbf_baseline': metrics_rbf,
        'sample_predictions': [
            {'x': x, 'y': y, 'prediction': graph_pred.predict_at(x, y).tolist()}
            for x, y in test_points
        ],
        'num_boreholes': len(boreholes)
    }

    with open(os.path.join(output_dir, 'test_results_v2.json'), 'w') as f:
        json.dump(results, f, indent=2)

    # 6. 可视化
    print("\n[6] 生成可视化...")
    try:
        import matplotlib.pyplot as plt

        fig, axes = plt.subplots(2, 2, figsize=(12, 10))

        # 钻孔分布和煤厚
        ax = axes[0, 0]
        positions = np.array([[b.x, b.y] for b in boreholes])
        thicknesses = np.array([b.thickness for b in boreholes])
        scatter = ax.scatter(positions[:, 0], positions[:, 1], c=thicknesses,
                            cmap='YlOrRd', s=50, edgecolors='k', linewidth=0.5)
        plt.colorbar(scatter, ax=ax, label='Thickness (m)')
        ax.set_xlabel('X (m)')
        ax.set_ylabel('Y (m)')
        ax.set_title('Borehole Distribution - Coal Thickness')
        ax.grid(True, alpha=0.3)

        # 底板标高
        ax = axes[0, 1]
        floors = np.array([b.z for b in boreholes])
        scatter = ax.scatter(positions[:, 0], positions[:, 1], c=floors,
                            cmap='viridis', s=50, edgecolors='k', linewidth=0.5)
        plt.colorbar(scatter, ax=ax, label='Floor Elevation (m)')
        ax.set_xlabel('X (m)')
        ax.set_ylabel('Y (m)')
        ax.set_title('Borehole Distribution - Floor Elevation')
        ax.grid(True, alpha=0.3)

        # 预测对比 - 厚度
        ax = axes[1, 0]
        ax.scatter(targets[:, 0], pred_graph[:, 0], alpha=0.7, s=30, label='Graph-based')
        ax.scatter(targets[:, 0], pred_rbf[:, 0], alpha=0.5, s=30, marker='^', label='RBF')
        lims = [min(targets[:, 0].min(), pred_graph[:, 0].min()) - 0.2,
                max(targets[:, 0].max(), pred_graph[:, 0].max()) + 0.2]
        ax.plot(lims, lims, 'r--', label='Perfect')
        ax.set_xlabel('Actual Thickness (m)')
        ax.set_ylabel('Predicted Thickness (m)')
        ax.set_title(f'Thickness Prediction (Graph R2={metrics_graph["thickness_r2"]:.3f})')
        ax.legend()
        ax.grid(True, alpha=0.3)

        # 预测对比 - 底板
        ax = axes[1, 1]
        ax.scatter(targets[:, 1], pred_graph[:, 1], alpha=0.7, s=30, label='Graph-based')
        ax.scatter(targets[:, 1], pred_rbf[:, 1], alpha=0.5, s=30, marker='^', label='RBF')
        lims = [targets[:, 1].min() - 5, targets[:, 1].max() + 5]
        ax.plot(lims, lims, 'r--', label='Perfect')
        ax.set_xlabel('Actual Floor Elevation (m)')
        ax.set_ylabel('Predicted Floor Elevation (m)')
        ax.set_title(f'Floor Prediction (Graph R2={metrics_graph["floor_r2"]:.3f})')
        ax.legend()
        ax.grid(True, alpha=0.3)

        plt.tight_layout()
        plt.savefig(os.path.join(output_dir, 'test_plot_v2.png'), dpi=150)
        print(f"    Saved: {output_dir}/test_plot_v2.png")
        plt.close()

    except Exception as e:
        print(f"    Visualization skipped: {e}")

    print("\n" + "=" * 60)
    print("Test completed!")
    print("=" * 60)


if __name__ == "__main__":
    main()
