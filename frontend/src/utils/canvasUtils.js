/**
 * Canvas 绑定工具函数模块
 * 包含颜色转换、绘制辅助等函数
 */

/**
 * 将分数转换为热力图颜色
 * 红(低) -> 黄(中) -> 绿(高)
 */
export const scoreToColor = (score, alpha = 0.6) => {
  if (score < 50) {
    const t = score / 50;
    const r = 239;
    const g = Math.round(68 + (190 * t));
    const b = 68;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  } else {
    const t = (score - 50) / 50;
    const r = Math.round(239 - (223 * t));
    const g = Math.round(190 + (65 * t));
    const b = Math.round(68 + (61 * t));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
};

/**
 * 巷道宽度配置（米）
 */
export const ROADWAY_WIDTHS = {
  main: 5.0,        // 主运输大巷
  ventilation: 4.5, // 回风大巷
  transport: 4.0,   // 运输顺槽
  return: 4.0,      // 回风顺槽
  cut: 6.0,         // 开切眼
  gate: 3.5         // 联络巷
};

/**
 * 等值线颜色配置
 */
export const CONTOUR_COLORS = {
  30: '#ef4444',  // 红色 - 低分
  40: '#f97316',  // 橙红
  50: '#f59e0b',  // 橙色 - 中低
  60: '#eab308',  // 黄色
  70: '#84cc16',  // 黄绿 - 中高
  80: '#22c55e',  // 绿色
  90: '#10b981'   // 青绿 - 高分
};

/**
 * 计算巷道双线的偏移点
 */
export const calculateOffsetPoints = (path, halfWidth) => {
  const leftPoints = [];
  const rightPoints = [];

  for (let i = 0; i < path.length; i++) {
    let dx, dy;
    if (i === 0) {
      dx = path[1].x - path[0].x;
      dy = path[1].y - path[0].y;
    } else if (i === path.length - 1) {
      dx = path[i].x - path[i-1].x;
      dy = path[i].y - path[i-1].y;
    } else {
      dx = path[i+1].x - path[i-1].x;
      dy = path[i+1].y - path[i-1].y;
    }

    const len = Math.sqrt(dx*dx + dy*dy);
    if (len > 0) {
      const nx = -dy / len;
      const ny = dx / len;
      leftPoints.push({ x: path[i].x + nx * halfWidth, y: path[i].y + ny * halfWidth });
      rightPoints.push({ x: path[i].x - nx * halfWidth, y: path[i].y - ny * halfWidth });
    }
  }
  return { leftPoints, rightPoints };
};

/**
 * 绘制双线巷道
 */
export const drawDoubleLineRoadway = (ctx, path, width, color, scale, isMain = false, isDashed = false) => {
  const halfWidth = width / 2;
  const { leftPoints, rightPoints } = calculateOffsetPoints(path, halfWidth);

  if (leftPoints.length < 2) return;

  // 填充巷道内部（浅色）
  ctx.fillStyle = isMain ? 'rgba(0, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.08)';
  ctx.beginPath();
  ctx.moveTo(leftPoints[0].x, leftPoints[0].y);
  leftPoints.forEach(p => ctx.lineTo(p.x, p.y));
  for (let i = rightPoints.length - 1; i >= 0; i--) {
    ctx.lineTo(rightPoints[i].x, rightPoints[i].y);
  }
  ctx.closePath();
  ctx.fill();

  // 绘制边线
  ctx.strokeStyle = color;
  ctx.lineWidth = isMain ? 2.5 / scale : (isDashed ? 2 / scale : 1.5 / scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (isDashed) {
    ctx.setLineDash([10/scale, 5/scale]);
  } else {
    ctx.setLineDash([]);
  }

  if (isMain) {
    ctx.shadowBlur = 8;
    ctx.shadowColor = color;
  }

  // 左边线
  ctx.beginPath();
  ctx.moveTo(leftPoints[0].x, leftPoints[0].y);
  leftPoints.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.stroke();

  // 右边线
  ctx.beginPath();
  ctx.moveTo(rightPoints[0].x, rightPoints[0].y);
  rightPoints.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.setLineDash([]);
};

/**
 * 获取巷道类型配置
 */
export const getRoadwayConfig = (road) => {
  const roadType = road.type || '';
  const isMain = roadType === 'main' || road.id?.startsWith('Main') || road.id?.startsWith('MR-');
  const isTransport = roadType === 'transport' || road.id?.startsWith('Transport');
  const isVentilation = roadType === 'ventilation' || roadType === 'return' || road.id?.startsWith('Ventilation');
  const isCut = roadType === 'cut' || road.id?.startsWith('Cut');

  let color, width, isDashed = false;
  if (isMain) {
    color = '#00ffff';
    width = ROADWAY_WIDTHS.main;
  } else if (isVentilation) {
    color = '#ff9933';
    width = ROADWAY_WIDTHS.ventilation;
    isDashed = true;
  } else if (isTransport) {
    color = '#66ff66';
    width = ROADWAY_WIDTHS.transport;
  } else if (isCut) {
    color = '#45b7d1';
    width = ROADWAY_WIDTHS.cut;
  } else {
    color = '#a8a8a8';
    width = ROADWAY_WIDTHS.gate;
  }

  return { isMain, isTransport, isVentilation, isCut, color, width, isDashed };
};

/**
 * 获取巷道标签名称
 */
export const getRoadwayLabel = (road, config) => {
  let label = road.name || road.id || '';
  if (!label) {
    if (config.isMain) label = '主运输大巷';
    else if (config.isVentilation) label = '回风巷';
    else if (config.isTransport) label = '运输巷';
    else if (config.isCut) label = '开切眼';
    else label = '联络巷';
  }
  return label;
};
