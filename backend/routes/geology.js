import { Router } from 'express';
import store from '../store.js';
import { generateGeologyModel } from '../utils/geology.js';

const router = Router();

/**
 * POST /api/geology
 * 生成地质模型
 */
router.post('/', (req, res) => {
  if (!store.boreholes || store.boreholes.length === 0) {
    return res.status(400).json({ error: '请先上传钻孔数据' });
  }

  if (!store.boundary || store.boundary.length === 0) {
    return res.status(400).json({ error: '请先上传采区边界数据' });
  }

  const { resolution = 50 } = req.body;

  try {
    const geology = generateGeologyModel(store.boreholes, store.boundary, resolution);
    store.geology = geology;
    
    res.json({
      message: '地质模型生成成功',
      strike: geology.strike,
      dipDirection: geology.dipDirection,
      dipAngle: geology.dipAngle,
      gridInfo: geology.gridInfo,
      generatedAt: geology.generatedAt
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/geology
 * 获取地质模型
 */
router.get('/', (req, res) => {
  if (!store.geology) {
    return res.status(404).json({ error: '尚未生成地质模型' });
  }

  res.json(store.geology);
});

/**
 * GET /api/geology/summary
 * 获取地质模型摘要（不包含大型网格数据）
 */
router.get('/summary', (req, res) => {
  if (!store.geology) {
    return res.status(404).json({ error: '尚未生成地质模型' });
  }

  const { strike, dipDirection, dipAngle, gridInfo, generatedAt } = store.geology;
  
  res.json({
    strike,
    dipDirection,
    dipAngle,
    gridInfo,
    generatedAt
  });
});

export default router;
