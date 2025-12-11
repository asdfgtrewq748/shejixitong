"""
GNN煤层建模测试示例 - NumPy版本
不依赖PyTorch,用于验证核心逻辑
"""

import numpy as np
from scipy.spatial import Delaunay, KDTree
from dataclasses import dataclass
from typing import List, Dict, Tuple, Optional
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
    dip_angle: float = 0.0
    dip_direction: float = 0.0


def create_sample_boreholes(n: int = 50, seed: int = 42) -> List[Borehole]:
    """创建示例钻孔数据"""
    np.random.seed(seed)
    boreholes = []

    x_coords = np.random.uniform(0, 2000, n)
    y_coords = np.random.uniform(0, 1500, n)

    for i in range(n):
        x, y = x_coords[i], y_coords[i]
        # 底板标高(带有倾斜趋势)
        z = 500 - 0.05 * x - 0.03 * y + np.random.normal(0, 10)
        # 煤层厚度(带有空间变化)
        thickness = 3.0 + 0.5 * np.sin(x / 500) + 0.3 * np.cos(y / 400) + np.random.normal(0, 0.3)
        thickness = max(0.5, thickness)

        boreholes.append(Borehole(
            id=f"ZK{i+1:03d}",
            x=x, y=y, z=z,
            thickness=thickness,
            dip_angle=np.random.uniform(5, 15),
            dip_direction=np.random.uniform(0, 360)
        ))

    return boreholes


class SimpleGraphBuilder:
    """简化的图构建器"""

    def __init__(self, k_neighbors: int = 6):
        self.k_neighbors = k_neighbors

    def build(self, boreholes: List[Borehole]) -> Dict:
        """构建图数据"""
        n = len(boreholes)
        positions = np.array([[b.x, b.y, b.z] for b in boreholes])
        features = np.array([[b.thickness, b.dip_angle, b.dip_direction] for b in boreholes])

        # 归一化
        pos_min, pos_max = positions.min(0), positions.max(0)
        pos_norm = (positions - pos_min) / (pos_max - pos_min + 1e-6)

        feat_mean, feat_std = features.mean(0), features.std(0)
        feat_norm = (features - feat_mean) / (feat_std + 1e-6)

        # 构建KNN边
        xy = positions[:, :2]
        tree = KDTree(xy)
        edges = []

        for i in range(n):
            _, indices = tree.query(xy[i], k=min(self.k_neighbors + 1, n))
            for j in indices[1:]:
                edges.append([i, j])

        edge_index = np.array(edges).T if edges else np.zeros((2, 0), dtype=int)

        # 计算边特征
        edge_attr = []
        for e in range(edge_index.shape[1]):
            i, j = edge_index[0, e], edge_index[1, e]
            dx = positions[j, 0] - positions[i, 0]
            dy = positions[j, 1] - positions[i, 1]
            dist = np.sqrt(dx**2 + dy**2)
            azimuth = np.arctan2(dy, dx)
            dz = positions[j, 2] - positions[i, 2]
            edge_attr.append([dist, azimuth, dz])

        edge_attr = np.array(edge_attr) if edge_attr else np.zeros((0, 3))

        return {
            'positions': positions,
            'features': np.concatenate([pos_norm, feat_norm], axis=1),
            'targets': np.column_stack([
                [b.thickness for b in boreholes],
                [b.z for b in boreholes],
                [b.z + b.thickness for b in boreholes]
            ]),
            'edge_index': edge_index,
            'edge_attr': edge_attr,
            'ids': [b.id for b in boreholes]
        }


class SimpleGNNPredictor:
    """
    简化的GNN预测器 - 使用加权平均模拟消息传递
    这是一个用于演示的简化版本
    """

    def __init__(self):
        self.weights = None
        self.bias = None

    def fit(self, graph: Dict, epochs: int = 100, lr: float = 0.01) -> Dict:
        """训练模型"""
        features = graph['features']
        targets = graph['targets']
        edge_index = graph['edge_index']

        n_features = features.shape[1]
        n_targets = targets.shape[1]

        # 初始化权重
        np.random.seed(42)
        self.weights = np.random.randn(n_features, n_targets) * 0.1
        self.bias = np.zeros(n_targets)

        history = {'loss': [], 'mae': []}

        print(f"\n开始训练 (epochs={epochs})...")

        for epoch in range(epochs):
            # 前向传播: 简单线性模型 + 邻居聚合
            pred = self._forward(features, edge_index)

            # 计算损失
            loss = np.mean((pred - targets) ** 2)
            mae = np.mean(np.abs(pred - targets))

            # 反向传播 (简化的梯度下降)
            grad = 2 * (pred - targets) / len(targets)
            grad_w = features.T @ grad
            grad_b = grad.mean(0)

            # 更新权重
            self.weights -= lr * grad_w
            self.bias -= lr * grad_b

            history['loss'].append(loss)
            history['mae'].append(mae)

            if (epoch + 1) % 20 == 0:
                print(f"  Epoch {epoch+1:3d}: Loss={loss:.4f}, MAE={mae:.4f}")

        return history

    def _forward(self, features: np.ndarray, edge_index: np.ndarray) -> np.ndarray:
        """前向传播"""
        # 直接预测
        pred = features @ self.weights + self.bias

        # 邻居聚合 (消息传递的简化版)
        if edge_index.shape[1] > 0:
            n = len(features)
            aggregated = np.zeros_like(pred)
            counts = np.zeros(n)

            for e in range(edge_index.shape[1]):
                i, j = edge_index[0, e], edge_index[1, e]
                aggregated[i] += pred[j]
                counts[i] += 1

            # 加权组合
            mask = counts > 0
            aggregated[mask] /= counts[mask, np.newaxis]
            pred = 0.7 * pred + 0.3 * aggregated

        return pred

    def predict(self, graph: Dict) -> np.ndarray:
        """预测"""
        return self._forward(graph['features'], graph['edge_index'])


