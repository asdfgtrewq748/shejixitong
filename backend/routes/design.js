import { Router } from 'express';
import store from '../store.js';

const router = Router();

/**
 * POST /api/design
 * 根据评分网格，智能规划巷道和工作面
 * body: { 
 *   mode: 'safety' | 'economic' | 'env' | 'composite',
 *   workfaceWidth: number,  // 工作面宽度 (默认 150)
 *   workfaceLength: number, // 工作面长度 (默认 80)
 *   roadwayWidth: number,   // 巷道宽度 (默认 4)
 *   minScore: number        // 最低可开采评分 (默认 50)
 * }
 */
router.post('/', (req, res) => {
  if (!store.scores || !store.scores.grids) {
    return res.status(400).json({ error: '请先调用 POST /api/score 计算评分' });
  }

  const { 
    mode = 'economic',
    workfaceWidth = 150,
    workfaceLength = 80,
    roadwayWidth = 4,
    minScore = 50
  } = req.body;

  const grid = store.scores.grids[mode];
  if (!grid) {
    return res.status(400).json({ error: `无效的评分模式: ${mode}` });
  }

  const boundary = store.boundary;

  try {
    // 1. 识别高分区域
    const highScoreRegions = findHighScoreRegions(grid, minScore);
    
    // 2. 规划主巷道（从边界入口到采区中心）
    const mainRoadway = planMainRoadway(grid, boundary, highScoreRegions, minScore);
    
    // 3. 划分工作面
    const workfaces = planWorkfaces(grid, highScoreRegions, workfaceWidth, workfaceLength, minScore);
    
    // 4. 规划分巷道（连接主巷道和各工作面）
    const branchRoadways = planBranchRoadways(mainRoadway, workfaces, grid, roadwayWidth);
    
    // 5. 计算整体方案评分
    const designScore = calculateDesignScore(grid, workfaces, mainRoadway);

    const design = {
      mode,
      params: { workfaceWidth, workfaceLength, roadwayWidth, minScore },
      mainRoadway,
      branchRoadways,
      workfaces,
      highScoreRegions: highScoreRegions.map(r => ({
        center: r.center,
        avgScore: r.avgScore,
        area: r.cells.length
      })),
      designScore,
      gridInfo: {
        minX: grid.minX,
        maxX: grid.maxX,
        minY: grid.minY,
        maxY: grid.maxY,
        resolution: grid.resolution
      },
      generatedAt: new Date().toISOString(),
    };

    store.design = design;
    res.json(design);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/design
 */
router.get('/', (_req, res) => {
  if (!store.design) {
    return res.status(404).json({ error: '尚无设计方案' });
  }
  res.json(store.design);
});

// ==================== 核心算法 ====================

/**
 * 识别高分区域（连通区域聚类）
 */
function findHighScoreRegions(grid, minScore) {
  const { data, minX, minY, stepX, stepY, resolution } = grid;
  const visited = Array.from({ length: resolution + 1 }, () => Array(resolution + 1).fill(false));
  const regions = [];

  for (let row = 0; row <= resolution; row++) {
    for (let col = 0; col <= resolution; col++) {
      if (visited[row][col] || data[row][col] === null || data[row][col] < minScore) {
        continue;
      }
      
      // BFS 找连通区域
      const region = { cells: [], scores: [] };
      const queue = [[row, col]];
      visited[row][col] = true;

      while (queue.length > 0) {
        const [r, c] = queue.shift();
        const score = data[r][c];
        const x = minX + c * stepX;
        const y = minY + r * stepY;
        
        region.cells.push({ row: r, col: c, x, y, score });
        region.scores.push(score);

        // 8邻域搜索
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr > resolution || nc < 0 || nc > resolution) continue;
            if (visited[nr][nc]) continue;
            if (data[nr][nc] === null || data[nr][nc] < minScore) continue;
            visited[nr][nc] = true;
            queue.push([nr, nc]);
          }
        }
      }

      if (region.cells.length >= 4) { // 至少4个格子才算有效区域
        const avgScore = region.scores.reduce((a, b) => a + b, 0) / region.scores.length;
        const cx = region.cells.reduce((s, c) => s + c.x, 0) / region.cells.length;
        const cy = region.cells.reduce((s, c) => s + c.y, 0) / region.cells.length;
        regions.push({
          ...region,
          avgScore: Math.round(avgScore * 10) / 10,
          center: { x: Math.round(cx), y: Math.round(cy) }
        });
      }
    }
  }

  // 按平均分排序
  return regions.sort((a, b) => b.avgScore - a.avgScore);
}

/**
 * 规划主巷道
 * 从边界合适入口点，沿高分区域方向延伸
 */
