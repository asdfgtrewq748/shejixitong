import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, Upload, Database, Settings, Play, FileUp, Map,
  Layers, Target, AlertTriangle, CheckCircle, Download, RefreshCw,
  ChevronDown, ChevronRight, Info, BarChart3, Sliders, Eye, ArrowLeft
} from 'lucide-react';
import * as api from '../api';

// 场景配置
const SCENARIOS = {
  surface_subsidence: {
    name: '地表下沉',
    description: '评价地表沉陷风险',
    color: 'blue',
    icon: Layers
  },
  aquifer_disturbance: {
    name: '含水层扰动',
    description: '预测突水风险',
    color: 'cyan',
    icon: Activity
  },
  upward_mining: {
    name: '上行开采可行性',
    description: '评估上煤层开采难度',
    color: 'purple',
    icon: Target
  }
};

// ODI等级颜色
const LEVEL_COLORS = {
  1: { bg: 'bg-green-500', text: 'text-green-400', label: 'I级 轻微扰动' },
  2: { bg: 'bg-lime-500', text: 'text-lime-400', label: 'II级 较弱扰动' },
  3: { bg: 'bg-yellow-500', text: 'text-yellow-400', label: 'III级 中等扰动' },
  4: { bg: 'bg-orange-500', text: 'text-orange-400', label: 'IV级 较强扰动' },
  5: { bg: 'bg-red-500', text: 'text-red-400', label: 'V级 强扰动' }
};

// 可视化字段映射
const CONTOUR_FIELDS = {
  odi_normalized: 'ODI(归一化)',
  odi: 'ODI',
  Ti: '目标层厚度 Ti',
  Ei: '目标层弹模 Ei',
  Hi: '煤层-目标层间距 Hi',
  Di: '目标层埋深 Di',
  Mi: '采高 Mi'
};

