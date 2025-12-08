/**
 * 钻孔渲染器
 * 绘制钻孔标记
 */

/**
 * 渲染所有钻孔
 */
export const renderBoreholes = (ctx, { boreholes, selectedBorehole, scale }) => {
  boreholes.forEach((hole) => {
    const isSelected = selectedBorehole && selectedBorehole.id === hole.id;

    // 钻孔样式：同心圆 (Drawing Regulations)
    // 外圆 (Screen size: radius ~2.5px -> diameter 5px)
    ctx.strokeStyle = isSelected ? '#fbbf24' : '#ffffff';
    ctx.lineWidth = 1 / scale;
    ctx.beginPath();
    const outerR = 2.5 / scale;
    ctx.arc(hole.x, hole.y, outerR, 0, Math.PI * 2);
    ctx.stroke();

    // 内圆 (Screen size: radius ~1px)
    ctx.fillStyle = isSelected ? '#fbbf24' : '#ffffff';
    ctx.beginPath();
    const innerR = 0.8 / scale;
    ctx.arc(hole.x, hole.y, innerR, 0, Math.PI * 2);
    ctx.fill();

    // 钻孔名称标注
    ctx.fillStyle = isSelected ? '#fbbf24' : 'rgba(255, 255, 255, 0.9)';
    ctx.font = `bold ${12 / scale}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(hole.id, hole.x + 4 / scale, hole.y + 4 / scale);

    // 选中高亮 (额外的光圈)
    if (isSelected) {
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.5)';
      ctx.lineWidth = 3 / scale;
      ctx.beginPath();
      ctx.arc(hole.x, hole.y, 6 / scale, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
};
