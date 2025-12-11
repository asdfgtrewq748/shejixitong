"""
GNN地质建模路由
提供基于图神经网络的煤层三维建模API
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Optional, Any
import numpy as np
from scipy.spatial import KDTree

from store import store

router = APIRouter()


# ============== 数据模型 ==============

class BoreholeInput(BaseModel):
    """钻孔输入数据"""
    id: str
    x: float
    y: float
    z: Optional[float] = None  # 底板标高
    thickness: Optional[float] = None  # 煤层厚度
    dip_angle: Optional[float] = 0.0
    dip_direction: Optional[float] = 0.0


class TrainRequest(BaseModel):
    """训练请求"""
    epochs: int = 100
    k_neighbors: int = 8


class PredictPointRequest(BaseModel):
    """单点预测请求"""
    x: float
    y: float


class PredictBatchRequest(BaseModel):
    """批量预测请求"""
    points: List[Dict[str, float]]


# ============== 简化的图基础预测器 ==============

class GraphBasedGeologyPredictor:
    """
    基于图的地质预测器
    使用消息传递思想进行空间插值
    (简化版,不依赖PyTorch)
    """

    def __init__(self, k_neighbors: int = 8):
        self.k = k_neighbors
        self.tree = None
        self.positions = None
        self.values = None
        self.is_trained = False

    def fit(self, boreholes: List[Dict]):
        """训练模型"""
        if len(boreholes) < 3:
            raise ValueError("钻孔数量不足,至少需要3个")

        self.positions = np.array([[b['x'], b['y']] for b in boreholes])

        # 提取目标值
        self.values = []
        for b in boreholes:
            thickness = b.get('coalThickness', b.get('thickness', 3.0))
            floor = b.get('floorElevation', b.get('z', 0))
            roof = floor + thickness
            self.values.append([thickness, floor, roof])

        self.values = np.array(self.values)
        self.tree = KDTree(self.positions)
        self.is_trained = True

        return {
            'num_boreholes': len(boreholes),
            'num_features': 3,
            'bounds': {
                'x_min': float(self.positions[:, 0].min()),
                'x_max': float(self.positions[:, 0].max()),
                'y_min': float(self.positions[:, 1].min()),
                'y_max': float(self.positions[:, 1].max())
            }
        }

    def predict_at(self, x: float, y: float) -> Dict[str, float]:
        """在指定位置预测"""
        if not self.is_trained:
            raise ValueError("模型未训练")

        query = np.array([x, y])
        k = min(self.k, len(self.positions))
        distances, indices = self.tree.query(query, k=k)

        # 避免除零
        distances = np.maximum(distances, 1e-6)

        # 反距离加权
        weights = 1.0 / distances ** 2
        weights = weights / weights.sum()

        # 加权平均
        prediction = np.zeros(3)
        for i, idx in enumerate(indices):
            prediction += weights[i] * self.values[idx]

        return {
            'thickness': float(prediction[0]),
            'floor': float(prediction[1]),
            'roof': float(prediction[2]),
            'confidence': float(1.0 / (1.0 + distances.min() / 100))  # 基于距离的置信度
        }

    def predict_batch(self, points: List[Dict[str, float]]) -> List[Dict]:
        """批量预测"""
        return [self.predict_at(p['x'], p['y']) for p in points]

    def generate_grid(self, resolution: int = 50) -> Dict:
        """生成网格预测"""
        if not self.is_trained:
            raise ValueError("模型未训练")

        x_min, x_max = self.positions[:, 0].min(), self.positions[:, 0].max()
        y_min, y_max = self.positions[:, 1].min(), self.positions[:, 1].max()

        x_grid = np.linspace(x_min, x_max, resolution)
        y_grid = np.linspace(y_min, y_max, resolution)

        thickness_grid = np.zeros((resolution, resolution))
        floor_grid = np.zeros((resolution, resolution))
        roof_grid = np.zeros((resolution, resolution))

        for i, x in enumerate(x_grid):
            for j, y in enumerate(y_grid):
                pred = self.predict_at(x, y)
                thickness_grid[i, j] = pred['thickness']
                floor_grid[i, j] = pred['floor']
                roof_grid[i, j] = pred['roof']

        return {
            'resolution': resolution,
            'bounds': {
                'x_min': float(x_min),
                'x_max': float(x_max),
                'y_min': float(y_min),
                'y_max': float(y_max)
            },
            'thickness': thickness_grid.tolist(),
            'floor': floor_grid.tolist(),
            'roof': roof_grid.tolist()
        }

    def cross_validate(self) -> Dict[str, float]:
        """交叉验证评估"""
        if not self.is_trained:
            raise ValueError("模型未训练")

        predictions = []
        for i in range(len(self.positions)):
            # 临时移除当前点
            temp_positions = np.delete(self.positions, i, axis=0)
            temp_values = np.delete(self.values, i, axis=0)

            query = self.positions[i]
            tree = KDTree(temp_positions)
            k = min(self.k, len(temp_positions))
            distances, indices = tree.query(query, k=k)

            distances = np.maximum(distances, 1e-6)
            weights = 1.0 / distances ** 2
            weights = weights / weights.sum()

            pred = np.zeros(3)
            for j, idx in enumerate(indices):
                pred += weights[j] * temp_values[idx]

            predictions.append(pred)

        predictions = np.array(predictions)
        targets = self.values

        # 计算指标
        metrics = {}
        names = ['thickness', 'floor', 'roof']

        for i, name in enumerate(names):
            mae = np.mean(np.abs(predictions[:, i] - targets[:, i]))
            rmse = np.sqrt(np.mean((predictions[:, i] - targets[:, i]) ** 2))
            ss_res = np.sum((targets[:, i] - predictions[:, i]) ** 2)
            ss_tot = np.sum((targets[:, i] - targets[:, i].mean()) ** 2)
            r2 = 1 - ss_res / (ss_tot + 1e-10)

            metrics[f'{name}_mae'] = round(mae, 4)
            metrics[f'{name}_rmse'] = round(rmse, 4)
            metrics[f'{name}_r2'] = round(r2, 4)

        return metrics


# 全局预测器实例
gnn_predictor = GraphBasedGeologyPredictor()


# ============== API 路由 ==============

@router.post("/train")
async def train_gnn_model(request: TrainRequest):
    """
    训练GNN地质模型

    使用当前项目的钻孔数据训练模型
    """
    if not store.boreholes:
        raise HTTPException(status_code=400, detail="缺少钻孔数据,请先上传钻孔数据")

    try:
        gnn_predictor.k = request.k_neighbors
        result = gnn_predictor.fit(store.boreholes)

        # 进行交叉验证
        metrics = gnn_predictor.cross_validate()

        return {
            'success': True,
            'message': 'GNN模型训练完成',
            'model_info': result,
            'metrics': metrics
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"训练失败: {str(e)}")


@router.post("/predict/point")
async def predict_point(request: PredictPointRequest):
    """
    单点预测

    在指定位置预测煤层属性
    """
    if not gnn_predictor.is_trained:
        # 自动训练
        if store.boreholes:
            gnn_predictor.fit(store.boreholes)
        else:
            raise HTTPException(status_code=400, detail="模型未训练且无钻孔数据")

    try:
        prediction = gnn_predictor.predict_at(request.x, request.y)
        return {
            'success': True,
            'x': request.x,
            'y': request.y,
            'prediction': prediction
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"预测失败: {str(e)}")


@router.post("/predict/batch")
async def predict_batch(request: PredictBatchRequest):
    """
    批量预测

    对多个位置进行预测
    """
    if not gnn_predictor.is_trained:
        if store.boreholes:
            gnn_predictor.fit(store.boreholes)
        else:
            raise HTTPException(status_code=400, detail="模型未训练且无钻孔数据")

    try:
        predictions = gnn_predictor.predict_batch(request.points)
        return {
            'success': True,
            'count': len(predictions),
            'predictions': [
                {'x': p['x'], 'y': p['y'], **pred}
                for p, pred in zip(request.points, predictions)
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"预测失败: {str(e)}")


@router.post("/grid")
async def generate_grid_model(resolution: int = 50):
    """
    生成网格模型

    生成指定分辨率的煤层属性网格
    """
    if not gnn_predictor.is_trained:
        if store.boreholes:
            gnn_predictor.fit(store.boreholes)
        else:
            raise HTTPException(status_code=400, detail="模型未训练且无钻孔数据")

    try:
        grid = gnn_predictor.generate_grid(resolution)

        return {
            'success': True,
            'message': f'网格模型生成完成 ({resolution}x{resolution})',
            'model': grid
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成失败: {str(e)}")


@router.get("/model")
async def get_gnn_model():
    """
    获取当前GNN模型信息
    """
    if not gnn_predictor.is_trained:
        return {
            'is_trained': False,
            'message': '模型未训练'
        }

    return {
        'is_trained': True,
        'k_neighbors': gnn_predictor.k,
        'num_boreholes': len(gnn_predictor.positions),
        'bounds': {
            'x_min': float(gnn_predictor.positions[:, 0].min()),
            'x_max': float(gnn_predictor.positions[:, 0].max()),
            'y_min': float(gnn_predictor.positions[:, 1].min()),
            'y_max': float(gnn_predictor.positions[:, 1].max())
        },
        'value_ranges': {
            'thickness': {
                'min': float(gnn_predictor.values[:, 0].min()),
                'max': float(gnn_predictor.values[:, 0].max()),
                'mean': float(gnn_predictor.values[:, 0].mean())
            },
            'floor': {
                'min': float(gnn_predictor.values[:, 1].min()),
                'max': float(gnn_predictor.values[:, 1].max()),
                'mean': float(gnn_predictor.values[:, 1].mean())
            }
        }
    }


@router.get("/metrics")
async def get_model_metrics():
    """
    获取模型评估指标
    """
    if not gnn_predictor.is_trained:
        raise HTTPException(status_code=400, detail="模型未训练")

    try:
        metrics = gnn_predictor.cross_validate()
        return {
            'success': True,
            'metrics': metrics
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"评估失败: {str(e)}")
