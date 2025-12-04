"""
地质条件评估模块

基于钻孔分层数据，计算：
1. 煤层埋深和厚度
2. 顶底板岩性评估
3. 煤层倾角估算
4. 综合可采性评分
"""

import numpy as np
import pandas as pd
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, field
from scipy.interpolate import griddata
from scipy.spatial import Delaunay
import re


@dataclass
class CoalSeamInfo:
    """单个煤层信息"""
    name: str                      # 煤层名称 (如 "15-4煤", "16-3煤")
    thickness: float               # 煤层厚度 (m)
    depth: float                   # 煤层顶板埋深 (m)
    roof_rock: str                 # 顶板岩性
    roof_thickness: float          # 直接顶厚度
    floor_rock: str                # 底板岩性
    floor_thickness: float         # 直接底厚度
    elevation: Optional[float] = None  # 煤层标高 (如果有地面标高)


@dataclass
class BoreholeGeology:
    """单个钻孔的地质信息"""
    id: str                        # 钻孔编号
    x: float                       # X坐标
    y: float                       # Y坐标
    surface_elevation: float = 0   # 地面标高 (默认0，从地表开始)
    total_depth: float = 0         # 钻孔总深度
    coal_seams: List[CoalSeamInfo] = field(default_factory=list)  # 各煤层信息
    layers: List[Dict] = field(default_factory=list)  # 原始分层数据


