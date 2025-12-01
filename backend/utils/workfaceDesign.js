/**
 * 工作面设计核心算法模块
 * 按照煤矿规程实现工作面布局设计
 */

/**
 * 选择工作面起布置边界
 * 根据煤层倾向，优先选择下倾侧边界实现仰斜开采
 * @param {Array} boundary - 采区边界点数组
 * @param {number} dipDirection - 倾向方位角（度，0-360）
 * @param {number} dipAngle - 倾角（度）
 * @returns {Object} {side, line, description}
 */
export function selectStartBoundary(boundary, dipDirection, dipAngle = 0) {
  const areaDims = calculateAreaDimensions(boundary);
  
  // 如果倾角很小（近水平），按采区形状选择长边
  if (dipAngle < 5) {
    const side = areaDims.width >= areaDims.height ? 'south' : 'west';
    return {
      side,
      line: getBoundaryLine(boundary, side),
      description: `煤层近水平（倾角${dipAngle.toFixed(1)}°），选择${getSideName(side)}作为起始边界`
    };
  }
  
  // 根据倾向确定下倾侧（实现仰斜开采）
  let downdipSide;
  let layoutDirection;
  
  if ((dipDirection >= 0 && dipDirection < 45) || dipDirection >= 315) {
    // 倾向北，下倾侧在北边，工作面从南向北推进（仰斜）
    downdipSide = 'south';
    layoutDirection = 'horizontal';
  } else if (dipDirection >= 45 && dipDirection < 135) {
    // 倾向东，下倾侧在东边，工作面从西向东推进（仰斜）
    downdipSide = 'west';
    layoutDirection = 'vertical';
  } else if (dipDirection >= 135 && dipDirection < 225) {
    // 倾向南，下倾侧在南边，工作面从北向南推进（仰斜）
    downdipSide = 'north';
    layoutDirection = 'horizontal';
  } else {
    // 倾向西，下倾侧在西边，工作面从东向西推进（仰斜）
    downdipSide = 'east';
    layoutDirection = 'vertical';
  }
  
  return {
    side: downdipSide,
    line: getBoundaryLine(boundary, downdipSide),
    layoutDirection,
    description: `煤层倾向${getDirectionName(dipDirection)}（${dipDirection.toFixed(1)}°），倾角${dipAngle.toFixed(1)}°，从${getSideName(downdipSide)}开始布置实现仰斜开采`
  };
}

/**
 * 获取方位角的方向名称
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
 * 获取边界方向的中文名称
 */
function getSideName(side) {
  const names = {
    'north': '北边界',
    'south': '南边界',
    'east': '东边界',
    'west': '西边界'
  };
  return names[side] || side;
}

/**
 * 计算煤柱宽度
 * 基于《煤矿安全规程》和《建筑物、水体、铁路及主要井巷煤柱留设与压煤开采规程》
 * @param {number} depth - 采深（m）
 * @param {number} thickness - 煤层厚度（m）
 * @param {number} dipAngle - 倾角（度）
 * @param {number} rockStrength - 顶板岩石强度系数（默认1.0）
 * @returns {Object} {width, formula, description}
 */
export function calculatePillarWidth(depth, thickness = 3, dipAngle = 0, rockStrength = 1.0) {
  // 规程公式: B = 2 * H * tan(φ) / K + 2 * S0
  // 简化为: B = H / K + 2 * S0
  // 其中：
  // H - 采深（m）
  // K - 矿压系数，取决于顶板岩性，一般4-6，坚硬顶板可取6，软弱取4
  // S0 - 保护带宽度，一般3-5m
  
  // 根据顶板强度确定矿压系数
  let K = 5.0;
  if (rockStrength > 1.2) {
    K = 6.0; // 坚硬顶板
  } else if (rockStrength < 0.8) {
    K = 4.0; // 软弱顶板
  }
  
  const S0 = 4; // 保护带宽度（m）
  
  // 基础煤柱宽度
  let pillarWidth = depth / K + 2 * S0;
  
  // 煤层厚度修正：厚煤层采空区跨度大，需要更宽煤柱
  if (thickness > 5) {
    pillarWidth *= 1.2;
  } else if (thickness > 3.5) {
    pillarWidth *= 1.1;
  }
  
  // 倾角修正：急倾斜煤层稳定性差
  if (dipAngle > 25) {
    pillarWidth *= 1.2;
  } else if (dipAngle > 15) {
    pillarWidth *= 1.1;
  }
  
  // 规程规定的最小值和推荐范围
  // 一般不小于20m，通常在20-35m之间
  pillarWidth = Math.max(20, pillarWidth);
  
  // 对于深部开采（>800m），煤柱可能需要更大
  if (depth > 800) {
    pillarWidth = Math.max(pillarWidth, 30);
  }
  
  const width = Math.round(pillarWidth);
  
  return {
    width,
    formula: `B = H/K + 2*S0 = ${depth}/${K} + 2*${S0}`,
    description: `采深${depth}m，厚度${thickness}m，倾角${dipAngle.toFixed(1)}°，计算煤柱宽度${width}m`
  };
}

