import { Router } from 'express';
import store from '../store.js';

const router = Router();

/**
 * POST /api/design
 * 根据得分网格，自动寻找最优巷道路径和工作面位置
 * body: { mode: 'safety' | 'economic' | 'env' | 'composite' }
 *       mode 决定以哪种得分进行优化，默认 composite（综合）
 */
router.post('/', (req, res) => {
  if (!store.scores) {
    return res.status(400).json({ error: '请先调用 POST /api/score 计算评分' });
  }

  const { mode = 'composite' } = req.body;
  const { boreholes, grid, weights } = store.scores;

  // ---------- 1. 寻找高分区域中心（简化：得分 > 80 的网格点聚类中心）----------
  const highScoreCells = [];
  for (const row of grid) {
    for (const cell of row) {
      if (cell.value !== null && cell.value >= 75) {
        highScoreCells.push(cell);
      }
    }
  }

  if (highScoreCells.length === 0) {
    return res.status(400).json({ error: '未找到高分区域，无法生成设计' });
  }

  // 计算高分区域质心作为工作面推荐中心
  const cx = highScoreCells.reduce((s, c) => s + c.x, 0) / highScoreCells.length;
  const cy = highScoreCells.reduce((s, c) => s + c.y, 0) / highScoreCells.length;

  // ---------- 2. 生成简化巷道路径（从边界起点到高分质心）----------
  const boundaryStart = store.boundary[0];
  const roadwayPath = [
    { x: boundaryStart.x + 50, y: boundaryStart.y + 50 },
    { x: cx, y: cy },
  ];

  // ---------- 3. 推荐工作面矩形范围（质心周围）----------
  const faceWidth = 150;
  const faceHeight = 80;
  const workingFace = {
    x: cx - faceWidth / 2,
    y: cy - faceHeight / 2,
    width: faceWidth,
    height: faceHeight,
    centerScore: Math.round(
      highScoreCells.reduce((s, c) => s + c.value, 0) / highScoreCells.length * 10
    ) / 10,
  };

  // ---------- 4. 计算方案整体得分 ----------
  const avgComposite = boreholes.reduce((s, b) => s + b.scores.composite, 0) / boreholes.length;

  const design = {
    mode,
    roadwayPath,
    workingFace,
    overallScore: Math.round(avgComposite * 10) / 10,
    weights,
    generatedAt: new Date().toISOString(),
  };

  store.design = design;
  res.json(design);
});

/**
 * GET /api/design
 * 返回最近生成的设计方案
 */
router.get('/', (_req, res) => {
  if (!store.design) {
    return res.status(404).json({ error: '尚无设计方案，请先调用 POST /api/design' });
  }
  res.json(store.design);
});

export default router;
