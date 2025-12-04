"""
采矿规程参数配置模块

定义符合采矿规程的各类约束参数，用于指导工作面设计
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
import numpy as np


@dataclass
class MiningRules:
    """采矿规程参数配置类"""

    # ==================== 工作面几何约束 ====================

    # 工作面长度范围 (沿走向方向, 单位: 米)
    face_length_min: float = 150.0      # 最小长度
    face_length_max: float = 300.0      # 最大长度
    face_length_preferred: float = 200.0  # 推荐长度

    # 推进长度范围 (沿倾向方向, 单位: 米)
    advance_length_min: float = 800.0    # 最小推进长度
    advance_length_max: float = 2500.0   # 最大推进长度
    advance_length_preferred: float = 1500.0  # 推荐推进长度

    # ==================== 煤柱约束 ====================

    # 区段煤柱宽度 (相邻工作面之间, 单位: 米)
    section_pillar_min: float = 15.0
    section_pillar_max: float = 30.0
    section_pillar_preferred: float = 20.0

    # 边界煤柱宽度 (井田边界, 单位: 米)
    boundary_pillar_min: float = 20.0
    boundary_pillar_max: float = 50.0
    boundary_pillar_preferred: float = 30.0

    # ==================== 倾角约束 ====================

    # 煤层倾角分类 (单位: 度)
    dip_angle_gentle_max: float = 8.0      # 缓斜煤层上限
    dip_angle_inclined_max: float = 25.0   # 倾斜煤层上限
    dip_angle_steep_max: float = 45.0      # 急斜煤层上限

    # 伪倾斜布置阈值 - 超过此角度需要考虑伪倾斜
    pseudo_incline_threshold: float = 15.0

    # ==================== 煤厚约束 ====================

    # 最小可采厚度 (单位: 米)
    min_minable_thickness: float = 0.8

    # 煤厚分类
    thin_seam_max: float = 1.3           # 薄煤层上限
    medium_seam_max: float = 3.5         # 中厚煤层上限
    # 大于3.5m为厚煤层

    # 煤厚变异系数阈值 - 超过此值认为煤厚不稳定
    thickness_variation_threshold: float = 0.25

    # ==================== 开采方式 ====================

    # 布置方式: 'strike' (走向长壁) 或 'dip' (倾向长壁)
    layout_direction: str = 'strike'

    # 回采方式: 'retreat' (后退式) 或 'advance' (前进式)
    mining_method: str = 'retreat'

    # ==================== 评分权重 ====================

    # 各项指标在综合评分中的权重
    score_weights: Dict[str, float] = field(default_factory=lambda: {
        'coal_thickness': 0.35,    # 煤厚权重 (最重要)
        'roof_stability': 0.25,    # 顶板稳定性
        'gas_content': 0.20,       # 瓦斯含量
        'water_inflow': 0.15,      # 涌水量
        'geological_structure': 0.05  # 地质构造 (暂时权重较低)
    })

    # ==================== 评分阈值 ====================

    # 综合评分分级
    score_excellent: float = 85.0    # 优秀
    score_good: float = 70.0         # 良好
    score_acceptable: float = 60.0   # 可接受
    # 低于60分为不宜开采

    def get_face_length_range(self) -> Tuple[float, float]:
        """获取工作面长度范围"""
        return (self.face_length_min, self.face_length_max)

    def get_pillar_width(self, pillar_type: str = 'section') -> float:
        """获取煤柱宽度推荐值"""
        if pillar_type == 'boundary':
            return self.boundary_pillar_preferred
        return self.section_pillar_preferred

    def classify_dip_angle(self, angle: float) -> str:
        """
        根据倾角分类煤层类型

        Returns:
            'gentle': 缓斜煤层 (0-8°)
            'inclined': 倾斜煤层 (8-25°)
            'steep': 急斜煤层 (25-45°)
            'very_steep': 急倾斜煤层 (>45°)
        """
        angle = abs(angle)
        if angle <= self.dip_angle_gentle_max:
            return 'gentle'
        elif angle <= self.dip_angle_inclined_max:
            return 'inclined'
        elif angle <= self.dip_angle_steep_max:
            return 'steep'
        else:
            return 'very_steep'

    def classify_coal_thickness(self, thickness: float) -> str:
        """
        根据煤厚分类

        Returns:
            'unminable': 不可采 (<0.8m)
            'thin': 薄煤层 (0.8-1.3m)
            'medium': 中厚煤层 (1.3-3.5m)
            'thick': 厚煤层 (>3.5m)
        """
        if thickness < self.min_minable_thickness:
            return 'unminable'
        elif thickness <= self.thin_seam_max:
            return 'thin'
        elif thickness <= self.medium_seam_max:
            return 'medium'
        else:
            return 'thick'

    def needs_pseudo_incline(self, dip_angle: float) -> bool:
        """判断是否需要伪倾斜布置"""
        return abs(dip_angle) > self.pseudo_incline_threshold

    def validate_face_length(self, length: float) -> Tuple[bool, str]:
        """
        验证工作面长度是否符合规程

        Returns:
            (is_valid, message)
        """
        if length < self.face_length_min:
            return (False, f"工作面长度 {length:.1f}m 小于最小值 {self.face_length_min}m")
        elif length > self.face_length_max:
            return (False, f"工作面长度 {length:.1f}m 大于最大值 {self.face_length_max}m")
        else:
            return (True, "符合规程")

    def validate_advance_length(self, length: float) -> Tuple[bool, str]:
        """验证推进长度是否符合规程"""
        if length < self.advance_length_min:
            return (False, f"推进长度 {length:.1f}m 小于最小值 {self.advance_length_min}m")
        elif length > self.advance_length_max:
            return (False, f"推进长度 {length:.1f}m 大于最大值 {self.advance_length_max}m")
        else:
            return (True, "符合规程")

    def suggest_face_count(self, total_strike_length: float, total_dip_length: float) -> Dict:
        """
        根据采区尺寸建议工作面数量和布置

        Args:
            total_strike_length: 采区走向总长度
            total_dip_length: 采区倾向总长度

        Returns:
            包含建议的字典
        """
        # 计算可布置的工作面数量
        effective_strike = total_strike_length - 2 * self.boundary_pillar_preferred
        effective_dip = total_dip_length - 2 * self.boundary_pillar_preferred

        # 走向长壁布置
        strike_face_count = int(effective_dip / (self.face_length_preferred + self.section_pillar_preferred))
        strike_advance = effective_strike

        # 倾向长壁布置
        dip_face_count = int(effective_strike / (self.face_length_preferred + self.section_pillar_preferred))
        dip_advance = effective_dip

        return {
            'strike_layout': {
                'face_count': max(1, strike_face_count),
                'face_length': self.face_length_preferred,
                'advance_length': strike_advance,
                'description': '走向长壁布置'
            },
            'dip_layout': {
                'face_count': max(1, dip_face_count),
                'face_length': self.face_length_preferred,
                'advance_length': dip_advance,
                'description': '倾向长壁布置'
            },
            'recommended': 'strike_layout' if strike_advance > dip_advance else 'dip_layout'
        }

    def to_dict(self) -> Dict:
        """转换为字典，便于前端使用"""
        return {
            'faceLength': {
                'min': self.face_length_min,
                'max': self.face_length_max,
                'preferred': self.face_length_preferred
            },
            'advanceLength': {
                'min': self.advance_length_min,
                'max': self.advance_length_max,
                'preferred': self.advance_length_preferred
            },
            'sectionPillar': {
                'min': self.section_pillar_min,
                'max': self.section_pillar_max,
                'preferred': self.section_pillar_preferred
            },
            'boundaryPillar': {
                'min': self.boundary_pillar_min,
                'max': self.boundary_pillar_max,
                'preferred': self.boundary_pillar_preferred
            },
            'dipAngle': {
                'gentleMax': self.dip_angle_gentle_max,
                'inclinedMax': self.dip_angle_inclined_max,
                'steepMax': self.dip_angle_steep_max,
                'pseudoInclineThreshold': self.pseudo_incline_threshold
            },
            'coalThickness': {
                'minMinable': self.min_minable_thickness,
                'thinMax': self.thin_seam_max,
                'mediumMax': self.medium_seam_max
            },
            'scoreWeights': self.score_weights,
            'scoreThresholds': {
                'excellent': self.score_excellent,
                'good': self.score_good,
                'acceptable': self.score_acceptable
            },
            'layoutDirection': self.layout_direction,
            'miningMethod': self.mining_method
        }

    @classmethod
    def from_dict(cls, data: Dict) -> 'MiningRules':
        """从字典创建实例"""
        rules = cls()

        if 'faceLength' in data:
            fl = data['faceLength']
            rules.face_length_min = fl.get('min', rules.face_length_min)
            rules.face_length_max = fl.get('max', rules.face_length_max)
            rules.face_length_preferred = fl.get('preferred', rules.face_length_preferred)

        if 'advanceLength' in data:
            al = data['advanceLength']
            rules.advance_length_min = al.get('min', rules.advance_length_min)
            rules.advance_length_max = al.get('max', rules.advance_length_max)
            rules.advance_length_preferred = al.get('preferred', rules.advance_length_preferred)

        if 'sectionPillar' in data:
            sp = data['sectionPillar']
            rules.section_pillar_min = sp.get('min', rules.section_pillar_min)
            rules.section_pillar_max = sp.get('max', rules.section_pillar_max)
            rules.section_pillar_preferred = sp.get('preferred', rules.section_pillar_preferred)

        if 'boundaryPillar' in data:
            bp = data['boundaryPillar']
            rules.boundary_pillar_min = bp.get('min', rules.boundary_pillar_min)
            rules.boundary_pillar_max = bp.get('max', rules.boundary_pillar_max)
            rules.boundary_pillar_preferred = bp.get('preferred', rules.boundary_pillar_preferred)

        if 'dipAngle' in data:
            da = data['dipAngle']
            rules.pseudo_incline_threshold = da.get('pseudoInclineThreshold', rules.pseudo_incline_threshold)

        if 'coalThickness' in data:
            ct = data['coalThickness']
            rules.min_minable_thickness = ct.get('minMinable', rules.min_minable_thickness)

        if 'scoreWeights' in data:
            rules.score_weights = data['scoreWeights']

        if 'layoutDirection' in data:
            rules.layout_direction = data['layoutDirection']

        if 'miningMethod' in data:
            rules.mining_method = data['miningMethod']

        return rules


# 默认规程实例
DEFAULT_MINING_RULES = MiningRules()
