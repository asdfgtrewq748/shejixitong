/**
 * 地质建模模块
 * 从钻孔数据生成煤层地质模型
 */

/**
 * 验证地质数据有效性
 * @param {Array} boreholes - 钻孔数据数组
 * @param {Array} boundary - 采区边界
 * @returns {Object} 验证结果 {isValid, errors, warnings}
 */
export function validateGeologyData(boreholes, boundary) {
  const errors = [];
  const warnings = [];
  
  // 验证钻孔数据
  if (!boreholes || boreholes.length === 0) {
    errors.push('钻孔数据为空');
  } else {
    if (boreholes.length < 3) {
      warnings.push(`钻孔数量较少(${boreholes.length}个)，可能影响建模精度，建议至少3个钻孔`);
    }
    
    // 验证每个钻孔的必要字段
    boreholes.forEach((bh, idx) => {
      if (bh.x === null || bh.x === undefined || isNaN(bh.x)) {
        errors.push(`钻孔[${idx}] X坐标无效`);
      }
      if (bh.y === null || bh.y === undefined || isNaN(bh.y)) {
        errors.push(`钻孔[${idx}] Y坐标无效`);
      }
      if (!bh.topElevation && !bh.bottomElevation && !bh.coalThickness) {
        warnings.push(`钻孔[${idx}] (${bh.name || 'unnamed'}) 缺少高程或厚度数据`);
      }
    });
  }
  
  // 验证边界数据
  if (!boundary || boundary.length < 3) {
    errors.push('采区边界点数量不足（至少需要3个点）');
  } else {
    boundary.forEach((pt, idx) => {
      if (pt.x === null || pt.x === undefined || isNaN(pt.x)) {
        errors.push(`边界点[${idx}] X坐标无效`);
      }
      if (pt.y === null || pt.y === undefined || isNaN(pt.y)) {
        errors.push(`边界点[${idx}] Y坐标无效`);
      }
    });
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * 生成地质模型
 * @param {Array} boreholes - 钻孔数据数组
 * @param {Object} boundary - 采区边界
 * @param {number} resolution - 网格分辨率
 * @returns {Object} 地质模型对象
 */
export function generateGeologyModel(boreholes, boundary, resolution = 50) {
  // 验证输入数据
  const validation = validateGeologyData(boreholes, boundary);
  if (!validation.isValid) {
    throw new Error('数据验证失败: ' + validation.errors.join('; '));
  }
  
  // 输出警告信息
  if (validation.warnings.length > 0) {
    console.warn('地质数据警告:', validation.warnings);
  }

  // 计算边界范围
  const { minX, maxX, minY, maxY } = calculateBounds(boundary);
  const stepX = (maxX - minX) / resolution;
  const stepY = (maxY - minY) / resolution;

  // 1. 插值生成顶板高程网格
  const surfaceTop = interpolateSurface(
    boreholes, 
    'topElevation', 
    { minX, maxX, minY, maxY, stepX, stepY, resolution },
    boundary
  );

  // 2. 插值生成底板高程网格
  const surfaceBottom = interpolateSurface(
    boreholes,
    'bottomElevation',
    { minX, maxX, minY, maxY, stepX, stepY, resolution },
    boundary
  );

  // 3. 计算煤厚网格
  const thicknessGrid = calculateThicknessGrid(surfaceTop, surfaceBottom);

  // 4. 拟合平面计算走向和倾角
  const boreholePoints = boreholes
    .filter(b => b.topElevation !== null && b.topElevation !== undefined)
    .map(b => ({ x: b.x, y: b.y, z: b.topElevation }));

  const { strike, dipDirection, dipAngle } = calculateStrikeAndDip(boreholePoints);

  // 5. 计算煤层平均厚度和埋深
  const avgThickness = calculateAverageThickness(boreholes);
  const avgDepth = calculateAverageDepth(boreholes);
  const maxDepth = Math.max(...boreholes.map(b => b.depth || b.bottomElevation || 0).filter(d => d > 0));
  const minDepth = Math.min(...boreholes.map(b => b.depth || b.topElevation || Infinity).filter(d => d < Infinity));

  const model = {
    surfaceTop,
    surfaceBottom,
    thicknessGrid,
    strike,          // 走向方位角（度，0-360）
    dipDirection,    // 倾向方位角（度，0-360）
    dipAngle,        // 倾角（度）
    avgThickness,    // 平均煤层厚度（m）
    avgDepth,        // 平均埋深（m）
    maxDepth,        // 最大埋深（m）
    minDepth,        // 最小埋深（m）
    gridInfo: {
      minX,
      maxX,
      minY,
      maxY,
      stepX,
      stepY,
      resolution
    },
    validation,      // 包含验证信息
    generatedAt: new Date().toISOString()
  };
  
  // 输出关键参数用于验证
  console.log('=== 地质模型生成完成 ===');
  console.log(`煤层倾向: ${dipDirection.toFixed(1)}° (${getDirectionName(dipDirection)})`);
  console.log(`煤层倾角: ${dipAngle.toFixed(1)}°`);
  console.log(`煤层走向: ${strike.toFixed(1)}° (${getDirectionName(strike)})`);
  console.log(`平均厚度: ${avgThickness.toFixed(2)}m`);
  console.log(`平均埋深: ${avgDepth.toFixed(2)}m`);
  console.log(`埋深范围: ${minDepth.toFixed(2)}m - ${maxDepth.toFixed(2)}m`);
  console.log(`钻孔数量: ${boreholes.length}个`);
  console.log('========================');
  
  return model;
}

/**
 * 获取方位角的方向名称
 * @param {number} azimuth - 方位角（度，0-360）
 * @returns {string} 方向名称
 */
function getDirectionName(azimuth) {
  if (azimuth >= 337.5 || azimuth < 22.5) return '北';
  if (azimuth >= 22.5 && azimuth < 67.5) return '东北';
  if (azimuth >= 67.5 && azimuth < 112.5) return '东';
  if (azimuth >= 112.5 && azimuth < 157.5) return '东南';
  if (azimuth >= 157.5 && azimuth < 202.5) return '南';
  if (azimuth >= 202.5 && azimuth < 247.5) return '西南';
  if (azimuth >= 247.5 && azimuth < 292.5) return '西';
  return '西北';
}

/**
 * 计算边界范围
 */
function calculateBounds(boundary) {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const point of boundary) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, maxX, minY, maxY };
}

