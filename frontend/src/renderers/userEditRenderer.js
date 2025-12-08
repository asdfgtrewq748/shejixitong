/**
 * 用户编辑渲染器
 * 绘制用户自定义的巷道和工作面
 */

/**
 * 渲染用户编辑的元素（锁定状态）
 */
export const renderUserEdits = (ctx, { userEdits, scale }) => {
  if (userEdits.roadways.length === 0 && userEdits.workfaces.length === 0) return;

  ctx.save();

  // 用户自定义巷道（蓝色）
  userEdits.roadways.forEach(roadway => {
    if (roadway.path && roadway.path.length > 1) {
      // 外发光
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)';
      ctx.lineWidth = 14 / scale;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(roadway.path[0].x, roadway.path[0].y);
      roadway.path.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.stroke();

      // 主线
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 4 / scale;
      ctx.shadowBlur = 12;
      ctx.shadowColor = '#3b82f6';
      ctx.beginPath();
      ctx.moveTo(roadway.path[0].x, roadway.path[0].y);
      roadway.path.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.stroke();
      ctx.shadowBlur = 0;

      // 标签
      const midIdx = Math.floor(roadway.path.length / 2);
      ctx.fillStyle = '#3b82f6';
      ctx.font = `bold ${Math.max(10, 12 / scale)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(`🔒${roadway.id}`, roadway.path[midIdx].x, roadway.path[midIdx].y - 15 / scale);
    }
  });

  // 用户自定义工作面（橙色）
  userEdits.workfaces.forEach(face => {
    const { x, y, width: w, height: h } = face;

    // 填充
    ctx.fillStyle = 'rgba(251, 146, 60, 0.25)';
    ctx.fillRect(x, y, w, h);

    // 边框
    ctx.strokeStyle = '#fb923c';
    ctx.lineWidth = 3 / scale;
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#fb923c';
    ctx.setLineDash([10 / scale, 5 / scale]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;

    // 标签
    ctx.fillStyle = '#fb923c';
    ctx.font = `bold ${Math.max(10, 12 / scale)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`🔒${face.id}`, x + w / 2, y + h / 2);
  });

  ctx.restore();
};

/**
 * 渲染临时绘制元素
 */
export const renderTempElements = (ctx, { isEditing, tempRoadway, tempWorkface, mousePos, scale }) => {
  // 临时巷道
  if (isEditing && tempRoadway && tempRoadway.path.length > 0) {
    ctx.save();
    ctx.strokeStyle = 'rgba(96, 165, 250, 0.8)';
    ctx.lineWidth = 10 / scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([15 / scale, 10 / scale]);
    ctx.beginPath();
    ctx.moveTo(tempRoadway.path[0].x, tempRoadway.path[0].y);
    tempRoadway.path.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(mousePos.x, mousePos.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // 绘制节点
    tempRoadway.path.forEach((p, i) => {
      ctx.fillStyle = '#60a5fa';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5 / scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(8, 10 / scale)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(`${i + 1}`, p.x, p.y - 10 / scale);
    });
    ctx.restore();
  }

  // 临时工作面
  if (isEditing && tempWorkface) {
    ctx.save();
    const { x, y, width: w, height: h } = tempWorkface;
    ctx.fillStyle = 'rgba(251, 146, 60, 0.2)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#fb923c';
    ctx.lineWidth = 2 / scale;
    ctx.setLineDash([8 / scale, 5 / scale]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);

    ctx.fillStyle = '#fb923c';
    ctx.font = `${Math.max(10, 12 / scale)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.abs(w).toFixed(0)} × ${Math.abs(h).toFixed(0)}m`, x + w / 2, y + h / 2);
    ctx.restore();
  }
};
