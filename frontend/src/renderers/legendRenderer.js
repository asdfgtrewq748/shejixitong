/**
 * 图例渲染器
 * 绘制评分图例和巷道图例
 */

import { scoreToColor } from '../utils';

/**
 * 渲染评分图例
 */
export const renderScoreLegend = (ctx, { width, height, displayDimension }) => {
  const legendX = 20;
  const legendY = height - 180;
  const legendWidth = 20;
  const legendHeight = 150;

  // 图例背景
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(legendX - 10, legendY - 30, 100, legendHeight + 60);

  // 图例标题
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText('评分图例', legendX, legendY - 10);

  // 颜色条
  for (let i = 0; i < legendHeight; i++) {
    const score = 100 - (i / legendHeight * 100);
    ctx.fillStyle = scoreToColor(score, 1);
    ctx.fillRect(legendX, legendY + i, legendWidth, 1);
  }

  // 刻度标签
  ctx.fillStyle = '#fff';
  ctx.font = '10px sans-serif';
  ctx.fillText('100', legendX + legendWidth + 5, legendY + 5);
  ctx.fillText('75', legendX + legendWidth + 5, legendY + legendHeight * 0.25 + 3);
  ctx.fillText('50', legendX + legendWidth + 5, legendY + legendHeight * 0.5 + 3);
  ctx.fillText('25', legendX + legendWidth + 5, legendY + legendHeight * 0.75 + 3);
  ctx.fillText('0', legendX + legendWidth + 5, legendY + legendHeight);

  // 维度标签
  const dimLabels = { safety: '安全性', economic: '经济性', env: '环保性', composite: '综合' };
  ctx.fillStyle = '#a5b4fc';
  ctx.font = 'bold 11px sans-serif';
  ctx.fillText(dimLabels[displayDimension] || '综合', legendX, legendY + legendHeight + 20);
};

/**
 * 渲染巷道图例
 */
export const renderRoadwayLegend = (ctx, { width, height }) => {
  const roadLegendX = width - 155;
  const roadLegendY = height - 180;

  // 背景
  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.fillRect(roadLegendX - 10, roadLegendY - 25, 160, 175);
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1;
  ctx.strokeRect(roadLegendX - 10, roadLegendY - 25, 160, 175);

  // 标题
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px "Microsoft YaHei", sans-serif';
  ctx.fillText('图 例', roadLegendX + 50, roadLegendY - 8);

  // 图例项
  const legendItems = [
    { color: '#00ffff', label: '主运输大巷', width: 5 },
    { color: '#66ff66', label: '运输顺槽', width: 4 },
    { color: '#ff9933', label: '回风顺槽', width: 4, dashed: true },
    { color: '#45b7d1', label: '开切眼', width: 6 },
    { color: '#e74c3c', label: '工作面', isWorkface: true }
  ];

  ctx.font = '10px "Microsoft YaHei", sans-serif';
  legendItems.forEach((item, idx) => {
    const y = roadLegendY + 12 + idx * 24;

    if (item.isWorkface) {
      // 工作面图例 - 带斜线填充
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.fillRect(roadLegendX, y - 8, 35, 16);
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(roadLegendX, y - 8, 35, 16);

      // 斜线填充
      ctx.save();
      ctx.beginPath();
      ctx.rect(roadLegendX, y - 8, 35, 16);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 0.8;
      for (let i = roadLegendX - 16; i < roadLegendX + 35 + 16; i += 5) {
        ctx.beginPath();
        ctx.moveTo(i, y - 8);
        ctx.lineTo(i + 16, y + 8);
        ctx.stroke();
      }
      ctx.restore();
    } else {
      // 巷道图例 - 双线表示
      const halfW = 3;
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(roadLegendX, y - halfW, 35, halfW * 2);

      ctx.strokeStyle = item.color;
      ctx.lineWidth = 1.5;
      if (item.dashed) {
        ctx.setLineDash([3, 2]);
      } else {
        ctx.setLineDash([]);
      }

      // 上边线
      ctx.beginPath();
      ctx.moveTo(roadLegendX, y - halfW);
      ctx.lineTo(roadLegendX + 35, y - halfW);
      ctx.stroke();

      // 下边线
      ctx.beginPath();
      ctx.moveTo(roadLegendX, y + halfW);
      ctx.lineTo(roadLegendX + 35, y + halfW);
      ctx.stroke();

      ctx.setLineDash([]);
    }

    // 标签
    ctx.fillStyle = item.color;
    ctx.fillText(item.label, roadLegendX + 42, y + 4);
  });
};
