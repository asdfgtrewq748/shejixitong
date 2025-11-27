import { Router } from 'express';
import store from '../store.js';
import { calcSafetyScore, calcEconomicScore, calcEnvScore } from '../utils/scoreFormulas.js';

const router = Router();

/**
 * POST /api/score
 * 根据权重计算各钻孔综合得分，并生成全区插值网格
 * body: { weights: { safety, economic, env } }
 */
router.post('/', (req, res) => {
  if (store.boreholes.length === 0) {
    return res.status(400).json({ error: '请先导入钻孔数据' });
  }
  const { weights = { safety: 40, economic: 30, env: 30 } } = req.body;
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
        safety: Math.round(safety),
        economic: Math.round(economic),
        env: Math.round(env),
        composite: Math.round(composite),
      },
    };
  });

  // 2. 生成采区网格并用 IDW 插值
  const grid = generateScoreGrid(store.boundary, scoredBoreholes, 20); // 20x20 分辨率

  store.scores = { boreholes: scoredBoreholes, grid, weights };
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

// ---------- 辅助函数 ----------

/**
 * 简易 IDW (Inverse Distance Weighting) 插值
 * 返回网格二维数组 grid[row][col] = { x, y, value }
 */
function generateScoreGrid(boundary, boreholes, resolution = 20) {
  // 计算边界包围盒
  const xs = boundary.map(p => p.x);
  const ys = boundary.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const stepX = (maxX - minX) / resolution;
  const stepY = (maxY - minY) / resolution;

  const grid = [];
  for (let row = 0; row <= resolution; row++) {
    const rowData = [];
    for (let col = 0; col <= resolution; col++) {
      const x = minX + col * stepX;
      const y = minY + row * stepY;
      // 判断是否在边界内（简化：跳过边界外点）
      const inside = pointInPolygon({ x, y }, boundary);
      if (!inside) {
        rowData.push({ x, y, value: null });
        continue;
      }
      // IDW 插值
      let numerator = 0, denominator = 0;
      for (const hole of boreholes) {
        const d = Math.hypot(hole.x - x, hole.y - y) || 0.0001;
        const w = 1 / (d * d);
        numerator += w * hole.scores.composite;
        denominator += w;
      }
      const value = denominator ? numerator / denominator : 0;
      rowData.push({ x, y, value: Math.round(value * 10) / 10 });
    }
    grid.push(rowData);
  }
  return grid;
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
