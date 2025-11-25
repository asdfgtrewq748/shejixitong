import { Router } from 'express';
import store from '../store.js';
import { calcSafetyScore, calcEconomicScore, calcEnvScore } from '../utils/scoreFormulas.js';

const router = Router();

/**
 * POST /api/score
 * 根据权重计算各钻孔综合得分，并生成全区插值网格
 * body: { weights: { safety, economic, env }, resolution: number }
 */
router.post('/', (req, res) => {
  if (store.boreholes.length === 0) {
    return res.status(400).json({ error: '请先导入钻孔数据' });
  }
  const { 
    weights = { safety: 40, economic: 30, env: 30 },
    resolution = 50  // 网格分辨率，默认 50x50
  } = req.body;
  const totalWeight = weights.safety + weights.economic + weights.env || 1;

  // 1. 计算每个钻孔各维度得分
  const scoredBoreholes = store.boreholes.map(hole => {
    const safety = calcSafetyScore(hole);
    const economic = calcEconomicScore(hole);
    const env = calcEnvScore(hole);
    const composite = (safety * weights.safety + economic * weights.economic + env * weights.env) / totalWeight;
    return {
      ...hole,
      scores: {
        safety: Math.round(safety * 10) / 10,
        economic: Math.round(economic * 10) / 10,
        env: Math.round(env * 10) / 10,
        composite: Math.round(composite * 10) / 10,
      },
    };
  });

  // 2. 生成多维度评分网格
  const grids = {
    safety: generateScoreGrid(store.boundary, scoredBoreholes, resolution, 'safety'),
    economic: generateScoreGrid(store.boundary, scoredBoreholes, resolution, 'economic'),
    env: generateScoreGrid(store.boundary, scoredBoreholes, resolution, 'env'),
    composite: generateScoreGrid(store.boundary, scoredBoreholes, resolution, 'composite'),
  };

  // 3. 生成等值线数据
  const contourLevels = [30, 40, 50, 60, 70, 80, 90];
  const contours = {
    economic: generateContours(grids.economic, contourLevels),
    composite: generateContours(grids.composite, contourLevels),
  };

  // 4. 统计信息
  const stats = calculateGridStats(grids.composite);

  store.scores = { 
    boreholes: scoredBoreholes, 
    grids, 
    contours,
    stats,
    weights,
    resolution,
    boundary: store.boundary
  };
  
  store.boreholes = scoredBoreholes;
  res.json(store.scores);
});

/**
 * GET /api/score
 * 返回最近一次计算的评分结果
 */
router.get('/', (_req, res) => {
  if (!store.scores) {
    return res.status(404).json({ error: '尚无评分数据，请先调用 POST /api/score' });
  }
  res.json(store.scores);
});

/**
 * GET /api/score/grid/:type
 * 获取指定类型的评分网格
 */
router.get('/grid/:type', (req, res) => {
  if (!store.scores) {
    return res.status(404).json({ error: '尚无评分数据' });
  }
  const { type } = req.params;
  const grid = store.scores.grids[type];
  if (!grid) {
    return res.status(400).json({ error: `无效的网格类型: ${type}` });
  }
  res.json({ type, grid, stats: calculateGridStats(grid) });
});

// ---------- 辅助函数 ----------

/**
 * IDW (Inverse Distance Weighting) 插值
 * 生成指定维度的评分网格
 */
function generateScoreGrid(boundary, boreholes, resolution, scoreType) {
  const xs = boundary.map(p => p.x);
  const ys = boundary.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const stepX = (maxX - minX) / resolution;
  const stepY = (maxY - minY) / resolution;

  const grid = {
    minX, maxX, minY, maxY,
    stepX, stepY,
    resolution,
    data: []
  };

  for (let row = 0; row <= resolution; row++) {
    const rowData = [];
    for (let col = 0; col <= resolution; col++) {
      const x = minX + col * stepX;
      const y = minY + row * stepY;
      
      const inside = pointInPolygon({ x, y }, boundary);
      if (!inside) {
        rowData.push(null);
        continue;
      }
      
      // IDW 插值，使用 p=2 的权重
      let numerator = 0, denominator = 0;
      for (const hole of boreholes) {
        const d = Math.hypot(hole.x - x, hole.y - y);
        if (d < 0.001) {
          // 正好在钻孔位置
          numerator = hole.scores[scoreType];
          denominator = 1;
          break;
        }
        const w = 1 / (d * d);
        numerator += w * hole.scores[scoreType];
        denominator += w;
      }
      const value = denominator ? numerator / denominator : 0;
      rowData.push(Math.round(value * 10) / 10);
    }
    grid.data.push(rowData);
  }
  return grid;
}

