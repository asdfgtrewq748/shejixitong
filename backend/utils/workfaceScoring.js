/**
 * 工作面综合评分系统
 * 基于8个维度对工作面设计方案进行综合评价
 */

// 默认值常量
const DEFAULT_VALUES = {
  DEPTH: 500,
  THICKNESS: 2.5,
  DIP_ANGLE: 10,
  GAS_CONTENT: 5,
  ROCK_HARDNESS: 7,
  HEAT_VALUE: 20,
  WATER_INDEX: 5,
  VENT_DISTANCE: 1000,
  TRANSPORT_DISTANCE: 800,
  THICKNESS_CV: 0.1,
  DIP_VARIATION: 2,
  GRID_STD: 5
};

/**
 * 验证上下文参数
 * @param {Object} context - 上下文对象
 * @throws {Error} 如果缺少必需参数
 */
function validateContext(context) {
  if (!context) {
    throw new Error('评分上下文不能为空');
  }

  const required = ['grid', 'geology', 'designParams', 'mainRoadways', 'allWorkfaces'];
  const missing = required.filter(key => !context[key]);

  if (missing.length > 0) {
    console.warn(`[评分] 缺少可选参数: ${missing.join(', ')}，将使用默认值`);
  }

  return true;
}

/**
 * 验证工作面对象
 * @param {Object} workface - 工作面对象
 * @throws {Error} 如果工作面数据无效
 */
function validateWorkface(workface) {
  if (!workface) {
    throw new Error('工作面对象不能为空');
  }

  const requiredFields = ['x', 'y', 'width', 'length'];
  const missing = requiredFields.filter(field =>
    workface[field] === undefined || workface[field] === null
  );

  if (missing.length > 0) {
    throw new Error(`工作面缺少必需字段: ${missing.join(', ')}`);
  }

  // 检查数值合法性
  if (workface.width <= 0 || workface.length <= 0) {
    throw new Error(`工作面尺寸必须大于0: width=${workface.width}, length=${workface.length}`);
  }

  return true;
}

/**
 * 计算工作面综合评分
 * @param {Object} workface - 工作面对象
 * @param {Object} context - 上下文信息
 * @returns {Object} 评分结果
 */
export function calculateWorkfaceScore(workface, context = {}) {
  try {
    // 参数验证
    validateWorkface(workface);
    validateContext(context);

    const {
      grid,
      geology,
      designParams,
      mainRoadways,
      allWorkfaces,
      drillHoles = []
    } = context;

    // 1. 地质条件评分 (20分)
    const geologicalScore = calculateGeologicalScore(workface, grid, drillHoles);

    // 2. 安全性评分 (20分)
    const safetyScore = calculateSafetyScore(workface, context);

    // 3. 经济性评分 (15分)
    const economicScore = calculateEconomicScore(workface, context);

    // 4. 技术可行性评分 (15分)
    const technicalScore = calculateTechnicalFeasibilityScore(workface, geology);

    // 5. 开采效率评分 (10分)
    const efficiencyScore = calculateMiningEfficiencyScore(workface, geology);

    // 6. 通风条件评分 (10分)
    const ventilationScore = calculateVentilationScore(workface, mainRoadways);

    // 7. 运输条件评分 (5分)
    const transportScore = calculateTransportScore(workface, mainRoadways);

    // 8. 环保影响评分 (5分)
    const environmentalScore = calculateEnvironmentalScore(workface, geology, drillHoles);

    // 综合评分
    const totalScore =
      geologicalScore.score +
      safetyScore.score +
      economicScore.score +
      technicalScore.score +
      efficiencyScore.score +
      ventilationScore.score +
      transportScore.score +
      environmentalScore.score;

    // 检查否决条件
    const vetoCheck = checkVetoConditions(workface, safetyScore, context);

    // 评级
    const grade = getGrade(totalScore);

    return {
      totalScore: Math.round(totalScore * 10) / 10,
      grade,
      veto: vetoCheck,
      breakdown: {
        geological: geologicalScore,
        safety: safetyScore,
        economic: economicScore,
        technical: technicalScore,
        efficiency: efficiencyScore,
        ventilation: ventilationScore,
        transport: transportScore,
        environmental: environmentalScore
      }
    };
  } catch (error) {
    console.error(`[评分] 工作面 ${workface?.id || 'unknown'} 评分失败:`, error.message);

    // 返回默认评分结果，避免系统崩溃
    return {
      totalScore: 0,
      grade: { level: 'D', desc: '评分失败' },
      veto: { hasVeto: true, vetos: [{ type: 'error', reason: error.message }] },
      breakdown: {},
      error: error.message
    };
  }
}

