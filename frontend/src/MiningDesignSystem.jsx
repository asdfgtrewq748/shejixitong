import React, { useState, useEffect, useRef } from 'react';
import {
  Layers, Upload, Database, Activity, ShieldCheck, DollarSign, Leaf, Cpu,
  Map as MapIcon, Settings, ChevronRight, Play, Save, FileText,
  Zap, Search, AlertCircle, CheckCircle, Crosshair, BarChart3, Wind, Droplets, Hammer,
  Maximize2, Minimize2, Grid, FolderOpen
} from 'lucide-react';
import * as api from './api';
import FileUploader from './FileUploader';

const GlobalStyles = () => (
  <style>{`
    @keyframes scanline {
      0% { transform: translateY(-100%); }
      100% { transform: translateY(100%); }
    }
    @keyframes grid-move {
      0% { background-position: 0 0; }
      100% { background-position: 50px 50px; }
    }
    .bg-cyber-grid {
      background-image: linear-gradient(rgba(30, 58, 138, 0.1) 1px, transparent 1px),
      linear-gradient(90deg, rgba(30, 58, 138, 0.1) 1px, transparent 1px);
      background-size: 30px 30px;
    }
    .glass-panel {
      background: rgba(17, 24, 39, 0.7);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: 0 4px 30px rgba(0, 0, 0, 0.3);
    }
    .neon-border {
      box-shadow: 0 0 5px rgba(59, 130, 246, 0.5), inset 0 0 10px rgba(59, 130, 246, 0.1);
    }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: #0f172a; }
    ::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #475569; }
  `}</style>
);

const MINING_BOUNDARY = [
  { x: 100, y: 100 }, { x: 700, y: 80 }, { x: 750, y: 500 },
  { x: 600, y: 550 }, { x: 200, y: 520 }, { x: 100, y: 100 },
]

const generateBoreholes = (count) => {
  return Array.from({ length: count }, (_, i) => ({
    id: `ZK-${100 + i}`,
    x: 150 + Math.random() * 500,
    y: 120 + Math.random() * 350,
    rockHardness: 4 + Math.random() * 6,
    gasContent: Math.random() * 10,
    coalThickness: 2 + Math.random() * 5,
    groundWater: Math.random() * 100,
    scores: { safety: 0, economic: 0, env: 0 }
  }));
};

const calculateScores = (boreholes) => {
  return boreholes.map(hole => {
    const safetyScore = Math.max(0, 100 - (hole.gasContent * 8) - (Math.abs(hole.rockHardness - 7) * 5));
    const economicScore = Math.min(100, hole.coalThickness * 15 + 20);
    const envScore = Math.max(0, 100 - (hole.groundWater * 0.8));
    return {
      ...hole,
      scores: {
        safety: Math.round(safetyScore),
        economic: Math.round(economicScore),
        env: Math.round(envScore)
      }
    };
  });
};

