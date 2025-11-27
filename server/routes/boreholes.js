import { Router } from 'express';
import store from '../store.js';

const router = Router();

/**
 * POST /api/boreholes
 * 批量导入钻孔数据
 * body: { boreholes: [{ id, x, y, rockHardness, gasContent, coalThickness, groundWater, ... }, ...] }
 */
router.post('/', (req, res) => {
  const { boreholes } = req.body;
  if (!Array.isArray(boreholes) || boreholes.length === 0) {
    return res.status(400).json({ error: '钻孔数组不能为空' });
  }
  store.boreholes = boreholes.map((b, i) => ({
    id: b.id || `ZK-${100 + i}`,
    x: b.x,
    y: b.y,
    rockHardness: b.rockHardness ?? 5,
    gasContent: b.gasContent ?? 0,
    coalThickness: b.coalThickness ?? 3,
    groundWater: b.groundWater ?? 0,
    // 保留额外字段
    ...b,
  }));
  // 重置后续数据
  store.scores = null;
  store.design = null;
  res.json({ message: '钻孔数据已保存', count: store.boreholes.length });
});

/**
 * GET /api/boreholes
 * 返回全部钻孔
 */
router.get('/', (_req, res) => {
  res.json({ boreholes: store.boreholes });
});

export default router;