/**
 * 1. 地质条件评分 (20分)
 */
function calculateGeologicalScore(workface, grid, drillHoles) {
  const details = {};
  let score = 0;

  // 1.1 煤层厚度均匀性 (8分)
  const thicknessVariation = calculateThicknessVariation(workface, drillHoles);
  if (thicknessVariation < 0.1) {
    details.thicknessUniformity = { score: 8, cv: thicknessVariation, desc: '均匀' };
    score += 8;
  } else if (thicknessVariation < 0.2) {
    details.thicknessUniformity = { score: 6, cv: thicknessVariation, desc: '较均匀' };
    score += 6;
  } else if (thicknessVariation < 0.3) {
    details.thicknessUniformity = { score: 4, cv: thicknessVariation, desc: '一般' };
    score += 4;
  } else {
    details.thicknessUniformity = { score: 2, cv: thicknessVariation, desc: '不均匀' };
    score += 2;
  }

  // 1.2 煤层倾角稳定性 (6分)
  const dipAngleVariation = calculateDipAngleVariation(workface, drillHoles);
  if (dipAngleVariation < 3) {
    details.dipStability = { score: 6, variation: dipAngleVariation, desc: '稳定' };
    score += 6;
  } else if (dipAngleVariation < 5) {
    details.dipStability = { score: 4, variation: dipAngleVariation, desc: '较稳定' };
    score += 4;
  } else if (dipAngleVariation < 8) {
    details.dipStability = { score: 2, variation: dipAngleVariation, desc: '不稳定' };
    score += 2;
  } else {
    details.dipStability = { score: 0, variation: dipAngleVariation, desc: '很不稳定' };
  }

  // 1.3 地质构造复杂度 (6分)
  // 简化版：基于地质评分网格的标准差
  const gridScoreStd = calculateGridScoreStd(workface, grid);
  if (gridScoreStd < 5) {
    details.structureComplexity = { score: 6, std: gridScoreStd, desc: '简单' };
    score += 6;
  } else if (gridScoreStd < 10) {
    details.structureComplexity = { score: 4, std: gridScoreStd, desc: '一般' };
    score += 4;
  } else if (gridScoreStd < 15) {
    details.structureComplexity = { score: 2, std: gridScoreStd, desc: '复杂' };
    score += 2;
  } else {
    details.structureComplexity = { score: 0, std: gridScoreStd, desc: '很复杂' };
  }

  return {
    score: Math.round(score * 10) / 10,
    maxScore: 20,
    details
  };
}

/**
 * 2. 安全性评分 (20分)
 */
