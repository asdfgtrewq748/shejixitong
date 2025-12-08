/**
 * 边界渲染器
 * 绘制采区边界
 */

/**
 * 渲染边界
 */
export const renderBoundary = (ctx, { boundary, scale }) => {
  if (boundary.length === 0) return;

  ctx.shadowBlur = 10;
  ctx.shadowColor = '#0ea5e9';
  ctx.strokeStyle = '#0ea5e9';
  ctx.lineWidth = Math.max(2 / scale, 1);

  ctx.beginPath();
  ctx.moveTo(boundary[0].x, boundary[0].y);
  boundary.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.stroke();

  ctx.shadowBlur = 0;
};

/**
 * 创建边界裁剪区域（不执行裁剪）
 */
export const createBoundaryClipPath = (ctx, boundary) => {
  if (boundary.length === 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(boundary[0].x, boundary[0].y);
  boundary.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.closePath();
  // ctx.clip() // 暂时禁用裁剪，防止设计元素因精度问题不可见
};
