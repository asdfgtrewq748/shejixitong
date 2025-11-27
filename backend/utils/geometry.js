/**
 * 几何计算工具模块
 * 用于巷道和工作面的几何形状计算
 */

/**
 * 根据中心点、尺寸和朝向角度创建工作面
 * @param {string} id - 工作面ID
 * @param {number} centerX - 中心点 X 坐标
 * @param {number} centerY - 中心点 Y 坐标
 * @param {number} width - 工作面宽度
 * @param {number} length - 工作面长度
 * @param {number} orientationDeg - 朝向角度（度，0度为正北）
 * @param {number} avgScore - 平均评分
 * @returns {Object} 工作面对象
 */
export function createWorkface(id, centerX, centerY, width, length, orientationDeg = 0, avgScore = 0) {
  const rad = (orientationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const halfW = width / 2;
  const halfL = length / 2;

  // 计算矩形四个顶点坐标（顺时针）
  const corners = [
    {
      x: Math.round(centerX - halfL * cos - halfW * sin),
      y: Math.round(centerY - halfL * sin + halfW * cos)
    },
    {
      x: Math.round(centerX + halfL * cos - halfW * sin),
      y: Math.round(centerY + halfL * sin + halfW * cos)
    },
    {
      x: Math.round(centerX + halfL * cos + halfW * sin),
      y: Math.round(centerY + halfL * sin - halfW * cos)
    },
    {
      x: Math.round(centerX - halfL * cos + halfW * sin),
      y: Math.round(centerY - halfL * sin - halfW * cos)
    }
  ];

  return {
    id,
    center: { x: Math.round(centerX), y: Math.round(centerY) },
    corners,
    width: Math.round(width),
    length: Math.round(length),
    orientation: orientationDeg,
    avgScore: Math.round(avgScore * 10) / 10,
    area: width * length
  };
}

/**
 * 从轴对齐矩形创建工作面（保持兼容性）
 * @param {string} id - 工作面ID
 * @param {number} x - 左下角 X 坐标
 * @param {number} y - 左下角 Y 坐标
 * @param {number} width - 宽度
 * @param {number} length - 长度
 * @param {number} avgScore - 平均评分
 * @returns {Object} 工作面对象
 */
export function createAxisAlignedWorkface(id, x, y, width, length, avgScore = 0) {
  const centerX = x + width / 2;
  const centerY = y + length / 2;
  
  return {
    id,
    center: { x: Math.round(centerX), y: Math.round(centerY) },
    corners: [
      { x: Math.round(x), y: Math.round(y) },
      { x: Math.round(x + width), y: Math.round(y) },
      { x: Math.round(x + width), y: Math.round(y + length) },
      { x: Math.round(x), y: Math.round(y + length) }
    ],
    width: Math.round(width),
    length: Math.round(length),
    orientation: 0,
    avgScore: Math.round(avgScore * 10) / 10,
    area: width * length,
    // 保留原始坐标以兼容旧代码
    x: Math.round(x),
    y: Math.round(y)
  };
}

/**
 * 创建巷道对象
 * @param {string} id - 巷道ID
 * @param {string} type - 类型 ('main' 或 'branch')
 * @param {Array} path - 路径点数组 [{x, y}, ...]
 * @param {number} width - 巷道宽度
 * @param {number} avgScore - 平均评分
 * @param {string} workfaceId - 关联工作面ID（分巷道）
 * @returns {Object} 巷道对象
 */
export function createRoadway(id, type, path, width, avgScore = 0, workfaceId = null) {
  const length = calculatePathLength(path);
  
  const roadway = {
    id,
    type,
    path,
    width: Math.round(width),
    length: Math.round(length),
    avgScore: Math.round(avgScore * 10) / 10
  };

  if (workfaceId) {
    roadway.workfaceId = workfaceId;
  }

  return roadway;
}

/**
 * 计算路径总长度
 */
function calculatePathLength(path) {
  let length = 0;
  for (let i = 1; i < path.length; i++) {
    length += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  return length;
}

/**
 * 计算多边形面积（Shoelace 公式）
 * @param {Array} corners - 顶点数组 [{x, y}, ...]
 * @returns {number} 面积
 */
export function calculatePolygonArea(corners) {
  let area = 0;
  const n = corners.length;
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += corners[i].x * corners[j].y;
    area -= corners[j].x * corners[i].y;
  }
  
  return Math.abs(area) / 2;
}

/**
 * 检查点是否在多边形内
 * @param {Object} point - 点 {x, y}
 * @param {Array} polygon - 多边形顶点 [{x, y}, ...]
 * @returns {boolean}
 */
export function isPointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    
    const intersect = ((yi > point.y) !== (yj > point.y))
        && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * 计算两点之间的距离
 */
export function distance(p1, p2) {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

/**
 * 计算点到线段的距离
 */
export function pointToSegmentDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  
  if (lenSq === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  
  const nearestX = a.x + t * dx;
  const nearestY = a.y + t * dy;
  
  return Math.hypot(p.x - nearestX, p.y - nearestY);
}

/**
 * 计算工作面到巷道路径的最小距离（用于煤柱检查）
 */
export function calculateWorkfaceToRoadwayDistance(workface, roadwayPath) {
  let minDist = Infinity;
  
  // 检查工作面的每个顶点到巷道的距离
  for (const corner of workface.corners) {
    for (let i = 0; i < roadwayPath.length - 1; i++) {
      const dist = pointToSegmentDistance(corner, roadwayPath[i], roadwayPath[i + 1]);
      minDist = Math.min(minDist, dist);
    }
  }
  
  return minDist;
}