function calculateSafetyScore(workface, context) {
  const { geology, designParams, allWorkfaces } = context;
  const details = {};
  let score = 0;

  // 2.1 采深安全系数 (8分)
  const depth = geology.avgDepth || 500;
  if (depth < 300) {
    details.depthSafety = { score: 8, depth, desc: '浅部' };
    score += 8;
  } else if (depth < 500) {
    details.depthSafety = { score: 7, depth, desc: '中浅部' };
    score += 7;
  } else if (depth < 700) {
    details.depthSafety = { score: 6, depth, desc: '中深部' };
    score += 6;
  } else if (depth < 900) {
    details.depthSafety = { score: 4, depth, desc: '深部' };
    score += 4;
  } else {
    details.depthSafety = { score: 2, depth, desc: '极深部' };
    score += 2;
  }

  // 2.2 煤柱宽度合规性 (6分)
  const pillarCompliance = calculatePillarCompliance(workface, allWorkfaces, designParams);
  if (pillarCompliance >= 1.0 && pillarCompliance <= 1.2) {
    details.pillarCompliance = { score: 6, ratio: pillarCompliance, desc: '合规' };
    score += 6;
  } else if (pillarCompliance >= 0.9 && pillarCompliance < 1.0) {
    details.pillarCompliance = { score: 4, ratio: pillarCompliance, desc: '略窄' };
    score += 4;
  } else if (pillarCompliance > 1.2 && pillarCompliance <= 1.5) {
    details.pillarCompliance = { score: 4, ratio: pillarCompliance, desc: '过宽' };
    score += 4;
  } else {
    details.pillarCompliance = { score: 0, ratio: pillarCompliance, desc: '不合规' };
  }

  // 2.3 瓦斯风险 (3分)
  const gasContent = workface.avgGasContent || 5;
  if (gasContent < 5) {
    details.gasRisk = { score: 3, gas: gasContent, desc: '低瓦斯' };
    score += 3;
  } else if (gasContent < 10) {
    details.gasRisk = { score: 2, gas: gasContent, desc: '中瓦斯' };
    score += 2;
  } else {
    details.gasRisk = { score: 1, gas: gasContent, desc: '高瓦斯' };
    score += 1;
  }

  // 2.4 顶板稳定性 (3分)
  const rockHardness = workface.avgRockHardness || 7;
  if (rockHardness >= 6 && rockHardness <= 8) {
    details.roofStability = { score: 3, hardness: rockHardness, desc: '稳定' };
    score += 3;
  } else if (rockHardness >= 4 && rockHardness < 6) {
    details.roofStability = { score: 2, hardness: rockHardness, desc: '偏软' };
    score += 2;
  } else if (rockHardness > 8) {
    details.roofStability = { score: 2, hardness: rockHardness, desc: '过硬' };
    score += 2;
  } else {
    details.roofStability = { score: 0, hardness: rockHardness, desc: '极软' };
  }

  return {
    score: Math.round(score * 10) / 10,
    maxScore: 20,
    details
  };
}

/**
 * 3. 经济性评分 (15分)
 */
function calculateEconomicScore(workface, context) {
  const { geology, designParams, allWorkfaces } = context;
  const details = {};
  let score = 0;

  // 3.1 开采成本指数 (6分)
  const depth = geology.avgDepth || 500;
  const dipAngle = geology.dipAngle || 10;
  const thicknessCV = workface.thicknessCV || 0.1;
  const costIndex = (depth / 100) * 1.5 + (dipAngle / 45) * 2.0 + thicknessCV * 3.0;

  if (costIndex < 5) {
    details.costIndex = { score: 6, index: costIndex, desc: '成本低' };
    score += 6;
  } else if (costIndex < 8) {
    details.costIndex = { score: 4, index: costIndex, desc: '成本适中' };
    score += 4;
  } else if (costIndex < 12) {
    details.costIndex = { score: 2, index: costIndex, desc: '成本较高' };
    score += 2;
  } else {
    details.costIndex = { score: 0, index: costIndex, desc: '成本很高' };
  }

  // 3.2 回采率 (5分)
  const recoveryRate = calculateRecoveryRate(workface, allWorkfaces, designParams);
  const recoveryScore = recoveryRate * 5;
  details.recoveryRate = {
    score: Math.round(recoveryScore * 10) / 10,
    rate: recoveryRate,
    desc: `${(recoveryRate * 100).toFixed(1)}%`
  };
  score += recoveryScore;

  // 3.3 煤质经济价值 (4分)
  const heatValue = workface.avgHeatValue || 20;
  if (heatValue > 25) {
    details.coalQuality = { score: 4, heat: heatValue, desc: '优质煤' };
    score += 4;
  } else if (heatValue > 20) {
    details.coalQuality = { score: 3, heat: heatValue, desc: '良煤' };
    score += 3;
  } else if (heatValue > 16) {
    details.coalQuality = { score: 2, heat: heatValue, desc: '中煤' };
    score += 2;
  } else {
    details.coalQuality = { score: 1, heat: heatValue, desc: '劣煤' };
    score += 1;
  }

  return {
    score: Math.round(score * 10) / 10,
    maxScore: 15,
    details
  };
}

/**
 * 4. 技术可行性评分 (15分)
 */
