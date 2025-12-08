/**
 * 网格渲染器
 * 绘制背景网格
 */

export const renderGrid = (ctx, { scale, panOffset, width, height, time }) => {
  ctx.strokeStyle = 'rgba(30, 58, 138, 0.15)';
  ctx.lineWidth = 1 / scale;
  const gridSize = 40;
  const offset = (time * 0.5) % gridSize;

  const startX = Math.floor(-panOffset.x / gridSize) * gridSize;
  const startY = Math.floor(-panOffset.y / gridSize) * gridSize;
  const endX = startX + width / scale + gridSize * 2;
  const endY = startY + height / scale + gridSize * 2;

  // 绘制垂直线
  for (let x = startX; x <= endX; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
    ctx.stroke();
  }

  // 绘制水平线（带动画偏移）
  for (let y = startY; y <= endY; y += gridSize) {
    const drawY = y + offset;
    ctx.beginPath();
    ctx.moveTo(startX, drawY);
    ctx.lineTo(endX, drawY);
    ctx.stroke();
  }
};
