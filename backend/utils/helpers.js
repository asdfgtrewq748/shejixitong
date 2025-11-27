/**
 * 通用工具函数模块
 * 提供评分计算中常用的辅助函数
 */

/**
 * 限制数值在指定范围内
 * @param {number} min 最小值
 * @param {number} max 最大值
 * @param {number} v 输入值
 * @returns {number} 限制后的值
 */
export function clamp(min, max, v) {
  return Math.max(min, Math.min(max, v));
}

/**
 * 限制分数在 0-100 范围内
 * @param {number} v 输入分数
 * @returns {number} 限制后的分数
 */
export function clampScore(v) {
  return clamp(0, 100, v);
}

/**
 * 安全除法，避免除以 0
 * @param {number} num 分子
 * @param {number} den 分母
 * @param {number} fallback 除数为0时的返回值，默认0
 * @returns {number} 计算结果
 */
export function safeDiv(num, den, fallback = 0) {
  if (!den || !isFinite(den)) return fallback;
  return num / den;
}

/**
 * 线性插值
 * @param {number} v 输入值
 * @param {number} min 输入最小值
 * @param {number} max 输入最大值
 * @param {number} outMin 输出最小值（默认0）
 * @param {number} outMax 输出最大值（默认100）
 * @returns {number} 插值结果
 */
export function lerp(v, min, max, outMin = 0, outMax = 100) {
  if (max <= min) return outMin;
  const t = clamp(0, 1, (v - min) / (max - min));
  return outMin + t * (outMax - outMin);
}

/**
 * 计算点到多边形边界的最近距离
 * @param {{x: number, y: number}} point 点坐标
 * @param {Array<{x: number, y: number}>} boundary 边界顶点数组
 * @returns {number} 最近距离
 */
export function distanceToPolygonBoundary(point, boundary) {
  if (!boundary || boundary.length < 3) return 0;
  
  let minDist = Infinity;
  
  for (let i = 0; i < boundary.length; i++) {
    const j = (i + 1) % boundary.length;
    const dist = pointToSegmentDistance(point, boundary[i], boundary[j]);
    minDist = Math.min(minDist, dist);
  }
  
  return minDist;
}

/**
 * 计算点到线段的距离
 * @param {{x: number, y: number}} p 点
 * @param {{x: number, y: number}} a 线段起点
 * @param {{x: number, y: number}} b 线段终点
 * @returns {number} 距离
 */
export function pointToSegmentDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  
  if (lenSq === 0) {
    // a 和 b 重合
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  
  // 计算投影参数 t
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = clamp(0, 1, t);
  
  // 计算最近点
  const nearestX = a.x + t * dx;
  const nearestY = a.y + t * dy;
  
  return Math.hypot(p.x - nearestX, p.y - nearestY);
}