class GeologyAnalyzer:
    """地质分析器"""

    # 岩性硬度评分 (用于顶板稳定性评估)
    # 分数越高，顶板越稳定
    ROCK_HARDNESS = {
        '砾岩': 90, '粗砾岩': 90, '中砾岩': 85,
        '砂岩': 80, '细砂岩': 80, '中砂岩': 75, '粗砂岩': 70,
        '粉砂岩': 60, '�ite': 60,
        '泥岩': 40, '页岩': 35,
        '炭质泥岩': 25, '碳质泥岩': 25,
        '煤': 20, '腐殖土': 10, '土': 10,
        '灰�ite': 85, '石灰岩': 85,
    }

    # 岩性遇水稳定性 (用于底板评估)
    # 分数越高，遇水越稳定
    ROCK_WATER_STABILITY = {
        '砾岩': 90, '粗砾岩': 90, '中砾岩': 85,
        '砂岩': 85, '细砂岩': 80, '中砂岩': 80, '粗砂岩': 75,
        '粉砂岩': 60,
        '泥岩': 30,  # 泥岩遇水易膨胀
        '炭质泥岩': 20, '碳质泥岩': 20,
        '页岩': 25,
        '灰岩': 90, '石灰岩': 90,
    }

    # 煤层名称正则匹配
    COAL_PATTERN = re.compile(r'(\d+[-_]?\d*)\s*(上|中|下)?\s*煤?', re.IGNORECASE)

    def __init__(self):
        self.boreholes: List[BoreholeGeology] = []
        self.target_seam: Optional[str] = None  # 目标煤层

    def parse_borehole_csv(self, csv_content: str, borehole_id: str,
                           x: float = 0, y: float = 0) -> BoreholeGeology:
        """
        解析单个钻孔的CSV数据

        Args:
            csv_content: CSV文件内容
            borehole_id: 钻孔编号
            x, y: 钻孔坐标

        Returns:
            BoreholeGeology 对象
        """
        try:
            # 尝试不同编码
            for encoding in ['utf-8-sig', 'utf-8', 'gbk', 'gb2312']:
                try:
                    from io import StringIO
                    df = pd.read_csv(StringIO(csv_content), encoding=encoding)
                    break
                except:
                    continue
            else:
                # 如果都失败，尝试直接解析
                df = pd.read_csv(pd.io.common.StringIO(csv_content))
        except Exception as e:
            print(f"Failed to parse CSV for {borehole_id}: {e}")
            return BoreholeGeology(id=borehole_id, x=x, y=y)

        # 查找厚度列和名称列
        thickness_col = None
        name_col = None

        for col in df.columns:
            col_lower = str(col).lower()
            if '厚度' in col_lower or 'thick' in col_lower:
                thickness_col = col
            if '名称' in col_lower or 'name' in col_lower or '岩性' in col_lower:
                name_col = col

        if not thickness_col or not name_col:
            print(f"Cannot find required columns in {borehole_id}")
            return BoreholeGeology(id=borehole_id, x=x, y=y)

        # 解析各层
        layers = []
        current_depth = 0

        for _, row in df.iterrows():
            try:
                name = str(row[name_col]).strip()
                thickness = float(row[thickness_col])

                layers.append({
                    'name': name,
                    'thickness': thickness,
                    'top_depth': current_depth,
                    'bottom_depth': current_depth + thickness
                })
                current_depth += thickness
            except (ValueError, TypeError):
                continue

        # 创建钻孔对象
        borehole = BoreholeGeology(
            id=borehole_id,
            x=x,
            y=y,
            total_depth=current_depth,
            layers=layers
        )

        # 识别煤层
        self._identify_coal_seams(borehole)

        return borehole

    def _identify_coal_seams(self, borehole: BoreholeGeology):
        """识别钻孔中的煤层并提取顶底板信息"""
        layers = borehole.layers
        coal_seams = []

        for i, layer in enumerate(layers):
            name = layer['name']

            # 判断是否为煤层
            if self._is_coal_layer(name):
                # 获取顶板信息
                roof_rock = ''
                roof_thickness = 0
                if i > 0:
                    roof_rock = layers[i - 1]['name']
                    roof_thickness = layers[i - 1]['thickness']

                # 获取底板信息
                floor_rock = ''
                floor_thickness = 0
                if i < len(layers) - 1:
                    floor_rock = layers[i + 1]['name']
                    floor_thickness = layers[i + 1]['thickness']

                seam = CoalSeamInfo(
                    name=name,
                    thickness=layer['thickness'],
                    depth=layer['top_depth'],
                    roof_rock=roof_rock,
                    roof_thickness=roof_thickness,
                    floor_rock=floor_rock,
                    floor_thickness=floor_thickness
                )
                coal_seams.append(seam)

        borehole.coal_seams = coal_seams

    def _is_coal_layer(self, name: str) -> bool:
        """判断是否为煤层"""
        name_lower = name.lower().strip()
        # 包含"煤"字，或者名称格式如 "15-4", "16-3" 等
        if '煤' in name_lower or 'coal' in name_lower:
            return True
        # 排除含煤的岩层如"炭质泥岩"
        if '炭质' in name_lower or '碳质' in name_lower:
            return False
        return False

    def _normalize_seam_name(self, name: str) -> str:
        """标准化煤层名称，便于跨钻孔匹配"""
        # 移除空格，统一分隔符
        name = name.replace(' ', '').replace('_', '-')
        # 提取数字部分
        match = self.COAL_PATTERN.search(name)
        if match:
            base = match.group(1)
            suffix = match.group(2) or ''
            return f"{base}{suffix}煤"
        return name

    def add_borehole(self, borehole: BoreholeGeology):
        """添加钻孔到分析器"""
        self.boreholes.append(borehole)

    def get_seam_names(self) -> List[str]:
        """获取所有发现的煤层名称"""
        seam_names = set()
        for bh in self.boreholes:
            for seam in bh.coal_seams:
                normalized = self._normalize_seam_name(seam.name)
                seam_names.add(normalized)
        return sorted(list(seam_names))

    def calculate_dip_angle(self, target_seam: str = None) -> Dict[str, Any]:
        """
        计算煤层倾角

        使用多个钻孔的煤层埋深数据，通过平面拟合计算倾角和倾向

        Args:
            target_seam: 目标煤层名称，如果为None则使用最常见的煤层

        Returns:
            {
                'dip_angle': 倾角 (度),
                'dip_direction': 倾向 (度, 北为0),
                'strike_direction': 走向 (度),
                'points_used': 使用的钻孔数量,
                'seam_name': 使用的煤层名称,
                'confidence': 置信度
            }
        """
        if len(self.boreholes) < 3:
            return {
                'dip_angle': 0,
                'dip_direction': 0,
                'strike_direction': 90,
                'points_used': len(self.boreholes),
                'seam_name': target_seam,
                'confidence': 'low',
                'message': '钻孔数量不足，无法准确计算倾角'
            }

        # 如果未指定目标煤层，使用最常见的
        if not target_seam:
            seam_counts = {}
            for bh in self.boreholes:
                for seam in bh.coal_seams:
                    normalized = self._normalize_seam_name(seam.name)
                    seam_counts[normalized] = seam_counts.get(normalized, 0) + 1
            if seam_counts:
                target_seam = max(seam_counts, key=seam_counts.get)
            else:
                return {'dip_angle': 0, 'dip_direction': 0, 'confidence': 'none'}

        # 收集该煤层在各钻孔的数据点 (x, y, depth)
        points = []
        for bh in self.boreholes:
            for seam in bh.coal_seams:
                if self._normalize_seam_name(seam.name) == target_seam:
                    # 使用埋深的负值作为"标高"（向下为负）
                    points.append([bh.x, bh.y, -seam.depth])
                    break

        if len(points) < 3:
            return {
                'dip_angle': 0,
                'dip_direction': 0,
                'points_used': len(points),
                'seam_name': target_seam,
                'confidence': 'low',
                'message': f'煤层 {target_seam} 数据点不足'
            }

        points = np.array(points)

        # 使用最小二乘法拟合平面 z = ax + by + c
        A = np.c_[points[:, 0], points[:, 1], np.ones(len(points))]
        z = points[:, 2]

        # 求解 (ATA)^-1 * AT * z
        try:
            coeffs, residuals, rank, s = np.linalg.lstsq(A, z, rcond=None)
            a, b, c = coeffs

            # 计算倾角 (法向量与z轴夹角的余角)
            # 平面法向量 n = (-a, -b, 1)
            normal = np.array([-a, -b, 1])
            normal_length = np.linalg.norm(normal)

            # 倾角 = arctan(sqrt(a^2 + b^2))
            dip_angle = np.degrees(np.arctan(np.sqrt(a ** 2 + b ** 2)))

            # 倾向 = 最大下降方向的方位角
            # 梯度方向 (a, b) 指向下降最快的方向
            dip_direction = np.degrees(np.arctan2(a, b))  # 注意：测量坐标系可能不同
            if dip_direction < 0:
                dip_direction += 360

            # 走向 = 倾向 + 90° 或 - 90°
            strike_direction = (dip_direction + 90) % 360

            # 计算拟合质量
            if len(residuals) > 0:
                rmse = np.sqrt(residuals[0] / len(points))
                confidence = 'high' if rmse < 5 else ('medium' if rmse < 15 else 'low')
            else:
                confidence = 'medium'

            return {
                'dip_angle': round(dip_angle, 2),
                'dip_direction': round(dip_direction, 1),
                'strike_direction': round(strike_direction, 1),
                'points_used': len(points),
                'seam_name': target_seam,
                'confidence': confidence,
                'gradient': {'a': round(a, 6), 'b': round(b, 6)}
            }

        except Exception as e:
            return {
                'dip_angle': 0,
                'dip_direction': 0,
                'confidence': 'error',
                'message': str(e)
            }

    def calculate_score_at_point(self, x: float, y: float, target_seam: str = None) -> Dict[str, float]:
        """
        计算某点的综合可采性评分

        通过IDW插值获取该点的地质参数，然后计算评分

        Args:
            x, y: 坐标
            target_seam: 目标煤层

        Returns:
            各项评分和综合评分
        """
        # 收集目标煤层在各钻孔的数据
        data_points = []
        for bh in self.boreholes:
            for seam in bh.coal_seams:
                if target_seam is None or self._normalize_seam_name(seam.name) == target_seam:
                    data_points.append({
                        'x': bh.x,
                        'y': bh.y,
                        'thickness': seam.thickness,
                        'depth': seam.depth,
                        'roof_rock': seam.roof_rock,
                        'floor_rock': seam.floor_rock
                    })
                    break

        if not data_points:
            return {'total_score': 50, 'message': '无数据'}

        # IDW 插值
        weights = []
        for dp in data_points:
            dist = np.sqrt((dp['x'] - x) ** 2 + (dp['y'] - y) ** 2)
            if dist < 1:
                dist = 1  # 避免除零
            weights.append(1 / dist ** 2)

        total_weight = sum(weights)
        weights = [w / total_weight for w in weights]

        # 插值煤厚
        avg_thickness = sum(dp['thickness'] * w for dp, w in zip(data_points, weights))

        # 插值顶板评分
        roof_scores = []
        for dp in data_points:
            roof_score = self._get_rock_score(dp['roof_rock'], 'roof')
            roof_scores.append(roof_score)
        avg_roof_score = sum(s * w for s, w in zip(roof_scores, weights))

        # 插值底板评分
        floor_scores = []
        for dp in data_points:
            floor_score = self._get_rock_score(dp['floor_rock'], 'floor')
            floor_scores.append(floor_score)
        avg_floor_score = sum(s * w for s, w in zip(floor_scores, weights))

        # 计算煤厚评分 (0.8-5m 为佳)
        if avg_thickness < 0.8:
            thickness_score = 20  # 不可采
        elif avg_thickness < 1.3:
            thickness_score = 60  # 薄煤层
        elif avg_thickness < 3.5:
            thickness_score = 90  # 中厚煤层，最佳
        elif avg_thickness < 6:
            thickness_score = 80  # 厚煤层
        else:
            thickness_score = 70  # 特厚煤层，开采难度增加

        # 综合评分
        total_score = (
                thickness_score * 0.40 +
                avg_roof_score * 0.35 +
                avg_floor_score * 0.25
        )

        return {
            'total_score': round(total_score, 1),
            'thickness_score': round(thickness_score, 1),
            'roof_score': round(avg_roof_score, 1),
            'floor_score': round(avg_floor_score, 1),
            'interpolated_thickness': round(avg_thickness, 2),
            'data_points_count': len(data_points)
        }

    def _get_rock_score(self, rock_name: str, rock_type: str = 'roof') -> float:
        """获取岩性评分"""
        if not rock_name:
            return 50

        # 根据类型选择评分标准
        score_dict = self.ROCK_HARDNESS if rock_type == 'roof' else self.ROCK_WATER_STABILITY

        # 模糊匹配
        rock_name = rock_name.strip()
        for key, score in score_dict.items():
            if key in rock_name:
                return score

        return 50  # 默认分数

    def generate_score_grid(self, boundary_points: List[Dict],
                            target_seam: str = None,
                            resolution: int = 20) -> Dict[str, Any]:
        """
        生成评分网格，用于热力图显示

        Args:
            boundary_points: 边界点列表 [{'x': x, 'y': y}, ...]
            target_seam: 目标煤层
            resolution: 网格分辨率

        Returns:
            网格数据
        """
        if not boundary_points or len(self.boreholes) == 0:
            return {'grid': [], 'stats': {}}

        # 计算边界范围
        xs = [p['x'] for p in boundary_points]
        ys = [p['y'] for p in boundary_points]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)

        # 生成网格点
        x_range = np.linspace(min_x, max_x, resolution)
        y_range = np.linspace(min_y, max_y, resolution)

        grid = []
        scores = []

        for x in x_range:
            for y in y_range:
                score_data = self.calculate_score_at_point(x, y, target_seam)
                grid.append({
                    'x': round(x, 2),
                    'y': round(y, 2),
                    'score': score_data['total_score'],
                    'thickness': score_data.get('interpolated_thickness', 0)
                })
                scores.append(score_data['total_score'])

        return {
            'grid': grid,
            'stats': {
                'min_score': round(min(scores), 1) if scores else 0,
                'max_score': round(max(scores), 1) if scores else 100,
                'avg_score': round(np.mean(scores), 1) if scores else 50
            },
            'resolution': resolution,
            'bounds': {
                'min_x': min_x, 'max_x': max_x,
                'min_y': min_y, 'max_y': max_y
            }
        }

    def get_summary(self) -> Dict[str, Any]:
        """获取地质分析摘要"""
        seam_stats = {}
        for bh in self.boreholes:
            for seam in bh.coal_seams:
                name = self._normalize_seam_name(seam.name)
                if name not in seam_stats:
                    seam_stats[name] = {
                        'count': 0,
                        'thicknesses': [],
                        'depths': []
                    }
                seam_stats[name]['count'] += 1
                seam_stats[name]['thicknesses'].append(seam.thickness)
                seam_stats[name]['depths'].append(seam.depth)

        # 计算各煤层统计
        summary = {}
        for name, stats in seam_stats.items():
            summary[name] = {
                'borehole_count': stats['count'],
                'avg_thickness': round(np.mean(stats['thicknesses']), 2),
                'min_thickness': round(min(stats['thicknesses']), 2),
                'max_thickness': round(max(stats['thicknesses']), 2),
                'thickness_std': round(np.std(stats['thicknesses']), 2),
                'avg_depth': round(np.mean(stats['depths']), 1),
                'min_depth': round(min(stats['depths']), 1),
                'max_depth': round(max(stats['depths']), 1)
            }

        return {
            'borehole_count': len(self.boreholes),
            'coal_seams': summary,
            'seam_names': list(summary.keys())
        }