/**
 * 使用 IDW（反距离权重）插值生成表面网格
 * @param {Array} boreholes - 钻孔数据
 * @param {string} field - 要插值的字段名
 * @param {Object} gridParams - 网格参数
 * @param {Array} boundary - 边界多边形
 * @returns {Array} 二维高程网格
 */
function interpolateSurface(boreholes, field, gridParams, boundary) {
  const { minX, minY, stepX, stepY, resolution } = gridParams;
  const surface = Array.from({ length: resolution + 1 }, () => 
    Array(resolution + 1).fill(null)
  );

  // 过滤有效钻孔数据
  const validBoreholes = boreholes.filter(b => 
    b[field] !== null && b[field] !== undefined && !isNaN(b[field])
  );

  if (validBoreholes.length === 0) {
    console.warn(`没有有效的 ${field} 数据`);
    return surface;
  }

  // IDW 参数
  const power = 2; // 距离权重幂次

  for (let i = 0; i <= resolution; i++) {
    for (let j = 0; j <= resolution; j++) {
      const x = minX + j * stepX;
      const y = minY + i * stepY;

      // 检查是否在边界内
      if (!pointInPolygon({ x, y }, boundary)) {
        continue;
      }

      let numerator = 0;
      let denominator = 0;

      for (const bh of validBoreholes) {
        const dist = Math.hypot(bh.x - x, bh.y - y);
        
        // 如果点恰好在钻孔位置，直接使用钻孔值
        if (dist < 1e-6) {
          surface[i][j] = bh[field];
          numerator = -1; // 标记已找到精确值
          break;
        }

        const weight = 1 / Math.pow(dist, power);
        numerator += weight * bh[field];
        denominator += weight;
      }

      if (numerator !== -1 && denominator > 0) {
        surface[i][j] = numerator / denominator;
      }
    }
  }

  return surface;
}

/**
 * 计算煤厚网格
 */
function calculateThicknessGrid(surfaceTop, surfaceBottom) {
  const rows = surfaceTop.length;
  const cols = surfaceTop[0].length;
  const thickness = Array.from({ length: rows }, () => Array(cols).fill(null));

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const top = surfaceTop[i][j];
      const bottom = surfaceBottom[i][j];
      
      if (top !== null && bottom !== null) {
        thickness[i][j] = Math.abs(top - bottom);
      }
    }
  }

  return thickness;
}

/**
 * 计算煤层走向和倾角
 * 使用最小二乘法拟合平面
 * @param {Array} points - 点数组 [{x, y, z}, ...]
 * @returns {Object} {strike, dipDirection, dipAngle}
 */
function calculateStrikeAndDip(points) {
  if (points.length < 3) {
    console.warn('钻孔点数量不足，无法计算走向倾角');
    return { strike: 0, dipDirection: 0, dipAngle: 0 };
  }

  // 使用最小二乘法拟合平面 z = ax + by + c
  const { a, b, c } = fitPlane(points);

  // 倾角：arctan(√(a² + b²))
  const dipAngle = Math.atan(Math.sqrt(a * a + b * b)) * (180 / Math.PI);

  // 倾向：atan2(b, a)，表示坡度下降最快的方向
  let dipDirection = Math.atan2(b, a) * (180 / Math.PI);
  if (dipDirection < 0) dipDirection += 360;

  // 走向：倾向 + 90度（垂直于倾向）
  let strike = (dipDirection + 90) % 360;

  return {
    strike: Math.round(strike * 10) / 10,
    dipDirection: Math.round(dipDirection * 10) / 10,
    dipAngle: Math.round(dipAngle * 10) / 10
  };
}