/**
 * 计算工作面宽度（斜长）
 * 基于煤层厚度、埋深等地质条件和设备能力
 * @param {number} thickness - 煤层厚度（m）
 * @param {number} depth - 埋深（m）
 * @param {number} dipAngle - 倾角（度）
 * @returns {Object} {width, description}
 */
export function calculateWorkfaceWidth(thickness, depth, dipAngle = 0) {
  // 参考《煤矿开采设计规范》和综采设备能力
  // 工作面宽度一般在100-300m，常用150-200m
  
  // 基础宽度：根据煤层厚度确定
  let baseWidth;
  if (thickness < 1.3) {
    // 薄煤层：可适当加大工作面以提高效率
    baseWidth = 180;
  } else if (thickness <= 3.5) {
    // 中厚煤层：标准配置
    baseWidth = 160;
  } else if (thickness <= 6) {
    // 厚煤层：单产大，可适当减小
    baseWidth = 150;
  } else {
    // 特厚煤层：需要减小宽度保证安全
    baseWidth = 140;
  }
  
  let width = baseWidth;
  
  // 埋深影响：深部开采顶板压力大
  if (depth > 800) {
    width *= 0.85; // 深部大幅减小
  } else if (depth > 600) {
    width *= 0.9;
  } else if (depth > 400) {
    width *= 0.95;
  } else if (depth < 200) {
    width *= 1.1; // 浅部可适当增大
  }
  
  // 倾角影响：倾斜煤层设备工作困难
  if (dipAngle > 35) {
    width *= 0.8; // 急倾斜大幅减小
  } else if (dipAngle > 25) {
    width *= 0.85;
  } else if (dipAngle > 15) {
    width *= 0.92;
  }
  
  // 限制在工程实际范围内（100-300m）
  width = Math.max(100, Math.min(300, width));
  
  const finalWidth = Math.round(width / 10) * 10; // 取整到10m
  
  return {
    width: finalWidth,
    description: `厚度${thickness}m，埋深${depth}m，倾角${dipAngle.toFixed(1)}°，推荐工作面宽度${finalWidth}m`
  };
}

/**
 * 计算工作面推进长度
 * 一般为采区在倾向方向的跨度，扣除保护煤柱
 * @param {number} areaLength - 采区长度（m）
 * @param {number} boundaryPillar - 边界保护煤柱（m，默认30m）
 * @returns {number} 推进长度（m）
 */
export function calculateWorkfaceLength(areaLength, boundaryPillar = 30) {
  // 推进长度 = 采区长度 - 两侧保护煤柱
  let length = areaLength - 2 * boundaryPillar;
  
  // 确保不超过规程限制（如5000m）
  length = Math.min(5000, length);
  
  // 至少保证有效推进距离
  length = Math.max(200, length);
  
  return Math.round(length);
}

/**
 * 根据煤层倾向判断工作面布局方向
 * @param {number} dipDirection - 倾向方位角（度，0-360）
 * @param {number} dipAngle - 倾角（度）
 * @returns {string} 'horizontal' | 'vertical'
 */