function calculateTechnicalFeasibilityScore(workface, geology) {
  const details = {};
  let score = 0;

  // 4.1 工作面宽度适应性 (5分)
  const width = workface.width;
  if (width >= 150 && width <= 200) {
    details.widthAdaptability = { score: 5, width, desc: '标准范围' };
    score += 5;
  } else if (width >= 120 && width < 150) {
    details.widthAdaptability = { score: 4, width, desc: '略窄' };
    score += 4;
  } else if (width >= 100 && width < 120) {
    details.widthAdaptability = { score: 3, width, desc: '较窄' };
    score += 3;
  } else if (width > 200 && width <= 250) {
    details.widthAdaptability = { score: 3, width, desc: '略宽' };
    score += 3;
  } else {
    details.widthAdaptability = { score: 1, width, desc: '不适宜' };
    score += 1;
  }

  // 4.2 煤层厚度适应性 (5分)
  const thickness = geology.avgThickness || 2.5;
  if (thickness >= 1.3 && thickness <= 3.5) {
    details.thicknessAdaptability = { score: 5, thickness, desc: '中厚煤层' };
    score += 5;
  } else if (thickness > 3.5 && thickness <= 6) {
    details.thicknessAdaptability = { score: 4, thickness, desc: '厚煤层' };
    score += 4;
  } else if (thickness > 0.8 && thickness < 1.3) {
    details.thicknessAdaptability = { score: 3, thickness, desc: '薄煤层' };
    score += 3;
  } else {
    details.thicknessAdaptability = { score: 1, thickness, desc: '不适宜' };
    score += 1;
  }

  // 4.3 倾角适应性 (5分)
  const dipAngle = geology.dipAngle || 10;
  if (dipAngle <= 8) {
    details.dipAdaptability = { score: 5, dipAngle, desc: '近水平' };
    score += 5;
  } else if (dipAngle <= 15) {
    details.dipAdaptability = { score: 4, dipAngle, desc: '缓倾斜' };
    score += 4;
  } else if (dipAngle <= 25) {
    details.dipAdaptability = { score: 3, dipAngle, desc: '倾斜' };
    score += 3;
  } else if (dipAngle <= 45) {
    details.dipAdaptability = { score: 1, dipAngle, desc: '急倾斜' };
    score += 1;
  } else {
    details.dipAdaptability = { score: 0, dipAngle, desc: '极陡' };
  }

  return {
    score: Math.round(score * 10) / 10,
    maxScore: 15,
    details
  };
}

/**
 * 5. 开采效率评分 (10分)
 */
function calculateMiningEfficiencyScore(workface, geology) {
  const details = {};
  let score = 0;

  // 5.1 工作面面积 (4分)
  const area = workface.area || workface.width * workface.length;
  if (area > 100000) {
    details.area = { score: 4, area, desc: '大面积' };
    score += 4;
  } else if (area > 80000) {
    details.area = { score: 3, area, desc: '较大面积' };
    score += 3;
  } else if (area > 60000) {
    details.area = { score: 2, area, desc: '中等面积' };
    score += 2;
  } else {
    details.area = { score: 1, area, desc: '小面积' };
    score += 1;
  }

  // 5.2 长宽比合理性 (3分)
  const aspectRatio = workface.length / workface.width;
  if (aspectRatio >= 4 && aspectRatio <= 8) {
    details.aspectRatio = { score: 3, ratio: aspectRatio, desc: '理想比例' };
    score += 3;
  } else if (aspectRatio >= 3 && aspectRatio < 4) {
    details.aspectRatio = { score: 2, ratio: aspectRatio, desc: '略短' };
    score += 2;
  } else if (aspectRatio > 8 && aspectRatio <= 10) {
    details.aspectRatio = { score: 2, ratio: aspectRatio, desc: '略长' };
    score += 2;
  } else {
    details.aspectRatio = { score: 1, ratio: aspectRatio, desc: '不合理' };
    score += 1;
  }

  // 5.3 可采储量 (3分)
  const thickness = geology.avgThickness || 2.5;
  const reserves = area * thickness * 1.4; // 煤层密度1.4t/m³
  if (reserves > 200000) {
    details.reserves = { score: 3, reserves, desc: '大储量' };
    score += 3;
  } else if (reserves > 150000) {
    details.reserves = { score: 2, reserves, desc: '中储量' };
    score += 2;
  } else {
    details.reserves = { score: 1, reserves, desc: '小储量' };
    score += 1;
  }

  return {
    score: Math.round(score * 10) / 10,
    maxScore: 10,
    details
  };
}

/**
 * 6. 通风条件评分 (10分)
 */
