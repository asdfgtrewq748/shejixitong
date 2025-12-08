/**
 * 扫描线渲染器
 * 绘制扫描动画效果
 */

/**
 * 渲染扫描线动画
 */
export const renderScanLine = (ctx, { width, height, scale, panOffset, time }) => {
  const scanX = (time * 4) % (width / scale);

  // 渐变效果
  const gradient = ctx.createLinearGradient(scanX, 0, scanX - 100, 0);
  gradient.addColorStop(0, 'rgba(14, 165, 233, 0.3)');
  gradient.addColorStop(1, 'rgba(14, 165, 233, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(scanX - 100, -panOffset.y, 100, height / scale);

  // 扫描线
  ctx.strokeStyle = 'rgba(14, 165, 233, 0.8)';
  ctx.beginPath();
  ctx.moveTo(scanX, -panOffset.y);
  ctx.lineTo(scanX, -panOffset.y + height / scale);
  ctx.stroke();
};
