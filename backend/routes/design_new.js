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
    boundaryPillar = 30,
    userEdits = null
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
    
    // 6. 生成分巷道
    const branchRoadways = [];
    
    // 7. 计算整体方案评分
    const designScore = calculateDesignScore(grid, workfaces, mainRoadways);

    // 8. 煤柱检查验证
    const pillarValidation = validatePillars(workfaces, mainRoadways, pillarWidth, layoutDirection);
    
    // 9. 构建统一的数据结构
    const roadways = [...mainRoadways, ...branchRoadways];

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
      roadways,
      workfaces,
      pillarValidation,
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
 */
function planMainRoadwaysOnBoundary(boundary, layoutDirection, roadwayWidth) {
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
    const stripLength = Math.min(workfaceLength, (maxX - minX) - 2 * boundaryPillar);
    const startX = minX + boundaryPillar;
    let currentY = minY + boundaryPillar;
    
    while (currentY + workfaceWidth + boundaryPillar <= maxY) {
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
    const stripLength = Math.min(workfaceLength, (maxY - minY) - 2 * boundaryPillar);
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
 * 计算整体设计方案评分
 */
function calculateDesignScore(grid, workfaces, mainRoadways) {
  if (workfaces.length === 0) return {
    overall: 0,
    avgFaceScore: 0,
    totalArea: 0,
    workfaceCount: 0,
    roadwayLength: 0
  };

  const avgFaceScore = workfaces.reduce((s, f) => s + f.avgScore, 0) / workfaces.length;
  const totalArea = workfaces.reduce((s, f) => s + f.width * f.length, 0);
  const roadwayLength = mainRoadways.reduce((s, r) => s + r.length, 0);

  // 综合评分：70% 工作面评分 + 30% 开采面积
  const score = avgFaceScore * 0.7 + Math.min(100, totalArea / 1000) * 0.3;
  
  return {
    overall: Math.round(score * 10) / 10,
    avgFaceScore: Math.round(avgFaceScore * 10) / 10,
    totalArea: Math.round(totalArea),
    workfaceCount: workfaces.length,
    roadwayLength: Math.round(roadwayLength)
  };
}

export default router;
