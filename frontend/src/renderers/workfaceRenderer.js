/**
 * 工作面渲染器
 * 绘制工作面（采用CAD规范）
 */

import { scoreToColor } from '../utils';

/**
 * 绘制斜线填充
 */
const drawHatchPattern = (ctx, points, isInvalid, scale) => {
  ctx.save();

  // 创建裁剪路径
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  points.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.clip();

  // 计算边界
  const minX = Math.min(...points.map(p => p.x));
  const maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y));
  const maxY = Math.max(...points.map(p => p.y));

  // 绘制斜线填充
  ctx.strokeStyle = isInvalid ? 'rgba(239, 68, 68, 0.4)' : 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 0.8 / scale;
  const spacing = Math.max(1, 12 / scale);
  const maxIterations = 10000;
  let iterations = 0;

  for (let i = minX - (maxY - minY); i < maxX + (maxY - minY) && iterations < maxIterations; i += spacing) {
    ctx.beginPath();
    ctx.moveTo(i, minY);
    ctx.lineTo(i + (maxY - minY), maxY);
    ctx.stroke();
    iterations++;
  }

  ctx.restore();
};

/**
 * 绘制工作面标签
 */
const drawWorkfaceLabel = (ctx, face, idx, isInvalid, scale) => {
  const labelText = face.id || `WF-${String(idx + 1).padStart(2, '0')}`;
  const score = face.avgScore || 0;
  const faceLen = face.faceLength || face.length || 0;
  const advLen = face.advanceLength || face.width || 0;

  // 计算中心点
  let centerX, centerY;
  if (face.points && face.points.length > 0) {
    centerX = face.center_x || (face.points.reduce((s, p) => s + p.x, 0) / face.points.length);
    centerY = face.center_y || (face.points.reduce((s, p) => s + p.y, 0) / face.points.length);
  } else {
    centerX = face.x + (face.width || 0) / 2;
    centerY = face.y + (face.length || face.height || 0) / 2;
  }

  ctx.save();
  ctx.translate(centerX, centerY);

  // 工作面名称（大字体）
  const fontSize = Math.max(10, 14 / scale);
  ctx.font = `bold ${fontSize}px "Microsoft YaHei", sans-serif`;
  const textMetrics = ctx.measureText(labelText);

  // 标签背景
  const padding = 4 / scale;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(
    -textMetrics.width / 2 - padding,
    -fontSize / 2 - padding - 5 / scale,
    textMetrics.width + padding * 2,
    fontSize + padding * 2
  );

  // 标签文字
  ctx.fillStyle = isInvalid ? '#ff6b6b' : '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelText, 0, -5 / scale);

  // 工作面参数（小字体）
  const smallFontSize = Math.max(8, 10 / scale);
  ctx.font = `${smallFontSize}px "Microsoft YaHei", sans-serif`;
  ctx.fillStyle = '#aaaaaa';
  ctx.fillText(`${faceLen.toFixed(0)}m × ${advLen.toFixed(0)}m`, 0, 10 / scale);

  // 评分
  ctx.fillStyle = score > 70 ? '#4ade80' : (score > 50 ? '#fbbf24' : '#f87171');
  ctx.fillText(`评分: ${score.toFixed(0)}`, 0, 22 / scale);

  // 不符合规程警告
  if (isInvalid && face.validationMsg) {
    ctx.fillStyle = '#ff6b6b';
    ctx.font = `${Math.max(7, 9 / scale)}px sans-serif`;
    ctx.fillText(`⚠ ${face.validationMsg.substring(0, 15)}`, 0, 34 / scale);
  }

  ctx.restore();
};

/**
 * 渲染单个工作面
 */
const renderSingleWorkface = (ctx, face, idx, scale, selectedWorkface) => {
  const score = face.avgScore || 0;
  const isSelected = selectedWorkface && selectedWorkface.id === face.id;
  const isInvalid = face.isValid === false;

  // 工作面背景颜色
  let fillColor;
  if (isSelected) {
    fillColor = 'rgba(255, 255, 255, 0.25)';
  } else if (isInvalid) {
    fillColor = 'rgba(239, 68, 68, 0.2)';
  } else {
    fillColor = scoreToColor(score, 0.2);
  }
  ctx.fillStyle = fillColor;

  // 边框颜色
  let borderColor = isInvalid ? '#ef4444' : '#e74c3c';
  if (isSelected) {
    borderColor = '#ffffff';
  }

  if (face.points && face.points.length > 0) {
    // 使用多边形顶点绘制
    ctx.beginPath();
    ctx.moveTo(face.points[0].x, face.points[0].y);
    face.points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.fill();

    // 边框
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = isSelected ? 3 / scale : 2 / scale;
    ctx.setLineDash([]);
    ctx.stroke();

    // 斜线填充
    if (!isSelected) {
      drawHatchPattern(ctx, face.points, isInvalid, scale);
    }
  } else {
    // 降级回退：使用矩形绘制
    const { x, y, width: w, height: h } = face;
    ctx.fillRect(x, y, w, h);

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = isSelected ? 3 / scale : 2 / scale;
    ctx.strokeRect(x, y, w, h);

    // 斜线填充（矩形）
    if (!isSelected) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();

      ctx.strokeStyle = isInvalid ? 'rgba(239, 68, 68, 0.4)' : 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 0.8 / scale;
      const spacing = Math.max(1, 12 / scale);
      const maxIterations = 10000;
      let iterations = 0;

      for (let i = x - h; i < x + w + h && iterations < maxIterations; i += spacing) {
        ctx.beginPath();
        ctx.moveTo(i, y);
        ctx.lineTo(i + h, y + h);
        ctx.stroke();
        iterations++;
      }
      ctx.restore();
    }
  }

  // 绘制标签
  drawWorkfaceLabel(ctx, face, idx, isInvalid, scale);
};

/**
 * 渲染所有工作面
 */
export const renderWorkfaces = (ctx, { designData, scale, selectedWorkface }) => {
  const workfaceList = designData.panels || designData.workfaces || [];

  workfaceList.forEach((face, idx) => {
    renderSingleWorkface(ctx, face, idx, scale, selectedWorkface);
  });
};