export function determineLayoutDirection(dipDirection, dipAngle = 0) {
  // 如果倾角很小（<5度），按采区形状决定
  if (dipAngle < 5) {
    return null; // 返回null表示需要按采区形状判断
  }
  
  // 倾向角度范围：
  // 0-45度或315-360度：倾向北，走向东西，工作面应东西布置（horizontal）
  // 45-135度：倾向东，走向南北，工作面应南北布置（vertical）
  // 135-225度：倾向南，走向东西，工作面应东西布置（horizontal）
  // 225-315度：倾向西，走向南北，工作面应南北布置（vertical）
  
  if ((dipDirection >= 0 && dipDirection < 45) || dipDirection >= 315) {
    // 倾向北，走向东西
    return 'horizontal';
  } else if (dipDirection >= 45 && dipDirection < 135) {
    // 倾向东，走向南北
    return 'vertical';
  } else if (dipDirection >= 135 && dipDirection < 225) {
    // 倾向南，走向东西
    return 'horizontal';
  } else {
    // 倾向西，走向南北
    return 'vertical';
  }
}

/**
 * 获取采区边界线
 * @param {Array} boundary - 边界点数组
 * @param {string} side - 'north' | 'south' | 'east' | 'west'
 * @returns {Array} 边界线点数组 [{x, y}, {x, y}]
 */
export function getBoundaryLine(boundary, side) {
  if (!boundary || boundary.length < 3) {
    throw new Error('边界数据无效');
  }
  
  // 计算边界范围
  const minX = Math.min(...boundary.map(p => p.x));
  const maxX = Math.max(...boundary.map(p => p.x));
  const minY = Math.min(...boundary.map(p => p.y));
  const maxY = Math.max(...boundary.map(p => p.y));
  
  switch (side) {
    case 'north':
      // 北侧边界：Y最大的边
      return [
        { x: minX, y: maxY },
        { x: maxX, y: maxY }
      ];
    case 'south':
      // 南侧边界：Y最小的边
      return [
        { x: minX, y: minY },
        { x: maxX, y: minY }
      ];
    case 'east':
      // 东侧边界：X最大的边
      return [
        { x: maxX, y: minY },
        { x: maxX, y: maxY }
      ];
    case 'west':
      // 西侧边界：X最小的边
      return [
        { x: minX, y: minY },
        { x: minX, y: maxY }
      ];
    default:
      throw new Error(`无效的边界方向: ${side}`);
  }
}

/**
 * 计算采区尺寸
 * @param {Array} boundary - 边界点数组
 * @returns {Object} { width, height, minX, maxX, minY, maxY }
 */
export function calculateAreaDimensions(boundary) {
  const minX = Math.min(...boundary.map(p => p.x));
  const maxX = Math.max(...boundary.map(p => p.x));
  const minY = Math.min(...boundary.map(p => p.y));
  const maxY = Math.max(...boundary.map(p => p.y));
  
  return {
    width: maxX - minX,
    height: maxY - minY,
    minX,
    maxX,
    minY,
    maxY
  };
}

/**
 * 检查两个矩形是否重叠
 */
export function rectanglesOverlap(rect1, rect2) {
  return !(
    rect1.x + rect1.width < rect2.x ||
    rect2.x + rect2.width < rect1.x ||
    rect1.y + rect1.height < rect2.y ||
    rect2.y + rect2.height < rect1.y
  );
}

/**
 * 计算相邻工作面之间的实际距离（煤柱宽度验证）
 * @param {Object} face1 - 第一个工作面
 * @param {Object} face2 - 第二个工作面
 * @param {string} direction - 布局方向 'horizontal' | 'vertical'
 * @returns {number} 距离（m）
 */
export function calculateWorkfaceDistance(face1, face2, direction) {
  if (direction === 'horizontal') {
    // 水平布局：计算Y方向距离
    const face1Top = face1.y + face1.length;
    const face2Bottom = face2.y;
    return Math.abs(face2Bottom - face1Top);
  } else {
    // 垂直布局：计算X方向距离
    const face1Right = face1.x + face1.width;
    const face2Left = face2.x;
    return Math.abs(face2Left - face1Right);
  }
}

