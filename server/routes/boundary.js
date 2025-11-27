import { Router } from 'express';
import store from '../store.js';

const router = Router();

/**
 * POST /api/boundary
 * 接收采区边界顶点数组
 * body: { points: [{ x, y }, ...] }
 */
router.post('/', (req, res) => {
  const { points } = req.body;
  if (!Array.isArray(points) || points.length < 3) {
    return res.status(400).json({ error: '边界顶点数至少为 3' });
  }
  store.boundary = points;
  // 重置后续数据
  store.scores = null;
  store.design = null;
  res.json({ message: '边界数据已保存', count: points.length });
});

/**
 * GET /api/boundary
 * 返回当前存储的边界
 */
router.get('/', (_req, res) => {
  res.json({ boundary: store.boundary });
});

export default router;
