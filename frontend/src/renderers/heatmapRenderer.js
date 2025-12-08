/**
 * 热力图渲染器
 * 绘制评分热力图
 */

import { scoreToColor } from '../utils';

export const renderHeatmap = (ctx, { scoreData, displayDimension, viewMode }) => {
  const gridData = scoreData.grids[displayDimension];

  if (!gridData || !gridData.data || gridData.data.length === 0) return;

  const { data, minX, minY, stepX, stepY } = gridData;

  // 在热力图模式下，透明度更高，更明显
  ctx.globalAlpha = viewMode === 'heatmap' ? 0.9 : 0.7;

  for (let i = 0; i < data.length; i++) {
    for (let j = 0; j < data[i].length; j++) {
      const score = data[i][j];
      if (score === null) continue;

      const x = minX + j * stepX;
      const y = minY + i * stepY;

      // 热力图模式使用更强烈的颜色
      const alpha = viewMode === 'heatmap' ? 0.8 : 0.6;
      ctx.fillStyle = scoreToColor(score, alpha);
      ctx.fillRect(x, y, stepX + 1, stepY + 1);
    }
  }

  ctx.globalAlpha = 1.0;
};

/**
 * 检查是否应该显示热力图
 */
export const shouldShowHeatmap = ({ showHeatmap, scoreData, activeTab, viewMode }) => {
  return showHeatmap && scoreData && scoreData.grids && (
    activeTab === 'analysis' ||
    (activeTab === 'synthesis' && viewMode === 'heatmap')
  );
};