/**
 * 工作面布局算法 - 按煤矿规程从选定边界迭代铺设
 * @param {Array} boundary - 采区边界
 * @param {Object} geology - 地质模型数据
 * @param {Object} options - 配置选项
 * @returns {Object} {workfaces, pillars, stats}
 */
export function layoutWorkfaces(boundary, geology, options = {}) {
  const {
    userFaceWidth = null,      // 用户指定工作面宽度
    userPillarWidth = null,    // 用户指定煤柱宽度
    boundaryPillar = 30,       // 边界煤柱
    minScore = 0,              // 最低评分要求
    scoreGrid = null           // 评分网格（可选）
  } = options;
  
  const { dipDirection, dipAngle, avgThickness, avgDepth } = geology;
  
  // 1. 选择起始边界（仰斜开采）
  const startBoundary = selectStartBoundary(boundary, dipDirection, dipAngle);
  console.log('边界选择:', startBoundary.description);
  
  // 2. 计算工作面和煤柱宽度
  const faceWidthCalc = userFaceWidth 
    ? { width: userFaceWidth, description: `用户指定: ${userFaceWidth}m` }
    : calculateWorkfaceWidth(avgThickness, avgDepth, dipAngle);
  
  const pillarCalc = userPillarWidth
    ? { width: userPillarWidth, description: `用户指定: ${userPillarWidth}m` }
    : calculatePillarWidth(avgDepth, avgThickness, dipAngle);
  
  const faceWidth = faceWidthCalc.width;
  const pillarWidth = pillarCalc.width;
  
  console.log('工作面宽度:', faceWidthCalc.description);
  console.log('煤柱宽度:', pillarCalc.description);
  
  // 3. 计算采区尺寸
  const areaDims = calculateAreaDimensions(boundary);
  
  // 4. 根据布局方向迭代生成工作面和煤柱
  const workfaces = [];
  const pillars = [];
  
  const layoutDir = startBoundary.layoutDirection || 
    (areaDims.width >= areaDims.height ? 'horizontal' : 'vertical');
  
  if (layoutDir === 'horizontal') {
    // 水平布局：工作面沿X方向延伸
    layoutHorizontalWorkfaces(
      workfaces, pillars, areaDims, startBoundary.side,
      faceWidth, pillarWidth, boundaryPillar, scoreGrid, minScore
    );
  } else {
    // 垂直布局：工作面沿Y方向延伸
    layoutVerticalWorkfaces(
      workfaces, pillars, areaDims, startBoundary.side,
      faceWidth, pillarWidth, boundaryPillar, scoreGrid, minScore
    );
  }
  
  // 5. 生成统计信息
  const stats = {
    totalWorkfaces: workfaces.length,
    totalPillars: pillars.length,
    totalArea: workfaces.reduce((sum, wf) => sum + wf.area, 0),
    avgFaceWidth: faceWidth,
    pillarWidth: pillarWidth,
    layoutDirection: layoutDir,
    startBoundary: startBoundary.side,
    miningMethod: dipAngle > 5 ? '仰斜开采' : '水平开采'
  };
  
  console.log(`生成 ${workfaces.length} 个工作面, ${pillars.length} 个煤柱`);
  
  return {
    workfaces,
    pillars,
    stats,
    design: {
      faceWidth: faceWidthCalc,
      pillarWidth: pillarCalc,
      startBoundary
    }
  };
}

/**
 * 水平布局工作面（沿Y轴排列，沿X轴延伸）
 */