def analyze_boreholes_from_files(borehole_dir: str, coord_file: str,
                                  target_seam: str = None) -> GeologyAnalyzer:
    """
    从文件加载并分析钻孔数据

    Args:
        borehole_dir: 钻孔数据目录
        coord_file: 坐标文件路径
        target_seam: 目标煤层

    Returns:
        GeologyAnalyzer 实例
    """
    import os

    analyzer = GeologyAnalyzer()

    # 读取坐标文件
    coords = {}
    try:
        coord_df = pd.read_csv(coord_file, encoding='utf-8-sig')
        # 查找列名
        name_col = next((c for c in coord_df.columns if '钻孔' in c or 'name' in c.lower() or 'id' in c.lower()), coord_df.columns[0])
        x_col = next((c for c in coord_df.columns if 'x' in c.lower()), coord_df.columns[1])
        y_col = next((c for c in coord_df.columns if 'y' in c.lower()), coord_df.columns[2])

        for _, row in coord_df.iterrows():
            name = str(row[name_col]).strip()
            coords[name] = (float(row[x_col]), float(row[y_col]))
    except Exception as e:
        print(f"Error reading coordinate file: {e}")
        return analyzer

    # 读取各钻孔数据
    for filename in os.listdir(borehole_dir):
        if not filename.endswith('.csv'):
            continue

        borehole_id = filename.rsplit('.', 1)[0]
        filepath = os.path.join(borehole_dir, filename)

        # 获取坐标
        x, y = coords.get(borehole_id, (0, 0))

        try:
            with open(filepath, 'r', encoding='utf-8-sig') as f:
                content = f.read()
            borehole = analyzer.parse_borehole_csv(content, borehole_id, x, y)
            analyzer.add_borehole(borehole)
        except Exception as e:
            print(f"Error reading {filename}: {e}")

    analyzer.target_seam = target_seam
    return analyzer
