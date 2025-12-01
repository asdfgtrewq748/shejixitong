import { Router } from 'express';
import store from '../store.js';
import {
  createAxisAlignedWorkface,
  createRoadway
} from '../utils/geometry.js';
import {
  calculatePillarWidth,
  calculateWorkfaceWidth,
  calculateWorkfaceLength,
  determineLayoutDirection,
  getBoundaryLine,
  calculateAreaDimensions,
  rectanglesOverlap,
  calculateWorkfaceDistance
} from '../utils/workfaceDesign.js';

const router = Router();

/**
 * POST /api/design
 * 基于地质模型和评分网格，按照煤矿规程设计工作面布局
 * body: { 
 *   mode: 'safety' | 'economic' | 'env' | 'composite',
 *   roadwayWidth: number,   // 巷道宽度 (默认 4)
 *   minScore: number,       // 最低可开采评分 (默认 50)
 *   boundaryPillar: number  // 边界保护煤柱 (默认 30)
 * }
 */
router.post('/', (req, res) => {
  // 检查必需数据
  if (!store.geology) {
    return res.status(400).json({ error: '请先调用 POST /api/geology 生成地质模型' });
  }
  
  if (!store.scores || !store.scores.grids) {
    return res.status(400).json({ error: '请先调用 POST /api/score 计算评分' });
  }

  const { 
    mode = 'composite',
    roadwayWidth = 4,
    minScore = 50,
    boundaryPillar = 30,   // 边界保护煤柱宽度
    userEdits = null       // 用户自定义内容
  } = req.body;

  const grid = store.scores.grids[mode];
  if (!grid) {
    return res.status(400).json({ error: `无效的评分模式: ${mode}` });
  }

  const boundary = store.boundary;
  const geology = store.geology;

  try {
    // 1. 从地质模型获取关键参数
    const { dipDirection, dipAngle, avgThickness, avgDepth, maxDepth } = geology;
    const areaDims = calculateAreaDimensions(boundary);
    
    // 2. 计算设计参数（基于煤层地质条件）
    const pillarWidth = calculatePillarWidth(avgDepth, avgThickness, dipAngle);
    const workfaceWidth = calculateWorkfaceWidth(avgThickness, avgDepth, dipAngle);
    const workfaceLength = calculateWorkfaceLength(
      Math.max(areaDims.width, areaDims.height),
      boundaryPillar
    );
    
    // 3. 确定工作面布局方向（基于煤层倾向）
    let layoutDirection = determineLayoutDirection(dipDirection, dipAngle);
    if (!layoutDirection) {
      // 倾角小于5度，按采区形状决定
      layoutDirection = areaDims.width >= areaDims.height ? 'horizontal' : 'vertical';
    }
    
    // 4. 布置主巷道（沿采区边界）
    const mainRoadways = planMainRoadwaysOnBoundary(boundary, layoutDirection, roadwayWidth);
    
    // 5. 划分工作面（条带式布局）
    const fixedWorkfaces = userEdits?.workfaces || [];
    const workfaces = planStripWorkfaces(
      grid,
      areaDims,
      layoutDirection,
      workfaceWidth,
      workfaceLength,
      pillarWidth,
      boundaryPillar,
      minScore,
      fixedWorkfaces
    );
    
    // 6. 生成分巷道（简化：仅标记连接关系）
    const branchRoadways = [];
    
    // 7. 计算整体方案评分
    const designScore = calculateDesignScore(grid, workfaces, mainRoadways);

    // 8. 煤柱检查验证
    const pillarValidation = validatePillars(workfaces, mainRoadways, pillarWidth, layoutDirection);
    
    // 9. 构建统一的数据结构
    const roadways = [
      ...mainRoadways,
      ...branchRoadways
    ];

    const design = {
      mode,
      geologyParams: {
        dipDirection,
        dipAngle,
        avgThickness,
        avgDepth,
        maxDepth
      },
      designParams: {
        layoutDirection,
        workfaceWidth,
        workfaceLength,
        pillarWidth,
        roadwayWidth,
        boundaryPillar,
        minScore
      },
      roadways,        // 巷道列表
      workfaces,       // 工作面列表
      pillarValidation, // 煤柱验证结果
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
 * 在采区边界布置主巷道
 * @param {Array} boundary - 边界点
 * @param {string} layoutDirection - 布局方向
 * @param {number} roadwayWidth - 巷道宽度
 * @returns {Array} 主巷道数组
 */
function planMainRoadwaysOnBoundary(boundary, layoutDirection, roadwayWidth) {
  const areaDims = calculateAreaDimensions(boundary);
  const roadways = [];
  
  if (layoutDirection === 'horizontal') {
    // 水平布局：主巷道在北、南边界
    const northBoundary = getBoundaryLine(boundary, 'north');
    const southBoundary = getBoundaryLine(boundary, 'south');
    
    roadways.push(
      createRoadway('MR-N', 'main', northBoundary, roadwayWidth, 0),
      createRoadway('MR-S', 'main', southBoundary, roadwayWidth, 0)
    );
  } else {
    // 垂直布局：主巷道在东、西边界
    const eastBoundary = getBoundaryLine(boundary, 'east');
    const westBoundary = getBoundaryLine(boundary, 'west');
    
    roadways.push(
      createRoadway('MR-E', 'main', eastBoundary, roadwayWidth, 0),
      createRoadway('MR-W', 'main', westBoundary, roadwayWidth, 0)
    );
  }
  
  return roadways;
}

/**
 * 条带式工作面布局
 */
function planStripWorkfaces(
  grid,
  areaDims,
  layoutDirection,
  workfaceWidth,
  workfaceLength,
  pillarWidth,
  boundaryPillar,
  minScore,
  fixedWorkfaces = []
) {
  const workfaces = [...fixedWorkfaces];
  const { minX, maxX, minY, maxY } = areaDims;
  
  let faceId = fixedWorkfaces.length + 1;
  
  if (layoutDirection === 'horizontal') {
    // 水平布局：工作面沿X方向延伸，沿Y方向排列
    const stripLength = Math.min(workfaceLength, (maxX - minX) * 0.9);
    const startX = minX + boundaryPillar;
    let currentY = minY + boundaryPillar;
    
    while (currentY + workfaceWidth + boundaryPillar <= maxY) {
      // 检查是否与用户定义的工作面重叠
      const overlapsFixed = fixedWorkfaces.some(fixed => 
        rectanglesOverlap(
          { x: startX, y: currentY, width: stripLength, height: workfaceWidth },
          { x: fixed.x, y: fixed.y, width: fixed.width, height: fixed.height }
        )
      );
      
      if (!overlapsFixed) {
        const faceScore = calculateAreaScore(grid, startX, currentY, stripLength, workfaceWidth);
        
        if (faceScore >= minScore * 0.6) {
          const workface = createAxisAlignedWorkface(
            `WF-${String(faceId).padStart(2, '0')}`,
            startX,
            currentY,
            stripLength,
            workfaceWidth,
            faceScore
          );
          workface.direction = 'horizontal';
          workface.stripIndex = faceId;
          workfaces.push(workface);
          faceId++;
        }
      }
      
      currentY += workfaceWidth + pillarWidth;
    }
  } else {
    // 垂直布局：工作面沿Y方向延伸，沿X方向排列
    const stripLength = Math.min(workfaceLength, (maxY - minY) * 0.9);
    const startY = minY + boundaryPillar;
    let currentX = minX + boundaryPillar;
    
    while (currentX + workfaceWidth + boundaryPillar <= maxX) {
      const overlapsFixed = fixedWorkfaces.some(fixed => 
        rectanglesOverlap(
          { x: currentX, y: startY, width: workfaceWidth, height: stripLength },
          { x: fixed.x, y: fixed.y, width: fixed.width, height: fixed.height }
        )
      );
      
      if (!overlapsFixed) {
        const faceScore = calculateAreaScore(grid, currentX, startY, workfaceWidth, stripLength);
        
        if (faceScore >= minScore * 0.6) {
          const workface = createAxisAlignedWorkface(
            `WF-${String(faceId).padStart(2, '0')}`,
            currentX,
            startY,
            workfaceWidth,
            stripLength,
            faceScore
          );
          workface.direction = 'vertical';
          workface.stripIndex = faceId;
          workfaces.push(workface);
          faceId++;
        }
      }
      
      currentX += workfaceWidth + pillarWidth;
    }
  }
  
  return workfaces;
}

/**
 * 验证煤柱宽度
 */
function validatePillars(workfaces, mainRoadways, designPillarWidth, layoutDirection) {
  const warnings = [];
  const measurements = [];
  
  // 检查相邻工作面之间的煤柱
  for (let i = 0; i < workfaces.length - 1; i++) {
    const distance = calculateWorkfaceDistance(workfaces[i], workfaces[i + 1], layoutDirection);
    measurements.push({
      face1: workfaces[i].id,
      face2: workfaces[i + 1].id,
      distance: Math.round(distance),
      designed: designPillarWidth
    });
    
    if (Math.abs(distance - designPillarWidth) > 2) {
      warnings.push(`工作面 ${workfaces[i].id} 与 ${workfaces[i + 1].id} 之间煤柱宽度 ${Math.round(distance)}m 偏离设计值 ${designPillarWidth}m`);
    }
  }
  
  return {
    isValid: warnings.length === 0,
    warnings,
    measurements,
    avgPillarWidth: measurements.length > 0 
      ? Math.round(measurements.reduce((sum, m) => sum + m.distance, 0) / measurements.length)
      : designPillarWidth
  };
}

/**
 * 识别高分区域（连通区域聚类）- 保留用于兼容性
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
 * 规划主巷道 - 废弃，保留用于兼容性
 */
function planMainRoadway(grid, boundary, regions, minScore, maxSlope = 15, userMainPath = null) {
  // 已废弃，新方法使用 planMainRoadwaysOnBoundary
  return {
    path: [],
    length: 0,
    avgScore: 0,
    algorithm: 'deprecated'
  };
}

/**
 * 规划工作面 - 废弃，保留用于兼容性
 */
function planWorkfaces(grid, regions, width, length, minScore, fixedWorkfaces = []) {
  // 已废弃，新方法使用 planStripWorkfaces
  return [];
}

/**
 * 规划分巷道 - 废弃，保留用于兼容性
 */
function planBranchRoadways(mainRoadway, workfaces, grid, roadwayWidth) {
  // 已废弃，工作面直接连接边界主巷道
  return [];
}
  // 如果用户提供了主巷道路径，直接使用
  if (userMainPath && userMainPath.length >= 2) {
    const avgScore = calculatePathScore(grid, userMainPath);
    const length = calculatePathLength(userMainPath);
    return {
      path: userMainPath,
      length: Math.round(length),
      avgScore: Math.round(avgScore * 10) / 10,
      algorithm: 'user-defined'
    };
  }

  if (regions.length === 0) {
    throw new Error('未找到符合条件的高分区域');
  }

  const { data, minX, minY, stepX, stepY, resolution } = grid;
  
  // 找最佳入口点（边界上评分最高的位置）
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

  // 将坐标转换为网格单元
  const startCell = coordToGridCell(bestEntry.x, bestEntry.y, grid);
  const goalCell = coordToGridCell(target.x, target.y, grid);

  try {
    // 使用 A* 算法寻找最优路径
    const rawPath = findOptimalPath(grid, startCell, goalCell, {
      maxSlope,
      minScore,
      scoreThreshold: minScore + 10,
      lowScorePenalty: 30,
      boundary
    });

    // 简化路径（移除冗余点）
    const path = simplifyPath(rawPath, 10);

    // 添加路径节点类型标记
    if (path.length > 0) {
      path[0].type = 'entry';
      path[path.length - 1].type = 'junction';
      for (let i = 1; i < path.length - 1; i++) {
        path[i].type = 'waypoint';
      }
    }

    // 计算路径评分和长度
    const avgScore = calculatePathScore(grid, path);
    const length = calculatePathLength(path);

    return {
      path,
      length: Math.round(length),
      avgScore: Math.round(avgScore * 10) / 10,
      algorithm: 'A*'
    };
  } catch (error) {
    // 如果 A* 失败，回退到简单路径
    console.warn('A* 路径搜索失败，使用简化路径:', error.message);
    
    const midX = (bestEntry.x + target.x) / 2;
    const midY = (bestEntry.y + target.y) / 2;

    const path = [
      { x: Math.round(bestEntry.x), y: Math.round(bestEntry.y), type: 'entry' },
      { x: Math.round(midX), y: Math.round(midY), type: 'waypoint' },
      { x: target.x, y: target.y, type: 'junction' }
    ];

    const avgScore = calculatePathScore(grid, path);
    const length = calculatePathLength(path);

    return {
      path,
      length: Math.round(length),
      avgScore: Math.round(avgScore * 10) / 10,
      algorithm: 'fallback'
    };
  }
}

/**
 * 规划工作面 - 条带式布局（符合煤矿规范）
 * 在采区范围内划分统一宽度的条带式工作面，从一侧到另一侧平行排列
 * 支持用户自定义工作面（锁定）
 */
function planWorkfaces(grid, regions, width, length, minScore, fixedWorkfaces = []) {
  const workfaces = [...fixedWorkfaces]; // 首先包含用户锁定的工作面
  const { minX, maxX, minY, maxY, stepX, stepY, data, resolution } = grid;
  
  // 计算采区的有效范围（基于边界或网格范围）
  const areaWidth = maxX - minX;
  const areaHeight = maxY - minY;
  
  // 煤柱宽度（按照规范，工作面之间留20-30m煤柱）
  const pillarWidth = 25;
  
  // 根据采区形状决定条带方向
  // 如果采区较宽，则条带沿Y方向排列（水平条带）
  // 如果采区较高，则条带沿X方向排列（垂直条带）
  const isHorizontalStrips = areaWidth >= areaHeight;
  
  // 工作面参数（符合煤矿规范）
  const faceWidth = Math.min(width, 180);  // 工作面宽度：150-180m
  const faceLength = Math.min(length, areaWidth * 0.7, areaHeight * 0.7); // 工作面长度：根据采区大小自适应
  
  let faceId = 1;
  
  if (isHorizontalStrips) {
    // 水平条带：工作面沿X方向延伸，沿Y方向依次排列
    // 每个条带的长度尽量跨越整个采区宽度
    const stripLength = Math.min(faceLength, areaWidth * 0.85); // 工作面长度（沿X方向）
    const startX = minX + (areaWidth - stripLength) / 2; // 居中放置
    
    // 从底部向上排列条带，留出足够的边界距离
    let currentY = minY + 30; // 距离边界30m
    
    while (currentY + faceWidth + 30 <= maxY) { // 确保上边界也有30m距离
      // 计算该条带的平均评分
      const faceScore = calculateAreaScore(grid, startX, currentY, stripLength, faceWidth);
      
      // 检查该位置是否在有效区域内（至少40%的格点有效）
      const validRatio = calculateValidRatio(grid, startX, currentY, stripLength, faceWidth);
      
      // 检查是否与用户定义的工作面重叠
      const overlapsFixed = fixedWorkfaces.some(fixed => 
        rectanglesOverlap(
          { x: startX, y: currentY, width: stripLength, height: faceWidth },
          { x: fixed.x, y: fixed.y, width: fixed.width, height: fixed.height }
        )
      );
      
      if (!overlapsFixed && validRatio >= 0.4 && faceScore >= minScore * 0.6) {
        const workface = createAxisAlignedWorkface(
          `WF-${String(faceId).padStart(2, '0')}`,
          startX,
          currentY,
          stripLength,
          faceWidth,
          faceScore
        );
        workface.direction = 'horizontal';
        workface.stripIndex = faceId;
        workfaces.push(workface);
        faceId++;
      }
      
      // 下一个工作面位置 = 当前位置 + 工作面宽度 + 煤柱宽度
      currentY += faceWidth + pillarWidth;
    }
  } else {
    // 垂直条带：工作面沿Y方向延伸，沿X方向依次排列
    const stripLength = Math.min(faceLength, areaHeight * 0.85);
    const startY = minY + (areaHeight - stripLength) / 2;
    
    let currentX = minX + 30; // 距离边界30m
    
    while (currentX + faceWidth + 30 <= maxX) {
      const faceScore = calculateAreaScore(grid, currentX, startY, faceWidth, stripLength);
      const validRatio = calculateValidRatio(grid, currentX, startY, faceWidth, stripLength);
      
      // 检查是否与用户定义的工作面重叠
      const overlapsFixed = fixedWorkfaces.some(fixed => 
        rectanglesOverlap(
          { x: currentX, y: startY, width: faceWidth, height: stripLength },
          { x: fixed.x, y: fixed.y, width: fixed.width, height: fixed.height }
        )
      );
      
      if (!overlapsFixed && validRatio >= 0.4 && faceScore >= minScore * 0.6) {
        const workface = createAxisAlignedWorkface(
          `WF-${String(faceId).padStart(2, '0')}`,
          currentX,
          startY,
          faceWidth,
          stripLength,
          faceScore
        );
        workface.direction = 'vertical';
        workface.stripIndex = faceId;
        workfaces.push(workface);
        faceId++;
      }
      
      currentX += faceWidth + pillarWidth;
    }
  }

  // 如果没有找到合适工作面，在采区中心至少生成2-3个工作面
  if (workfaces.length === 0) {
    console.log('未找到符合条件的工作面，在采区中心生成默认工作面...');
    
    if (isHorizontalStrips) {
      // 水平条带：在采区中心生成2-3个平行工作面
      const stripLen = Math.min(faceLength, areaWidth * 0.7);
      const startX = minX + (areaWidth - stripLen) / 2;
      const centerY = (minY + maxY) / 2;
      const numFaces = Math.min(3, Math.floor((maxY - minY - 60) / (faceWidth + pillarWidth)));
      
      for (let i = 0; i < numFaces; i++) {
        const offsetY = centerY - ((numFaces - 1) * (faceWidth + pillarWidth) / 2) + i * (faceWidth + pillarWidth);
        const workface = createAxisAlignedWorkface(
          `WF-${String(i + 1).padStart(2, '0')}`,
          startX,
          offsetY,
          stripLen,
          faceWidth,
          regions.length > 0 ? regions[0].avgScore : 60
        );
        workface.direction = 'horizontal';
        workface.stripIndex = i + 1;
        workfaces.push(workface);
      }
    } else {
      // 垂直条带：在采区中心生成2-3个平行工作面
      const stripLen = Math.min(faceLength, areaHeight * 0.7);
      const startY = minY + (areaHeight - stripLen) / 2;
      const centerX = (minX + maxX) / 2;
      const numFaces = Math.min(3, Math.floor((maxX - minX - 60) / (faceWidth + pillarWidth)));
      
      for (let i = 0; i < numFaces; i++) {
        const offsetX = centerX - ((numFaces - 1) * (faceWidth + pillarWidth) / 2) + i * (faceWidth + pillarWidth);
        const workface = createAxisAlignedWorkface(
          `WF-${String(i + 1).padStart(2, '0')}`,
          offsetX,
          startY,
          faceWidth,
          stripLen,
          regions.length > 0 ? regions[0].avgScore : 60
        );
        workface.direction = 'vertical';
        workface.stripIndex = i + 1;
        workfaces.push(workface);
      }
    }
  }

  return workfaces;
}

/**
 * 计算矩形区域内有效格点的比例
 */
function calculateValidRatio(grid, x, y, width, height) {
  const { data, minX, minY, stepX, stepY, resolution } = grid;
  let valid = 0, total = 0;

  const startCol = Math.floor((x - minX) / stepX);
  const endCol = Math.ceil((x + width - minX) / stepX);
  const startRow = Math.floor((y - minY) / stepY);
  const endRow = Math.ceil((y + height - minY) / stepY);

  for (let row = startRow; row <= endRow && row <= resolution; row++) {
    for (let col = startCol; col <= endCol && col <= resolution; col++) {
      if (row >= 0 && col >= 0) {
        total++;
        if (data[row]?.[col] !== null) {
          valid++;
        }
      }
    }
  }

  return total > 0 ? valid / total : 0;
}

/**
 * 检查两个矩形是否重叠
 */
function rectanglesOverlap(rect1, rect2) {
  return !(
    rect1.x + rect1.width < rect2.x ||
    rect2.x + rect2.width < rect1.x ||
    rect1.y + rect1.height < rect2.y ||
    rect2.y + rect2.height < rect1.y
  );
}

/**
 * 规划分巷道（连接主巷道和工作面）
 * 条带式布局：主巷道沿一侧，分巷道垂直连接各工作面
 * 采用规范的运输巷道和回风巷道布局
 */
function planBranchRoadways(mainRoadway, workfaces, grid, roadwayWidth) {
  const branches = [];
  
  if (workfaces.length === 0) return branches;
  
  // 获取主巷道终点作为分巷道起点
  const junction = mainRoadway.path[mainRoadway.path.length - 1];
  
  // 根据工作面方向确定分巷道连接方式
  const isHorizontal = workfaces[0]?.direction === 'horizontal';

  for (let i = 0; i < workfaces.length; i++) {
    const face = workfaces[i];
    let transportEntry, ventilationExit;
    
    if (isHorizontal) {
      // 水平条带：运输巷道连接左端，回风巷道连接右端
      transportEntry = { 
        x: Math.round(face.x), 
        y: Math.round(face.y + face.length / 2) 
      };
      ventilationExit = { 
        x: Math.round(face.x + face.width), 
        y: Math.round(face.y + face.length / 2) 
      };
    } else {
      // 垂直条带：运输巷道连接下端，回风巷道连接上端
      transportEntry = { 
        x: Math.round(face.x + face.width / 2), 
        y: Math.round(face.y + face.length) 
      };
      ventilationExit = { 
        x: Math.round(face.x + face.width / 2), 
        y: Math.round(face.y) 
      };
    }

    // 运输巷道（从主巷道到工作面入口）
    const transportPath = [
      { x: junction.x, y: junction.y, type: 'junction' },
      { x: transportEntry.x, y: transportEntry.y, type: 'workface-entry' }
    ];
    
    branches.push({
      id: `BR-T${String(i + 1).padStart(2, '0')}`, // T = Transport 运输巷道
      workfaceId: face.id,
      roadwayType: 'transport',
      path: transportPath,
      length: Math.round(Math.hypot(transportEntry.x - junction.x, transportEntry.y - junction.y)),
      width: roadwayWidth
    });

    // 回风巷道（从工作面出口回到主巷道）
    const ventPath = [
      { x: ventilationExit.x, y: ventilationExit.y, type: 'workface-exit' },
      { x: junction.x, y: junction.y, type: 'junction' }
    ];
    
    branches.push({
      id: `BR-V${String(i + 1).padStart(2, '0')}`, // V = Ventilation 回风巷道
      workfaceId: face.id,
      roadwayType: 'ventilation',
      path: ventPath,
      length: Math.round(Math.hypot(ventilationExit.x - junction.x, ventilationExit.y - junction.y)),
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

// calculatePathLength 已从 pathfinding.js 导入，移除本地定义

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