const DisturbanceEvaluation = () => {
  const navigate = useNavigate();

  // 状态管理
  const [activeScenario, setActiveScenario] = useState('surface_subsidence');
  const [step, setStep] = useState(1); // 1:数据导入 2:参数配置 3:计算 4:结果
  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState([]);

  // 数据状态
  const [boreholeCoords, setBoreholeCoords] = useState([]);
  const [boreholeLayers, setBoreholeLayers] = useState({});
  const [workfaceCoords, setWorkfaceCoords] = useState([]);
  const [measuredData, setMeasuredData] = useState([]);

  // 参数状态
  const [miningHeight, setMiningHeight] = useState(3.0);
  const [stepSize, setStepSize] = useState(25);
  const [collapseAngle, setCollapseAngle] = useState(75);
  const [customWeights, setCustomWeights] = useState({ wd: 0.45, wo: 0.30, wf: 0.25 });

  // 结果状态
  const [results, setResults] = useState(null);
  const [contours, setContours] = useState(null);
  const [statistics, setStatistics] = useState(null);
  const [contourField, setContourField] = useState('odi_normalized');

  // 画布相关
  const canvasRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

  // 视图控制状态
  const [showContourFill, setShowContourFill] = useState(true);
  const [showContourLines, setShowContourLines] = useState(true);
  const [showPoints, setShowPoints] = useState(true);
  const [contourLevels, setContourLevels] = useState(10);

  // 添加日志
  const addLog = useCallback((msg, type = 'info') => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [`[${time}] ${msg}|${type}`, ...prev].slice(0, 50));
  }, []);

  // 加载场景默认权重
  useEffect(() => {
    const scenarioWeights = {
      surface_subsidence: { wd: 0.45, wo: 0.30, wf: 0.25 },
      aquifer_disturbance: { wd: 0.60, wo: 0.25, wf: 0.15 },
      upward_mining: { wd: 0.20, wo: 0.45, wf: 0.35 }
    };
    setCustomWeights(scenarioWeights[activeScenario]);
  }, [activeScenario]);

  // 文件上传处理
  const handleFileUpload = async (type, file) => {
    setIsLoading(true);
    addLog(`正在上传 ${file.name}...`, 'loading');

    try {
      let result;
      switch (type) {
        case 'boreholes':
          result = await api.uploadDisturbanceBoreholes(file);
          if (result.success) {
            setBoreholeCoords(result.data);
            addLog(`成功导入 ${result.count} 个钻孔坐标`, 'success');
          }
          break;
        case 'workface':
          result = await api.uploadDisturbanceWorkface(file);
          if (result.success) {
            setWorkfaceCoords(result.data);
            addLog(`成功导入 ${result.count} 个工作面坐标点`, 'success');
          }
          break;
        case 'measured':
          result = await api.uploadMeasuredData(file);
          if (result.success) {
            setMeasuredData(result.data);
            addLog(`成功导入 ${result.count} 个实测数据点`, 'success');
          }
          break;
        default:
          break;
      }
    } catch (err) {
      addLog(`上传失败: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // 批量上传钻孔分层
  const handleLayersUpload = async (files) => {
    setIsLoading(true);
    const newLayers = { ...boreholeLayers };
    let successCount = 0;

    for (const file of files) {
      const boreholeId = file.name.replace(/\.(xlsx|csv|xls)$/i, '').replace('_marked', '');
      addLog(`正在解析 ${boreholeId} 分层数据...`, 'loading');

      try {
        const result = await api.uploadBoreholeLayers_Disturbance(boreholeId, file);
        if (result.success) {
          newLayers[boreholeId] = {
            layers: result.layers,
            geo_params: result.geo_params
          };
          successCount++;
        }
      } catch (err) {
        addLog(`${boreholeId} 解析失败: ${err.message}`, 'warning');
      }
    }

    setBoreholeLayers(newLayers);
    addLog(`成功解析 ${successCount}/${files.length} 个钻孔分层数据`, 'success');
    setIsLoading(false);
  };

  // 执行ODI计算
  const handleCalculate = async () => {
    if (boreholeCoords.length === 0 || workfaceCoords.length === 0) {
      addLog('请先导入钻孔坐标和工作面坐标', 'error');
      return;
    }

    setIsLoading(true);
    addLog('正在计算ODI...', 'loading');

    try {
      // 构建钻孔完整数据
      const boreholeData = boreholeCoords.map(bh => {
        const layers = boreholeLayers[bh.id];
        return {
          ...bh,
          ...(layers?.geo_params || {}),
        };
      });

      const result = await api.calculateODI({
        scenario: activeScenario,
        mining_height: miningHeight,
        step_size: stepSize,
        custom_weights: customWeights,
        borehole_data: boreholeData,
        workface_coords: workfaceCoords
      });

      if (result.success) {
        setResults(result.results);
        setContours(result.contours);
        setStatistics(result.statistics);
        setStep(4);
        addLog(`计算完成，共 ${result.point_count} 个评价点`, 'success');
      }
    } catch (err) {
      addLog(`计算失败: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // 实测校准
  const handleCalibrate = async () => {
    if (measuredData.length === 0) {
      addLog('请先导入实测数据', 'error');
      return;
    }

    setIsLoading(true);
    addLog('正在进行实测约束校准...', 'loading');

    try {
      const result = await api.calibrateODI(measuredData);
      if (result.success) {
        addLog(`校准完成，平均误差: ${result.statistics.mean_error.toFixed(4)}`, 'success');
      }
    } catch (err) {
      addLog(`校准失败: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // 绘制结果到Canvas - 等值线填充效果
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

    const fromScreen = (sx, sy) => ({
      x: minX + (sx - padding - offsetX - panOffset.x) / s,
      y: minY + (height - padding - offsetY - sy - panOffset.y) / s
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

    const valueList = results.map(getValueFromPoint).filter(v => Number.isFinite(v));
    const minVal = valueList.length ? Math.min(...valueList) : 0;
    const maxVal = valueList.length ? Math.max(...valueList) : 1;
    const span = maxVal - minVal;
    const normalizeValue = (v) => {
      if (!Number.isFinite(v)) return 0;
      if (span <= 0) return 0;
      return Math.max(0, Math.min(1, (v - minVal) / span));
    };

    // ODI颜色映射函数 - 类似地质图的渐变色带
    const getODIColor = (odi, alpha = 1) => {
      // 5级色带: 绿 -> 黄绿 -> 黄 -> 橙 -> 红
      const colors = [
        { stop: 0.0, r: 34, g: 197, b: 94 },    // 绿色 - I级
        { stop: 0.2, r: 132, g: 204, b: 22 },   // 黄绿 - II级
        { stop: 0.4, r: 234, g: 179, b: 8 },    // 黄色 - III级
        { stop: 0.7, r: 249, g: 115, b: 22 },   // 橙色 - IV级
        { stop: 1.0, r: 239, g: 68, b: 68 },    // 红色 - V级
      ];

      const clampedOdi = Math.max(0, Math.min(1, odi));

      // 找到插值区间
      let lower = colors[0], upper = colors[colors.length - 1];
      for (let i = 0; i < colors.length - 1; i++) {
        if (clampedOdi >= colors[i].stop && clampedOdi <= colors[i + 1].stop) {
          lower = colors[i];
          upper = colors[i + 1];
          break;
        }
      }

      // 线性插值
      const t = (clampedOdi - lower.stop) / (upper.stop - lower.stop || 1);
      const r = Math.round(lower.r + (upper.r - lower.r) * t);
      const g = Math.round(lower.g + (upper.g - lower.g) * t);
      const b = Math.round(lower.b + (upper.b - lower.b) * t);

      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    // IDW插值函数
    const interpolateValue = (px, py) => {
      let weightSum = 0;
      let valueSum = 0;
      const power = 2; // IDW幂次

      for (const pt of results) {
        const dx = px - pt.x;
        const dy = py - pt.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 1) {
          return getValueFromPoint(pt);
        }

        const weight = 1 / Math.pow(dist, power);
        weightSum += weight;
        valueSum += weight * getValueFromPoint(pt);
      }

      return weightSum > 0 ? valueSum / weightSum : 0;
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
      // 计算工作面中心和半径（用于距离衰减）
      let centerX = 0, centerY = 0, maxRadius = 500;
      if (workfaceCoords.length >= 3) {
        centerX = workfaceCoords.reduce((s, p) => s + p.x, 0) / workfaceCoords.length;
        centerY = workfaceCoords.reduce((s, p) => s + p.y, 0) / workfaceCoords.length;
        maxRadius = Math.max(...workfaceCoords.map(p =>
          Math.sqrt((p.x - centerX) ** 2 + (p.y - centerY) ** 2)
        ));
      }

      // 计算到工作面边界的最短距离
      const distanceToWorkfaceBoundary = (px, py) => {
        if (workfaceCoords.length < 3) return 0;
        let minDist = Infinity;
        const n = workfaceCoords.length;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const x1 = workfaceCoords[i].x, y1 = workfaceCoords[i].y;
          const x2 = workfaceCoords[j].x, y2 = workfaceCoords[j].y;

          const dx = x2 - x1, dy = y2 - y1;
          const lenSq = dx * dx + dy * dy;

          let t = 0;
          if (lenSq > 0) {
            t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
          }

          const nearX = x1 + t * dx;
          const nearY = y1 + t * dy;
          const dist = Math.sqrt((px - nearX) ** 2 + (py - nearY) ** 2);
          minDist = Math.min(minDist, dist);
        }
        return minDist;
      };

      // 使用imageData直接操作像素
      const gridRes = 3;
      const imageData = ctx.createImageData(Math.ceil(plotWidth), Math.ceil(plotHeight));
      const data = imageData.data;

      for (let py = 0; py < plotHeight; py += gridRes) {
        for (let px = 0; px < plotWidth; px += gridRes) {
          // 屏幕坐标转世界坐标
          const worldX = minX + px / s;
          const worldY = maxY - py / s;

          // 计算当前字段值
          let value;
          const hasValidResults = results && results.length > 0;

          if (hasValidResults) {
            // 使用后端返回的数据进行插值
            value = interpolateValue(worldX, worldY);
          } else {
            // 基于距离计算（工作面中心最高，向外衰减）
            const inWorkface = isInWorkface(worldX, worldY);
            const distToBoundary = distanceToWorkfaceBoundary(worldX, worldY);

            if (inWorkface) {
              // 工作面内部：高ODI，中心最高
              const normalizedDist = Math.min(distToBoundary / (maxRadius * 0.3), 1);
              value = 0.9 + 0.1 * normalizedDist;
            } else {
              // 工作面外部：指数衰减
              const decayLength = maxRadius * 0.8;
              value = 0.85 * Math.exp(-distToBoundary / decayLength);
            }
          }

          // 直接计算颜色（避免字符串解析）
          const clampedOdi = normalizeValue(value);
          let r, g, b;

          if (clampedOdi <= 0.2) {
            const t = clampedOdi / 0.2;
            r = Math.round(34 + (132 - 34) * t);
            g = Math.round(197 + (204 - 197) * t);
            b = Math.round(94 + (22 - 94) * t);
          } else if (clampedOdi <= 0.4) {
            const t = (clampedOdi - 0.2) / 0.2;
            r = Math.round(132 + (234 - 132) * t);
            g = Math.round(204 + (179 - 204) * t);
            b = Math.round(22 + (8 - 22) * t);
          } else if (clampedOdi <= 0.7) {
            const t = (clampedOdi - 0.4) / 0.3;
            r = Math.round(234 + (249 - 234) * t);
            g = Math.round(179 + (115 - 179) * t);
            b = Math.round(8 + (22 - 8) * t);
          } else {
            const t = (clampedOdi - 0.7) / 0.3;
            r = Math.round(249 + (239 - 249) * t);
            g = Math.round(115 + (68 - 115) * t);
            b = Math.round(22 + (68 - 22) * t);
          }

          // 填充像素块
          for (let dy = 0; dy < gridRes && py + dy < plotHeight; dy++) {
            for (let dx = 0; dx < gridRes && px + dx < plotWidth; dx++) {
              const idx = ((py + dy) * Math.ceil(plotWidth) + (px + dx)) * 4;
              data[idx] = r;
              data[idx + 1] = g;
              data[idx + 2] = b;
              data[idx + 3] = 230; // alpha
            }
          }
        }
      }

      // 绘制到画布
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = Math.ceil(plotWidth);
      tempCanvas.height = Math.ceil(plotHeight);
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.putImageData(imageData, 0, 0);
      ctx.drawImage(tempCanvas, padding + panOffset.x, padding + panOffset.y);
    }

    // ========== 2. 绘制等值线 ==========
    if (showContourLines && workfaceCoords.length >= 3) {
      const levels = [];
      for (let i = 1; i <= contourLevels; i++) {
        levels.push(i / contourLevels);
      }

      ctx.lineWidth = 2;

      // 计算工作面几何信息
      let centerX = 0, centerY = 0, maxRadius = 500;
      if (workfaceCoords.length >= 3) {
        centerX = workfaceCoords.reduce((s, p) => s + p.x, 0) / workfaceCoords.length;
        centerY = workfaceCoords.reduce((s, p) => s + p.y, 0) / workfaceCoords.length;
        maxRadius = Math.max(...workfaceCoords.map(p =>
          Math.sqrt((p.x - centerX) ** 2 + (p.y - centerY) ** 2)
        ));
      }

      // 为每个等级绘制等值线（使用Marching Squares）
      const gridSize = 15;
      const numX = Math.ceil(plotWidth / gridSize) + 1;
      const numY = Math.ceil(plotHeight / gridSize) + 1;

      // 预计算网格上的ODI值
      const grid = [];
      for (let gy = 0; gy < numY; gy++) {
        grid[gy] = [];
        for (let gx = 0; gx < numX; gx++) {
          const sx = gx * gridSize;
          const sy = gy * gridSize;
          const worldX = minX + (sx - offsetX) / s;
          const worldY = minY + (plotHeight - sy - offsetY) / s;

          // 仅工作面内插值
          if (!isInWorkface(worldX, worldY)) {
            grid[gy][gx] = NaN;
            continue;
          }

          let val;
          if (results.length > 0) {
            val = interpolateValue(worldX, worldY);
          } else {
            const distToCenter = Math.sqrt((worldX - centerX) ** 2 + (worldY - centerY) ** 2);
            val = 0.85 + 0.15 * (1 - distToCenter / maxRadius);
          }
          grid[gy][gx] = normalizeValue(val);
        }
      }

      // Marching Squares 查找表
      const edgeTable = [
        [], [0, 3], [0, 1], [1, 3], [1, 2], [0, 1, 2, 3], [0, 2], [2, 3],
        [2, 3], [0, 2], [0, 3, 1, 2], [1, 2], [1, 3], [0, 1], [0, 3], []
      ];

      levels.forEach((level) => {
        ctx.strokeStyle = getODIColor(level, 1);
        ctx.beginPath();

        for (let gy = 0; gy < numY - 1; gy++) {
          for (let gx = 0; gx < numX - 1; gx++) {
            // 四个角的值
            const v0 = grid[gy][gx];
            const v1 = grid[gy][gx + 1];
            const v2 = grid[gy + 1][gx + 1];
            const v3 = grid[gy + 1][gx];

            // 若该单元有 NaN（工作面外），跳过
            if ([v0, v1, v2, v3].some(v => Number.isNaN(v))) continue;

            // 计算case索引
            let caseIndex = 0;
            if (v0 >= level) caseIndex |= 1;
            if (v1 >= level) caseIndex |= 2;
            if (v2 >= level) caseIndex |= 4;
            if (v3 >= level) caseIndex |= 8;

            const edges = edgeTable[caseIndex];
            if (edges.length === 0) continue;

            // 四个角的屏幕坐标
            const x0 = padding + gx * gridSize + panOffset.x;
            const y0 = padding + gy * gridSize + panOffset.y;
            const x1 = x0 + gridSize;
            const y1 = y0 + gridSize;

            // 计算边上的插值点
            const getEdgePoint = (edge) => {
              switch (edge) {
                case 0: { // 上边 (v0-v1)
                  const t = (level - v0) / (v1 - v0 || 0.001);
                  return { x: x0 + t * gridSize, y: y0 };
                }
                case 1: { // 右边 (v1-v2)
                  const t = (level - v1) / (v2 - v1 || 0.001);
                  return { x: x1, y: y0 + t * gridSize };
                }
                case 2: { // 下边 (v3-v2)
                  const t = (level - v3) / (v2 - v3 || 0.001);
                  return { x: x0 + t * gridSize, y: y1 };
                }
                case 3: { // 左边 (v0-v3)
                  const t = (level - v0) / (v3 - v0 || 0.001);
                  return { x: x0, y: y0 + t * gridSize };
                }
              }
            };

            // 绘制线段
            for (let i = 0; i < edges.length; i += 2) {
              const p1 = getEdgePoint(edges[i]);
              const p2 = getEdgePoint(edges[i + 1]);
              if (p1 && p2) {
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
              }
            }
          }
        }

        ctx.stroke();
      });
    }

    // ========== 3. 绘制工作面边界 ==========
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

      // 添加工作面标签
      const centerX = workfaceCoords.reduce((s, p) => s + p.x, 0) / workfaceCoords.length;
      const centerY = workfaceCoords.reduce((s, p) => s + p.y, 0) / workfaceCoords.length;
      const center = toScreen(centerX, centerY);
      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = '#0ea5e9';
      ctx.textAlign = 'center';
      ctx.fillText('工作面', center.sx, center.sy);
    }

    // ========== 4. 绘制评价点 ==========
    if (showPoints) {
      results.forEach(pt => {
        const { sx, sy } = toScreen(pt.x, pt.y);
        const level = pt.disturbance_level || 1;
        const normVal = normalizeValue(getValueFromPoint(pt));

        // 根据类型绘制不同样式
        if (pt.type === 'borehole') {
          // 钻孔点 - 较大的圆圈
          ctx.beginPath();
          ctx.arc(sx, sy, 6, 0, Math.PI * 2);
          ctx.fillStyle = getODIColor(normVal, 1);
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.stroke();

          // 标注钻孔ID
          ctx.font = '9px sans-serif';
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.fillText(pt.id, sx, sy - 10);
        } else {
          // 普通评价点 - 小点
          ctx.beginPath();
          ctx.arc(sx, sy, 3, 0, Math.PI * 2);
          ctx.fillStyle = getODIColor(normVal, 0.8);
          ctx.fill();
        }
      });
    }

    // ========== 5. 绘制坐标轴 ==========
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

    // X轴刻度
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

    // Y轴刻度
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

    // ========== 6. 绘制色标图例 ==========
    const legendX = width - 70;
    const legendY = padding;
    const legendWidth = 20;
    const legendHeight = 200;

    // 色标背景
    ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
    ctx.fillRect(legendX - 15, legendY - 25, 75, legendHeight + 60);

    // 色标标题
    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'center';
    ctx.fillText(CONTOUR_FIELDS[contourField] || 'ODI', legendX + legendWidth / 2, legendY - 8);

    // 绘制色标渐变
    const gradient = ctx.createLinearGradient(legendX, legendY + legendHeight, legendX, legendY);
    gradient.addColorStop(0, getODIColor(0, 1));
    gradient.addColorStop(0.2, getODIColor(0.2, 1));
    gradient.addColorStop(0.4, getODIColor(0.4, 1));
    gradient.addColorStop(0.7, getODIColor(0.7, 1));
    gradient.addColorStop(1, getODIColor(1, 1));

    ctx.fillStyle = gradient;
    ctx.fillRect(legendX, legendY, legendWidth, legendHeight);

    // 色标边框
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.strokeRect(legendX, legendY, legendWidth, legendHeight);

    // 色标刻度和等级标签
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'left';
    const levelLabels = [0, 0.25, 0.5, 0.75, 1.0].map(pos => {
      const val = span > 0 ? (minVal + pos * span) : minVal;
      return { pos, label: val.toFixed(2) };
    });

    levelLabels.forEach(({ pos, label, level }) => {
      const y = legendY + legendHeight * (1 - pos);
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(label, legendX + legendWidth + 4, y + 3);
    });

  }, [results, workfaceCoords, scale, panOffset, showContourFill, showContourLines, showPoints, contourLevels, contourField]);

  // 渲染场景选择器
  const renderScenarioSelector = () => (
    <div className="grid grid-cols-3 gap-3">
      {Object.entries(SCENARIOS).map(([key, scenario]) => {
        const Icon = scenario.icon;
        const isActive = activeScenario === key;
        return (
          <button
            key={key}
            onClick={() => setActiveScenario(key)}
            className={`p-4 rounded-xl border-2 transition-all ${
              isActive
                ? `border-${scenario.color}-500 bg-${scenario.color}-500/20`
                : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
            }`}
          >
            <Icon className={`mx-auto mb-2 ${isActive ? `text-${scenario.color}-400` : 'text-gray-400'}`} size={24} />
            <div className={`font-bold text-sm ${isActive ? 'text-white' : 'text-gray-300'}`}>
              {scenario.name}
            </div>
            <div className="text-[10px] text-gray-500 mt-1">{scenario.description}</div>
          </button>
        );
      })}
    </div>
  );

  // 渲染数据导入面板
  const renderDataImport = () => (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-cyan-400 flex items-center gap-2">
        <Database size={14} /> 数据导入
      </h3>

      {/* 钻孔坐标 */}
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-gray-300">钻孔坐标</span>
          {boreholeCoords.length > 0 && (
            <span className="text-xs text-green-400 flex items-center gap-1">
              <CheckCircle size={12} /> {boreholeCoords.length} 个
            </span>
          )}
        </div>
        <label className="flex items-center justify-center gap-2 py-3 px-4 bg-gray-700/50 rounded-lg cursor-pointer hover:bg-gray-700 transition-colors border border-dashed border-gray-600">
          <Upload size={16} className="text-gray-400" />
          <span className="text-xs text-gray-400">选择 CSV/Excel 文件</span>
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => e.target.files[0] && handleFileUpload('boreholes', e.target.files[0])}
          />
        </label>
      </div>

      {/* 钻孔分层 */}
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-gray-300">钻孔分层数据</span>
          {Object.keys(boreholeLayers).length > 0 && (
            <span className="text-xs text-green-400 flex items-center gap-1">
              <CheckCircle size={12} /> {Object.keys(boreholeLayers).length} 个
            </span>
          )}
        </div>
        <label className="flex items-center justify-center gap-2 py-3 px-4 bg-gray-700/50 rounded-lg cursor-pointer hover:bg-gray-700 transition-colors border border-dashed border-gray-600">
          <FileUp size={16} className="text-gray-400" />
          <span className="text-xs text-gray-400">批量选择分层文件</span>
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            multiple
            className="hidden"
            onChange={(e) => e.target.files.length > 0 && handleLayersUpload(Array.from(e.target.files))}
          />
        </label>
      </div>

      {/* 工作面坐标 */}
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-gray-300">工作面坐标</span>
          {workfaceCoords.length > 0 && (
            <span className="text-xs text-green-400 flex items-center gap-1">
              <CheckCircle size={12} /> {workfaceCoords.length} 点
            </span>
          )}
        </div>
        <label className="flex items-center justify-center gap-2 py-3 px-4 bg-gray-700/50 rounded-lg cursor-pointer hover:bg-gray-700 transition-colors border border-dashed border-gray-600">
          <Map size={16} className="text-gray-400" />
          <span className="text-xs text-gray-400">选择工作面边界文件</span>
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => e.target.files[0] && handleFileUpload('workface', e.target.files[0])}
          />
        </label>
      </div>

      {/* 实测数据 (可选) */}
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-gray-300">实测数据 (可选)</span>
          {measuredData.length > 0 && (
            <span className="text-xs text-green-400 flex items-center gap-1">
              <CheckCircle size={12} /> {measuredData.length} 点
            </span>
          )}
        </div>
        <label className="flex items-center justify-center gap-2 py-3 px-4 bg-gray-700/50 rounded-lg cursor-pointer hover:bg-gray-700 transition-colors border border-dashed border-gray-600">
          <BarChart3 size={16} className="text-gray-400" />
          <span className="text-xs text-gray-400">选择实测数据文件</span>
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => e.target.files[0] && handleFileUpload('measured', e.target.files[0])}
          />
        </label>
      </div>
    </div>
  );

  // 渲染参数配置面板
  const renderParamsConfig = () => (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-purple-400 flex items-center gap-2">
        <Settings size={14} /> 参数配置
      </h3>

      {/* 开采参数 */}
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 space-y-4">
        <div className="text-xs text-gray-400 uppercase tracking-wider">开采参数</div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-300">采高 (m)</span>
            <span className="text-cyan-400 font-mono">{miningHeight}</span>
          </div>
          <input
            type="range"
            min="1"
            max="10"
            step="0.1"
            value={miningHeight}
            onChange={(e) => setMiningHeight(parseFloat(e.target.value))}
            className="w-full accent-cyan-500"
          />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-300">评价点步长 (m)</span>
            <span className="text-cyan-400 font-mono">{stepSize}</span>
          </div>
          <input
            type="range"
            min="10"
            max="100"
            step="5"
            value={stepSize}
            onChange={(e) => setStepSize(parseInt(e.target.value))}
            className="w-full accent-cyan-500"
          />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-300">垮落角 (°)</span>
            <span className="text-cyan-400 font-mono">{collapseAngle}</span>
          </div>
          <input
            type="range"
            min="45"
            max="90"
            step="1"
            value={collapseAngle}
            onChange={(e) => setCollapseAngle(parseInt(e.target.value))}
            className="w-full accent-cyan-500"
          />
        </div>
      </div>

      {/* 响应权重 */}
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-400 uppercase tracking-wider">响应权重</div>
          <button
            onClick={() => {
              const scenarioWeights = {
                surface_subsidence: { wd: 0.45, wo: 0.30, wf: 0.25 },
                aquifer_disturbance: { wd: 0.60, wo: 0.25, wf: 0.15 },
                upward_mining: { wd: 0.20, wo: 0.45, wf: 0.35 }
              };
              setCustomWeights(scenarioWeights[activeScenario]);
            }}
            className="text-[10px] text-cyan-400 hover:text-cyan-300"
          >
            重置默认
          </button>
        </div>

        {[
          { key: 'wd', label: '位移响应', color: 'blue' },
          { key: 'wo', label: '力学响应', color: 'amber' },
          { key: 'wf', label: '水力响应', color: 'emerald' }
        ].map(item => (
          <div key={item.key} className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className={`text-${item.color}-400`}>{item.label}</span>
              <span className={`text-${item.color}-400 font-mono`}>
                {(customWeights[item.key] * 100).toFixed(0)}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={customWeights[item.key] * 100}
              onChange={(e) => {
                const newVal = parseInt(e.target.value) / 100;
                const others = Object.keys(customWeights).filter(k => k !== item.key);
                const remaining = 1 - newVal;
                const otherSum = others.reduce((s, k) => s + customWeights[k], 0);
                const ratio = otherSum > 0 ? remaining / otherSum : 0.5;
                setCustomWeights({
                  ...customWeights,
                  [item.key]: newVal,
                  [others[0]]: customWeights[others[0]] * ratio,
                  [others[1]]: customWeights[others[1]] * ratio
                });
              }}
              className={`w-full accent-${item.color}-500`}
            />
          </div>
        ))}

        <div className="text-[10px] text-gray-500 flex items-center gap-1">
          <Info size={10} /> 三项权重之和自动归一化为 100%
        </div>
      </div>
    </div>
  );

  // 渲染统计信息
  const renderStatistics = () => {
    if (!statistics) return null;

    return (
      <div className="space-y-4">
        <h3 className="text-sm font-bold text-amber-400 flex items-center gap-2">
          <BarChart3 size={14} /> 统计信息
        </h3>

        <div className="grid grid-cols-3 gap-3">
          <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700 text-center">
            <div className="text-2xl font-bold text-cyan-400">{statistics.min_odi?.toFixed(3)}</div>
            <div className="text-[10px] text-gray-400">最小ODI</div>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700 text-center">
            <div className="text-2xl font-bold text-amber-400">{statistics.mean_odi?.toFixed(3)}</div>
            <div className="text-[10px] text-gray-400">平均ODI</div>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700 text-center">
            <div className="text-2xl font-bold text-red-400">{statistics.max_odi?.toFixed(3)}</div>
            <div className="text-[10px] text-gray-400">最大ODI</div>
          </div>
        </div>

        {/* 等级分布 */}
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
          <div className="text-xs text-gray-400 mb-3">等级分布</div>
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map(level => {
              const count = statistics.level_distribution?.[`level_${level}`] || 0;
              const total = results?.length || 1;
              const percentage = (count / total * 100).toFixed(1);
              const info = LEVEL_COLORS[level];

              return (
                <div key={level} className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded ${info.bg}`}></div>
                  <div className="text-xs text-gray-300 flex-1">{info.label}</div>
                  <div className="text-xs text-gray-400">{count} ({percentage}%)</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // 渲染日志面板
  const renderLogs = () => (
    <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-800 h-32 overflow-y-auto">
      {logs.length === 0 ? (
        <div className="text-xs text-gray-500 text-center py-4">暂无日志</div>
      ) : (
        logs.map((log, i) => {
          const [msg, type] = log.split('|');
          const colors = {
            info: 'text-gray-400',
            success: 'text-green-400',
            warning: 'text-yellow-400',
            error: 'text-red-400',
            loading: 'text-cyan-400'
          };
          return (
            <div key={i} className={`text-[10px] font-mono ${colors[type] || 'text-gray-400'}`}>
              {msg}
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100">
      {/* 顶部导航 */}
      <header className="h-14 bg-gray-900/80 backdrop-blur border-b border-gray-800 flex items-center px-6">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors mr-4"
        >
          <ArrowLeft size={18} />
          <span className="text-sm">返回主页</span>
        </button>

        <div className="flex items-center gap-3">
          <Activity className="text-cyan-400" size={24} />
          <h1 className="text-lg font-bold tracking-wide">覆岩扰动评价系统</h1>
        </div>

        <div className="ml-auto flex items-center gap-4">
          {results && (
            <>
              <button
                onClick={handleCalibrate}
                disabled={measuredData.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600/20 text-purple-400 rounded-lg hover:bg-purple-600/30 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                <Sliders size={14} /> 实测校准
              </button>
              <button
                onClick={async () => {
                  const data = await api.exportDisturbanceResults();
                  // 简单的CSV导出
                  const csv = [
                    Object.keys(data.data[0]).join(','),
                    ...data.data.map(row => Object.values(row).join(','))
                  ].join('\n');
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `ODI_results_${Date.now()}.csv`;
                  a.click();
                }}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600/20 text-emerald-400 rounded-lg hover:bg-emerald-600/30 text-sm"
              >
                <Download size={14} /> 导出结果
              </button>
            </>
          )}
        </div>
      </header>

      {/* 主内容区 */}
      <main className="flex flex-1 overflow-hidden">
        {/* 左侧配置面板 */}
        <aside className="w-80 bg-gray-900/50 border-r border-gray-800 p-4 overflow-y-auto space-y-6">
          {/* 场景选择 */}
          <div>
            <h3 className="text-sm font-bold text-gray-300 mb-3 flex items-center gap-2">
              <Target size={14} /> 评价场景
            </h3>
            {renderScenarioSelector()}
          </div>

          {/* 数据导入 */}
          {renderDataImport()}

          {/* 参数配置 */}
          {renderParamsConfig()}

          {/* 计算按钮 */}
          <button
            onClick={handleCalculate}
            disabled={isLoading || boreholeCoords.length === 0 || workfaceCoords.length === 0}
            className={`w-full py-4 rounded-xl flex items-center justify-center gap-2 font-bold text-sm transition-all ${
              boreholeCoords.length > 0 && workfaceCoords.length > 0
                ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:from-cyan-500 hover:to-blue-500 shadow-lg shadow-cyan-500/25'
                : 'bg-gray-800 text-gray-500 cursor-not-allowed'
            }`}
          >
            {isLoading ? (
              <>
                <RefreshCw className="animate-spin" size={16} /> 计算中...
              </>
            ) : (
              <>
                <Play size={16} /> 开始计算 ODI
              </>
            )}
          </button>
        </aside>

        {/* 中间可视化区域 */}
        <div className="flex-1 flex flex-col p-4">
          <div className="flex-1 bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden relative">
            <canvas
              ref={canvasRef}
              className="w-full h-full"
              onWheel={(e) => {
                e.preventDefault();
                const delta = e.deltaY > 0 ? 0.9 : 1.1;
                setScale(prev => Math.max(0.5, Math.min(3, prev * delta)));
              }}
            />

            {!results && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center text-gray-500">
                  <Eye size={48} className="mx-auto mb-4 opacity-50" />
                  <div className="text-lg">等待数据导入与计算</div>
                  <div className="text-sm mt-2">请在左侧面板配置参数后开始计算</div>
                </div>
              </div>
            )}

            {/* 工具栏 */}
            <div className="absolute top-4 right-4 flex gap-2">
              <button
                onClick={() => setScale(s => Math.min(3, s * 1.2))}
                className="p-2 bg-gray-800/80 rounded-lg hover:bg-gray-700 text-gray-300"
                title="放大"
              >
                +
              </button>
              <button
                onClick={() => setScale(s => Math.max(0.5, s / 1.2))}
                className="p-2 bg-gray-800/80 rounded-lg hover:bg-gray-700 text-gray-300"
                title="缩小"
              >
                -
              </button>
              <button
                onClick={() => { setScale(1); setPanOffset({ x: 0, y: 0 }); }}
                className="p-2 bg-gray-800/80 rounded-lg hover:bg-gray-700 text-gray-300"
                title="重置视图"
              >
                <RefreshCw size={14} />
              </button>
            </div>

            {/* 图层控制 */}
            {results && (
              <div className="absolute top-4 left-4 bg-gray-900/90 backdrop-blur rounded-lg p-3 space-y-2 border border-gray-700">
                <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">图层控制</div>
                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showContourFill}
                    onChange={(e) => setShowContourFill(e.target.checked)}
                    className="rounded accent-cyan-500"
                  />
                  等值线填充
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showContourLines}
                    onChange={(e) => setShowContourLines(e.target.checked)}
                    className="rounded accent-cyan-500"
                  />
                  等值线
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showPoints}
                    onChange={(e) => setShowPoints(e.target.checked)}
                    className="rounded accent-cyan-500"
                  />
                  评价点
                </label>
                <div className="pt-2 border-t border-gray-700">
                  <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                    <span>等值线字段</span>
                    <span>{CONTOUR_FIELDS[contourField] || contourField}</span>
                  </div>
                  <select
                    value={contourField}
                    onChange={(e) => setContourField(e.target.value)}
                    className="w-full bg-gray-800 text-xs text-gray-200 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:border-cyan-500"
                  >
                    {Object.entries(CONTOUR_FIELDS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
                <div className="pt-2 border-t border-gray-700">
                  <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                    <span>等值线数量</span>
                    <span>{contourLevels}</span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="20"
                    value={contourLevels}
                    onChange={(e) => setContourLevels(parseInt(e.target.value))}
                    className="w-full accent-cyan-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* 日志区域 */}
          <div className="mt-4">
            {renderLogs()}
          </div>
        </div>

        {/* 右侧统计面板 */}
        <aside className="w-72 bg-gray-900/50 border-l border-gray-800 p-4 overflow-y-auto">
          {results ? (
            renderStatistics()
          ) : (
            <div className="text-center text-gray-500 py-8">
              <BarChart3 size={32} className="mx-auto mb-2 opacity-50" />
              <div className="text-sm">计算完成后显示统计</div>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
};

export default DisturbanceEvaluation;