function calculateVentilationScore(workface, mainRoadways) {
  const details = {};
  let score = 0;

  // 6.1 巷道通风距离 (4分)
  const ventDistance = calculateVentilationDistance(workface, mainRoadways);
  if (ventDistance < 1000) {
    details.ventDistance = { score: 4, distance: ventDistance, desc: '通风距离短' };
    score += 4;
  } else if (ventDistance < 1500) {
    details.ventDistance = { score: 3, distance: ventDistance, desc: '通风距离适中' };
    score += 3;
  } else if (ventDistance < 2000) {
    details.ventDistance = { score: 2, distance: ventDistance, desc: '通风距离较长' };
    score += 2;
  } else {
    details.ventDistance = { score: 1, distance: ventDistance, desc: '通风距离长' };
    score += 1;
  }

  // 6.2 瓦斯排放能力 (3分)
  const gasEmissionDemand = (workface.avgGasContent || 5) * workface.width;
  if (gasEmissionDemand < 500) {
    details.gasEmission = { score: 3, demand: gasEmissionDemand, desc: '排放需求低' };
    score += 3;
  } else if (gasEmissionDemand < 1000) {
    details.gasEmission = { score: 2, demand: gasEmissionDemand, desc: '排放需求中等' };
    score += 2;
  } else {
    details.gasEmission = { score: 1, demand: gasEmissionDemand, desc: '排放需求高' };
    score += 1;
  }

  // 6.3 通风系统布局 (3分)
  // 简化版：如果有两条主巷道，认为是U型通风
  if (mainRoadways && mainRoadways.length >= 2) {
    details.ventSystem = { score: 3, desc: 'U型通风' };
    score += 3;
  } else {
    details.ventSystem = { score: 2, desc: '简单通风' };
    score += 2;
  }

  return {
    score: Math.round(score * 10) / 10,
    maxScore: 10,
    details
  };
}

/**
 * 7. 运输条件评分 (5分)
 */
function calculateTransportScore(workface, mainRoadways) {
  const details = {};
  let score = 0;

  // 7.1 运输距离 (3分)
  const transportDist = calculateTransportDistance(workface, mainRoadways);
  if (transportDist < 500) {
    details.transportDistance = { score: 3, distance: transportDist, desc: '距离短' };
    score += 3;
  } else if (transportDist < 1000) {
    details.transportDistance = { score: 2, distance: transportDist, desc: '距离适中' };
    score += 2;
  } else {
    details.transportDistance = { score: 1, distance: transportDist, desc: '距离长' };
    score += 1;
  }

  // 7.2 巷道坡度 (2分)
  // 简化版：假设小于5度
  const slope = 3; // 默认3度
  if (slope < 5) {
    details.roadwaySlope = { score: 2, slope, desc: '坡度小' };
    score += 2;
  } else if (slope < 10) {
    details.roadwaySlope = { score: 1, slope, desc: '坡度适中' };
    score += 1;
  } else {
    details.roadwaySlope = { score: 0, slope, desc: '坡度大' };
  }

  return {
    score: Math.round(score * 10) / 10,
    maxScore: 5,
    details
  };
}

/**
 * 8. 环保影响评分 (5分)
 */
function calculateEnvironmentalScore(workface, geology, drillHoles) {
  const details = {};
  let score = 0;

  // 8.1 地表沉陷风险 (3分)
  const thickness = geology.avgThickness || 2.5;
  const depth = geology.avgDepth || 500;
  const subsidenceRatio = thickness / depth;

  if (subsidenceRatio < 1 / 100) {
    details.subsidenceRisk = { score: 3, ratio: subsidenceRatio, desc: '低沉陷风险' };
    score += 3;
  } else if (subsidenceRatio < 1 / 50) {
    details.subsidenceRisk = { score: 2, ratio: subsidenceRatio, desc: '中等沉陷风险' };
    score += 2;
  } else {
    details.subsidenceRisk = { score: 1, ratio: subsidenceRatio, desc: '高沉陷风险' };
    score += 1;
  }

  // 8.2 水害风险 (2分)
  const waterIndex = workface.avgWaterIndex || 5;
  if (waterIndex < 5) {
    details.waterRisk = { score: 2, index: waterIndex, desc: '低水害风险' };
    score += 2;
  } else if (waterIndex < 10) {
    details.waterRisk = { score: 1, index: waterIndex, desc: '中等水害风险' };
    score += 1;
  } else {
    details.waterRisk = { score: 0, index: waterIndex, desc: '高水害风险' };
  }

  return {
    score: Math.round(score * 10) / 10,
    maxScore: 5,
    details
  };
}

