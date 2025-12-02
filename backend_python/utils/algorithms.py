import numpy as np
from shapely.geometry import Polygon, Point, LineString, box
from shapely.affinity import rotate, translate
from shapely.ops import unary_union
import networkx as nx
from typing import List, Dict, Any, Tuple

def create_polygon_from_points(points: List[Dict[str, float]]) -> Polygon:
    """从点列表创建 Shapely 多边形"""
    if not points or len(points) < 3:
        return Polygon()
        
    coords = [(p['x'], p['y']) for p in points]
    if coords[0] != coords[-1]:
        coords.append(coords[0])
    return Polygon(coords)

def generate_smart_layout(
    boundary_points: List[Dict[str, float]], 
    dip_angle: float, 
    dip_direction: float,
    face_width: float,
    pillar_width: float,
    boundary_margin: float = 30.0
) -> Dict[str, Any]:
    """
    使用 Shapely 进行智能工作面布局
    """
    # 1. 创建采区边界多边形
    boundary_poly = create_polygon_from_points(boundary_points)
    
    # 2. 内缩边界（预留边界煤柱）
    # buffer(negative) 可以实现内缩
    mining_area = boundary_poly.buffer(-boundary_margin)
    
    if mining_area.is_empty:
        return {"workfaces": [], "pillars": [], "stats": {}}

    # 3. 确定布局方向
    # 将采区旋转到水平方向以便于切割
    # 旋转角度 = -dip_direction (逆时针旋转使其水平)
    # 这里简化逻辑：尝试将多边形的主轴旋转到 X 轴
    
    # 计算最小外接矩形
    min_rect = mining_area.minimum_rotated_rectangle
    
    # 获取矩形坐标
    rect_coords = list(min_rect.exterior.coords)
    
    # 计算长边角度
    edge_angles = []
    for i in range(len(rect_coords) - 1):
        p1 = rect_coords[i]
        p2 = rect_coords[i+1]
        dx = p2[0] - p1[0]
        dy = p2[1] - p1[1]
        length = np.sqrt(dx**2 + dy**2)
        angle = np.degrees(np.arctan2(dy, dx))
        edge_angles.append((length, angle))
    
    # 找到最长边对应的角度，作为旋转基准
    edge_angles.sort(key=lambda x: x[0], reverse=True)
    rotation_angle = -edge_angles[0][1] # 旋转使其水平
    
    # 旋转采区
    rotated_area = rotate(mining_area, rotation_angle, origin='centroid')
    min_x, min_y, max_x, max_y = rotated_area.bounds
    
    workfaces = []
    pillars = []
    
    # 4. 网格化切割
    current_x = min_x
    face_id = 1
    
    while current_x + face_width <= max_x:
        # 创建候选工作面矩形 (在旋转后的坐标系中)
        # 这里的 height 取整个采区的高度，稍后求交集
        candidate_rect = box(current_x, min_y, current_x + face_width, max_y)
        
        # 求交集：获取实际在采区内的工作面形状
        intersection = rotated_area.intersection(candidate_rect)
        
        if not intersection.is_empty:
            # 可能被切成多个部分（如果采区形状不规则）
            parts = [intersection] if intersection.geom_type == 'Polygon' else intersection.geoms
            
            for part in parts:
                if part.area < 1000: # 忽略太小的碎片
                    continue
                    
                # 再次旋转回原始坐标系
                original_shape = rotate(part, -rotation_angle, origin=mining_area.centroid)
                
                # 获取外接矩形作为简化的工作面表示（前端好画）
                # 或者直接输出多边形顶点
                bounds = original_shape.minimum_rotated_rectangle
                coords = list(bounds.exterior.coords)
                
                # 计算中心点和尺寸
                center = original_shape.centroid
                
                # 估算长宽
                rect_w = face_width
                rect_h = part.area / face_width
                
                workfaces.append({
                    "id": f"WF-{face_id:02d}",
                    "x": coords[0][0], # 仅作为参考点
                    "y": coords[0][1],
                    "center_x": center.x,
                    "center_y": center.y,
                    "width": rect_w,
                    "length": rect_h,
                    "area": part.area,
                    "points": [{"x": x, "y": y} for x, y in coords[:-1]], # 多边形顶点
                    "avgScore": 85 + np.random.random() * 10 # 模拟评分
                })
                face_id += 1
        
        current_x += face_width + pillar_width
        
    # 5. 生成巷道网络 (MST)
    roadways = generate_roadways(workfaces, boundary_points)
    
    return {
        "workfaces": workfaces,
        "roadways": roadways,
        "stats": {
            "totalArea": sum(w['area'] for w in workfaces),
            "count": len(workfaces),
            "miningMethod": "智能拟合开采"
        }
    }

def generate_roadways(workfaces: List[Dict], boundary_points: List[Dict]) -> List[Dict]:
    """
    使用最小生成树 (MST) 生成连接所有工作面的巷道网络
    """
    if not workfaces:
        return []
        
    # 构建图
    G = nx.Graph()
    
    # 添加节点：工作面中心点
    centers = [(w['center_x'], w['center_y']) for w in workfaces]
    
    # 添加一个"井底车场"节点（假设在边界的最低点）
    if boundary_points:
        min_y_point = min(boundary_points, key=lambda p: p['y'])
        start_node = (min_y_point['x'], min_y_point['y'])
        centers.append(start_node)
    
    if len(centers) < 2:
        return []
    
    # 添加边：完全图（所有点两两相连，权重为距离）
    for i in range(len(centers)):
        for j in range(i + 1, len(centers)):
            p1 = centers[i]
            p2 = centers[j]
            dist = np.sqrt((p1[0]-p2[0])**2 + (p1[1]-p2[1])**2)
            G.add_edge(i, j, weight=dist)
            
    # 计算最小生成树
    mst = nx.minimum_spanning_tree(G)
    
    roadways = []
    road_id = 1
    
    for u, v in mst.edges():
        p1 = centers[u]
        p2 = centers[v]
        
        roadways.append({
            "id": f"RW-{road_id}",
            "type": "transport",
            "path": [
                {"x": p1[0], "y": p1[1]},
                {"x": p2[0], "y": p2[1]}
            ],
            "length": mst[u][v]['weight']
        })
        road_id += 1
        
    return roadways
