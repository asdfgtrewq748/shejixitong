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
    
    if not boundary_poly.is_valid:
        print("Warning: Invalid boundary polygon, attempting to fix...")
        boundary_poly = boundary_poly.buffer(0)
        
    print(f"Boundary area: {boundary_poly.area}")
    
    # 2. 内缩边界（预留边界煤柱）
    # buffer(negative) 可以实现内缩
    mining_area = boundary_poly.buffer(-boundary_margin)
    print(f"Mining area after margin: {mining_area.area}")
    
    if mining_area.is_empty:
        print("Mining area is empty after margin!")
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
    
    # Fix: Allow partial overlap at the end. 
    # Previously: while current_x + face_width <= max_x
    # This prevented generating faces if the area width < face_width
    while current_x < max_x:
        # 创建候选工作面矩形 (在旋转后的坐标系中)
        # 这里的 height 取整个采区的高度，稍后求交集
        candidate_rect = box(current_x, min_y, current_x + face_width, max_y)
        
        # 求交集：获取实际在采区内的工作面形状
        intersection = rotated_area.intersection(candidate_rect)
        
        if not intersection.is_empty:
            # 可能被切成多个部分（如果采区形状不规则）
            parts = [intersection] if intersection.geom_type == 'Polygon' else intersection.geoms
            
            for part in parts:
                if part.area < 500: # 降低最小面积阈值，避免漏掉小块
                    continue
                    
                # 再次旋转回原始坐标系
                original_shape = rotate(part, -rotation_angle, origin=mining_area.centroid)
                
                # 获取外接矩形作为简化的工作面表示（前端好画）
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
        
    # 5. 生成巷道网络 (基于边界的主巷道 + 联络巷)
    # 传入旋转角度和中心点，以便在生成巷道时使用相同的坐标系
    # 传入 rotated_area 以便检测边界距离
    roadways = generate_roadways(workfaces, boundary_points, rotation_angle, mining_area.centroid, rotated_area)
    
    return {
        "workfaces": workfaces,
        "roadways": roadways,
        "stats": {
            "totalArea": sum(w['area'] for w in workfaces),
            "count": len(workfaces),
            "miningMethod": "智能拟合开采"
        }
    }

def generate_roadways(workfaces: List[Dict], boundary_points: List[Dict], rotation_angle: float = 0, centroid: Point = None, rotated_area: Polygon = None) -> List[Dict]:
    """
    生成巷道网络：
    1. 识别采区最佳一侧（上下左右）作为主运输大巷
    2. 从每个工作面生成联络巷连接到主大巷
    """
    if not workfaces:
        return []
        
    roadways = []
    road_id = 1
    
    # 1. 确定主大巷位置
    # 使用旋转后的坐标系来确定"底部"
    # 找到所有工作面在旋转坐标系下的 min_y
    
    # 如果没有传入 centroid，重新计算（不应该发生）
    if not centroid:
        poly = create_polygon_from_points(boundary_points)
        centroid = poly.centroid
        
    # 将所有工作面中心点旋转到水平坐标系
    rotated_centers = []
    for wf in workfaces:
        p = Point(wf['center_x'], wf['center_y'])
        rp = rotate(p, rotation_angle, origin=centroid)
        rotated_centers.append({'x': rp.x, 'y': rp.y, 'original': wf})
        
    if not rotated_centers:
        return []
        
    # 找到工作面群的边界框
    wf_min_x = min(p['x'] for p in rotated_centers)
    wf_max_x = max(p['x'] for p in rotated_centers)
    wf_min_y = min(p['y'] for p in rotated_centers)
    wf_max_y = max(p['y'] for p in rotated_centers)

    # 决策：主大巷放在上面还是下面？
    # 检查旋转后的采区边界，看哪边空间大
    if rotated_area:
        bounds = rotated_area.bounds # minx, miny, maxx, maxy
        area_min_y = bounds[1]
        area_max_y = bounds[3]
        
        dist_bottom = wf_min_y - area_min_y
        dist_top = area_max_y - wf_max_y
        
        # 选择空间较大的一侧，或者默认为底部
        # 如果空间都很大，优先选择底部（通常是运输巷）
        if dist_top > dist_bottom + 50: # 只有当顶部空间显著更大时才选顶部
            main_road_y = wf_max_y + 30
            is_top = True
        else:
            main_road_y = wf_min_y - 30
            is_top = False
    else:
        main_road_y = wf_min_y - 30
        is_top = False
    
    # 主大巷起点和终点 (延伸一点)
    main_start = Point(wf_min_x - 50, main_road_y)
    main_end = Point(wf_max_x + 50, main_road_y)
    
    # 旋转回原始坐标系
    real_start = rotate(main_start, -rotation_angle, origin=centroid)
    real_end = rotate(main_end, -rotation_angle, origin=centroid)
    
    # 添加主大巷
    roadways.append({
        "id": "Main-Transport",
        "type": "main",
        "path": [
            {"x": real_start.x, "y": real_start.y},
            {"x": real_end.x, "y": real_end.y}
        ],
        "length": real_start.distance(real_end)
    })
    
    # 2. 生成联络巷 (Gate Roads)
    # 从每个工作面中心垂直连接到主大巷
    for i, wf in enumerate(rotated_centers):
        # 起点：工作面中心
        # 终点：主大巷上的投影点 (x, main_road_y)
        
        start_p = Point(wf['x'], wf['y'])
        end_p = Point(wf['x'], main_road_y)
        
        # 旋转回原始坐标系
        real_s = rotate(start_p, -rotation_angle, origin=centroid)
        real_e = rotate(end_p, -rotation_angle, origin=centroid)
        
        roadways.append({
            "id": f"Gate-{i+1}",
            "type": "gate",
            "path": [
                {"x": real_s.x, "y": real_s.y},
                {"x": real_e.x, "y": real_e.y}
            ],
            "length": start_p.distance(end_p)
        })
        
    return roadways
    
    # 2. 生成联络巷 (从每个工作面中心垂直连接到主大巷)
    for i, rc in enumerate(rotated_centers):
        # 在旋转坐标系中，垂直向下连接到 main_road_y
        # 起点：工作面中心
        # 终点：(rc.x, main_road_y)
        
        p_start = Point(rc['x'], rc['y'])
        p_end = Point(rc['x'], main_road_y)
        
        # 旋转回原始坐标系
        real_p_start = rotate(p_start, -rotation_angle, origin=centroid)
        real_p_end = rotate(p_end, -rotation_angle, origin=centroid)
        
        roadways.append({
            "id": f"Gate-{i+1}",
            "type": "gate",
            "path": [
                {"x": real_p_start.x, "y": real_p_start.y},
                {"x": real_p_end.x, "y": real_p_end.y}
            ],
            "length": real_p_start.distance(real_p_end)
        })
        
    return roadways
