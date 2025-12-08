/**
 * 巷道渲染器
 * 绘制巷道（采用CAD双线表示法）
 */

import { ROADWAY_WIDTHS, calculateOffsetPoints } from '../utils';

/**
 * 绘制双线巷道
 */
const drawDoubleLineRoadway = (ctx, path, width, color, scale, time, isMain = false, isDashed = false) => {
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

  // 设置虚线样式（回风巷道使用虚线）
  if (isDashed) {
    ctx.setLineDash([10 / scale, 5 / scale]);
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
 * 绘制主巷道的中心线和箭头
 */
const drawMainRoadwayDecorations = (ctx, road, color, scale, time) => {
  // 加粗中心线
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5 / scale;
  ctx.setLineDash([12 / scale, 6 / scale]);
  ctx.lineDashOffset = -time * 2;
  ctx.shadowBlur = 15;
  ctx.shadowColor = color;
  ctx.beginPath();
  ctx.moveTo(road.path[0].x, road.path[0].y);
  road.path.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.shadowBlur = 0;

  // 绘制箭头标记
  const arrowInterval = Math.max(1, Math.floor(road.path.length / 5));
  for (let i = arrowInterval; i < road.path.length && arrowInterval > 0; i += arrowInterval) {
    const p1 = road.path[i - 1];
    const p2 = road.path[i];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const angle = Math.atan2(dy, dx);
    const arrowSize = 8 / scale;

    ctx.save();
    ctx.translate(p2.x, p2.y);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-arrowSize, -arrowSize / 2);
    ctx.lineTo(-arrowSize, arrowSize / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
};

/**
 * 绘制巷道标签
 */
const drawRoadwayLabel = (ctx, road, config, scale) => {
  const midIdx = Math.floor(road.path.length / 2);
  const midPoint = road.path[midIdx];

  // 计算文字角度
  let dx = road.path[road.path.length - 1].x - road.path[0].x;
  let dy = road.path[road.path.length - 1].y - road.path[0].y;
  let angle = Math.atan2(dy, dx);
  // 确保文字不会倒置
  if (angle > Math.PI / 2 || angle < -Math.PI / 2) {
    angle += Math.PI;
  }

  // 获取标签文本
  let label = road.name || road.id || '';
  if (!label) {
    if (config.isMain) label = '主运输大巷';
    else if (config.isVentilation) label = '回风巷';
    else if (config.isTransport) label = '运输巷';
    else if (config.isCut) label = '开切眼';
    else label = '联络巷';
  }

  ctx.save();
  ctx.translate(midPoint.x, midPoint.y - config.width / 2 - 3 / scale);
  ctx.rotate(angle);

  if (config.isMain) {
    // 主巷道标签更醒目
    const fontSize = Math.max(10, 14 / scale);
    ctx.font = `bold ${fontSize}px "Microsoft YaHei", sans-serif`;

    const textMetrics = ctx.measureText(label);
    const padding = 4 / scale;

    // 标签背景
    ctx.fillStyle = 'rgba(0, 40, 50, 0.9)';
    ctx.fillRect(
      -textMetrics.width / 2 - padding,
      -fontSize / 2 - padding,
      textMetrics.width + padding * 2,
      fontSize + padding * 2
    );
    ctx.strokeStyle = config.color;
    ctx.lineWidth = 1.5 / scale;
    ctx.strokeRect(
      -textMetrics.width / 2 - padding,
      -fontSize / 2 - padding,
      textMetrics.width + padding * 2,
      fontSize + padding * 2
    );

    ctx.fillStyle = config.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 0);
  } else {
    // 普通巷道标签
    const fontSize = Math.max(8, 10 / scale);
    ctx.font = `${fontSize}px "Microsoft YaHei", sans-serif`;

    const textMetrics = ctx.measureText(label);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(
      -textMetrics.width / 2 - 2 / scale,
      -fontSize / 2 - 1 / scale,
      textMetrics.width + 4 / scale,
      fontSize + 2 / scale
    );
    ctx.fillStyle = config.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 0);
  }

  ctx.restore();
};

/**
 * 获取巷道配置
 */
const getRoadwayConfig = (road) => {
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
 * 渲染所有巷道
 */
export const renderRoadways = (ctx, { designData, scale, time }) => {
  let roadways = designData.roadways || [];
  if (roadways.length === 0) {
    if (designData.mainRoadway) roadways.push(designData.mainRoadway);
    if (designData.branchRoadways) roadways.push(...designData.branchRoadways);
  }

  roadways.forEach(road => {
    if (!road.path || road.path.length <= 1) return;

    const config = getRoadwayConfig(road);

    // 绘制双线巷道
    drawDoubleLineRoadway(ctx, road.path, config.width, config.color, scale, time, config.isMain, config.isDashed);

    // 主大巷添加装饰
    if (config.isMain) {
      drawMainRoadwayDecorations(ctx, road, config.color, scale, time);
    }

    // 绘制标签
    if (scale > 0.25 || config.isMain) {
      drawRoadwayLabel(ctx, road, config, scale);
    }
  });
};