/**
 * Marching Squares 简化实现 - 生成等值线
 */
function generateContours(grid, levels) {
  const contours = {};
  for (const level of levels) {
    contours[level] = extractContourSegments(grid, level);
  }
  return contours;
}

function extractContourSegments(grid, level) {
  const segments = [];
  const { data, minX, minY, stepX, stepY, resolution } = grid;
  
  for (let row = 0; row < resolution; row++) {
    for (let col = 0; col < resolution; col++) {
      const v00 = data[row]?.[col];
      const v10 = data[row]?.[col + 1];
      const v01 = data[row + 1]?.[col];
      const v11 = data[row + 1]?.[col + 1];
      
      // 跳过包含 null 的单元格
      if (v00 === null || v10 === null || v01 === null || v11 === null) continue;
      
      const x0 = minX + col * stepX;
      const y0 = minY + row * stepY;
      const x1 = x0 + stepX;
      const y1 = y0 + stepY;
      
      // 计算 Marching Squares 索引
      let idx = 0;
      if (v00 >= level) idx |= 1;
      if (v10 >= level) idx |= 2;
      if (v11 >= level) idx |= 4;
      if (v01 >= level) idx |= 8;
      
      // 根据索引生成线段
      const cellSegments = marchingSquaresCell(idx, x0, y0, x1, y1, v00, v10, v01, v11, level);
      segments.push(...cellSegments);
    }
  }
  return segments;
}

function marchingSquaresCell(idx, x0, y0, x1, y1, v00, v10, v01, v11, level) {
  const segments = [];
  const lerp = (a, b, va, vb) => a + (b - a) * (level - va) / (vb - va);
  
  // 边中点插值
  const left = () => ({ x: x0, y: lerp(y0, y1, v00, v01) });
  const right = () => ({ x: x1, y: lerp(y0, y1, v10, v11) });
  const top = () => ({ x: lerp(x0, x1, v01, v11), y: y1 });
  const bottom = () => ({ x: lerp(x0, x1, v00, v10), y: y0 });
  
  // 16 种情况
  switch (idx) {
    case 1: case 14: segments.push([left(), bottom()]); break;
    case 2: case 13: segments.push([bottom(), right()]); break;
    case 3: case 12: segments.push([left(), right()]); break;
    case 4: case 11: segments.push([right(), top()]); break;
    case 5: segments.push([left(), top()], [bottom(), right()]); break;
    case 6: case 9: segments.push([bottom(), top()]); break;
    case 7: case 8: segments.push([left(), top()]); break;
    case 10: segments.push([left(), bottom()], [right(), top()]); break;
  }
  return segments;
}

/**
 * 计算网格统计信息
 */
function calculateGridStats(grid) {
  const values = grid.data.flat().filter(v => v !== null);
  if (values.length === 0) return { min: 0, max: 0, avg: 0, count: 0 };
  
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  
  // 分布统计
  const distribution = {
    low: values.filter(v => v < 40).length,      // 低分区
    medium: values.filter(v => v >= 40 && v < 70).length,  // 中分区
    high: values.filter(v => v >= 70).length,    // 高分区
  };
  
  return {
    min: Math.round(min * 10) / 10,
    max: Math.round(max * 10) / 10,
    avg: Math.round(avg * 10) / 10,
    count: values.length,
    distribution
  };
}

/**
 * 射线法判断点是否在多边形内
 */
function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export default router;
