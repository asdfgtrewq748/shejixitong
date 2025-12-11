"""
GNN煤层三维建模模块
基于图神经网络的煤层三维建模方法实现
"""

from .graph_builder import MultiScaleGraphBuilder
from .model import GeoGNN, GeologicalConstraintLayer
from .loss import GeoModelingLoss
from .decoder import ImplicitSurfaceDecoder
from .trainer import GNNTrainer
from .visualizer import CoalSeamVisualizer

__version__ = "0.1.0"
__all__ = [
    "MultiScaleGraphBuilder",
    "GeoGNN",
    "GeologicalConstraintLayer",
    "GeoModelingLoss",
    "ImplicitSurfaceDecoder",
    "GNNTrainer",
    "CoalSeamVisualizer",
]