function layoutHorizontalWorkfaces(
  workfaces, pillars, areaDims, startSide,
  faceWidth, pillarWidth, boundaryPillar, scoreGrid, minScore
) {
  const { minX, maxX, minY, maxY } = areaDims;
  
  // 工作面长度（X方向）
  const faceLength = (maxX - minX) - 2 * boundaryPillar;
  const startX = minX + boundaryPillar;
  
  // 确定起始Y位置（根据边界）
  let currentY = startSide === 'south' ? minY + boundaryPillar : maxY - boundaryPillar - faceWidth;
  const yStep = startSide === 'south' ? 1 : -1; // 推进方向
  
  let faceIndex = 1;
  
  while (true) {
    // 检查是否超出边界
    if (startSide === 'south') {
      if (currentY + faceWidth + boundaryPillar > maxY) break;
    } else {
      if (currentY - boundaryPillar < minY) break;
    }
    
    // 创建工作面
    const workface = {
      id: `WF-${String(faceIndex).padStart(2, '0')}`,
      x: startX,
      y: currentY,
      width: faceLength,
      length: faceWidth,
      area: faceLength * faceWidth,
      direction: 'horizontal',
      index: faceIndex
    };
    
    // 如果有评分网格，计算评分
    if (scoreGrid) {
      workface.avgScore = calculateAreaScore(scoreGrid, startX, currentY, faceLength, faceWidth);
      if (workface.avgScore < minScore) {
        currentY += yStep * (faceWidth + pillarWidth);
        continue; // 跳过低分工作面
      }
    }
    
    workfaces.push(workface);
    
    // 在工作面之间创建煤柱（除了最后一个）
    const nextY = currentY + yStep * (faceWidth + pillarWidth);
    const pillarY = yStep > 0 ? currentY + faceWidth : currentY - pillarWidth;
    
    if ((startSide === 'south' && nextY + faceWidth + boundaryPillar <= maxY) ||
        (startSide === 'north' && nextY - boundaryPillar >= minY)) {
      pillars.push({
        id: `PL-${String(faceIndex).padStart(2, '0')}`,
        x: startX,
        y: pillarY,
        width: faceLength,
        length: pillarWidth,
        area: faceLength * pillarWidth,
        type: 'inter-workface'
      });
    }
    
    currentY = nextY;
    faceIndex++;
  }
}

/**
 * 垂直布局工作面（沿X轴排列，沿Y轴延伸）
 */
function layoutVerticalWorkfaces(
  workfaces, pillars, areaDims, startSide,
  faceWidth, pillarWidth, boundaryPillar, scoreGrid, minScore
) {
  const { minX, maxX, minY, maxY } = areaDims;
  
  // 工作面长度（Y方向）
  const faceLength = (maxY - minY) - 2 * boundaryPillar;
  const startY = minY + boundaryPillar;
  
  // 确定起始X位置
  let currentX = startSide === 'west' ? minX + boundaryPillar : maxX - boundaryPillar - faceWidth;
  const xStep = startSide === 'west' ? 1 : -1;
  
  let faceIndex = 1;
  
  while (true) {
    // 检查是否超出边界
    if (startSide === 'west') {
      if (currentX + faceWidth + boundaryPillar > maxX) break;
    } else {
      if (currentX - boundaryPillar < minX) break;
    }
    
    // 创建工作面
    const workface = {
      id: `WF-${String(faceIndex).padStart(2, '0')}`,
      x: currentX,
      y: startY,
      width: faceWidth,
      length: faceLength,
      area: faceWidth * faceLength,
      direction: 'vertical',
      index: faceIndex
    };
    
    if (scoreGrid) {
      workface.avgScore = calculateAreaScore(scoreGrid, currentX, startY, faceWidth, faceLength);
      if (workface.avgScore < minScore) {
        currentX += xStep * (faceWidth + pillarWidth);
        continue;
      }
    }
    
    workfaces.push(workface);
    
    // 创建煤柱
    const nextX = currentX + xStep * (faceWidth + pillarWidth);
    const pillarX = xStep > 0 ? currentX + faceWidth : currentX - pillarWidth;
    
    if ((startSide === 'west' && nextX + faceWidth + boundaryPillar <= maxX) ||
        (startSide === 'east' && nextX - boundaryPillar >= minX)) {
      pillars.push({
        id: `PL-${String(faceIndex).padStart(2, '0')}`,
        x: pillarX,
        y: startY,
        width: pillarWidth,
        length: faceLength,
        area: pillarWidth * faceLength,
        type: 'inter-workface'
      });
    }
    
    currentX = nextX;
    faceIndex++;
  }
}

/**
 * 计算矩形区域的平均评分
 */
function calculateAreaScore(grid, x, y, width, height) {
  if (!grid || !grid.data) return 100; // 无评分时返回默认高分
  
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

  return count > 0 ? Math.round(total / count * 10) / 10 : 0;
}