/**
 * 最小二乘法拟合平面
 * 拟合方程: z = ax + by + c
 */
function fitPlane(points) {
  const n = points.length;
  
  let sumX = 0, sumY = 0, sumZ = 0;
  let sumX2 = 0, sumY2 = 0, sumXY = 0;
  let sumXZ = 0, sumYZ = 0;

  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumZ += p.z;
    sumX2 += p.x * p.x;
    sumY2 += p.y * p.y;
    sumXY += p.x * p.y;
    sumXZ += p.x * p.z;
    sumYZ += p.y * p.z;
  }

  // 构建法方程组并求解
  // [ sumX2  sumXY  sumX ] [ a ]   [ sumXZ ]
  // [ sumXY  sumY2  sumY ] [ b ] = [ sumYZ ]
  // [ sumX   sumY   n    ] [ c ]   [ sumZ  ]

  const det = sumX2 * (sumY2 * n - sumY * sumY) 
            - sumXY * (sumXY * n - sumX * sumY) 
            + sumX * (sumXY * sumY - sumY2 * sumX);

  if (Math.abs(det) < 1e-10) {
    console.warn('平面拟合行列式接近零，使用简化计算');
    return { a: 0, b: 0, c: sumZ / n };
  }

  const a = (sumXZ * (sumY2 * n - sumY * sumY) 
           - sumYZ * (sumXY * n - sumX * sumY) 
           + sumZ * (sumXY * sumY - sumY2 * sumX)) / det;

  const b = (sumX2 * (sumYZ * n - sumZ * sumY) 
           - sumXY * (sumXZ * n - sumZ * sumX) 
           + sumX * (sumXZ * sumY - sumYZ * sumX)) / det;

  const c = (sumX2 * (sumY2 * sumZ - sumYZ * sumY) 
           - sumXY * (sumXY * sumZ - sumXZ * sumY) 
           + sumX * (sumXY * sumYZ - sumY2 * sumXZ)) / det;

  return { a, b, c };
}

/**
 * 点是否在多边形内
 */
function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    
    const intersect = ((yi > point.y) !== (yj > point.y))
        && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * 计算煤层平均厚度
 */
function calculateAverageThickness(boreholes) {
  const validThickness = boreholes
    .map(b => b.coalThickness)
    .filter(t => t !== null && t !== undefined && t > 0);
  
  if (validThickness.length === 0) return 3; // 默认值
  
  const sum = validThickness.reduce((a, b) => a + b, 0);
  return Math.round((sum / validThickness.length) * 100) / 100;
}

/**
 * 计算煤层平均埋深
 */
function calculateAverageDepth(boreholes) {
  const validDepth = boreholes
    .map(b => b.depth || b.topElevation)
    .filter(d => d !== null && d !== undefined && d > 0);
  
  if (validDepth.length === 0) return 400; // 默认值
  
  const sum = validDepth.reduce((a, b) => a + b, 0);
  return Math.round((sum / validDepth.length) * 100) / 100;
}

/**
 * 从网格获取指定坐标的高程值（双线性插值）
 * @param {Array} grid - 高程网格
 * @param {Object} gridInfo - 网格参数
 * @param {number} x - X坐标
 * @param {number} y - Y坐标
 * @returns {number|null} 高程值
 */
export function getElevationAt(grid, gridInfo, x, y) {
  const { minX, minY, stepX, stepY, resolution } = gridInfo;
  
  const col = (x - minX) / stepX;
  const row = (y - minY) / stepY;
  
  const col0 = Math.floor(col);
  const row0 = Math.floor(row);
  const col1 = Math.ceil(col);
  const row1 = Math.ceil(row);
  
  if (row0 < 0 || row1 > resolution || col0 < 0 || col1 > resolution) {
    return null;
  }
  
  const v00 = grid[row0]?.[col0];
  const v01 = grid[row0]?.[col1];
  const v10 = grid[row1]?.[col0];
  const v11 = grid[row1]?.[col1];
  
  if (v00 === null || v01 === null || v10 === null || v11 === null) {
    return null;
  }
  
  // 双线性插值
  const tx = col - col0;
  const ty = row - row0;
  
  const v0 = v00 * (1 - tx) + v01 * tx;
  const v1 = v10 * (1 - tx) + v11 * tx;
  
  return v0 * (1 - ty) + v1 * ty;
}