/**
 * 检查否决条件
 */
function checkVetoConditions(workface, safetyScore, context) {
  const vetos = [];

  // 1. 安全性评分过低
  if (safetyScore.score < 10) {
    vetos.push({
      type: 'safety',
      reason: '安全性评分过低，存在重大安全隐患',
      score: safetyScore.score
    });
  }

  // 2. 煤柱宽度严重不合规
  if (safetyScore.details.pillarCompliance && safetyScore.details.pillarCompliance.ratio < 0.9) {
    vetos.push({
      type: 'pillar',
      reason: '煤柱宽度不足，严重违反规程',
      ratio: safetyScore.details.pillarCompliance.ratio
    });
  }

  // 3. 高突风险
  const { geology } = context;
  const gasContent = workface.avgGasContent || 5;
  const depth = geology.avgDepth || 500;
  if (gasContent > 15 && depth > 500) {
    vetos.push({
      type: 'gas',
      reason: '高突风险区域，需要特殊措施',
      gas: gasContent,
      depth
    });
  }

  return {
    hasVeto: vetos.length > 0,
    vetos
  };
}

/**
 * 获取评级
 */
function getGrade(score) {
  if (score >= 90) return { level: 'A+', desc: '优秀' };
  if (score >= 80) return { level: 'A', desc: '良好' };
  if (score >= 70) return { level: 'B+', desc: '较好' };
  if (score >= 60) return { level: 'B', desc: '一般' };
  if (score >= 50) return { level: 'C', desc: '较差' };
  return { level: 'D', desc: '很差' };
}

// ========== 辅助计算函数 ==========

/**
 * 计算煤层厚度变异系数
 */
function calculateThicknessVariation(workface, drillHoles) {
  // 简化版：从钻孔数据中提取工作面范围内的厚度数据
  const thicknesses = getWorkfaceProperty(workface, drillHoles, 'thickness');
  if (thicknesses.length === 0) return DEFAULT_VALUES.THICKNESS_CV;

  const mean = thicknesses.reduce((s, v) => s + v, 0) / thicknesses.length;

  // 防止除零
  if (mean === 0 || isNaN(mean)) {
    return DEFAULT_VALUES.THICKNESS_CV;
  }

  const variance = thicknesses.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / thicknesses.length;
  const std = Math.sqrt(variance);

  const cv = std / mean;
  return isNaN(cv) || !isFinite(cv) ? DEFAULT_VALUES.THICKNESS_CV : cv;
}

/**
 * 计算倾角变化
 */
function calculateDipAngleVariation(workface, drillHoles) {
  const dipAngles = getWorkfaceProperty(workface, drillHoles, 'dipAngle');
  if (dipAngles.length === 0) return DEFAULT_VALUES.DIP_VARIATION;

  const max = Math.max(...dipAngles);
  const min = Math.min(...dipAngles);
  return max - min;
}

/**
 * 计算网格评分标准差
 */
function calculateGridScoreStd(workface, grid) {
  const scores = getGridScoresInWorkface(workface, grid);
  if (scores.length === 0) return DEFAULT_VALUES.GRID_STD;

  const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
  const variance = scores.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / scores.length;
  return Math.sqrt(variance);
}

/**
 * 计算煤柱合规度
 */
function calculatePillarCompliance(workface, allWorkfaces, designParams) {
  if (!designParams) return 1.0;

  const designPillarWidth = designParams.pillarWidth || 25;

  // 这里需要找到相邻工作面并计算实际煤柱宽度
  // 简化版返回合规值
  return 1.0;
}

/**
 * 计算回采率
 */
function calculateRecoveryRate(workface, allWorkfaces, designParams) {
  if (!workface || !designParams) return 0.8; // 默认80%

  const pillarWidth = designParams.pillarWidth || 25;
  const totalWidth = workface.width + pillarWidth;

  // 防止除零
  if (totalWidth === 0) return 0.8;

  const rate = workface.width / totalWidth;
  return isNaN(rate) || !isFinite(rate) ? 0.8 : Math.min(1.0, Math.max(0, rate));
}

/**
 * 计算通风距离
 */
