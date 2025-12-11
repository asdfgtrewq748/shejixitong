"""
损失函数模块
地质建模多任务损失函数
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Dict, Tuple, Optional


class GeoModelingLoss(nn.Module):
    """
    地质建模多任务损失函数

    包含:
    1. 重建损失: 预测值与真实值的MSE
    2. 平滑性损失: 相邻节点预测应相似
    3. 地质约束损失: 满足地质合理性
    """

    def __init__(
        self,
        lambda_smooth: float = 0.1,
        lambda_geo: float = 0.1,
        lambda_gradient: float = 0.05
    ):
        """
        Args:
            lambda_smooth: 平滑性损失权重
            lambda_geo: 地质约束损失权重
            lambda_gradient: 梯度损失权重
        """
        super().__init__()

        self.lambda_smooth = lambda_smooth
        self.lambda_geo = lambda_geo
        self.lambda_gradient = lambda_gradient

    def forward(
        self,
        pred: torch.Tensor,
        target: torch.Tensor,
        edge_index: torch.Tensor,
        positions: Optional[torch.Tensor] = None
    ) -> Tuple[torch.Tensor, Dict[str, float]]:
        """
        计算总损失

        Args:
            pred: [N, 3] 预测值 (煤厚, 底板标高, 顶板标高)
            target: [N, 3] 真实值
            edge_index: [2, E] 边索引
            positions: [N, 3] 节点位置(可选,用于梯度损失)

        Returns:
            total_loss: 总损失
            loss_dict: 各项损失的字典
        """
        # 1. 重建损失 (MSE)
        recon_loss = F.mse_loss(pred, target)

        # 2. 平滑性损失
        smooth_loss = self.smoothness_loss(pred, edge_index)

        # 3. 地质约束损失
        geo_loss = self.geological_constraint_loss(pred)

        # 4. 梯度损失(可选)
        if positions is not None:
            gradient_loss = self.gradient_loss(pred, edge_index, positions)
        else:
            gradient_loss = torch.tensor(0.0, device=pred.device)

        # 总损失
        total_loss = (
            recon_loss +
            self.lambda_smooth * smooth_loss +
            self.lambda_geo * geo_loss +
            self.lambda_gradient * gradient_loss
        )

        loss_dict = {
            'total': total_loss.item(),
            'recon': recon_loss.item(),
            'smooth': smooth_loss.item(),
            'geo': geo_loss.item(),
            'gradient': gradient_loss.item()
        }

        return total_loss, loss_dict

    def smoothness_loss(
        self,
        pred: torch.Tensor,
        edge_index: torch.Tensor
    ) -> torch.Tensor:
        """
        平滑性损失
        相邻节点的预测值应该平滑过渡
        """
        if edge_index.shape[1] == 0:
            return torch.tensor(0.0, device=pred.device)

        src, dst = edge_index

        # 相邻节点预测差异
        diff = pred[src] - pred[dst]

        return (diff ** 2).mean()

    def geological_constraint_loss(self, pred: torch.Tensor) -> torch.Tensor:
        """
        地质约束损失

        约束条件:
        1. 煤厚非负
        2. 顶板标高 > 底板标高
        3. 煤厚应在合理范围内
        """
        thickness = pred[:, 0]  # 煤层厚度
        floor = pred[:, 1]  # 底板标高
        roof = pred[:, 2]  # 顶板标高

        # 1. 非负约束: 煤厚 >= 0
        neg_penalty = F.relu(-thickness).mean()

        # 2. 顶底板关系约束: roof > floor
        # 即 roof - floor > 0, 惩罚 floor - roof > 0 的情况
        relation_penalty = F.relu(floor - roof + 0.1).mean()  # 0.1是最小厚度

        # 3. 厚度一致性约束: thickness ≈ roof - floor
        thickness_consistency = F.mse_loss(thickness, roof - floor)

        # 4. 厚度范围约束: 0 < thickness < 20 (假设最大20米)
        max_thickness = 20.0
        range_penalty = F.relu(thickness - max_thickness).mean()

        return neg_penalty + relation_penalty + thickness_consistency + range_penalty

    def gradient_loss(
        self,
        pred: torch.Tensor,
        edge_index: torch.Tensor,
        positions: torch.Tensor
    ) -> torch.Tensor:
        """
        梯度损失
        限制煤层属性的空间变化率
        """
        if edge_index.shape[1] == 0:
            return torch.tensor(0.0, device=pred.device)

        src, dst = edge_index

        # 计算空间距离
        pos_diff = positions[dst] - positions[src]
        distances = torch.norm(pos_diff[:, :2], dim=1, keepdim=True)  # XY平面距离
        distances = distances.clamp(min=1e-6)

        # 计算属性梯度
        pred_diff = pred[dst] - pred[src]
        gradients = pred_diff / distances

        # 惩罚过大的梯度
        max_gradient = 0.1  # 最大允许梯度
        gradient_penalty = F.relu(gradients.abs() - max_gradient).mean()

        return gradient_penalty


class WeightedMSELoss(nn.Module):
    """
    加权MSE损失
    对不同属性使用不同权重
    """

    def __init__(
        self,
        thickness_weight: float = 1.0,
        floor_weight: float = 1.0,
        roof_weight: float = 1.0
    ):
        super().__init__()

        self.weights = torch.tensor([thickness_weight, floor_weight, roof_weight])

    def forward(self, pred: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
        """计算加权MSE"""
        weights = self.weights.to(pred.device)
        mse = (pred - target) ** 2
        weighted_mse = mse * weights.unsqueeze(0)
        return weighted_mse.mean()


class UncertaintyLoss(nn.Module):
    """
    不确定性感知损失
    同时预测均值和方差
    """

    def __init__(self, min_var: float = 1e-6):
        super().__init__()
        self.min_var = min_var

    def forward(
        self,
        pred_mean: torch.Tensor,
        pred_var: torch.Tensor,
        target: torch.Tensor
    ) -> torch.Tensor:
        """
        计算负对数似然损失

        Args:
            pred_mean: [N, D] 预测均值
            pred_var: [N, D] 预测方差
            target: [N, D] 真实值

        Returns:
            NLL损失
        """
        var = pred_var.clamp(min=self.min_var)

        # 负对数似然
        nll = 0.5 * (torch.log(var) + (target - pred_mean) ** 2 / var)

        return nll.mean()
