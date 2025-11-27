/**
 * 评分公式模块
 * 可根据实际业务规则调整公式参数
 */

/**
 * 安全得分 (百分制)
 * 瓦斯含量越低、岩石硬度适中 → 得分越高
 */
export function calcSafetyScore(hole) {
  const { gasContent = 0, rockHardness = 5 } = hole;
  // 瓦斯罚分：每 m³/t 扣 8 分
  const gasPenalty = gasContent * 8;
  // 岩石硬度偏离最佳值 7 时罚分
  const hardnessPenalty = Math.abs(rockHardness - 7) * 5;
  return Math.max(0, Math.min(100, 100 - gasPenalty - hardnessPenalty));
}

/**
 * 经济得分 (百分制)
 * 煤层厚度越大 → 得分越高
 */
export function calcEconomicScore(hole) {
  const { coalThickness = 3 } = hole;
  // 基础分 20，每米煤厚加 15 分，上限 100
  return Math.max(0, Math.min(100, 20 + coalThickness * 15));
}

/**
 * 环保得分 (百分制)
 * 含水层影响越小 → 得分越高
 */
export function calcEnvScore(hole) {
  const { groundWater = 0 } = hole;
  // 每单位含水量扣 0.8 分
  return Math.max(0, Math.min(100, 100 - groundWater * 0.8));
}