def main():
    """主函数"""
    print("=" * 60)
    print("GNN煤层三维建模测试 (NumPy简化版)")
    print("=" * 60)

    # 1. 创建数据
    print("\n[1] 创建示例钻孔数据...")
    boreholes = create_sample_boreholes(n=100, seed=42)
    print(f"    钻孔数量: {len(boreholes)}")
    print(f"    示例: {boreholes[0]}")

    # 2. 构建图
    print("\n[2] 构建图数据...")
    builder = SimpleGraphBuilder(k_neighbors=6)
    graph = builder.build(boreholes)
    print(f"    节点数: {len(graph['ids'])}")
    print(f"    边数: {graph['edge_index'].shape[1]}")
    print(f"    特征维度: {graph['features'].shape[1]}")

    # 3. 训练模型
    print("\n[3] 训练模型...")
    model = SimpleGNNPredictor()
    history = model.fit(graph, epochs=100, lr=0.01)

    # 4. 预测
    print("\n[4] 进行预测...")
    predictions = model.predict(graph)
    targets = graph['targets']

    # 计算误差
    mae = np.mean(np.abs(predictions - targets), axis=0)
    rmse = np.sqrt(np.mean((predictions - targets) ** 2, axis=0))

    print(f"\n    预测误差:")
    print(f"    煤厚 - MAE: {mae[0]:.3f}m, RMSE: {rmse[0]:.3f}m")
    print(f"    底板 - MAE: {mae[1]:.3f}m, RMSE: {rmse[1]:.3f}m")
    print(f"    顶板 - MAE: {mae[2]:.3f}m, RMSE: {rmse[2]:.3f}m")

    # 5. 计算R2
    for i, name in enumerate(['Thickness', 'Floor', 'Roof']):
        ss_res = np.sum((targets[:, i] - predictions[:, i]) ** 2)
        ss_tot = np.sum((targets[:, i] - targets[:, i].mean()) ** 2)
        r2 = 1 - ss_res / (ss_tot + 1e-10)
        print(f"    {name} R2: {r2:.3f}")

    # 6. 保存结果
    print("\n[5] 保存结果...")
    output_dir = os.path.dirname(os.path.abspath(__file__))

    results = {
        'boreholes': [
            {
                'id': b.id,
                'x': b.x,
                'y': b.y,
                'z': b.z,
                'thickness': b.thickness,
                'predicted_thickness': float(predictions[i, 0]),
                'predicted_floor': float(predictions[i, 1]),
                'predicted_roof': float(predictions[i, 2])
            }
            for i, b in enumerate(boreholes)
        ],
        'metrics': {
            'thickness_mae': float(mae[0]),
            'thickness_rmse': float(rmse[0]),
            'floor_mae': float(mae[1]),
            'floor_rmse': float(rmse[1]),
            'roof_mae': float(mae[2]),
            'roof_rmse': float(rmse[2])
        },
        'graph_info': {
            'num_nodes': len(graph['ids']),
            'num_edges': int(graph['edge_index'].shape[1]),
            'feature_dim': int(graph['features'].shape[1])
        }
    }

    with open(os.path.join(output_dir, 'test_results.json'), 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"    结果已保存到: {output_dir}/test_results.json")

    # 7. 可视化训练曲线
    print("\n[6] 生成可视化...")
    try:
        import matplotlib.pyplot as plt

        fig, axes = plt.subplots(1, 2, figsize=(12, 4))

        # 损失曲线
        axes[0].plot(history['loss'], 'b-', label='Loss')
        axes[0].set_xlabel('Epoch')
        axes[0].set_ylabel('MSE Loss')
        axes[0].set_title('Training Loss')
        axes[0].legend()
        axes[0].grid(True)

        # 预测对比
        axes[1].scatter(targets[:, 0], predictions[:, 0], alpha=0.6, s=20)
        min_val = min(targets[:, 0].min(), predictions[:, 0].min())
        max_val = max(targets[:, 0].max(), predictions[:, 0].max())
        axes[1].plot([min_val, max_val], [min_val, max_val], 'r--', label='Perfect')
        axes[1].set_xlabel('Actual Thickness (m)')
        axes[1].set_ylabel('Predicted Thickness (m)')
        axes[1].set_title('Thickness Prediction')
        axes[1].legend()
        axes[1].grid(True)

        plt.tight_layout()
        plt.savefig(os.path.join(output_dir, 'test_plot.png'), dpi=150)
        print(f"    图表已保存: {output_dir}/test_plot.png")
        plt.close()

    except Exception as e:
        print(f"    可视化跳过: {e}")

    print("\n" + "=" * 60)
    print("测试完成!")
    print("=" * 60)

    return graph, predictions


if __name__ == "__main__":
    main()