function calculateVentilationDistance(workface, mainRoadways) {
  if (!mainRoadways || mainRoadways.length < 2) {
    return DEFAULT_VALUES.VENT_DISTANCE;
  }

  // 计算工作面中心到回风巷的距离
  const workfaceCenter = {
    x: workface.x + workface.width / 2,
    y: workface.y + workface.length / 2
  };

  const ventRoadway = mainRoadways[1]; // 回风巷

  // 检查path是否存在且不为空
  if (!ventRoadway || !ventRoadway.path || ventRoadway.path.length === 0) {
    return DEFAULT_VALUES.VENT_DISTANCE;
  }

  try {
    const distances = ventRoadway.path.map(p => {
      if (!p || p.x === undefined || p.y === undefined) {
        return Infinity;
      }
      return Math.hypot(p.x - workfaceCenter.x, p.y - workfaceCenter.y);
    });

    const minDist = Math.min(...distances);
    return isFinite(minDist) ? minDist : DEFAULT_VALUES.VENT_DISTANCE;
  } catch (error) {
    console.warn('[评分] 计算通风距离失败:', error.message);
    return DEFAULT_VALUES.VENT_DISTANCE;
  }
}

/**
 * 计算运输距离
 */
function calculateTransportDistance(workface, mainRoadways) {
  if (!mainRoadways || mainRoadways.length === 0) {
    return DEFAULT_VALUES.TRANSPORT_DISTANCE;
  }

  const workfaceCenter = {
    x: workface.x + workface.width / 2,
    y: workface.y + workface.length / 2
  };

  const transportRoadway = mainRoadways[0]; // 运输巷

  // 检查path是否存在且不为空
  if (!transportRoadway || !transportRoadway.path || transportRoadway.path.length === 0) {
    return DEFAULT_VALUES.TRANSPORT_DISTANCE;
  }

  try {
    const distances = transportRoadway.path.map(p => {
      if (!p || p.x === undefined || p.y === undefined) {
        return Infinity;
      }
      return Math.hypot(p.x - workfaceCenter.x, p.y - workfaceCenter.y);
    });

    const minDist = Math.min(...distances);
    return isFinite(minDist) ? minDist : DEFAULT_VALUES.TRANSPORT_DISTANCE;
  } catch (error) {
    console.warn('[评分] 计算运输距离失败:', error.message);
    return DEFAULT_VALUES.TRANSPORT_DISTANCE;
  }
}

/**
 * 从钻孔数据中获取工作面范围内的属性值
 */
function getWorkfaceProperty(workface, drillHoles, property) {
  if (!drillHoles || drillHoles.length === 0) return [];

  return drillHoles
    .filter(hole =>
      hole.x >= workface.x &&
      hole.x <= workface.x + workface.width &&
      hole.y >= workface.y &&
      hole.y <= workface.y + workface.length
    )
    .map(hole => hole[property])
    .filter(v => v !== undefined && v !== null);
}

/**
 * 获取工作面范围内的网格评分
 */
function getGridScoresInWorkface(workface, grid) {
  if (!grid || !grid.data || !Array.isArray(grid.data)) {
    return [];
  }

  // 检查grid数据完整性
  if (!grid.minX === undefined || grid.minY === undefined || !grid.resolution) {
    console.warn('[评分] 网格数据不完整，缺少minX、minY或resolution');
    return [];
  }

  const { data, minX, minY, resolution } = grid;

  // 检查data不为空
  if (data.length === 0 || !Array.isArray(data[0])) {
    return [];
  }

  const scores = [];

  try {
    const startCol = Math.floor((workface.x - minX) / resolution);
    const endCol = Math.ceil((workface.x + workface.width - minX) / resolution);
    const startRow = Math.floor((workface.y - minY) / resolution);
    const endRow = Math.ceil((workface.y + workface.length - minY) / resolution);

    for (let row = startRow; row <= endRow && row < data.length; row++) {
      if (row < 0 || !data[row]) continue;

      for (let col = startCol; col <= endCol && col < data[row].length; col++) {
        if (col >= 0 && data[row][col] !== null && data[row][col] !== undefined) {
          scores.push(data[row][col]);
        }
      }
    }
  } catch (error) {
    console.warn('[评分] 提取网格评分失败:', error.message);
  }

  return scores;
}
