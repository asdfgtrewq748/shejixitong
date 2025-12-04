from typing import List, Dict, Any, Optional
from pydantic import BaseModel


class Store:
    """全局数据存储类"""

    def __init__(self):
        # 采区边界 [{"x": 1, "y": 2}, ...]
        self.boundary: List[Dict[str, float]] = []

        # 钻孔数据（合并后的完整数据）
        self.boreholes: List[Dict[str, Any]] = []

        # 钻孔坐标（仅坐标）
        self.borehole_coordinates: List[Dict[str, Any]] = []

        # 钻孔分层数据（原始分层）
        self.borehole_layer_data: List[Dict[str, Any]] = []

        # 地质模型数据
        self.geology_model: Dict[str, Any] = {}

        # 评分数据
        self.scores: Dict[str, Any] = {}

        # 设计结果
        self.design_result: Dict[str, Any] = {}

        # 坐标偏移量（用于归一化后恢复）
        self.coord_offset: Dict[str, float] = {'x': 0, 'y': 0}

    def clear(self):
        """清空所有数据"""
        self.__init__()

    def get_normalized_boundary(self) -> List[Dict[str, float]]:
        """获取归一化后的边界（用于计算，不修改原始数据）"""
        if not self.boundary:
            return []

        min_x = min(p['x'] for p in self.boundary)
        min_y = min(p['y'] for p in self.boundary)

        if min_x > 100 or min_y > 100:
            self.coord_offset = {'x': min_x, 'y': min_y}
            return [{'x': p['x'] - min_x, 'y': p['y'] - min_y} for p in self.boundary]

        return self.boundary.copy()

    def get_normalized_boreholes(self) -> List[Dict[str, Any]]:
        """获取归一化后的钻孔数据（用于计算，不修改原始数据）"""
        if not self.boreholes:
            return []

        offset_x = self.coord_offset.get('x', 0)
        offset_y = self.coord_offset.get('y', 0)

        if offset_x > 0 or offset_y > 0:
            return [{
                **bh,
                'x': bh.get('x', 0) - offset_x,
                'y': bh.get('y', 0) - offset_y
            } for bh in self.boreholes]

        return self.boreholes.copy()


store = Store()
