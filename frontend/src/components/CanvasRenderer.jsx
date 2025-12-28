/**
 * Canvas渲染器组件 - 用于扰动评价系统的前端等值线填充绘制
 *
 * 注意：这是备用渲染方案，默认使用后端高质量渲染模式
 * 仅在用户关闭"高质量模式"时加载此组件
 */

import React, { useEffect, useRef } from 'react';

// ODI等级颜色映射
const getODIColor = (odi, alpha = 1) => {
  const clampedOdi = Math.max(0, Math.min(1, odi));
  let r, g, b;
  if (clampedOdi <= 0.045) {
    r = 59; g = 130; b = 246; // I级 - 蓝色
  } else if (clampedOdi <= 0.345) {
    r = 250; g = 204; b = 21; // II级 - 黄色
  } else if (clampedOdi <= 0.825) {
    r = 251; g = 146; b = 60; // III级 - 橙色
  } else if (clampedOdi <= 0.847) {
    r = 248; g = 113; b = 113; // IV级 - 浅红色
  } else {
    r = 220; g = 38; b = 38; // V级 - 深红色
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const CanvasRenderer = ({
  results,
  workfaceCoords,
  scale,
  panOffset,
  showContourFill,
  showContourLines,
  showPoints,
  contourLevels,
  contourField
}) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !results) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    // 清空画布
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    if (results.length === 0) return;

    // 计算坐标范围
    const xs = results.map(r => r.x);
    const ys = results.map(r => r.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);

    const padding = 80;
    const plotWidth = width - padding * 2;
    const plotHeight = height - padding * 2;
    const scaleX = plotWidth / (maxX - minX || 1);
    const scaleY = plotHeight / (maxY - minY || 1);
    const s = Math.min(scaleX, scaleY) * scale;

    // 居中偏移
    const offsetX = (plotWidth - (maxX - minX) * s) / 2;
    const offsetY = (plotHeight - (maxY - minY) * s) / 2;

    const toScreen = (x, y) => ({
      sx: padding + offsetX + (x - minX) * s + panOffset.x,
      sy: height - padding - offsetY - (y - minY) * s + panOffset.y
    });

    // 根据选择的字段获取数值
    const getValueFromPoint = (pt) => {
      if (!pt) return 0;
      if (contourField === 'odi_normalized') return pt.odi_normalized ?? 0;
      if (contourField === 'odi') return pt.odi ?? 0;
      const geo = pt.geo_params || {};
      const mining = pt.mining_params || {};
      if (contourField in geo) return geo[contourField] ?? 0;
      if (contourField in mining) return mining[contourField] ?? 0;
      return 0;
    };

    const isODIField = contourField === 'odi_normalized' || contourField === 'odi';

    const valueList = results.map(getValueFromPoint).filter(v => Number.isFinite(v));
    const minVal = valueList.length ? Math.min(...valueList) : 0;
    const maxVal = valueList.length ? Math.max(...valueList) : 1;
    const span = maxVal - minVal;

    const normalizeValue = (v) => {
      if (!Number.isFinite(v)) return 0;
      if (span <= 0) return 0;
      return Math.max(0, Math.min(1, (v - minVal) / span));
    };

    // 判断点是否在工作面多边形内
    const isInWorkface = (px, py) => {
      if (workfaceCoords.length < 3) return true;
      let inside = false;
      const n = workfaceCoords.length;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = workfaceCoords[i].x, yi = workfaceCoords[i].y;
        const xj = workfaceCoords[j].x, yj = workfaceCoords[j].y;
        if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
          inside = !inside;
        }
      }
      return inside;
    };

    // ========== 1. 绘制等值线填充 ==========
    if (showContourFill) {
      let centerX = 0, centerY = 0, maxRadius = 500;
      if (workfaceCoords.length >= 3) {
        centerX = workfaceCoords.reduce((s, p) => s + p.x, 0) / workfaceCoords.length;
        centerY = workfaceCoords.reduce((s, p) => s + p.y, 0) / workfaceCoords.length;
        maxRadius = Math.max(...workfaceCoords.map(p =>
          Math.sqrt((p.x - centerX) ** 2 + (p.y - centerY) ** 2)
        ));
      }

      const gridWidth = Math.ceil(plotWidth);
      const gridHeight = Math.ceil(plotHeight);
      const gridData = new Float32Array(gridWidth * gridHeight);
      const power = 2.5;
      const hasValidResults = results && results.length > 0;
      const influenceRadius = hasValidResults ?
        Math.max(maxX - minX, maxY - minY) * 0.3 : maxRadius * 2;
      const worldWidth = maxX - minX || 1;
      const worldHeight = maxY - minY || 1;

      const isMiningHeightField = contourField === 'Mi';

      for (let py = 0; py < gridHeight; py++) {
        for (let px = 0; px < gridWidth; px++) {
          const worldX = minX + (px / gridWidth) * worldWidth;
          const worldY = maxY - (py / gridHeight) * worldHeight;
          let value;

          if (hasValidResults) {
            if (isMiningHeightField && !isInWorkface(worldX, worldY)) {
              value = 0;
            } else if (isODIField && !isInWorkface(worldX, worldY)) {
              value = 0;
            } else {
              let weightSum = 0;
              let valueSum = 0;

              for (const pt of results) {
                if (isODIField && !pt.in_workface) continue;
                const dx = worldX - pt.x;
                const dy = worldY - pt.y;
                const distSq = dx * dx + dy * dy;
                const dist = Math.sqrt(distSq);

                if (dist < 0.1) {
                  value = getValueFromPoint(pt);
                  weightSum = 1;
                  valueSum = value;
                  break;
                }

                const idwWeight = 1 / Math.pow(dist, power);
                const gaussWeight = Math.exp(-distSq / (influenceRadius * influenceRadius * 0.1));
                const weight = idwWeight * gaussWeight;
                weightSum += weight;
                valueSum += weight * getValueFromPoint(pt);
              }
              value = weightSum > 0 ? valueSum / weightSum : 0;
            }
          } else {
            const inWorkface = isInWorkface(worldX, worldY);
            if (inWorkface) {
              const distToCenter = Math.sqrt((worldX - centerX) ** 2 + (worldY - centerY) ** 2);
              value = 0.9 + 0.1 * (1 - distToCenter / maxRadius);
            } else {
              value = isMiningHeightField ? 0 : 0.3;
            }
          }
          gridData[py * gridWidth + px] = value;
        }
      }

      // 高斯模糊（非Mi字段）
      const smoothedData = new Float32Array(gridWidth * gridHeight);
      if (isMiningHeightField) {
        smoothedData.set(gridData);
      } else {
        const gaussKernel = [1/16, 2/16, 1/16, 2/16, 4/16, 2/16, 1/16, 2/16, 1/16];
        for (let py = 1; py < gridHeight - 1; py++) {
          for (let px = 1; px < gridWidth - 1; px++) {
            let sum = 0, ki = 0;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                sum += gridData[(py + dy) * gridWidth + (px + dx)] * gaussKernel[ki++];
              }
            }
            smoothedData[py * gridWidth + px] = sum;
          }
        }
        for (let px = 0; px < gridWidth; px++) {
          smoothedData[px] = gridData[px];
          smoothedData[(gridHeight - 1) * gridWidth + px] = gridData[(gridHeight - 1) * gridWidth + px];
        }
        for (let py = 0; py < gridHeight; py++) {
          smoothedData[py * gridWidth] = gridData[py * gridWidth];
          smoothedData[py * gridWidth + gridWidth - 1] = gridData[py * gridWidth + gridWidth - 1];
        }
      }

      // 渲染到ImageData
      const imageData = ctx.createImageData(gridWidth, gridHeight);
      const data = imageData.data;

      for (let py = 0; py < gridHeight; py++) {
        for (let px = 0; px < gridWidth; px++) {
          const value = smoothedData[py * gridWidth + px];
          const idx = (py * gridWidth + px) * 4;
          let r, g, b;

          if (isODIField) {
            if (value <= 0.045) { r = 59; g = 130; b = 246; }
            else if (value <= 0.345) { r = 250; g = 204; b = 21; }
            else if (value <= 0.825) { r = 251; g = 146; b = 60; }
            else if (value <= 0.847) { r = 248; g = 113; b = 113; }
            else { r = 220; g = 38; b = 38; }
          } else {
            const normValue = normalizeValue(value);
            const t = Math.max(0, Math.min(1, normValue));
            if (t < 0.25) {
              const tt = t / 0.25;
              r = 59; g = Math.round(130 + 100 * tt); b = Math.round(246 - 100 * tt);
            } else if (t < 0.5) {
              const tt = (t - 0.25) / 0.25;
              r = Math.round(59 + 50 * tt); g = 230; b = Math.round(146 - 86 * tt);
            } else if (t < 0.75) {
              const tt = (t - 0.5) / 0.25;
              r = Math.round(109 + 141 * tt); g = Math.round(230 - 26 * tt); b = 60;
            } else {
              const tt = (t - 0.75) / 0.25;
              r = Math.round(250 - 30 * tt); g = Math.round(204 - 166 * tt); b = Math.round(60 - 22 * tt);
            }
          }

          data[idx] = r;
          data[idx + 1] = g;
          data[idx + 2] = b;
          data[idx + 3] = 230;
        }
      }

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = gridWidth;
      tempCanvas.height = gridHeight;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.putImageData(imageData, 0, 0);

      ctx.drawImage(tempCanvas,
        padding + offsetX + panOffset.x,
        padding + offsetY + panOffset.y,
        (maxX - minX) * s,
        (maxY - minY) * s
      );
    }

    // ========== 2. 绘制工作面边界 ==========
    if (workfaceCoords.length >= 3) {
      ctx.beginPath();
      const first = toScreen(workfaceCoords[0].x, workfaceCoords[0].y);
      ctx.moveTo(first.sx, first.sy);
      for (let i = 1; i < workfaceCoords.length; i++) {
        const pt = toScreen(workfaceCoords[i].x, workfaceCoords[i].y);
        ctx.lineTo(pt.sx, pt.sy);
      }
      ctx.closePath();
      ctx.strokeStyle = '#0ea5e9';
      ctx.lineWidth = 3;
      ctx.stroke();

      const centerX = workfaceCoords.reduce((s, p) => s + p.x, 0) / workfaceCoords.length;
      const centerY = workfaceCoords.reduce((s, p) => s + p.y, 0) / workfaceCoords.length;
      const center = toScreen(centerX, centerY);
      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = '#0ea5e9';
      ctx.textAlign = 'center';
      ctx.fillText('工作面', center.sx, center.sy);
    }

    // ========== 3. 绘制评价点 ==========
    if (showPoints) {
      results.forEach(pt => {
        const { sx, sy } = toScreen(pt.x, pt.y);
        const normVal = normalizeValue(getValueFromPoint(pt));

        if (pt.type === 'borehole') {
          ctx.beginPath();
          ctx.arc(sx, sy, 6, 0, Math.PI * 2);
          ctx.fillStyle = getODIColor(normVal, 1);
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.font = '9px sans-serif';
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.fillText(pt.id, sx, sy - 10);
        } else {
          ctx.beginPath();
          ctx.arc(sx, sy, 3, 0, Math.PI * 2);
          ctx.fillStyle = getODIColor(normVal, 0.8);
          ctx.fill();
        }
      });
    }

    // ========== 4. 绘制坐标轴 ==========
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.font = '10px monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'center';

    // X轴
    ctx.beginPath();
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.stroke();

    const xTicks = 5;
    for (let i = 0; i <= xTicks; i++) {
      const x = padding + i * plotWidth / xTicks;
      const val = minX + i * (maxX - minX) / xTicks;
      ctx.beginPath();
      ctx.moveTo(x, height - padding);
      ctx.lineTo(x, height - padding + 5);
      ctx.stroke();
      ctx.fillText(val.toFixed(0), x, height - padding + 18);
    }
    ctx.fillText('X坐标 (m)', width / 2, height - 15);

    // Y轴
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, height - padding);
    ctx.stroke();

    ctx.textAlign = 'right';
    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
      const y = height - padding - i * plotHeight / yTicks;
      const val = minY + i * (maxY - minY) / yTicks;
      ctx.beginPath();
      ctx.moveTo(padding - 5, y);
      ctx.lineTo(padding, y);
      ctx.stroke();
      ctx.fillText(val.toFixed(0), padding - 8, y + 3);
    }
    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('Y坐标 (m)', 0, 0);
    ctx.restore();

    // ========== 5. 绘制色标图例 ==========
    const legendX = width - 100;
    const legendY = padding;
    const legendWidth = 25;
    const legendHeight = 150;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
    ctx.fillRect(legendX - 20, legendY - 30, 115, legendHeight + 120);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.strokeRect(legendX - 20, legendY - 30, 115, legendHeight + 120);

    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'center';
    ctx.fillText('扰动等级', legendX + legendWidth / 2, legendY - 12);

    const levelColors = [
      { level: 5, color: '#dc2626', label: 'V级' },
      { level: 4, color: '#f87171', label: 'IV级' },
      { level: 3, color: '#fb923c', label: 'III级' },
      { level: 2, color: '#facc15', label: 'II级' },
      { level: 1, color: '#3b82f6', label: 'I级' },
    ];

    const blockHeight = legendHeight / 5;
    levelColors.forEach((item, idx) => {
      const y = legendY + idx * blockHeight;
      ctx.fillStyle = item.color;
      ctx.fillRect(legendX, y, legendWidth, blockHeight);
      ctx.font = '10px sans-serif';
      ctx.fillStyle = '#e2e8f0';
      ctx.textAlign = 'left';
      ctx.fillText(item.label, legendX + legendWidth + 6, y + blockHeight / 2 + 3);
    });

    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.strokeRect(legendX, legendY, legendWidth, legendHeight);

  }, [results, workfaceCoords, scale, panOffset, showContourFill, showContourLines, showPoints, contourLevels, contourField]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      onWheel={(e) => {
        e.preventDefault();
        // 缩放由父组件处理
      }}
    />
  );
};

export default CanvasRenderer;