function planMainRoadway(grid, boundary, regions, minScore) {
  if (regions.length === 0) {
    throw new Error('未找到符合条件的高分区域');
  }

  // 找最佳入口点（边界上评分最高的位置）
  const { data, minX, minY, stepX, stepY, resolution } = grid;
  let bestEntry = { x: boundary[0].x, y: boundary[0].y, score: 0 };
  
  for (const point of boundary) {
    const col = Math.round((point.x - minX) / stepX);
    const row = Math.round((point.y - minY) / stepY);
    if (row >= 0 && row <= resolution && col >= 0 && col <= resolution) {
      const score = data[row]?.[col] || 0;
      if (score > bestEntry.score) {
        bestEntry = { x: point.x, y: point.y, score };
      }
    }
  }

  // 目标点：最大高分区域的中心
  const target = regions[0].center;

  // 简化路径规划：入口 → 中间点 → 目标
  const midX = (bestEntry.x + target.x) / 2;
  const midY = (bestEntry.y + target.y) / 2;

  const path = [
    { x: Math.round(bestEntry.x), y: Math.round(bestEntry.y), type: 'entry' },
    { x: Math.round(midX), y: Math.round(midY), type: 'waypoint' },
    { x: target.x, y: target.y, type: 'junction' }
  ];

  // 计算巷道沿线平均评分
  let totalScore = 0, count = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const steps = 10;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = path[i].x + (path[i + 1].x - path[i].x) * t;
      const y = path[i].y + (path[i + 1].y - path[i].y) * t;
      const col = Math.round((x - minX) / stepX);
      const row = Math.round((y - minY) / stepY);
      if (row >= 0 && row <= resolution && col >= 0 && col <= resolution && data[row][col] !== null) {
        totalScore += data[row][col];
        count++;
      }
    }
  }

  return {
    path,
    length: Math.round(calculatePathLength(path)),
    avgScore: count > 0 ? Math.round(totalScore / count * 10) / 10 : 0
  };
}

/**
 * 规划工作面
 * 在高分区域内划分矩形工作面
 */
function planWorkfaces(grid, regions, width, length, minScore) {
  const workfaces = [];
  const { minX, minY, stepX, stepY, data, resolution } = grid;
  
  let faceId = 1;
  for (const region of regions) {
    if (region.avgScore < minScore) continue;
    
    // 计算区域的包围盒
    const xs = region.cells.map(c => c.x);
    const ys = region.cells.map(c => c.y);
    const regionMinX = Math.min(...xs);
    const regionMaxX = Math.max(...xs);
    const regionMinY = Math.min(...ys);
    const regionMaxY = Math.max(...ys);
    
    // 尝试在区域内放置工作面
    for (let y = regionMinY; y + length <= regionMaxY; y += length + 20) {
      for (let x = regionMinX; x + width <= regionMaxX; x += width + 20) {
        // 检查工作面区域的平均分
        const faceScore = calculateAreaScore(grid, x, y, width, length);
        if (faceScore >= minScore) {
          workfaces.push({
            id: `WF-${String(faceId++).padStart(2, '0')}`,
            x: Math.round(x),
            y: Math.round(y),
            width,
            length,
            avgScore: Math.round(faceScore * 10) / 10,
            region: regions.indexOf(region) + 1
          });
        }
      }
    }
  }

  // 如果没有找到合适工作面，在最高分区域中心放一个
  if (workfaces.length === 0 && regions.length > 0) {
    const bestRegion = regions[0];
    workfaces.push({
      id: 'WF-01',
      x: Math.round(bestRegion.center.x - width / 2),
      y: Math.round(bestRegion.center.y - length / 2),
      width,
      length,
      avgScore: bestRegion.avgScore,
      region: 1
    });
  }

  return workfaces;
}

/**
 * 规划分巷道（连接主巷道和工作面）
 */
function planBranchRoadways(mainRoadway, workfaces, grid, roadwayWidth) {
  const branches = [];
  const junction = mainRoadway.path[mainRoadway.path.length - 1];

  for (const face of workfaces) {
    const faceCenter = {
      x: face.x + face.width / 2,
      y: face.y + face.length / 2
    };

    branches.push({
      id: `BR-${face.id.split('-')[1]}`,
      workfaceId: face.id,
      path: [
        { x: junction.x, y: junction.y, type: 'junction' },
        { x: Math.round(faceCenter.x), y: Math.round(faceCenter.y), type: 'workface' }
      ],
      length: Math.round(Math.hypot(faceCenter.x - junction.x, faceCenter.y - junction.y)),
      width: roadwayWidth
    });
  }

  return branches;
}

/**
 * 计算矩形区域的平均评分
 */
function calculateAreaScore(grid, x, y, width, height) {
  const { data, minX, minY, stepX, stepY, resolution } = grid;
  let total = 0, count = 0;

  const startCol = Math.floor((x - minX) / stepX);
  const endCol = Math.ceil((x + width - minX) / stepX);
  const startRow = Math.floor((y - minY) / stepY);
  const endRow = Math.ceil((y + height - minY) / stepY);

  for (let row = startRow; row <= endRow && row <= resolution; row++) {
    for (let col = startCol; col <= endCol && col <= resolution; col++) {
      if (row >= 0 && col >= 0 && data[row]?.[col] !== null) {
        total += data[row][col];
        count++;
      }
    }
  }

  return count > 0 ? total / count : 0;
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
 * 计算整体设计方案评分
 */
function calculateDesignScore(grid, workfaces, mainRoadway) {
  if (workfaces.length === 0) return 0;

  const avgFaceScore = workfaces.reduce((s, f) => s + f.avgScore, 0) / workfaces.length;
  const totalArea = workfaces.reduce((s, f) => s + f.width * f.length, 0);
  const roadwayScore = mainRoadway.avgScore;

  // 综合评分：60% 工作面评分 + 30% 开采面积 + 10% 巷道安全性
  const score = avgFaceScore * 0.6 + Math.min(100, totalArea / 500) * 0.3 + roadwayScore * 0.1;
  
  return {
    overall: Math.round(score * 10) / 10,
    avgFaceScore: Math.round(avgFaceScore * 10) / 10,
    totalArea,
    workfaceCount: workfaces.length,
    roadwayLength: mainRoadway.length
  };
}

export default router;
