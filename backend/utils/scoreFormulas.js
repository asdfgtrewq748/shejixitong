/**
 * 评分公式模块 - 基于优化指南重构
 * 包含安全、经济、环保三大维度的评分算法
 */

import { clamp, clampScore, safeDiv } from './helpers.js';

// ==================== 安全评分 ====================

/**
 * 安全得分 (百分制)
 * 瓦斯含量越低、岩石硬度适中 → 得分越高
 */
export function calcSafetyScore(hole, ctx = {}) {
  const { gasContent = 0, rockHardness = 5 } = hole;
  const { gasThreshold = 8, idealRockHardness = 7 } = ctx;
  
  // 瓦斯罚分：每单位扣分
  const gasPenalty = (gasContent / gasThreshold) * 50;
  
  // 岩石硬度偏离最佳值时罚分
  const hardnessPenalty = Math.abs(rockHardness - idealRockHardness) * 5;
  
  return clampScore(100 - gasPenalty - hardnessPenalty);
}

// ==================== 环保评分 ====================

/**
 * 地表沉陷风险评分
 * 基于采厚采深比和岩石硬度修正
 */
function scoreSurfaceSubsidence(hole, ctx = {}) {
  const { depth = 100, coalThickness = 3, rockHardness = 7 } = hole;
  const { subsidenceK = 5, idealRockHardness = 7 } = ctx;

  if (depth <= 0 || coalThickness <= 0) {
    // 没有开采或数据异常，视为无沉陷风险
    return 100;
  }

  // 采厚采深比：越大表示沉陷风险越高
  const r = coalThickness / depth;
  let score = 100 - subsidenceK * r * 100;
  score = clampScore(score);

  // 岩石硬度修正（硬度=7最佳，偏离时增加风险）
  const hardnessFactor = clamp(0.5, 1.2, rockHardness / idealRockHardness);
  score = clampScore(score * hardnessFactor);

  return score;
}

/**
 * 含水层扰动/水灾风险评分
 * 优先使用突水系数 T = P/M，退化时使用富水指数
 */
function scoreWaterHazard(hole, ctx = {}) {
  const { 
    aquiferPressure = null,      // 含水层水压 MPa
    aquicludeThickness = null,   // 隔水层厚度 m
    waterRichnessIndex = 0,      // 富水指数 0~1
    groundWater = 0              // 兼容旧字段
  } = hole;
  
  const { criticalWaterPressure = 0.1 } = ctx;

  // 优先使用突水系数（如果有真实数据）
  if (aquiferPressure != null && aquicludeThickness != null && aquicludeThickness > 0) {
    const T = aquiferPressure / aquicludeThickness; // MPa/m
    
    if (T >= criticalWaterPressure) {
      return 0; // 超过临界值，极高风险
    } else {
      // T 越接近 0 越安全
      const score = 100 * (criticalWaterPressure - T) / criticalWaterPressure;
      return clampScore(score);
    }
  }

  // 退化方案1：使用富水指数
  if (waterRichnessIndex > 0) {
    const score = 100 * (1 - clamp(0, 1, waterRichnessIndex));
    return clampScore(score);
  }

  // 退化方案2：使用旧字段 groundWater（兼容现有数据）
  const score = 100 - groundWater * 0.8;
  return clampScore(score);
}

/**
 * 生态破坏评分
 * 基于土地利用类型和距离敏感区域的距离
 */
function scoreEcoImpact(hole, ctx = {}) {
  const {
    ecoLandType = 'wasteland',           // 土地类型
    distanceToWaterBody = 1000,          // 距水体距离 m
    distanceToProtectedArea = 2000       // 距保护区距离 m
  } = hole;
  
  const { 
    waterSafeDistance = 200,
    protectedSafeDistance = 500 
  } = ctx;

  // 基础分：按土地类型
  let score = baseEcoScoreByLandType(ecoLandType);

  // 距水体惩罚：在安全距离内线性衰减
  if (distanceToWaterBody < waterSafeDistance) {
    const factor = distanceToWaterBody / waterSafeDistance;
    score *= clamp(0, 1, factor);
  }

  // 距保护区惩罚：在安全距离内线性衰减
  if (distanceToProtectedArea < protectedSafeDistance) {
    const factor = distanceToProtectedArea / protectedSafeDistance;
    score *= clamp(0, 1, factor);
  }

  return clampScore(score);
}

/**
 * 根据土地利用类型返回基础生态评分
 */
function baseEcoScoreByLandType(landType) {
  const scores = {
    'reserve': 5,        // 保护区，生态价值极高
    'forest': 20,        // 林地
    'farmland': 40,      // 农田
    'grassland': 60,     // 草地
    'construction': 80,  // 建设用地
    'wasteland': 100     // 荒地，生态影响最小
  };
  return scores[landType] || 60;
}

/**
 * 环保总分 - 综合三个子项
 */
export function calcEnvScore(hole, ctx = {}) {
  const { envWeights = { subsidence: 0.4, water: 0.3, eco: 0.3 } } = ctx;
  
  const sSubs = scoreSurfaceSubsidence(hole, ctx);
  const sWater = scoreWaterHazard(hole, ctx);
  const sEco = scoreEcoImpact(hole, ctx);

  const envScore =
    envWeights.subsidence * sSubs +
    envWeights.water * sWater +
    envWeights.eco * sEco;

  return clampScore(envScore);
}

// ==================== 经济评分 ====================

/**
 * 可采储量评分 - 基于距边界距离近似
 * 距边界越远，储量越充足
 */
function scoreLocalReserve(hole, ctx = {}) {
  const { distanceToBoundary = 0 } = hole;
  const { maxLocalReserveRadius = 200 } = ctx;

  const ratio = clamp(0, 1, distanceToBoundary / maxLocalReserveRadius);
  const score = 100 * ratio;
  
  return clampScore(score);
}

/**
 * 煤层厚度评分
 * 使用幂函数，前期增加收益大，后期边际递减
 */
function scoreCoalThickness(hole, ctx = {}) {
  const { coalThickness = 0 } = hole;
  const { idealCoalThickness = 6 } = ctx;

  if (coalThickness <= 0) return 0;

  let ratio = coalThickness / idealCoalThickness;
  
  if (ratio >= 1) {
    return 100; // 达到或超过理想厚度
  }

  // 幂指数 <1，使得前期增加更有收益
  const gamma = 0.7;
  const score = 100 * Math.pow(ratio, gamma);

  return clampScore(score);
}

/**
 * 煤质评分 - 基于发热量
 */
function scoreCoalQuality(hole, ctx = {}) {
  const { calorificValue = null } = hole;
  const { calorificMin = 18, calorificMax = 30 } = ctx;

  if (!calorificValue || !isFinite(calorificValue) || calorificMax <= calorificMin) {
    // 没有正确数据，给中间分
    return 50;
  }

  let norm = (calorificValue - calorificMin) / (calorificMax - calorificMin);
  norm = clamp(0, 1, norm);

  const score = 100 * norm;
  return clampScore(score);
}

/**
 * 经济总分 - 综合三个子项
 */
export function calcEconomicScore(hole, ctx = {}) {
  const { econWeights = { reserve: 0.33, thickness: 0.33, quality: 0.34 } } = ctx;
  
  const sReserve = scoreLocalReserve(hole, ctx);
  const sThick = scoreCoalThickness(hole, ctx);
  const sQuality = scoreCoalQuality(hole, ctx);

  const econScore =
    econWeights.reserve * sReserve +
    econWeights.thickness * sThick +
    econWeights.quality * sQuality;

  return clampScore(econScore);
}
