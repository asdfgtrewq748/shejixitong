"""
训练模块
GNN模型训练器
"""

import torch
import torch.nn as nn
import torch.optim as optim
from torch.optim.lr_scheduler import ReduceLROnPlateau, CosineAnnealingLR
import numpy as np
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
import json
import os

from .graph_builder import GraphData
from .model import GeoGNN
from .loss import GeoModelingLoss


@dataclass
class TrainingConfig:
    """训练配置"""
    learning_rate: float = 0.001
    weight_decay: float = 1e-4
    epochs: int = 200
    patience: int = 20  # 早停耐心值
    min_lr: float = 1e-6
    batch_size: int = 1  # 图级别batch
    device: str = "cuda" if torch.cuda.is_available() else "cpu"

    # 损失函数权重
    lambda_smooth: float = 0.1
    lambda_geo: float = 0.1
    lambda_gradient: float = 0.05


class GNNTrainer:
    """
    GNN模型训练器
    """

    def __init__(
        self,
        model: GeoGNN,
        config: Optional[TrainingConfig] = None
    ):
        """
        Args:
            model: GNN模型
            config: 训练配置
        """
        self.model = model
        self.config = config or TrainingConfig()

        # 移动模型到设备
        self.device = torch.device(self.config.device)
        self.model = self.model.to(self.device)

        # 损失函数
        self.criterion = GeoModelingLoss(
            lambda_smooth=self.config.lambda_smooth,
            lambda_geo=self.config.lambda_geo,
            lambda_gradient=self.config.lambda_gradient
        )

        # 优化器
        self.optimizer = optim.AdamW(
            self.model.parameters(),
            lr=self.config.learning_rate,
            weight_decay=self.config.weight_decay
        )

        # 学习率调度器
        self.scheduler = ReduceLROnPlateau(
            self.optimizer,
            mode='min',
            factor=0.5,
            patience=10,
            min_lr=self.config.min_lr
        )

        # 训练历史
        self.history = {
            'train_loss': [],
            'val_loss': [],
            'metrics': []
        }

        # 最佳模型状态
        self.best_loss = float('inf')
        self.best_state = None
        self.patience_counter = 0

    def _to_tensor(self, graph: GraphData) -> Tuple[torch.Tensor, ...]:
        """将GraphData转换为张量"""
        x = torch.tensor(graph.node_features, dtype=torch.float32).to(self.device)
        edge_index = torch.tensor(graph.edge_index, dtype=torch.long).to(self.device)
        edge_attr = torch.tensor(graph.edge_attr, dtype=torch.float32).to(self.device)
        positions = torch.tensor(graph.positions, dtype=torch.float32).to(self.device)
        targets = torch.tensor(graph.targets, dtype=torch.float32).to(self.device)

        return x, edge_index, edge_attr, positions, targets

    def train_epoch(self, train_graph: GraphData) -> Dict[str, float]:
        """
        训练一个epoch

        Args:
            train_graph: 训练图数据

        Returns:
            损失字典
        """
        self.model.train()

        x, edge_index, edge_attr, positions, targets = self._to_tensor(train_graph)

        # 前向传播
        self.optimizer.zero_grad()
        pred = self.model(x, edge_index, edge_attr)

        # 计算损失
        loss, loss_dict = self.criterion(pred, targets, edge_index, positions)

        # 反向传播
        loss.backward()

        # 梯度裁剪
        torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=1.0)

        self.optimizer.step()

        return loss_dict

    def validate(self, val_graph: GraphData) -> Tuple[Dict[str, float], Dict[str, float]]:
        """
        验证

        Args:
            val_graph: 验证图数据

        Returns:
            损失字典, 指标字典
        """
        self.model.eval()

        x, edge_index, edge_attr, positions, targets = self._to_tensor(val_graph)

        with torch.no_grad():
            pred = self.model(x, edge_index, edge_attr)
            loss, loss_dict = self.criterion(pred, targets, edge_index, positions)

            # 计算评估指标
            metrics = self._compute_metrics(pred, targets)

        return loss_dict, metrics

    def _compute_metrics(
        self,
        pred: torch.Tensor,
        target: torch.Tensor
    ) -> Dict[str, float]:
        """计算评估指标"""
        pred_np = pred.cpu().numpy()
        target_np = target.cpu().numpy()

        metrics = {}

        # 各属性的MAE和RMSE
        attr_names = ['thickness', 'floor', 'roof']

        for i, name in enumerate(attr_names):
            mae = np.mean(np.abs(pred_np[:, i] - target_np[:, i]))
            rmse = np.sqrt(np.mean((pred_np[:, i] - target_np[:, i]) ** 2))
            r2 = 1 - np.sum((pred_np[:, i] - target_np[:, i]) ** 2) / \
                     (np.sum((target_np[:, i] - target_np[:, i].mean()) ** 2) + 1e-10)

            metrics[f'{name}_mae'] = mae
            metrics[f'{name}_rmse'] = rmse
            metrics[f'{name}_r2'] = r2

        # 总体指标
        metrics['overall_mae'] = np.mean(np.abs(pred_np - target_np))
        metrics['overall_rmse'] = np.sqrt(np.mean((pred_np - target_np) ** 2))

        return metrics

    def train(
        self,
        train_graph: GraphData,
        val_graph: Optional[GraphData] = None,
        verbose: bool = True
    ) -> Dict:
        """
        完整训练流程

        Args:
            train_graph: 训练图数据
            val_graph: 验证图数据(可选)
            verbose: 是否打印训练信息

        Returns:
            训练历史
        """
        if val_graph is None:
            val_graph = train_graph

        for epoch in range(self.config.epochs):
            # 训练
            train_loss = self.train_epoch(train_graph)
            self.history['train_loss'].append(train_loss['total'])

            # 验证
            val_loss, metrics = self.validate(val_graph)
            self.history['val_loss'].append(val_loss['total'])
            self.history['metrics'].append(metrics)

            # 学习率调度
            self.scheduler.step(val_loss['total'])

            # 早停检查
            if val_loss['total'] < self.best_loss:
                self.best_loss = val_loss['total']
                self.best_state = {k: v.cpu().clone() for k, v in self.model.state_dict().items()}
                self.patience_counter = 0
            else:
                self.patience_counter += 1

            # 打印信息
            if verbose and (epoch + 1) % 10 == 0:
                lr = self.optimizer.param_groups[0]['lr']
                print(f"Epoch {epoch+1}/{self.config.epochs}")
                print(f"  Train Loss: {train_loss['total']:.4f} (recon: {train_loss['recon']:.4f}, "
                      f"smooth: {train_loss['smooth']:.4f}, geo: {train_loss['geo']:.4f})")
                print(f"  Val Loss: {val_loss['total']:.4f}")
                print(f"  Thickness - MAE: {metrics['thickness_mae']:.3f}, RMSE: {metrics['thickness_rmse']:.3f}, R2: {metrics['thickness_r2']:.3f}")
                print(f"  LR: {lr:.6f}")

            # 早停
            if self.patience_counter >= self.config.patience:
                if verbose:
                    print(f"Early stopping at epoch {epoch+1}")
                break

        # 恢复最佳模型
        if self.best_state is not None:
            self.model.load_state_dict(self.best_state)

        return self.history

    def predict(self, graph: GraphData) -> np.ndarray:
        """
        预测

        Args:
            graph: 图数据

        Returns:
            预测结果 [N, 3]
        """
        self.model.eval()

        x, edge_index, edge_attr, _, _ = self._to_tensor(graph)

        with torch.no_grad():
            pred = self.model(x, edge_index, edge_attr)

        return pred.cpu().numpy()

    def save_model(self, path: str):
        """保存模型"""
        torch.save({
            'model_state_dict': self.model.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict(),
            'config': self.config.__dict__,
            'history': self.history,
            'best_loss': self.best_loss
        }, path)

    def load_model(self, path: str):
        """加载模型"""
        checkpoint = torch.load(path, map_location=self.device)
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
        self.history = checkpoint['history']
        self.best_loss = checkpoint['best_loss']


def train_test_split_graph(
    graph: GraphData,
    test_ratio: float = 0.2,
    seed: int = 42
) -> Tuple[GraphData, GraphData]:
    """
    将图数据分割为训练集和测试集

    注意: 这里使用节点掩码方式,保持图结构完整

    Args:
        graph: 原始图数据
        test_ratio: 测试集比例
        seed: 随机种子

    Returns:
        训练图, 测试图
    """
    np.random.seed(seed)

    n_nodes = len(graph.borehole_ids)
    n_test = int(n_nodes * test_ratio)

    # 随机选择测试节点
    indices = np.random.permutation(n_nodes)
    test_indices = set(indices[:n_test])
    train_indices = set(indices[n_test:])

    # 创建训练图(只保留训练节点的目标值)
    train_targets = graph.targets.copy()
    for i in test_indices:
        train_targets[i] = np.nan  # 测试节点的目标值设为NaN

    train_graph = GraphData(
        node_features=graph.node_features,
        edge_index=graph.edge_index,
        edge_attr=graph.edge_attr,
        positions=graph.positions,
        targets=train_targets,
        borehole_ids=graph.borehole_ids
    )

    # 测试图保持原样
    test_graph = graph

    return train_graph, test_graph, list(train_indices), list(test_indices)
