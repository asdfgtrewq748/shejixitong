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
import { calculateWorkfaceScore } from '../utils/workfaceScoring.js';

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

    // 生成开切眼（连接工作面与主巷道）
    const branchRoadways = generateCutEyes(
      workfaces,
      mainRoadways,
      stats.layoutDirection,
      grid,
      minScore
    );

    // 为每个工作面计算详细评分
    const scoringContext = {
      grid,
      geology,
      designParams: {
        ...designParams,
        pillarWidth: stats.pillarWidth,
        layoutDirection: stats.layoutDirection
      },
      mainRoadways,
      allWorkfaces: workfaces,
      drillHoles: store.drillHoles || []
    };

    workfaces.forEach(workface => {
      const scoreResult = calculateWorkfaceScore(workface, scoringContext);
      workface.detailedScore = scoreResult;
      workface.totalScore = scoreResult.totalScore;
      workface.grade = scoreResult.grade;
    });

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
 * 生成开切眼（连接工作面与主巷道）
 * 根据地质条件和距离选择最优位置
 */
function generateCutEyes(workfaces, mainRoadways, layoutDirection, grid, minScore = 50) {
  const cutEyes = [];

  if (workfaces.length === 0 || mainRoadways.length < 2) {
    return cutEyes;
  }

  // 识别运输巷和回风巷
  const transportRoadway = mainRoadways[0]; // 第一条主巷道作为运输巷
  const ventilationRoadway = mainRoadways[1]; // 第二条主巷道作为回风巷

  workfaces.forEach((workface, idx) => {
    // 为每个工作面生成两条开切眼：一条连接运输巷，一条连接回风巷

    // 1. 运输开切眼
    const transportCutEye = findOptimalCutEyePosition(
      workface,
      transportRoadway,
      layoutDirection,
      grid,
      minScore,
      'transport'
    );

    if (transportCutEye) {
      cutEyes.push({
        id: `Cut-T-${idx + 1}`,
        type: 'cut',
        subType: 'transport',
        path: transportCutEye.path,
        width: 6.0,
        length: transportCutEye.length,
        avgScore: transportCutEye.avgScore,
        workfaceId: workface.id
      });
    }

    // 2. 回风开切眼
    const ventilationCutEye = findOptimalCutEyePosition(
      workface,
      ventilationRoadway,
      layoutDirection,
      grid,
      minScore,
      'ventilation'
    );

    if (ventilationCutEye) {
      cutEyes.push({
        id: `Cut-V-${idx + 1}`,
        type: 'cut',
        subType: 'ventilation',
        path: ventilationCutEye.path,
        width: 6.0,
        length: ventilationCutEye.length,
        avgScore: ventilationCutEye.avgScore,
        workfaceId: workface.id
      });
    }
  });

  return cutEyes;
}

/**
 * 寻找最优的开切眼位置
 * 考虑因素：距离最短、地质条件良好、避免穿过其他工作面
 */
function findOptimalCutEyePosition(workface, roadway, layoutDirection, grid, minScore, type) {
  const roadwayPath = roadway.path;
  if (!roadwayPath || roadwayPath.length === 0) {
    return null;
  }

  // 确定工作面的连接边（靠近巷道的一侧）
  let connectPoint;

  if (layoutDirection === 'horizontal') {
    // 水平布局：工作面横向排列
    // 运输开切眼连接工作面底部，回风开切眼连接顶部
    if (type === 'transport') {
      // 连接工作面底部中点
      connectPoint = {
        x: workface.x + workface.width / 2,
        y: workface.y
      };
    } else {
      // 连接工作面顶部中点
      connectPoint = {
        x: workface.x + workface.width / 2,
        y: workface.y + workface.length
      };
    }
  } else {
    // 垂直布局：工作面纵向排列
    // 运输开切眼连接工作面左侧，回风开切眼连接右侧
    if (type === 'transport') {
      // 连接工作面左侧中点
      connectPoint = {
        x: workface.x,
        y: workface.y + workface.length / 2
      };
    } else {
      // 连接工作面右侧中点
      connectPoint = {
        x: workface.x + workface.width,
        y: workface.y + workface.length / 2
      };
    }
  }

  // 在巷道路径上寻找最优连接点
  let bestPoint = null;
  let minDistance = Infinity;
  let bestSegmentIdx = 0;

  roadwayPath.forEach((point, idx) => {
    const dist = Math.hypot(point.x - connectPoint.x, point.y - connectPoint.y);
    if (dist < minDistance) {
      minDistance = dist;
      bestPoint = point;
      bestSegmentIdx = idx;
    }
  });

  if (!bestPoint) {
    return null;
  }

  // 生成开切眼路径（直线连接）
  const path = [
    { x: connectPoint.x, y: connectPoint.y },
    { x: bestPoint.x, y: bestPoint.y }
  ];

  // 计算路径上的平均地质评分
  const avgScore = calculatePathScore(path, grid);

  // 如果地质条件太差，返回null（不生成该开切眼）
  if (avgScore < minScore * 0.8) {
    return null;
  }

  return {
    path,
    length: minDistance,
    avgScore
  };
}

/**
 * 计算路径上的平均地质评分
 */
function calculatePathScore(path, grid) {
  if (path.length < 2) return 100;

  const samples = 10; // 在路径上采样10个点
  let totalScore = 0;
  let validSamples = 0;

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = path[0].x + t * (path[path.length - 1].x - path[0].x);
    const y = path[0].y + t * (path[path.length - 1].y - path[0].y);

    // 从网格中获取评分
    const col = Math.floor((x - grid.minX) / grid.resolution);
    const row = Math.floor((y - grid.minY) / grid.resolution);

    if (row >= 0 && row < grid.data.length && col >= 0 && col < grid.data[0].length) {
      totalScore += grid.data[row][col];
      validSamples++;
    }
  }

  return validSamples > 0 ? totalScore / validSamples : 100;
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
    roadwayLength: 0,
    scoreDistribution: {}
  };

  // 使用新的详细评分
  const avgFaceScore = workfaces.reduce((s, f) => s + (f.totalScore || f.avgScore || 100), 0) / workfaces.length;
  const totalArea = workfaces.reduce((s, f) => s + (f.area || f.width * f.length), 0);
  const roadwayLength = mainRoadways.reduce((s, r) => s + r.length, 0);

  // 综合评分：70% 工作面平均评分 + 30% 开采面积
  const score = avgFaceScore * 0.7 + Math.min(100, totalArea / 1000) * 0.3;

  // 评分分布统计
  const scoreDistribution = {
    'A+ (90-100)': workfaces.filter(f => (f.totalScore || 100) >= 90).length,
    'A (80-89)': workfaces.filter(f => (f.totalScore || 100) >= 80 && (f.totalScore || 100) < 90).length,
    'B+ (70-79)': workfaces.filter(f => (f.totalScore || 100) >= 70 && (f.totalScore || 100) < 80).length,
    'B (60-69)': workfaces.filter(f => (f.totalScore || 100) >= 60 && (f.totalScore || 100) < 70).length,
    'C (50-59)': workfaces.filter(f => (f.totalScore || 100) >= 50 && (f.totalScore || 100) < 60).length,
    'D (<50)': workfaces.filter(f => (f.totalScore || 100) < 50).length
  };

  return {
    overall: Math.round(score * 10) / 10,
    avgFaceScore: Math.round(avgFaceScore * 10) / 10,
    totalArea: Math.round(totalArea),
    workfaceCount: workfaces.length,
    roadwayLength: Math.round(roadwayLength),
    scoreDistribution
  };
}

export default router;