const MiningDesignSystem = () => {
  const canvasRef = useRef(null);
  const [activeTab, setActiveTab] = useState('import');
  const [isLoading, setIsLoading] = useState(false);
  const [systemLog, setSystemLog] = useState([]);
  const [boundary, setBoundary] = useState([]);
  const [boreholes, setBoreholes] = useState([]);
  const [weights, setWeights] = useState({ safety: 40, economic: 30, env: 30 });
  const requestRef = useRef();
  const frameRef = useRef(0);

  // 热力图/等值线/设计数据状态
  const [scoreData, setScoreData] = useState(null); // { grids, contours, bounds }
  const [designData, setDesignData] = useState(null); // { roadways, workingFaces, zones }
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showContours, setShowContours] = useState(true);
  const [showDesign, setShowDesign] = useState(true);
  const [displayDimension, setDisplayDimension] = useState('composite'); // safety | economic | env | composite

  // 画布交互状态
  const [scale, setScale] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const lastPanPos = useRef({ x: 0, y: 0 });

  // UI 面板状态
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBorehole, setSelectedBorehole] = useState(null);
  const [importMode, setImportMode] = useState('file'); // 'file' | 'demo'

  const addLog = (msg, type = 'info') => {
    const time = new Date().toLocaleTimeString();
    setSystemLog(prev => [`[${time}] ${msg}|${type}`, ...prev].slice(0, 50));
  };

  // 画布鼠标事件处理
  const handleCanvasMouseMove = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX / scale - panOffset.x);
    const y = Math.round((e.clientY - rect.top) * scaleY / scale - panOffset.y);
    setMousePos({ x, y });

    // 拖拽平移
    if (isPanning) {
      const dx = (e.clientX - lastPanPos.current.x) / scale;
      const dy = (e.clientY - lastPanPos.current.y) / scale;
      setPanOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      lastPanPos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleCanvasMouseDown = (e) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // 中键或 Alt+左键 开始平移
      setIsPanning(true);
      lastPanPos.current = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    }
  };

  const handleCanvasMouseUp = () => {
    setIsPanning(false);
  };

  const handleCanvasWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale(prev => Math.max(0.25, Math.min(4, prev * delta)));
  };

  // 缩放控制
  const handleZoomIn = () => setScale(prev => Math.min(4, prev * 1.25));
  const handleZoomOut = () => setScale(prev => Math.max(0.25, prev * 0.8));
  const handleResetView = () => {
    setScale(1);
    setPanOffset({ x: 0, y: 0 });
  };

  // 导出报告
  const handleExportReport = () => {
    const reportData = {
      generatedAt: new Date().toISOString(),
      boundary: boundary,
      boreholes: boreholes.map(b => ({
        id: b.id,
        x: b.x,
        y: b.y,
        scores: b.scores
      })),
      weights: weights,
      activeTab: activeTab
    };
    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `geomind-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addLog('报告已导出', 'success');
  };

  // 搜索钻孔
  const filteredBoreholes = boreholes.filter(b =>
    b.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // CSV 文件上传完成回调
  const handleFileUploadComplete = async (data) => {
    if (data.boundary && data.boundary.length > 0) {
      setBoundary(data.boundary);
      addLog(`采区边界已导入 [顶点: ${data.boundary.length}]`, 'success');
    }
    if (data.boreholes && data.boreholes.length > 0) {
      // 重新计算评分
      try {
        const result = await api.calculateScore(weights);
        setBoreholes(result.boreholes || data.boreholes);
        addLog(`钻孔数据已导入并评分 [数量: ${result.boreholes?.length || data.boreholes.length}]`, 'success');
        setActiveTab('analysis');
      } catch (err) {
        setBoreholes(data.boreholes);
        addLog(`钻孔数据已导入 [数量: ${data.boreholes.length}]`, 'success');
      }
    }
  };

  const handleImportBoundary = async () => {
    setIsLoading(true);
    addLog('正在解析 DXF 矢量数据...', 'loading');
    try {
      // 实际项目中可替换为文件解析，这里用模拟边界演示
      await api.uploadBoundary(MINING_BOUNDARY);
      setBoundary(MINING_BOUNDARY);
      addLog(`采区边界模型构建完成 [顶点: ${MINING_BOUNDARY.length}]`, 'success');
    } catch (err) {
      addLog('边界上传失败: ' + err.message, 'warning');
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportBoreholes = async () => {
    if (boundary.length === 0) return;
    setIsLoading(true);
    addLog('正在连接地质数据库 GeoDB_v4...', 'loading');
    try {
      // 生成模拟钻孔并上传到后端
      const rawData = generateBoreholes(30);
      await api.uploadBoreholes(rawData);
      addLog(`检索到 ${rawData.length} 个钻孔样本`, 'info');
      addLog('正在执行多维评分算法...', 'loading');
      // 调用后端计算评分
      const result = await api.calculateScore(weights);
      setBoreholes(result.boreholes || []);
      addLog('地质数据评分矩阵计算完毕', 'success');
      setActiveTab('analysis');
    } catch (err) {
      addLog('钻孔数据处理失败: ' + err.message, 'warning');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateDesign = async () => {
    setIsLoading(true);
    addLog('启动深度学习推理引擎 (ResNet-Geology)...', 'warning');
    try {
      // 1. 获取高分辨率评分网格数据
      addLog('生成全区地质评分网格 (50x50分辨率)...', 'info');
      const scoreResult = await api.calculateScore(weights, 50);
      setScoreData({
        grids: scoreResult.grids,
        contours: scoreResult.contours,
        stats: scoreResult.stats
      });
      setBoreholes(scoreResult.boreholes || []);
      addLog(`评分网格生成完成 (${Object.keys(scoreResult.grids || {}).length}个维度)`, 'success');

      // 2. 调用后端生成设计方案
      addLog('运行遗传算法优化巷道路径...', 'info');
      const design = await api.generateDesign(displayDimension);
      setDesignData(design);
      
      const faceCount = design.workfaces?.length || 0;
      const roadwayLen = design.mainRoadway?.length || 0;
      const designScore = design.designScore?.overall || 0;
      addLog(`最优采掘工程设计方案已生成`, 'success');
      addLog(`  - 工作面: ${faceCount}个`, 'info');
      addLog(`  - 主巷道长度: ${roadwayLen}m`, 'info');
      addLog(`  - 分巷道数量: ${design.branchRoadways?.length || 0}条`, 'info');
      addLog(`  - 整体评分: ${designScore}分`, 'info');
      
      setActiveTab('synthesis');
    } catch (err) {
      addLog('设计生成失败: ' + err.message, 'warning');
    } finally {
      setIsLoading(false);
    }
  };

  // 颜色映射函数 - 将分数转换为热力图颜色
  const scoreToColor = (score, alpha = 0.6) => {
    // 红(低) -> 黄(中) -> 绿(高)
    if (score < 50) {
      // 红到黄
      const t = score / 50;
      const r = 239;
      const g = Math.round(68 + (190 * t));
      const b = 68;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    } else {
      // 黄到绿
      const t = (score - 50) / 50;
      const r = Math.round(239 - (223 * t));
      const g = Math.round(190 + (65 * t));
      const b = Math.round(68 + (61 * t));
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  };

  const animate = () => {
    if (!canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const width = canvas.width
    const height = canvas.height

    frameRef.current += 1
    const time = frameRef.current

    ctx.clearRect(0, 0, width, height)

    // 应用缩放和平移变换
    ctx.save()
    ctx.scale(scale, scale)
    ctx.translate(panOffset.x, panOffset.y)

    // 网格绘制（可开关）
    if (showGrid) {
      ctx.strokeStyle = 'rgba(30, 58, 138, 0.15)'
      ctx.lineWidth = 1 / scale
      const gridSize = 40
      const offset = (time * 0.5) % gridSize

      const startX = Math.floor(-panOffset.x / gridSize) * gridSize
      const startY = Math.floor(-panOffset.y / gridSize) * gridSize
      const endX = startX + width / scale + gridSize * 2
      const endY = startY + height / scale + gridSize * 2

      for (let x = startX; x <= endX; x += gridSize) {
        ctx.beginPath()
        ctx.moveTo(x, startY)
        ctx.lineTo(x, endY)
        ctx.stroke()
      }
      for (let y = startY; y <= endY; y += gridSize) {
        const drawY = y + offset
        ctx.beginPath()
        ctx.moveTo(startX, drawY)
        ctx.lineTo(endX, drawY)
        ctx.stroke()
      }
    }

    if (boundary.length === 0) {
      ctx.restore()
      requestRef.current = requestAnimationFrame(animate)
      return
    }

    // 创建边界裁剪区域
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(boundary[0].x, boundary[0].y)
    boundary.forEach(p => ctx.lineTo(p.x, p.y))
    ctx.closePath()
    ctx.clip()

    // ====== 热力图渲染 ======
    if (showHeatmap && scoreData && scoreData.grids) {
      const gridData = scoreData.grids[displayDimension]
      
      if (gridData && gridData.data && gridData.data.length > 0) {
        const { data, minX, minY, stepX, stepY, resolution } = gridData
        
        ctx.globalAlpha = 0.7
        for (let i = 0; i < data.length; i++) {
          for (let j = 0; j < data[i].length; j++) {
            const score = data[i][j]
            if (score === null) continue
            
            const x = minX + j * stepX
            const y = minY + i * stepY
            
            ctx.fillStyle = scoreToColor(score, 0.6)
            ctx.fillRect(x, y, stepX + 1, stepY + 1)
          }
        }
        ctx.globalAlpha = 1.0
      }
    }

    // ====== 等值线渲染 ======
    if (showContours && scoreData && scoreData.contours) {
      const contourData = scoreData.contours[displayDimension]
      
      if (contourData && typeof contourData === 'object') {
        const levelColors = {
          30: '#ef4444',  // 红色 - 低分
          40: '#f97316',  // 橙红
          50: '#f59e0b',  // 橙色 - 中低
          60: '#eab308',  // 黄色
          70: '#84cc16',  // 黄绿 - 中高
          80: '#22c55e',  // 绿色
          90: '#10b981'   // 青绿 - 高分
        }
        
        // contourData 是 { 30: [...segments], 50: [...], ... }
        Object.entries(contourData).forEach(([level, segments]) => {
          if (!segments || segments.length === 0) return
          
          ctx.strokeStyle = levelColors[level] || '#fff'
          ctx.lineWidth = 2 / scale
          ctx.shadowBlur = 4
          ctx.shadowColor = levelColors[level] || '#fff'
          
          segments.forEach(seg => {
            if (Array.isArray(seg) && seg.length === 2) {
              // 格式: [[{x,y}, {x,y}], ...]
              ctx.beginPath()
              ctx.moveTo(seg[0].x, seg[0].y)
              ctx.lineTo(seg[1].x, seg[1].y)
              ctx.stroke()
            }
          })
        })
        ctx.shadowBlur = 0
      }
    }

    // ====== 钻孔径向渐变 (如果没有热力图数据时显示) ======
    if (!scoreData && boreholes.length > 0) {
      const totalWeight = weights.safety + weights.economic + weights.env

      boreholes.forEach((hole, idx) => {
        const weightedScore = (
          hole.scores.safety * weights.safety +
          hole.scores.economic * weights.economic +
          hole.scores.env * weights.env
        ) / (totalWeight || 1)

        const pulseScale = 1 + Math.sin(time * 0.05 + idx) * 0.05
        const radius = 120 * pulseScale

        const grad = ctx.createRadialGradient(hole.x, hole.y, 0, hole.x, hole.y, radius)
        const colorMain = weightedScore > 80 ? '16, 185, 129' : weightedScore > 50 ? '245, 158, 11' : '239, 68, 68'
        grad.addColorStop(0, `rgba(${colorMain}, 0.5)`)
        grad.addColorStop(1, 'rgba(0,0,0,0)')

        ctx.globalCompositeOperation = 'screen'
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(hole.x, hole.y, radius, 0, Math.PI * 2)
        ctx.fill()
      })
      ctx.globalCompositeOperation = 'source-over'
    }

    // ====== 智能设计渲染 (巷道和工作面) ======
    if (showDesign && designData && activeTab === 'synthesis') {
      ctx.globalCompositeOperation = 'source-over'
      
      // 绘制主巷道
      if (designData.mainRoadway && designData.mainRoadway.path && designData.mainRoadway.path.length > 1) {
        const mainRoad = designData.mainRoadway.path
        
        // 巷道背景（宽度）
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.3)'
        ctx.lineWidth = 12
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ctx.moveTo(mainRoad[0].x, mainRoad[0].y)
        mainRoad.forEach(p => ctx.lineTo(p.x, p.y))
        ctx.stroke()
        
        // 巷道中线 - 动态流动效果
        ctx.strokeStyle = '#00ffff'
        ctx.lineWidth = 3
        ctx.setLineDash([20, 15])
        ctx.lineDashOffset = -time * 2
        ctx.shadowBlur = 10
        ctx.shadowColor = '#00ffff'
        ctx.beginPath()
        ctx.moveTo(mainRoad[0].x, mainRoad[0].y)
        mainRoad.forEach(p => ctx.lineTo(p.x, p.y))
        ctx.stroke()
        ctx.setLineDash([])
        ctx.shadowBlur = 0
        
        // 主巷道标签
        const midIdx = Math.floor(mainRoad.length / 2)
        ctx.fillStyle = '#00ffff'
        ctx.font = `bold ${Math.max(10, 12 / scale)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.fillText('主巷道', mainRoad[midIdx].x, mainRoad[midIdx].y - 15)
      }
      
      // 绘制分巷道
      if (designData.branchRoadways && designData.branchRoadways.length > 0) {
        designData.branchRoadways.forEach(branch => {
          if (branch.path && branch.path.length > 1) {
            // 分巷背景
            ctx.strokeStyle = 'rgba(168, 85, 247, 0.3)'
            ctx.lineWidth = 8
            ctx.lineCap = 'round'
            ctx.beginPath()
            ctx.moveTo(branch.path[0].x, branch.path[0].y)
            branch.path.forEach(p => ctx.lineTo(p.x, p.y))
            ctx.stroke()
            
            // 分巷中线
            ctx.strokeStyle = '#a855f7'
            ctx.lineWidth = 2
            ctx.setLineDash([10, 8])
            ctx.lineDashOffset = -time * 1.5
            ctx.beginPath()
            ctx.moveTo(branch.path[0].x, branch.path[0].y)
            branch.path.forEach(p => ctx.lineTo(p.x, p.y))
            ctx.stroke()
            ctx.setLineDash([])
          }
        })
      }
      
      // 绘制工作面
      if (designData.workfaces && designData.workfaces.length > 0) {
        designData.workfaces.forEach((face, idx) => {
          const { x, y, width: w, length: h, avgScore } = face
          const score = avgScore || 0
          
          // 工作面背景
          ctx.fillStyle = scoreToColor(score, 0.3)
          ctx.fillRect(x, y, w, h)
          
          // 工作面边框 - 发光效果
          ctx.shadowBlur = 8
          ctx.shadowColor = score > 70 ? '#10b981' : '#f59e0b'
          ctx.strokeStyle = score > 70 ? '#10b981' : '#f59e0b'
          ctx.lineWidth = 2
          ctx.strokeRect(x, y, w, h)
          ctx.shadowBlur = 0
          
          // 扫描线动画
          const scanProgress = (time + idx * 20) % 100
          const scanY = y + (h * scanProgress / 100)
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(x, scanY)
          ctx.lineTo(x + w, scanY)
          ctx.stroke()
          
          // 工作面标签
          ctx.fillStyle = '#fff'
          ctx.font = `bold ${Math.max(10, 12 / scale)}px "Courier New"`
          ctx.textAlign = 'center'
          ctx.fillText(face.id || `WF_${String(idx + 1).padStart(2, '0')}`, x + w / 2, y + h / 2 - 5)
          ctx.font = `${Math.max(8, 10 / scale)}px "Courier New"`
          ctx.fillText(`${score.toFixed(0)}分`, x + w / 2, y + h / 2 + 10)
        })
      }
    }

    ctx.restore() // 恢复裁剪

    // ====== 边界轮廓 ======
    ctx.shadowBlur = 10
    ctx.shadowColor = '#0ea5e9'
    ctx.strokeStyle = '#0ea5e9'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(boundary[0].x, boundary[0].y)
    boundary.forEach(p => ctx.lineTo(p.x, p.y))
    ctx.closePath()
    ctx.stroke()
    ctx.shadowBlur = 0

    // ====== 钻孔点标记 ======
    if (boreholes.length > 0) {
      boreholes.forEach((hole, idx) => {
        const isActive = activeTab === 'analysis' || activeTab === 'synthesis'
        const isSelected = selectedBorehole && selectedBorehole.id === hole.id
        
        // 钻孔点
        ctx.fillStyle = isSelected ? '#fbbf24' : (isActive ? '#fff' : 'rgba(255,255,255,0.5)')
        ctx.beginPath()
        const r = isSelected ? 5 : (isActive ? 3 + Math.sin(time * 0.1 + idx) * 0.5 : 2)
        ctx.arc(hole.x, hole.y, r, 0, Math.PI * 2)
        ctx.fill()
        
        // 选中高亮
        if (isSelected) {
          ctx.strokeStyle = '#fbbf24'
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(hole.x, hole.y, 10, 0, Math.PI * 2)
          ctx.stroke()
        }
      })
    }

    // ====== 扫描线动画 ======
    if (isLoading || activeTab === 'analysis') {
      const scanX = (time * 4) % (width / scale)
      const gradient = ctx.createLinearGradient(scanX, 0, scanX - 100, 0)
      gradient.addColorStop(0, 'rgba(14, 165, 233, 0.3)')
      gradient.addColorStop(1, 'rgba(14, 165, 233, 0)')
      ctx.fillStyle = gradient
      ctx.fillRect(scanX - 100, -panOffset.y, 100, height / scale)
      ctx.strokeStyle = 'rgba(14, 165, 233, 0.8)'
      ctx.beginPath()
      ctx.moveTo(scanX, -panOffset.y)
      ctx.lineTo(scanX, -panOffset.y + height / scale)
      ctx.stroke()
    }

    ctx.restore() // 恢复变换

    // ====== 图例绘制 (不受变换影响) ======
    if (scoreData && (showHeatmap || showContours)) {
      const legendX = 20
      const legendY = height - 180
      const legendWidth = 20
      const legendHeight = 150
      
      // 图例背景
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
      ctx.fillRect(legendX - 10, legendY - 30, 100, legendHeight + 60)
      
      // 图例标题
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 12px sans-serif'
      ctx.fillText('评分图例', legendX, legendY - 10)
      
      // 颜色条
      for (let i = 0; i < legendHeight; i++) {
        const score = 100 - (i / legendHeight * 100)
        ctx.fillStyle = scoreToColor(score, 1)
        ctx.fillRect(legendX, legendY + i, legendWidth, 1)
      }
      
      // 刻度标签
      ctx.fillStyle = '#fff'
      ctx.font = '10px sans-serif'
      ctx.fillText('100', legendX + legendWidth + 5, legendY + 5)
      ctx.fillText('75', legendX + legendWidth + 5, legendY + legendHeight * 0.25 + 3)
      ctx.fillText('50', legendX + legendWidth + 5, legendY + legendHeight * 0.5 + 3)
      ctx.fillText('25', legendX + legendWidth + 5, legendY + legendHeight * 0.75 + 3)
      ctx.fillText('0', legendX + legendWidth + 5, legendY + legendHeight)
      
      // 维度标签
      const dimLabels = { safety: '安全性', economic: '经济性', env: '环保性', composite: '综合' }
      ctx.fillStyle = '#a5b4fc'
      ctx.font = 'bold 11px sans-serif'
      ctx.fillText(dimLabels[displayDimension] || '综合', legendX, legendY + legendHeight + 20)
    }

    requestRef.current = requestAnimationFrame(animate)
  }

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(requestRef.current)
  }, [boundary, boreholes, weights, activeTab, isLoading, scale, showGrid, panOffset, scoreData, designData, showHeatmap, showContours, showDesign, displayDimension, selectedBorehole])
  return (
  <div className="flex flex-col h-screen bg-gray-950 text-gray-100 font-sans overflow-hidden bg-cyber-grid selection:bg-blue-500/30">
    <GlobalStyles />
      
    <header className="glass-panel z-50 flex items-center justify-between px-6 py-3 mx-4 mt-4 rounded-xl">
    <div className="flex items-center gap-4">
      <div className="relative group">
      <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg blur opacity-40 group-hover:opacity-100 transition duration-1000 group-hover:duration-200"></div>
      <div className="relative p-2 bg-gray-900 rounded-lg border border-gray-700">
        <Cpu className="w-6 h-6 text-blue-400 animate-pulse" />
      </div>
      </div>
      <div>
      <h1 className="text-2xl font-black tracking-widest text-white uppercase" style={{ textShadow: '0 0 10px rgba(59, 130, 246, 0.5)' }}>
        GeoMind <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">NEXUS</span>
      </h1>
      <div className="flex items-center gap-2 text-[10px] text-gray-400 tracking-wider">
        <span className="w-2 h-2 bg-green-500 rounded-full animate-ping"></span>
        SYSTEM ONLINE // V5.0.1
      </div>
      </div>
    </div>
        
    <div className="flex bg-gray-900/50 p-1 rounded-full border border-gray-700 backdrop-blur-sm">
      {['import', 'analysis', 'synthesis'].map((step, idx) => {
        const isActive = activeTab === step;
        const labels = { import: '数据源', analysis: '地质算力', synthesis: '工程决策' };
        const icons = { import: Upload, analysis: Activity, synthesis: MapIcon };
        const Icon = icons[step];
                
        return (
          <button 
            key={step}
            onClick={() => !isLoading && setActiveTab(step)}
            className={`
              relative flex items-center gap-2 px-6 py-2 rounded-full text-xs font-bold transition-all duration-300
              ${isActive ? 'text-white bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.5)]' : 'text-gray-500 hover:text-gray-300'}
            `}
          >
            <Icon size={14} />
            {labels[step]}
          </button>
        );
      })}
    </div>

    <div className="flex gap-3">
      <button 
        onClick={() => setSettingsOpen(!settingsOpen)}
        className={`p-2.5 hover:bg-white/10 rounded-lg transition-colors border hover:border-gray-600 ${settingsOpen ? 'text-blue-400 border-blue-500/50' : 'text-gray-400 border-transparent'}`}
      >
        <Settings size={18} />
      </button>
      <button 
        onClick={handleExportReport}
        className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-lg shadow-emerald-900/20 border border-emerald-400/20 transition-all hover:scale-105"
      >
        <Save size={14} /> Report
      </button>
    </div>
    </header>

    {/* 设置面板 */}
    {settingsOpen && (
      <div className="absolute top-20 right-8 z-50 glass-panel rounded-xl p-5 w-80 shadow-2xl border border-gray-700 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Settings size={16} className="text-blue-400" /> 系统设置
          </h3>
          <button onClick={() => setSettingsOpen(false)} className="text-gray-400 hover:text-white">
            <span className="text-lg">&times;</span>
          </button>
        </div>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs text-gray-400 uppercase tracking-wider">显示选项</label>
            <div className="space-y-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={showGrid}
                  onChange={(e) => setShowGrid(e.target.checked)}
                  className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-300">显示网格</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={showHeatmap}
                  onChange={(e) => setShowHeatmap(e.target.checked)}
                  className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-300">显示热力图</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={showContours}
                  onChange={(e) => setShowContours(e.target.checked)}
                  className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-300">显示等值线</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={showDesign}
                  onChange={(e) => setShowDesign(e.target.checked)}
                  className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-300">显示设计方案</span>
              </label>
            </div>
          </div>
          
          <div className="space-y-2">
            <label className="text-xs text-gray-400 uppercase tracking-wider">分析维度</label>
            <select
              value={displayDimension}
              onChange={(e) => setDisplayDimension(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500"
            >
              <option value="composite">综合评分</option>
              <option value="safety">安全性评分</option>
              <option value="economic">经济性评分</option>
              <option value="env">环保性评分</option>
            </select>
          </div>
          
          <div className="space-y-2">
            <label className="text-xs text-gray-400 uppercase tracking-wider">缩放级别</label>
            <div className="flex items-center gap-3">
              <input 
                type="range" 
                min="25" 
                max="400" 
                value={scale * 100}
                onChange={(e) => setScale(parseInt(e.target.value) / 100)}
                className="flex-1"
              />
              <span className="text-sm text-white font-mono w-12">{(scale * 100).toFixed(0)}%</span>
            </div>
          </div>
          
          <div className="pt-3 border-t border-gray-700 space-y-2">
            <button 
              onClick={handleResetView}
              className="w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors"
            >
              重置视图
            </button>
            <button 
              onClick={() => {
                setBoundary([]);
                setBoreholes([]);
                setScoreData(null);
                setDesignData(null);
                setActiveTab('import');
                setSystemLog([]);
                addLog('系统已重置', 'warning');
                setSettingsOpen(false);
              }}
              className="w-full py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 text-sm rounded-lg transition-colors border border-red-800/50"
            >
              重置所有数据
            </button>
          </div>
        </div>
      </div>
    )}

    <main className="flex flex-1 overflow-hidden p-4 gap-4">
        
    <aside className="w-80 glass-panel rounded-xl flex flex-col overflow-hidden animate-[slideInLeft_0.5s_ease-out]">
      <div className="p-5 space-y-8 overflow-y-auto">
                
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-gray-700/50">
            <h3 className="text-xs uppercase tracking-[0.2em] text-blue-400 font-bold flex items-center gap-2">
              <Database size={12} /> Data Sources
            </h3>
            {/* 导入模式切换 */}
            <div className="flex bg-gray-800/50 rounded-full p-0.5 border border-gray-700">
              <button
                onClick={() => setImportMode('file')}
                className={`px-2 py-1 text-[10px] rounded-full transition-all ${
                  importMode === 'file' 
                    ? 'bg-blue-600 text-white' 
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                文件
              </button>
              <button
                onClick={() => setImportMode('demo')}
                className={`px-2 py-1 text-[10px] rounded-full transition-all ${
                  importMode === 'demo' 
                    ? 'bg-blue-600 text-white' 
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                演示
              </button>
            </div>
          </div>
          
          {/* CSV 文件上传模式 */}
          {importMode === 'file' && (
            <FileUploader 
              onUploadComplete={handleFileUploadComplete}
              onLog={addLog}
            />
          )}
          
          {/* 演示数据模式 */}
          {importMode === 'demo' && (
            <div className="space-y-3">
              <button 
                onClick={handleImportBoundary}
                className={`group w-full relative overflow-hidden p-4 rounded-xl border transition-all duration-300 text-left
                  ${boundary.length > 0 
                    ? 'bg-blue-900/20 border-blue-500/50 text-blue-300' 
                    : 'bg-gray-800/40 border-gray-700 text-gray-400 hover:border-gray-500 hover:bg-gray-800'}
                `}
              >
                 <div className={`absolute inset-0 bg-blue-400/10 translate-y-full transition-transform duration-300 ${boundary.length > 0 ? '' : 'group-hover:translate-y-0'}`}></div>
                 <div className="flex justify-between items-center relative z-10">
                  <div>
                    <span className="block text-sm font-bold">采区边界矢量</span>
                    <span className="text-[10px] opacity-70">模拟 DXF 数据</span>
                  </div>
                  {boundary.length > 0 ? <CheckCircle className="text-blue-400" size={18} /> : <Upload size={18} />}
                 </div>
              </button>
                          
              <button 
                onClick={handleImportBoreholes}
                disabled={boundary.length === 0}
                className={`group w-full relative overflow-hidden p-4 rounded-xl border transition-all duration-300 text-left
                  ${boreholes.length > 0 
                    ? 'bg-amber-900/20 border-amber-500/50 text-amber-300' 
                    : 'bg-gray-800/40 border-gray-700 text-gray-400 hover:border-gray-500 hover:bg-gray-800'}
                  ${boundary.length === 0 ? 'opacity-40 cursor-not-allowed' : ''}
                `}
              >
                 <div className={`absolute inset-0 bg-amber-400/10 translate-y-full transition-transform duration-300 ${boreholes.length > 0 ? '' : 'group-hover:translate-y-0'}`}></div>
                 <div className="flex justify-between items-center relative z-10">
                  <div>
                    <span className="block text-sm font-bold">钻孔地质库</span>
                    <span className="text-[10px] opacity-70">模拟 30 个钻孔</span>
                  </div>
                  {boreholes.length > 0 ? <CheckCircle className="text-amber-400" size={18} /> : <Database size={18} />}
                 </div>
              </button>
            </div>
          )}
          
          {/* 数据状态指示器 */}
          {(boundary.length > 0 || boreholes.length > 0) && (
            <div className="bg-gray-800/30 rounded-lg p-3 space-y-2">
              <div className="text-[10px] text-gray-400 uppercase tracking-wider">已导入数据</div>
              {boundary.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-blue-300">
                  <CheckCircle size={12} /> 边界顶点: {boundary.length} 个
                </div>
              )}
              {boreholes.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-amber-300">
                  <CheckCircle size={12} /> 钻孔数据: {boreholes.length} 条
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <h3 className="text-xs uppercase tracking-[0.2em] text-purple-400 font-bold flex items-center gap-2 pb-2 border-b border-gray-700/50">
            <Settings size={12} /> Parameters
          </h3>

          {[
            { key: 'safety', label: 'Safety Factor', icon: ShieldCheck, color: 'text-blue-400', accent: 'accent-blue-500', bg: 'bg-blue-500' },
            { key: 'economic', label: 'Economic Value', icon: DollarSign, color: 'text-amber-400', accent: 'accent-amber-500', bg: 'bg-amber-500' },
            { key: 'env', label: 'Eco-Friendly', icon: Leaf, color: 'text-emerald-400', accent: 'accent-emerald-500', bg: 'bg-emerald-500' },
          ].map(item => (
            <div key={item.key} className="space-y-3 group">
              <div className="flex justify-between text-sm items-center">
                <span className={`flex items-center gap-2 ${item.color} font-medium`}>
                  <item.icon size={14}/> {item.label}
                </span>
                <span className={`font-mono ${item.color} bg-gray-800 px-2 py-0.5 rounded text-xs`}>
                  {weights[item.key]}%
                </span>
              </div>
              <div className="relative h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className={`absolute top-0 left-0 h-full ${item.bg} transition-all duration-300`} 
                  style={{ width: `${weights[item.key]}%` }}
                ></div>
                <input 
                  type="range" min="0" max="100" 
                  value={weights[item.key]}
                  onChange={(e) => setWeights({...weights, [item.key]: parseInt(e.target.value)})}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-auto">
          <button 
            onClick={handleGenerateDesign}
            disabled={boreholes.length === 0 || isLoading}
            className={`
              relative w-full py-5 rounded-xl flex items-center justify-center gap-3 font-bold text-sm tracking-wider uppercase transition-all overflow-hidden group
              ${boreholes.length > 0 
                ? 'text-white shadow-[0_0_20px_rgba(59,130,246,0.4)] hover:shadow-[0_0_30px_rgba(59,130,246,0.6)]' 
                : 'bg-gray-800/50 text-gray-500 cursor-not-allowed border border-gray-700'}
            `}
          >
            {boreholes.length > 0 && (
              <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-purple-600 transition-transform duration-300 group-hover:scale-105"></div>
            )}
            {boreholes.length > 0 && (
              <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20"></div>
            )}
            <div className="relative z-10 flex items-center gap-2">
              {isLoading ? <Activity className="animate-spin" /> : <Play fill="currentColor" size={16} />}
              {isLoading ? 'PROCESSING...' : 'GENERATE OPTIMAL DESIGN'}
            </div>
          </button>
        </div>
      </div>
    </aside>

    <section className="flex-1 relative flex flex-col rounded-xl overflow-hidden glass-panel border-gray-700/50 shadow-2xl">
      <div className="absolute top-0 left-0 right-0 h-12 bg-gradient-to-b from-gray-900/90 to-transparent z-10 flex items-center justify-between px-4 pointer-events-none">
        <div className="flex gap-4 text-[10px] text-gray-400 font-mono">
          <span className="flex items-center gap-1"><Crosshair size={10} /> COORDS: {mousePos.x}, {mousePos.y}</span>
          <span className="flex items-center gap-1"><Maximize2 size={10} /> SCALE: {(scale * 100).toFixed(0)}%</span>
        </div>
        <div className="flex gap-2">
          <div className="bg-black/40 backdrop-blur rounded px-2 py-1 border border-gray-700/50 flex items-center gap-2 text-[10px] text-gray-300">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.8)]"></span> HIGH SUITABILITY
          </div>
          <div className="bg-black/40 backdrop-blur rounded px-2 py-1 border border-gray-700/50 flex items-center gap-2 text-[10px] text-gray-300">
            <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.8)]"></span> HAZARD ZONE
          </div>
        </div>
      </div>

      <div className="relative flex-1 bg-gray-900 flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 pointer-events-none opacity-20" 
          style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '100px 100px' }}>
        </div>

        <canvas 
          ref={canvasRef}
          width={900}
          height={700}
          className={`w-full h-full object-contain ${isPanning ? 'cursor-grabbing' : 'cursor-crosshair'}`}
          onMouseMove={handleCanvasMouseMove}
          onMouseDown={handleCanvasMouseDown}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          onWheel={handleCanvasWheel}
        />
                
        {isLoading && (
          <div className="absolute inset-0 bg-gray-900/80 backdrop-blur-sm flex flex-col items-center justify-center z-30">
            <div className="relative w-24 h-24 mb-6">
              <div className="absolute inset-0 rounded-full border-t-2 border-b-2 border-blue-500 animate-spin"></div>
              <div className="absolute inset-2 rounded-full border-r-2 border-l-2 border-purple-500 animate-spin reverse duration-700"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <Cpu className="text-blue-400 animate-pulse" size={32} />
              </div>
            </div>
            <h2 className="text-2xl font-black text-white tracking-widest mb-1">COMPUTING</h2>
            <div className="flex items-center gap-1 text-blue-400 font-mono text-sm">
              <span>[</span>
              <span className="w-20 h-2 bg-gray-800 rounded-full overflow-hidden relative">
                <span className="absolute inset-0 bg-blue-500 animate-[scanline_1s_infinite]"></span>
              </span>
              <span>]</span>
            </div>
          </div>
        )}

        {boundary.length === 0 && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center group">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full border-2 border-dashed border-gray-700 flex items-center justify-center group-hover:border-blue-500/50 group-hover:scale-110 transition-all duration-500">
                <Layers size={32} className="text-gray-600 group-hover:text-blue-400 transition-colors" />
              </div>
              <h3 className="text-xl font-bold text-gray-300 tracking-wide">NO DATA LOADED</h3>
              <p className="text-gray-500 text-sm mt-2 font-mono">Initiate sequence via [Data Sources]</p>
            </div>
          </div>
        )}
      </div>
            
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-gray-900/80 backdrop-blur border border-gray-700 rounded-full px-4 py-2 flex gap-4 z-20 shadow-xl">
        <button 
          onClick={() => setShowGrid(!showGrid)} 
          className={`transition-colors ${showGrid ? 'text-blue-400' : 'text-gray-400 hover:text-white'}`}
          title="切换网格"
        >
          <Grid size={18}/>
        </button>
        <button 
          onClick={() => setSearchOpen(!searchOpen)} 
          className={`transition-colors ${searchOpen ? 'text-blue-400' : 'text-gray-400 hover:text-white'}`}
          title="搜索钻孔"
        >
          <Search size={18}/>
        </button>
        <div className="w-px h-6 bg-gray-700"></div>
        <button 
          onClick={handleZoomOut} 
          className="text-gray-400 hover:text-white transition-colors"
          title="缩小"
        >
          <Minimize2 size={18}/>
        </button>
        <button 
          onClick={handleZoomIn} 
          className="text-gray-400 hover:text-white transition-colors"
          title="放大"
        >
          <Maximize2 size={18}/>
        </button>
        <button 
          onClick={handleResetView} 
          className="text-gray-400 hover:text-white transition-colors text-xs font-bold"
          title="重置视图"
        >
          1:1
        </button>
      </div>

      {/* 搜索面板 */}
      {searchOpen && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-gray-900/95 backdrop-blur border border-gray-700 rounded-xl p-4 z-30 shadow-xl w-72">
          <div className="flex items-center gap-2 mb-3">
            <Search size={14} className="text-gray-400" />
            <input
              type="text"
              placeholder="搜索钻孔 ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              autoFocus
            />
          </div>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {filteredBoreholes.length === 0 ? (
              <div className="text-gray-500 text-xs text-center py-2">无匹配钻孔</div>
            ) : (
              filteredBoreholes.map(hole => (
                <button
                  key={hole.id}
                  onClick={() => {
                    setSelectedBorehole(hole);
                    setPanOffset({ x: -hole.x + 450, y: -hole.y + 350 });
                    setSearchOpen(false);
                    addLog(`已定位到钻孔 ${hole.id}`, 'info');
                  }}
                  className="w-full text-left px-3 py-2 rounded hover:bg-gray-800 text-sm flex justify-between items-center"
                >
                  <span className="text-white font-mono">{hole.id}</span>
                  <span className="text-gray-500 text-xs">({Math.round(hole.x)}, {Math.round(hole.y)})</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

    </section>

    <aside className="w-72 glass-panel rounded-xl flex flex-col overflow-hidden animate-[slideInRight_0.5s_ease-out]">
      <div className="p-4 border-b border-gray-700/50 bg-gray-900/30">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
          <FileText size={12}/> System Terminal
        </h3>
      </div>
            
      <div className="flex-1 overflow-y-auto p-4 space-y-1 font-mono text-[10px] scroll-smooth">
        {systemLog.length === 0 && <span className="text-gray-600 animate-pulse">_ Waiting for input...</span>}
        {systemLog.map((log, index) => {
          const [text, type] = log.split('|');
          const colors = { 
            info: 'text-gray-300 border-gray-600', 
            success: 'text-green-400 border-green-600', 
            warning: 'text-amber-400 border-amber-600',
            loading: 'text-blue-300 border-blue-600'
          };
          return (
            <div key={index} className={`border-l-2 pl-2 py-1 mb-1 animate-[fadeIn_0.2s_ease-out] ${colors[type] || colors.info}`}>
              <span className="opacity-50 mr-2">{text.match(/^\[(.*?)\]/)[0]}</span>
              <span>{text.replace(/^\[.*?\]\s/, '')}</span>
            </div>
          );
        })}
      </div>

      {activeTab === 'synthesis' && (
        <div className="border-t border-gray-700/50 bg-gradient-to-t from-blue-900/20 to-transparent p-5">
          <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
            <BarChart3 size={14} className="text-blue-400"/> Projected Metrics
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-800/50 p-3 rounded-lg border border-gray-700 hover:border-blue-500/50 transition-colors group">
              <div className="text-[10px] text-gray-400 uppercase mb-1">Total Score</div>
              <div className="text-2xl font-black text-white group-hover:text-blue-400 transition-colors">94.8</div>
            </div>
            <div className="bg-gray-800/50 p-3 rounded-lg border border-gray-700 hover:border-amber-500/50 transition-colors group">
              <div className="text-[10px] text-gray-400 uppercase mb-1 flex items-center gap-1"><Hammer size={10}/> Output</div>
              <div className="text-xl font-bold text-white group-hover:text-amber-400 transition-colors">240<span className="text-xs ml-0.5 opacity-50">Mt</span></div>
            </div>
            <div className="bg-gray-800/50 p-3 rounded-lg border border-gray-700 hover:border-emerald-500/50 transition-colors group">
              <div className="text-[10px] text-gray-400 uppercase mb-1 flex items-center gap-1"><ShieldCheck size={10}/> Rating</div>
              <div className="text-xl font-bold text-emerald-400">A++</div>
            </div>
            <div className="bg-gray-800/50 p-3 rounded-lg border border-gray-700 hover:border-purple-500/50 transition-colors group">
              <div className="text-[10px] text-gray-400 uppercase mb-1 flex items-center gap-1"><Wind size={10}/> Vent</div>
              <div className="text-xl font-bold text-gray-200 group-hover:text-purple-400">Low</div>
            </div>
          </div>
        </div>
      )}
    </aside>
    </main>
  </div>
  );
};

export default MiningDesignSystem;