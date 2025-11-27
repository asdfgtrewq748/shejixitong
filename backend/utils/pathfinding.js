/**
 * 路径规划算法模块
 * 实现 A* 算法，支持煤矿规程约束
 */

/**
 * 优先队列实现（用于 A* 算法）
 */
class PriorityQueue {
  constructor() {
    this.items = [];
  }

  push(item) {
    this.items.push(item);
    this.items.sort((a, b) => a.priority - b.priority);
  }

  pop() {
    return this.items.shift();
  }

  isEmpty() {
    return this.items.length === 0;
  }
}

/**
 * 网格单元类
 */
class GridCell {
  constructor(row, col, x, y) {
    this.row = row;
    this.col = col;
    this.x = x;
    this.y = y;
  }

  equals(other) {
    return this.row === other.row && this.col === other.col;
  }

  key() {
    return `${this.row},${this.col}`;
  }
}

/**
 * A* 路径搜索算法
 * @param {Object} grid - 评分网格对象
 * @param {GridCell} start - 起点
 * @param {GridCell} goal - 终点
 * @param {Object} options - 约束选项
 * @returns {Array} - 路径点数组
 */
export function findOptimalPath(grid, start, goal, options = {}) {
  const {
    maxSlope = 15,              // 最大坡度（度）
    minScore = 50,              // 最低通行评分
    obstacles = new Set(),      // 障碍区域
    heightGrid = null,          // 高程网格（用于坡度计算）
    scoreThreshold = 60,        // 低分区域阈值
    lowScorePenalty = 50,       // 低分区域惩罚
    boundary = null             // 边界多边形
  } = options;

  const { data, minX, minY, stepX, stepY, resolution } = grid;
  
  const openSet = new PriorityQueue();
  const cameFrom = new Map();
  const costSoFar = new Map();
  
  const startKey = start.key();
  const goalKey = goal.key();
  
  costSoFar.set(startKey, 0);
  openSet.push({ cell: start, priority: 0 });

  while (!openSet.isEmpty()) {
    const current = openSet.pop();
    const currentKey = current.cell.key();

    // 到达目标
    if (currentKey === goalKey) {
      return reconstructPath(cameFrom, start, goal);
    }

    // 遍历相邻格点
    const neighbors = getNeighbors(current.cell, grid, boundary);
    
    for (const neighbor of neighbors) {
      const neighborKey = neighbor.key();
      
      // 检查障碍物
      if (obstacles.has(neighborKey)) continue;
      
      // 检查评分（低于最低评分视为不可通行）
      const neighborScore = data[neighbor.row]?.[neighbor.col];
      if (neighborScore === null || neighborScore < minScore) continue;

      // 计算移动代价
      const distance = Math.hypot(
        neighbor.x - current.cell.x,
        neighbor.y - current.cell.y
      );
      
      let moveCost = distance;

      // 坡度约束检查
      if (heightGrid) {
        const currentHeight = heightGrid[current.cell.row]?.[current.cell.col] || 0;
        const neighborHeight = heightGrid[neighbor.row]?.[neighbor.col] || 0;
        const dz = Math.abs(neighborHeight - currentHeight);
        const slope = (dz / distance) * (180 / Math.PI); // 转换为度数
        
        if (slope > maxSlope) continue; // 超过坡度限制，不可通行
        
        // 坡度越大，代价越高
        moveCost += slope * 2;
      }

      // 低分区域惩罚
      if (neighborScore < scoreThreshold) {
        moveCost += lowScorePenalty;
      }

      // 计算新代价
      const newCost = costSoFar.get(currentKey) + moveCost;

      if (!costSoFar.has(neighborKey) || newCost < costSoFar.get(neighborKey)) {
        costSoFar.set(neighborKey, newCost);
        const priority = newCost + heuristic(neighbor, goal);
        openSet.push({ cell: neighbor, priority });
        cameFrom.set(neighborKey, current.cell);
      }
    }
  }

  // 未找到路径
  throw new Error('无法找到满足约束的路径');
}

/**
 * 获取相邻格点（8邻域）
 */
function getNeighbors(cell, grid, boundary) {
  const { minX, minY, stepX, stepY, resolution, data } = grid;
  const neighbors = [];
  
  const directions = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1]
  ];

  for (const [dr, dc] of directions) {
    const newRow = cell.row + dr;
    const newCol = cell.col + dc;
    
    // 边界检查
    if (newRow < 0 || newRow > resolution || newCol < 0 || newCol > resolution) {
      continue;
    }
    
    const x = minX + newCol * stepX;
    const y = minY + newRow * stepY;
    
    // 检查是否在采区边界内
    if (boundary && !pointInPolygon({ x, y }, boundary)) {
      continue;
    }
    
    neighbors.push(new GridCell(newRow, newCol, x, y));
  }

  return neighbors;
}

/**
 * 启发式函数（欧氏距离）
 */
function heuristic(cell, goal) {
  return Math.hypot(cell.x - goal.x, cell.y - goal.y);
}

/**
 * 重建路径
 */
function reconstructPath(cameFrom, start, goal) {
  const path = [];
  let current = goal;
  
  while (current && !current.equals(start)) {
    path.unshift({ x: Math.round(current.x), y: Math.round(current.y) });
    const currentKey = current.key();
    current = cameFrom.get(currentKey);
  }
  
  path.unshift({ x: Math.round(start.x), y: Math.round(start.y) });
  return path;
}

/**
 * 点是否在多边形内（射线法）
 */
function pointInPolygon(point, polygon) {
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
 * 简化路径（移除冗余中间点）
 */
export function simplifyPath(path, tolerance = 5) {
  if (path.length <= 2) return path;
  
  const simplified = [path[0]];
  
  for (let i = 1; i < path.length - 1; i++) {
    const prev = simplified[simplified.length - 1];
    const curr = path[i];
    const next = path[i + 1];
    
    // 计算点到线段的距离
    const dist = pointToLineDistance(curr, prev, next);
    
    // 如果距离大于容差，保留该点
    if (dist > tolerance) {
      simplified.push(curr);
    }
  }
  
  simplified.push(path[path.length - 1]);
  return simplified;
}

/**
 * 点到线段的距离
 */
function pointToLineDistance(point, lineStart, lineEnd) {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lenSq = dx * dx + dy * dy;
  
  if (lenSq === 0) {
    return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);
  }
  
  let t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  
  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;
  
  return Math.hypot(point.x - projX, point.y - projY);
}

/**
 * 计算路径沿线的平均评分
 */
export function calculatePathScore(grid, path) {
  const { data, minX, minY, stepX, stepY, resolution } = grid;
  let totalScore = 0;
  let count = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const steps = 10;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = path[i].x + (path[i + 1].x - path[i].x) * t;
      const y = path[i].y + (path[i + 1].y - path[i].y) * t;
      const col = Math.round((x - minX) / stepX);
      const row = Math.round((y - minY) / stepY);
      
      if (row >= 0 && row <= resolution && col >= 0 && col <= resolution) {
        const score = data[row]?.[col];
        if (score !== null) {
          totalScore += score;
          count++;
        }
      }
    }
  }

  return count > 0 ? totalScore / count : 0;
}

/**
 * 计算路径总长度
 */
export function calculatePathLength(path) {
  let length = 0;
  for (let i = 1; i < path.length; i++) {
    length += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  return length;
}

/**
 * 将坐标转换为网格单元
 */
export function coordToGridCell(x, y, grid) {
  const { minX, minY, stepX, stepY } = grid;
  const col = Math.round((x - minX) / stepX);
  const row = Math.round((y - minY) / stepY);
  return new GridCell(row, col, x, y);
}
