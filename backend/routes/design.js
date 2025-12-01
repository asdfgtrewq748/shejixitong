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
  calculateWorkfaceDistance,
  layoutWorkfaces,
  selectStartBoundary
} from '../utils/workfaceDesign.js';
import { generateDXF } from '../utils/dxfExport.js';

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
    userFaceWidth = null,    // 新增：用户自定义工作面宽度
    userPillarWidth = null,  // 新增：用户自定义煤柱宽度
    userEdits = null
  } = req.body;

  const grid = store.scores.grids[mode];
  if (!grid) {
    return res.status(400).json({ error: `无效的评分模式: ${mode}` });
  }

  const boundary = store.boundary;
  const geology = store.geology;

  try {
    // 使用新的工作面布局算法
    const layoutResult = layoutWorkfaces(boundary, geology, {
      userFaceWidth,
      userPillarWidth,
      boundaryPillar,
      minScore,
      scoreGrid: grid
    });
    
    const { workfaces, pillars, stats, design: designParams } = layoutResult;
    
    // 布置主巷道（沿采区边界）
    const mainRoadways = planMainRoadwaysOnBoundary(
      boundary, 
      stats.layoutDirection, 
      roadwayWidth
    );
    
    // 生成分巷道（暂时为空，后续可扩展）
    const branchRoadways = [];
    
    // 计算整体方案评分
    const designScore = calculateDesignScore(grid, workfaces, mainRoadways);

    // 煤柱检查验证
    const pillarValidation = validatePillars(
      workfaces, 
      mainRoadways, 
      stats.pillarWidth, 
      stats.layoutDirection
    );
    
    // 构建统一的数据结构
    const roadways = [...mainRoadways, ...branchRoadways];

    const design = {
      mode,
      geologyParams: {
        dipDirection: geology.dipDirection,
        dipAngle: geology.dipAngle,
        avgThickness: geology.avgThickness,
        avgDepth: geology.avgDepth,
        maxDepth: geology.maxDepth
      },
      designParams: {
        layoutDirection: stats.layoutDirection,
        workfaceWidth: stats.avgFaceWidth,
        pillarWidth: stats.pillarWidth,
        roadwayWidth,
        boundaryPillar,
        minScore,
        faceWidthCalc: designParams.faceWidth,
        pillarWidthCalc: designParams.pillarWidth,
        startBoundary: designParams.startBoundary,
        miningMethod: stats.miningMethod
      },
      roadways,
      workfaces,
      pillars,       // 新增：煤柱数据
      stats,         // 新增：统计信息
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
    
    console.log('=== 设计方案生成完成 ===');
    console.log(`工作面数量: ${workfaces.length}`);
    console.log(`煤柱数量: ${pillars.length}`);
    console.log(`总开采面积: ${stats.totalArea.toFixed(0)}m²`);
    console.log(`布局方向: ${stats.layoutDirection}`);
    console.log(`开采方式: ${stats.miningMethod}`);
    console.log('========================');
    
    res.json(design);
  } catch (err) {
    console.error('设计方案生成失败:', err);
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

/**
 * GET /api/design/export/dxf
 * 导出设计方案为DXF格式
 */
router.get('/export/dxf', (req, res) => {
  if (!store.design) {
    return res.status(404).json({ error: '尚无设计方案' });
  }
  
  try {
    const dxfContent = generateDXF(store.design, store.boundary);
    
    // 设置响应头，提示浏览器下载文件
    res.setHeader('Content-Type', 'application/dxf');
    res.setHeader('Content-Disposition', `attachment; filename="mining_design_${Date.now()}.dxf"`);
    
    res.send(dxfContent);
  } catch (err) {
    res.status(500).json({ error: '导出DXF失败: ' + err.message });
  }
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
 * 验证煤柱宽度
 */
function validatePillars(workfaces, mainRoadways, designPillarWidth, layoutDirection) {
  const warnings = [];
  const measurements = [];
  
  // 使用pillars数组验证，如果没有则使用工作面间距
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

  const avgFaceScore = workfaces.reduce((s, f) => s + (f.avgScore || 100), 0) / workfaces.length;
  const totalArea = workfaces.reduce((s, f) => s + (f.area || f.width * f.length), 0);
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
