/**
 * 等值线渲染器
 * 绘制评分等值线
 */

import { CONTOUR_COLORS } from '../utils';

export const renderContours = (ctx, { scoreData, displayDimension, scale }) => {
  const contourData = scoreData.contours[displayDimension];

  if (!contourData || typeof contourData !== 'object') return;

  // contourData 是 { 30: [...segments], 50: [...], ... }
  Object.entries(contourData).forEach(([level, segments]) => {
    if (!segments || segments.length === 0) return;

    const color = CONTOUR_COLORS[level] || '#fff';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 / scale;
    ctx.shadowBlur = 4;
    ctx.shadowColor = color;

    segments.forEach(seg => {
      if (Array.isArray(seg) && seg.length === 2) {
        // 格式: [[{x,y}, {x,y}], ...]
        ctx.beginPath();
        ctx.moveTo(seg[0].x, seg[0].y);
        ctx.lineTo(seg[1].x, seg[1].y);
        ctx.stroke();
      }
    });
  });

  ctx.shadowBlur = 0;
};

/**
 * 检查是否应该显示等值线
 */
export const shouldShowContours = ({ showContours, scoreData, activeTab, viewMode }) => {
  return showContours && scoreData && scoreData.contours && (
    activeTab === 'analysis' ||
    (activeTab === 'synthesis' && viewMode === 'heatmap')
  );
};
