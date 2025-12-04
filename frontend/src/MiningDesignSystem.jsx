import React, { useState, useEffect, useRef } from 'react';
import {
  Layers, Upload, Database, Activity, ShieldCheck, DollarSign, Leaf, Cpu,
  Map as MapIcon, Settings, ChevronRight, Play, Save, FileText,
  Zap, Search, AlertCircle, CheckCircle, Crosshair, BarChart3, Wind, Droplets, Hammer,
  Maximize2, Minimize2, Grid, FolderOpen, Box, Terminal
} from 'lucide-react';
import * as api from './api';
import FileUploader from './FileUploader';
import GeoModelPreview from './components/GeoModelPreview';

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
  const [viewInitialized, setViewInitialized] = useState(false);
  
  // 编辑模式状态
  const [isEditing, setIsEditing] = useState(false);
  const [editMode, setEditMode] = useState(null); // 'roadway' | 'workface' | null
  const [tempRoadway, setTempRoadway] = useState(null); // 临时绘制的巷道
  const [tempWorkface, setTempWorkface] = useState(null); // 临时绘制的工作面
  const [userEdits, setUserEdits] = useState({ roadways: [], workfaces: [] }); // 用户自定义元素
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState(null);
  const lastPanPos = useRef({ x: 0, y: 0 });

  // UI 面板状态
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBorehole, setSelectedBorehole] = useState(null);
  const [selectedWorkface, setSelectedWorkface] = useState(null);
  const [importMode, setImportMode] = useState('file'); // 'file' | 'demo'
  const [leftPanelMode, setLeftPanelMode] = useState('import'); // 'import' | 'model' - 左侧面板模式
  const [designParams, setDesignParams] = useState({
    faceWidth: 200,      // 推进长度 (原来叫工作面宽度)
    pillarWidth: 20,     // 区段煤柱宽度
    boundaryMargin: 30,  // 边界煤柱宽度
    faceLengthMin: 150,  // 工作面长度最小值
    faceLengthMax: 300,  // 工作面长度最大值
    layoutDirection: 'strike',  // 布置方向: 'strike'走向 | 'dip'倾向
    dipAngle: 0,         // 煤层倾角
    dipDirection: 0,     // 煤层倾向
  });

  const addLog = (msg, type = 'info') => {
    const time = new Date().toLocaleTimeString();
    setSystemLog(prev => [`[${time}] ${msg}|${type}`, ...prev].slice(0, 50));
  };

  // 自动适配视图 - 当边界数据加载后调整视窗
  useEffect(() => {
    if (boundary.length > 0 && !viewInitialized && canvasRef.current) {
      const canvas = canvasRef.current;
      const canvasWidth = canvas.width || 900;
      const canvasHeight = canvas.height || 700;
      
      // 计算边界的范围
      const xs = boundary.map(p => p.x);
      const ys = boundary.map(p => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const dataWidth = maxX - minX;
      const dataHeight = maxY - minY;
      
      // 计算缩放比例（留出更多边距，避免初始视图过大）
      const scaleX = (canvasWidth * 0.5) / dataWidth;
      const scaleY = (canvasHeight * 0.5) / dataHeight;
      const newScale = Math.min(scaleX, scaleY, 1); // 不超过1倍
      
      // 计算平移偏移使数据居中
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const offsetX = (canvasWidth / 2 / newScale) - centerX;
      const offsetY = (canvasHeight / 2 / newScale) - centerY;
      
      setScale(newScale);
      setPanOffset({ x: offsetX, y: offsetY });
      setViewInitialized(true);
      
      console.log(`视图自动适配: scale=${newScale.toFixed(4)}, offset=(${offsetX.toFixed(0)}, ${offsetY.toFixed(0)})`);
      console.log(`数据范围: X[${minX.toFixed(0)}-${maxX.toFixed(0)}], Y[${minY.toFixed(0)}-${maxY.toFixed(0)}]`);
      addLog(`视图已自动适配至采区范围`, 'success');
    }
  }, [boundary, viewInitialized]);

  // 自动加载内置数据
  useEffect(() => {
    const fetchBuiltInData = async () => {
      try {
        // 延迟一点执行，确保组件已挂载且用户能看到日志
        await new Promise(resolve => setTimeout(resolve, 500));
        
        addLog('正在连接后端服务...', 'loading');
        
        // 并行获取数据
        const [boreholesRes, boundaryRes] = await Promise.all([
          api.getBoreholes().catch(e => {
            console.warn("Fetch boreholes failed", e);
            return { boreholes: [] };
          }),
          api.getBoundary().catch(e => {
            console.warn("Fetch boundary failed", e);
            return { boundary: [] };
          })
        ]);

        let hasData = false;
        
        // 提取数据 - API 返回 { boundary: [...] } 和 { boreholes: [...] }
        const boundaryData = boundaryRes?.boundary || (Array.isArray(boundaryRes) ? boundaryRes : []);
        const boreholesData = boreholesRes?.boreholes || (Array.isArray(boreholesRes) ? boreholesRes : []);

        if (boundaryData.length > 0) {
          setBoundary(boundaryData);
          addLog(`已加载采区边界 [顶点: ${boundaryData.length}]`, 'success');
          hasData = true;
        }

        if (boreholesData.length > 0) {
          addLog(`检测到 ${boreholesData.length} 个钻孔，正在计算评分...`, 'loading');
          try {
            // 调用后端计算评分（包含热力图数据）
            const result = await api.calculateScore(weights, 50);
            setBoreholes(result.boreholes || boreholesData);
            
            // 设置热力图数据
            if (result.grids && result.contours) {
              setScoreData({
                grids: result.grids,
                contours: result.contours,
                stats: result.stats
              });
              addLog(`评分网格生成完成 (${Object.keys(result.grids || {}).length}个维度)`, 'success');
            }
            
            addLog(`钻孔数据加载完毕 [数量: ${result.boreholes?.length || boreholesData.length}]`, 'success');
          } catch (err) {
            console.error("Score calculation failed", err);
            setBoreholes(boreholesData);
            addLog(`钻孔数据已加载 (评分服务暂不可用)`, 'warning');
          }
          hasData = true;
        }

        if (hasData) {
          setActiveTab('analysis');
          // 切换左侧面板到地质模型视图
          setLeftPanelMode('model');
          addLog('系统初始化完成，已自动切换至分析模式', 'success');
        } else {
          addLog('未检测到数据，等待手动导入...', 'info');
        }

      } catch (err) {
        console.error("Auto-fetch failed", err);
        addLog('无法连接到后端服务，请确保后端已启动 (Port 3001)', 'warning');
      }
    };

    fetchBuiltInData();
  }, []); // 仅在组件挂载时执行一次

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
    
    // 编辑模式：更新工作面预览
    if (isEditing && editMode === 'workface' && isDrawing && drawStart) {
      const width = x - drawStart.x;
      const height = y - drawStart.y;
      setTempWorkface({ x: drawStart.x, y: drawStart.y, width, height });
    }
  };

  const handleCanvasClick = (e) => {
    if (isPanning || isEditing) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX / scale - panOffset.x);
    const y = Math.round((e.clientY - rect.top) * scaleY / scale - panOffset.y);
    
    // 检查是否点击了工作面
    if (designData && designData.workfaces && activeTab === 'synthesis') {
      const clickedFace = designData.workfaces.find(face => 
        x >= face.x && x <= face.x + face.width &&
        y >= face.y && y <= face.y + face.length
      );
      
      if (clickedFace) {
        setSelectedWorkface(clickedFace);
        addLog(`选中工作面: ${clickedFace.id}`, 'info');
        return;
      }
    }
    
    setSelectedWorkface(null);
  };

  const handleCanvasMouseDown = (e) => {
    if (!isEditing) {
      // 非编辑模式：平移功能
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        setIsPanning(true);
        lastPanPos.current = { x: e.clientX, y: e.clientY };
        e.preventDefault();
      }
      return;
    }

    // 编辑模式下的绘制
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX / scale - panOffset.x);
    const y = Math.round((e.clientY - rect.top) * scaleY / scale - panOffset.y);

    if (editMode === 'roadway') {
      // 绘制巷道路径：点击添加路径点
      if (!tempRoadway) {
        setTempRoadway({ path: [{ x, y }] });
        addLog('开始绘制巷道，点击添加路径点，双击完成', 'info');
      } else {
        setTempRoadway(prev => ({
          ...prev,
          path: [...prev.path, { x, y }]
        }));
      }
    } else if (editMode === 'workface') {
      // 绘制工作面：拖拽绘制矩形
      setIsDrawing(true);
      setDrawStart({ x, y });
      setTempWorkface({ x, y, width: 0, height: 0 });
    }
  };

  const handleCanvasMouseUp = (e) => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }

    if (isEditing && editMode === 'workface' && isDrawing) {
      // 完成工作面绘制
      setIsDrawing(false);
      if (tempWorkface && (Math.abs(tempWorkface.width) > 20 || Math.abs(tempWorkface.height) > 20)) {
        // 规范化矩形（确保宽高为正）
        const normalized = {
          x: tempWorkface.width < 0 ? tempWorkface.x + tempWorkface.width : tempWorkface.x,
          y: tempWorkface.height < 0 ? tempWorkface.y + tempWorkface.height : tempWorkface.y,
          width: Math.abs(tempWorkface.width),
          height: Math.abs(tempWorkface.height)
        };
        
        const newWorkface = {
          id: `UWF-${userEdits.workfaces.length + 1}`,
          ...normalized,
          locked: true,
          userDefined: true
        };
        
        setUserEdits(prev => ({
          ...prev,
          workfaces: [...prev.workfaces, newWorkface]
        }));
        addLog(`工作面已添加: ${newWorkface.id} (${normalized.width}x${normalized.height}m)`, 'success');
      }
      setTempWorkface(null);
      setDrawStart(null);
    }
  };

  const handleCanvasWheel = (e) => {
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale(prev => Math.max(0.25, Math.min(4, prev * delta)));
  };

  // 缩放控制
  const handleZoomIn = () => setScale(prev => Math.min(4, prev * 1.25));
  const handleZoomOut = () => setScale(prev => Math.max(0.25, prev * 0.8));
  
  const handleResetView = () => {
    if (boundary.length > 0 && canvasRef.current) {
      const canvas = canvasRef.current;
      const canvasWidth = canvas.width || 900;
      const canvasHeight = canvas.height || 700;
      
      // 计算边界的范围
      const xs = boundary.map(p => p.x);
      const ys = boundary.map(p => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const dataWidth = maxX - minX;
      const dataHeight = maxY - minY;
      
      // 计算缩放比例（留出更多边距，避免初始视图过大）
      const scaleX = (canvasWidth * 0.5) / dataWidth;
      const scaleY = (canvasHeight * 0.5) / dataHeight;
      const newScale = Math.min(scaleX, scaleY); // 允许放大以适应屏幕
      
      // 计算平移偏移使数据居中
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const offsetX = (canvasWidth / 2 / newScale) - centerX;
      const offsetY = (canvasHeight / 2 / newScale) - centerY;
      
      setScale(newScale);
      setPanOffset({ x: offsetX, y: offsetY });
      addLog('视图已重置至最佳显示范围', 'info');
    } else {
      setScale(1);
      setPanOffset({ x: 0, y: 0 });
    }
  };

  // 编辑模式控制
  const toggleEditMode = (mode) => {
    if (isEditing && editMode === mode) {
      // 取消编辑模式
      setIsEditing(false);
      setEditMode(null);
      setTempRoadway(null);
      setTempWorkface(null);
      addLog('已退出编辑模式', 'info');
    } else {
      // 进入编辑模式
      setIsEditing(true);
      setEditMode(mode);
      setTempRoadway(null);
      setTempWorkface(null);
      if (mode === 'roadway') {
        addLog('进入巷道编辑模式：点击添加路径点，双击完成', 'info');
        addLog('提示：绘制主巷道将作为工作面设计的基准方向', 'info');
      } else if (mode === 'workface') {
        addLog('进入工作面编辑模式：拖拽绘制矩形', 'info');
      }
    }
  };

  const finishRoadwayDrawing = () => {
    if (tempRoadway && tempRoadway.path.length >= 2) {
      const newRoadway = {
        id: `UR-${userEdits.roadways.length + 1}`,
        path: tempRoadway.path,
        locked: true,
        userDefined: true
      };
      setUserEdits(prev => ({
        ...prev,
        roadways: [...prev.roadways, newRoadway]
      }));
      addLog(`巷道已添加: ${newRoadway.id} (${newRoadway.path.length}个路径点)`, 'success');
      setTempRoadway(null);
    } else {
      addLog('巷道路径点不足（至少需要2个点）', 'warning');
      setTempRoadway(null);
    }
  };

  const clearUserEdits = () => {
    setUserEdits({ roadways: [], workfaces: [] });
    addLog('已清除所有用户编辑', 'info');
  };

  // 处理双击完成巷道绘制
  const handleCanvasDoubleClick = (e) => {
    if (isEditing && editMode === 'roadway' && tempRoadway) {
      e.preventDefault();
      finishRoadwayDrawing();
    }
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
      // 设置钻孔数据
      setBoreholes(data.boreholes);
      addLog(`钻孔数据已导入 [数量: ${data.boreholes.length}]`, 'success');

      // 生成地质模型
      try {
        addLog('正在生成地质模型...', 'loading');
        await api.generateGeology(50);
        addLog('地质模型生成成功', 'success');
      } catch (err) {
        addLog(`地质模型生成失败: ${err.message}`, 'warning');
      }

      // 切换到分析标签页
      setActiveTab('analysis');
      // 切换左侧面板到地质模型视图
      setLeftPanelMode('model');
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
      // 切换左侧面板到地质模型视图
      setLeftPanelMode('model');
    } catch (err) {
      addLog('钻孔数据处理失败: ' + err.message, 'warning');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateDesign = async () => {
    setIsLoading(true);
    addLog('启动智能采矿设计引擎...', 'warning');
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

      // 2. 调用后端生成设计方案（传入规程参数）
      addLog('应用采矿规程约束，优化工作面布局...', 'info');

      const params = {
        mode: displayDimension,
        faceWidth: designParams.faceWidth,
        pillarWidth: designParams.pillarWidth,
        boundaryMargin: designParams.boundaryMargin,
        dipAngle: designParams.dipAngle,
        dipDirection: designParams.dipDirection,
        miningRules: {
          faceLength: {
            min: designParams.faceLengthMin,
            max: designParams.faceLengthMax,
            preferred: Math.round((designParams.faceLengthMin + designParams.faceLengthMax) / 2)
          },
          layoutDirection: designParams.layoutDirection
        },
        userEdits: userEdits.roadways.length > 0 || userEdits.workfaces.length > 0
          ? userEdits
          : undefined
      };

      addLog(`设计参数: 工作面长度=${designParams.faceLengthMin}-${designParams.faceLengthMax}m, 推进长度=${designParams.faceWidth}m`, 'info');
      addLog(`布置方式: ${designParams.layoutDirection === 'strike' ? '走向长壁' : '倾向长壁'}`, 'info');

      if (params.userEdits) {
        addLog(`包含用户自定义: ${userEdits.roadways.length}条巷道, ${userEdits.workfaces.length}个工作面`, 'info');
      }

      const design = await api.generateDesign(params);
      setDesignData(design);

      // 更新边界和钻孔数据为归一化后的坐标（与设计方案一致）
      if (design.boundary && design.boundary.length > 0) {
        setBoundary(design.boundary);
      }
      if (design.boreholes && design.boreholes.length > 0) {
        setBoreholes(design.boreholes);
      }

      // 重置视图以适应新的坐标
      setViewInitialized(false);

      // 显示设计结果统计
      const panels = design.panels || [];
      const roadways = design.roadways || [];
      const stats = design.stats || {};

      addLog(`======= 设计方案生成完成 =======`, 'success');
      addLog(`工作面数量: ${panels.length}个`, 'info');
      addLog(`  - 符合规程: ${stats.validCount || panels.length}个`, 'success');
      if (stats.invalidCount > 0) {
        addLog(`  - 需调整: ${stats.invalidCount}个`, 'warning');
      }
      addLog(`平均工作面长度: ${stats.avgFaceLength || 0}m`, 'info');
      addLog(`巷道总数: ${roadways.length}条`, 'info');
      addLog(`平均评分: ${stats.avgScore || 0}分`, 'info');
      addLog(`开采方式: ${stats.miningMethod || '走向长壁后退式'}`, 'info');

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
    
    // High DPI Support
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    
    // Only resize if dimensions changed
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        // Reset scale after resize
        ctx.scale(dpr, dpr);
    } else {
        // If not resizing, we still need to clear and set up the transform
        // But since we are in a loop, we usually just clear.
        // However, ctx.scale(dpr, dpr) is persistent if we don't restore? 
        // Actually, it's safer to just reset transform every frame or rely on save/restore.
        // Let's just use the width/height for clearing.
    }
    
    // We need to handle the scaling carefully. 
    // If we set canvas.width, the context is reset.
    // So we should probably do the resize check outside animate or just ensure we scale correctly.
    
    // Let's simplify: Just use the canvas dimensions for clearing
    const width = canvas.width / dpr
    const height = canvas.height / dpr
    
    // Reset transform to identity before clearing to ensure full clear
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Apply DPI scale
    ctx.scale(dpr, dpr);

    frameRef.current += 1
    const time = frameRef.current

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
    // 在 analysis 或 synthesis 阶段都显示热力图
    if (showHeatmap && scoreData && scoreData.grids && (activeTab === 'analysis' || activeTab === 'synthesis')) {
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
    // 在 analysis 或 synthesis 阶段都显示等值线
    if (showContours && scoreData && scoreData.contours && (activeTab === 'analysis' || activeTab === 'synthesis')) {
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
    // 注释掉旧的径向渐变逻辑，改为始终显示热力图
    // if (!scoreData && boreholes.length > 0) { ... }

    // ====== 智能设计渲染 (巷道和工作面) ======
    if (showDesign && designData && activeTab === 'synthesis') {
      ctx.globalCompositeOperation = 'source-over'

      // ====== 绘制巷道 (采用CAD双线表示法) ======
      const roadways = designData.roadways || [];
      if (roadways.length === 0) {
        if (designData.mainRoadway) roadways.push(designData.mainRoadway);
        if (designData.branchRoadways) roadways.push(...designData.branchRoadways);
      }

      // 巷道宽度配置（米，会根据scale自动调整显示）
      const roadwayWidths = {
        main: 5.0,        // 主运输大巷
        ventilation: 4.5, // 回风大巷
        transport: 4.0,   // 运输顺槽
        return: 4.0,      // 回风顺槽
        cut: 6.0,         // 开切眼
        gate: 3.5         // 联络巷
      };

      // 辅助函数：计算巷道双线的偏移点
      const calculateOffsetPoints = (path, halfWidth) => {
        const leftPoints = [];
        const rightPoints = [];

        for (let i = 0; i < path.length; i++) {
          let dx, dy;
          if (i === 0) {
            dx = path[1].x - path[0].x;
            dy = path[1].y - path[0].y;
          } else if (i === path.length - 1) {
            dx = path[i].x - path[i-1].x;
            dy = path[i].y - path[i-1].y;
          } else {
            dx = path[i+1].x - path[i-1].x;
            dy = path[i+1].y - path[i-1].y;
          }

          const len = Math.sqrt(dx*dx + dy*dy);
          if (len > 0) {
            const nx = -dy / len;
            const ny = dx / len;
            leftPoints.push({ x: path[i].x + nx * halfWidth, y: path[i].y + ny * halfWidth });
            rightPoints.push({ x: path[i].x - nx * halfWidth, y: path[i].y - ny * halfWidth });
          }
        }
        return { leftPoints, rightPoints };
      };

      // 绘制双线巷道
      const drawDoubleLineRoadway = (path, width, color, isMain = false) => {
        const halfWidth = width / 2;
        const { leftPoints, rightPoints } = calculateOffsetPoints(path, halfWidth);

        if (leftPoints.length < 2) return;

        // 填充巷道内部（浅色）
        ctx.fillStyle = isMain ? 'rgba(0, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.08)';
        ctx.beginPath();
        ctx.moveTo(leftPoints[0].x, leftPoints[0].y);
        leftPoints.forEach(p => ctx.lineTo(p.x, p.y));
        for (let i = rightPoints.length - 1; i >= 0; i--) {
          ctx.lineTo(rightPoints[i].x, rightPoints[i].y);
        }
        ctx.closePath();
        ctx.fill();

        // 绘制左边线
        ctx.strokeStyle = color;
        ctx.lineWidth = isMain ? 2.5 / scale : 1.5 / scale;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([]);

        if (isMain) {
          ctx.shadowBlur = 8;
          ctx.shadowColor = color;
        }

        ctx.beginPath();
        ctx.moveTo(leftPoints[0].x, leftPoints[0].y);
        leftPoints.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.stroke();

        // 绘制右边线
        ctx.beginPath();
        ctx.moveTo(rightPoints[0].x, rightPoints[0].y);
        rightPoints.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.stroke();

        ctx.shadowBlur = 0;

        // 绘制端部封闭线（可选，在交叉口处不封闭更好看）
        // ctx.beginPath();
        // ctx.moveTo(leftPoints[0].x, leftPoints[0].y);
        // ctx.lineTo(rightPoints[0].x, rightPoints[0].y);
        // ctx.stroke();
      };

      roadways.forEach(road => {
        if (road.path && road.path.length > 1) {
          const roadType = road.type || '';
          const isMain = roadType === 'main' || road.id?.startsWith('Main');
          const isTransport = roadType === 'transport' || road.id?.startsWith('Transport');
          const isVentilation = roadType === 'ventilation' || roadType === 'return' || road.id?.startsWith('Ventilation');
          const isCut = roadType === 'cut' || road.id?.startsWith('Cut');

          // 颜色和宽度配置（符合CAD规范）
          let color, width;
          if (isMain) {
            color = '#00e5e5'; // 青色 - 主运输大巷
            width = roadwayWidths.main;
          } else if (isVentilation) {
            color = '#ff6b6b'; // 红色 - 回风巷道
            width = roadwayWidths.ventilation;
          } else if (isTransport) {
            color = '#4ecdc4'; // 青绿色 - 运输巷
            width = roadwayWidths.transport;
          } else if (isCut) {
            color = '#45b7d1'; // 蓝色 - 开切眼
            width = roadwayWidths.cut;
          } else {
            color = '#a8a8a8'; // 灰色 - 联络巷
            width = roadwayWidths.gate;
          }

          // 绘制双线巷道
          drawDoubleLineRoadway(road.path, width, color, isMain);

          // 主大巷添加中心线（虚线，表示中轴）
          if (isMain) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 1 / scale;
            ctx.setLineDash([8/scale, 4/scale]);
            ctx.lineDashOffset = -time * 2;
            ctx.beginPath();
            ctx.moveTo(road.path[0].x, road.path[0].y);
            road.path.forEach(p => ctx.lineTo(p.x, p.y));
            ctx.stroke();
            ctx.setLineDash([]);
          }

          // 标签
          if (scale > 0.25 || isMain) {
            const midIdx = Math.floor(road.path.length / 2);
            const midPoint = road.path[midIdx];

            // 计算文字角度
            let dx = road.path[road.path.length-1].x - road.path[0].x;
            let dy = road.path[road.path.length-1].y - road.path[0].y;
            let angle = Math.atan2(dy, dx);
            // 确保文字不会倒置
            if (angle > Math.PI/2 || angle < -Math.PI/2) {
              angle += Math.PI;
            }

            let label = road.name || road.id || '';
            if (!label) {
              if (isMain) label = '主运输大巷';
              else if (isVentilation) label = '回风巷';
              else if (isTransport) label = '运输巷';
              else if (isCut) label = '开切眼';
              else label = '联络巷';
            }

            ctx.save();
            ctx.translate(midPoint.x, midPoint.y - width/2 - 3/scale);
            ctx.rotate(angle);

            // 主巷道标签更醒目
            if (isMain) {
              const fontSize = Math.max(10, 14 / scale);
              ctx.font = `bold ${fontSize}px "Microsoft YaHei", sans-serif`;

              // 标签背景
              const textMetrics = ctx.measureText(label);
              const padding = 4 / scale;
              ctx.fillStyle = 'rgba(0, 40, 50, 0.9)';
              ctx.fillRect(-textMetrics.width/2 - padding, -fontSize/2 - padding,
                           textMetrics.width + padding*2, fontSize + padding*2);
              ctx.strokeStyle = color;
              ctx.lineWidth = 1.5 / scale;
              ctx.strokeRect(-textMetrics.width/2 - padding, -fontSize/2 - padding,
                            textMetrics.width + padding*2, fontSize + padding*2);

              ctx.fillStyle = color;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(label, 0, 0);
            } else {
              const fontSize = Math.max(8, 10 / scale);
              ctx.font = `${fontSize}px "Microsoft YaHei", sans-serif`;
              ctx.fillStyle = color;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';

              // 简单背景
              const textMetrics = ctx.measureText(label);
              ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
              ctx.fillRect(-textMetrics.width/2 - 2/scale, -fontSize/2 - 1/scale,
                          textMetrics.width + 4/scale, fontSize + 2/scale);
              ctx.fillStyle = color;
              ctx.fillText(label, 0, 0);
            }

            ctx.restore();
          }
        }
      });


      // ====== 绘制工作面 (采用CAD规范) ======
      const workfaceList = designData.panels || designData.workfaces || [];
      if (workfaceList.length > 0) {
        workfaceList.forEach((face, idx) => {
          const { x, y, width: w, length: h, avgScore, isValid, validationMsg } = face
          const score = avgScore || 0
          const isSelected = selectedWorkface && selectedWorkface.id === face.id;
          const isInvalid = isValid === false;

          // 工作面背景颜色（根据评分）
          let fillColor;
          if (isSelected) {
            fillColor = 'rgba(255, 255, 255, 0.25)';
          } else if (isInvalid) {
            fillColor = 'rgba(239, 68, 68, 0.2)';
          } else {
            fillColor = scoreToColor(score, 0.2);
          }
          ctx.fillStyle = fillColor;

          if (face.points && face.points.length > 0) {
            // 使用多边形顶点绘制（支持旋转）
            ctx.beginPath();
            ctx.moveTo(face.points[0].x, face.points[0].y);
            face.points.forEach(p => ctx.lineTo(p.x, p.y));
            ctx.closePath();
            ctx.fill();

            // 工作面边框（CAD规范：红色实线）
            let borderColor = isInvalid ? '#ef4444' : '#e74c3c'; // 红色边框
            if (isSelected) {
              borderColor = '#ffffff';
            }

            ctx.strokeStyle = borderColor;
            ctx.lineWidth = isSelected ? 3 / scale : 2 / scale;
            ctx.setLineDash([]);
            ctx.stroke();

            // 添加斜线填充图案（CAD规范：已规划工作面用斜线表示）
            if (!isSelected) {
              ctx.save();
              ctx.clip(); // 裁剪到工作面区域内

              // 计算工作面边界
              const minX = Math.min(...face.points.map(p => p.x));
              const maxX = Math.max(...face.points.map(p => p.x));
              const minY = Math.min(...face.points.map(p => p.y));
              const maxY = Math.max(...face.points.map(p => p.y));

              // 绘制斜线填充
              ctx.strokeStyle = isInvalid ? 'rgba(239, 68, 68, 0.4)' : 'rgba(255, 255, 255, 0.25)';
              ctx.lineWidth = 0.8 / scale;
              const spacing = 12 / scale; // 斜线间距

              for (let i = minX - (maxY - minY); i < maxX + (maxY - minY); i += spacing) {
                ctx.beginPath();
                ctx.moveTo(i, minY);
                ctx.lineTo(i + (maxY - minY), maxY);
                ctx.stroke();
              }

              ctx.restore();
            }

            // 标签位置 (使用中心点)
            const centerX = face.center_x || (face.points.reduce((s, p) => s + p.x, 0) / face.points.length);
            const centerY = face.center_y || (face.points.reduce((s, p) => s + p.y, 0) / face.points.length);

            // 计算工作面的角度（用于旋转文字）
            let faceAngle = 0;
            if (face.points.length >= 2) {
              const dx = face.points[1].x - face.points[0].x;
              const dy = face.points[1].y - face.points[0].y;
              faceAngle = Math.atan2(dy, dx);
              if (faceAngle > Math.PI/2 || faceAngle < -Math.PI/2) {
                faceAngle += Math.PI;
              }
            }

            // 工作面编号标签
            const labelText = face.id || `WF-${String(idx + 1).padStart(2, '0')}`;

            ctx.save();
            ctx.translate(centerX, centerY);
            // ctx.rotate(faceAngle); // 可选：文字沿工作面方向

            // 工作面名称（大字体，类似CAD）
            const fontSize = Math.max(10, 14 / scale);
            ctx.font = `bold ${fontSize}px "Microsoft YaHei", sans-serif`;
            const textMetrics = ctx.measureText(labelText);

            // 标签背景
            const padding = 4 / scale;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(-textMetrics.width/2 - padding, -fontSize/2 - padding - 5/scale,
                        textMetrics.width + padding*2, fontSize + padding*2);

            // 标签文字
            ctx.fillStyle = isInvalid ? '#ff6b6b' : '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(labelText, 0, -5/scale);

            // 工作面参数（小字体）
            const faceLen = face.faceLength || h || 0;
            const advLen = face.advanceLength || w || 0;

            const smallFontSize = Math.max(8, 10 / scale);
            ctx.font = `${smallFontSize}px "Microsoft YaHei", sans-serif`;
            ctx.fillStyle = '#aaaaaa';

            // 显示尺寸
            ctx.fillText(`${faceLen.toFixed(0)}m × ${advLen.toFixed(0)}m`, 0, 10/scale);

            // 评分
            ctx.fillStyle = score > 70 ? '#4ade80' : (score > 50 ? '#fbbf24' : '#f87171');
            ctx.fillText(`评分: ${score.toFixed(0)}`, 0, 22/scale);

            // 不符合规程警告
            if (isInvalid && validationMsg) {
              ctx.fillStyle = '#ff6b6b';
              ctx.font = `${Math.max(7, 9/scale)}px sans-serif`;
              ctx.fillText(`⚠ ${validationMsg.substring(0, 15)}`, 0, 34/scale);
            }

            ctx.restore();

          } else {
            // 降级回退：使用矩形绘制
            ctx.fillRect(x, y, w, h)

            // 工作面边框（CAD规范：红色实线）
            ctx.strokeStyle = isSelected ? '#ffffff' : (isInvalid ? '#ef4444' : '#e74c3c');
            ctx.lineWidth = isSelected ? 3 / scale : 2 / scale;
            ctx.strokeRect(x, y, w, h)

            // 斜线填充
            if (!isSelected) {
              ctx.save();
              ctx.beginPath();
              ctx.rect(x, y, w, h);
              ctx.clip();

              ctx.strokeStyle = isInvalid ? 'rgba(239, 68, 68, 0.4)' : 'rgba(255, 255, 255, 0.25)';
              ctx.lineWidth = 0.8 / scale;
              const spacing = 12 / scale;

              for (let i = x - h; i < x + w + h; i += spacing) {
                ctx.beginPath();
                ctx.moveTo(i, y);
                ctx.lineTo(i + h, y + h);
                ctx.stroke();
              }
              ctx.restore();
            }

            // 工作面标签
            const labelText = face.id || `WF-${String(idx + 1).padStart(2, '0')}`;
            const centerX = x + w / 2;
            const centerY = y + h / 2;

            ctx.save();
            ctx.translate(centerX, centerY);

            const fontSize = Math.max(10, 14 / scale);
            ctx.font = `bold ${fontSize}px "Microsoft YaHei", sans-serif`;
            const textMetrics = ctx.measureText(labelText);
            const padding = 4 / scale;

            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(-textMetrics.width/2 - padding, -fontSize/2 - padding - 5/scale,
                        textMetrics.width + padding*2, fontSize + padding*2);

            ctx.fillStyle = isInvalid ? '#ff6b6b' : '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(labelText, 0, -5/scale);

            const smallFontSize = Math.max(8, 10 / scale);
            ctx.font = `${smallFontSize}px "Microsoft YaHei", sans-serif`;
            ctx.fillStyle = '#aaaaaa';
            ctx.fillText(`${w.toFixed(0)}m × ${h.toFixed(0)}m`, 0, 10/scale);

            ctx.fillStyle = score > 70 ? '#4ade80' : (score > 50 ? '#fbbf24' : '#f87171');
            ctx.fillText(`评分: ${score.toFixed(0)}`, 0, 22/scale);

            ctx.restore();
          }
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
        
        // 钻孔样式：同心圆 (Drawing Regulations)
        // 调整：减小圆圈大小，增大文字大小，优化缩放逻辑
        
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
        // 始终显示，字体调大 (Screen size: ~12px) - 用户反馈太大，调小一点
        ctx.fillStyle = isSelected ? '#fbbf24' : 'rgba(255, 255, 255, 0.9)';
        // 使用 bold 增加清晰度
        ctx.font = `bold ${12 / scale}px sans-serif`;
        ctx.textAlign = 'left';
        // 增加偏移量，避免压住圆圈
        ctx.fillText(hole.id, hole.x + 4 / scale, hole.y + 4 / scale);
        
        // 选中高亮 (额外的光圈)
        if (isSelected) {
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.5)';
          ctx.lineWidth = 3 / scale;
          ctx.beginPath();
          ctx.arc(hole.x, hole.y, 6 / scale, 0, Math.PI * 2);
          ctx.stroke();
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
    if (scoreData && (showHeatmap || showContours) && (activeTab === 'analysis' || activeTab === 'synthesis')) {
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

    // ====== 巷道图例 (右下角) - 符合CAD规范 ======
    if (designData && designData.roadways && designData.roadways.length > 0 && activeTab === 'synthesis') {
      const roadLegendX = width - 155
      const roadLegendY = height - 180

      // 背景
      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)'
      ctx.fillRect(roadLegendX - 10, roadLegendY - 25, 160, 175)
      ctx.strokeStyle = '#444'
      ctx.lineWidth = 1
      ctx.strokeRect(roadLegendX - 10, roadLegendY - 25, 160, 175)

      // 标题
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 12px "Microsoft YaHei", sans-serif'
      ctx.fillText('图 例', roadLegendX + 50, roadLegendY - 8)

      // 图例项 - 双线表示（符合CAD规范）
      const legendItems = [
        { color: '#00e5e5', label: '主运输大巷', width: 5 },
        { color: '#ff6b6b', label: '回风大巷', width: 4.5 },
        { color: '#4ecdc4', label: '运输顺槽', width: 4 },
        { color: '#ff6b6b', label: '回风顺槽', width: 4, dashed: true },
        { color: '#45b7d1', label: '开切眼', width: 6 },
        { color: '#e74c3c', label: '工作面', isWorkface: true }
      ]

      ctx.font = '10px "Microsoft YaHei", sans-serif'
      legendItems.forEach((item, idx) => {
        const y = roadLegendY + 12 + idx * 24

        if (item.isWorkface) {
          // 工作面图例 - 带斜线填充
          ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'
          ctx.fillRect(roadLegendX, y - 8, 35, 16)
          ctx.strokeStyle = item.color
          ctx.lineWidth = 2
          ctx.strokeRect(roadLegendX, y - 8, 35, 16)

          // 斜线填充
          ctx.save()
          ctx.beginPath()
          ctx.rect(roadLegendX, y - 8, 35, 16)
          ctx.clip()
          ctx.strokeStyle = 'rgba(255,255,255,0.3)'
          ctx.lineWidth = 0.8
          for (let i = roadLegendX - 16; i < roadLegendX + 35 + 16; i += 5) {
            ctx.beginPath()
            ctx.moveTo(i, y - 8)
            ctx.lineTo(i + 16, y + 8)
            ctx.stroke()
          }
          ctx.restore()
        } else {
          // 巷道图例 - 双线表示
          const halfW = 3 // 图例中的巷道宽度
          ctx.fillStyle = 'rgba(255,255,255,0.05)'
          ctx.fillRect(roadLegendX, y - halfW, 35, halfW * 2)

          ctx.strokeStyle = item.color
          ctx.lineWidth = 1.5
          if (item.dashed) {
            ctx.setLineDash([3, 2])
          } else {
            ctx.setLineDash([])
          }

          // 上边线
          ctx.beginPath()
          ctx.moveTo(roadLegendX, y - halfW)
          ctx.lineTo(roadLegendX + 35, y - halfW)
          ctx.stroke()

          // 下边线
          ctx.beginPath()
          ctx.moveTo(roadLegendX, y + halfW)
          ctx.lineTo(roadLegendX + 35, y + halfW)
          ctx.stroke()

          ctx.setLineDash([])
        }

        // 标签
        ctx.fillStyle = item.color
        ctx.fillText(item.label, roadLegendX + 42, y + 4)
      })
    }
    
    // ====== 绘制用户自定义元素（锁定状态）======
    if (userEdits.roadways.length > 0 || userEdits.workfaces.length > 0) {
      ctx.save();
      
      // 用户自定义巷道（蓝色）
      userEdits.roadways.forEach(roadway => {
        if (roadway.path && roadway.path.length > 1) {
          ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)';
          ctx.lineWidth = 14 / scale;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(roadway.path[0].x, roadway.path[0].y);
          roadway.path.forEach(p => ctx.lineTo(p.x, p.y));
          ctx.stroke();
          
          ctx.strokeStyle = '#3b82f6';
          ctx.lineWidth = 4 / scale;
          ctx.shadowBlur = 12;
          ctx.shadowColor = '#3b82f6';
          ctx.beginPath();
          ctx.moveTo(roadway.path[0].x, roadway.path[0].y);
          roadway.path.forEach(p => ctx.lineTo(p.x, p.y));
          ctx.stroke();
          ctx.shadowBlur = 0;
          
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
        
        ctx.fillStyle = 'rgba(251, 146, 60, 0.25)';
        ctx.fillRect(x, y, w, h);
        
        ctx.strokeStyle = '#fb923c';
        ctx.lineWidth = 3 / scale;
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#fb923c';
        ctx.setLineDash([10 / scale, 5 / scale]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;
        
        ctx.fillStyle = '#fb923c';
        ctx.font = `bold ${Math.max(10, 12 / scale)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(`🔒${face.id}`, x + w / 2, y + h / 2);
      });
      
      ctx.restore();
    }
    
    // ====== 绘制临时元素（正在绘制中）======
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

    requestRef.current = requestAnimationFrame(animate)
  }

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(requestRef.current)
  }, [boundary, boreholes, weights, activeTab, isLoading, scale, showGrid, panOffset, scoreData, designData, showHeatmap, showContours, showDesign, displayDimension, selectedBorehole, userEdits, tempRoadway, tempWorkface, isEditing, editMode, mousePos])
  
  // 处理滚轮缩放（使用 useEffect 避免 passive listener 警告）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const handleWheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setScale(prev => Math.max(0.25, Math.min(4, prev * delta)));
    };
    
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);
  
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
        GeoMind <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">智能采矿设计系统</span>
      </h1>
      <div className="flex items-center gap-2 text-[10px] text-gray-400 tracking-wider">
        <span className="w-2 h-2 bg-green-500 rounded-full animate-ping"></span>
        系统在线 // V5.0.1
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
        <Save size={14} /> 导出报告
      </button>
      <button 
        onClick={async () => {
          try {
            addLog('正在导出 DXF 设计图纸...', 'loading');
            await api.exportDesignDXF();
            addLog('DXF 导出成功', 'success');
          } catch (e) {
            addLog('DXF 导出失败: ' + e.message, 'warning');
          }
        }}
        disabled={!designData}
        className={`flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-lg shadow-blue-900/20 border border-blue-400/20 transition-all hover:scale-105 ${!designData ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <FolderOpen size={14} /> 导出 DXF
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
            <label className="text-xs text-gray-400 uppercase tracking-wider">采矿规程参数</label>

            {/* 工作面长度范围 */}
            <div className="space-y-1">
              <label className="text-[10px] text-gray-500">工作面长度范围 (m)</label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <input
                    type="number"
                    value={designParams.faceLengthMin}
                    onChange={(e) => setDesignParams({...designParams, faceLengthMin: parseFloat(e.target.value) || 150})}
                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white"
                    placeholder="最小"
                  />
                </div>
                <div>
                  <input
                    type="number"
                    value={designParams.faceLengthMax}
                    onChange={(e) => setDesignParams({...designParams, faceLengthMax: parseFloat(e.target.value) || 300})}
                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white"
                    placeholder="最大"
                  />
                </div>
              </div>
            </div>

            {/* 推进长度和煤柱宽度 */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-gray-500">推进长度 (m)</label>
                <input
                  type="number"
                  value={designParams.faceWidth}
                  onChange={(e) => setDesignParams({...designParams, faceWidth: parseFloat(e.target.value) || 200})}
                  className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500">区段煤柱 (m)</label>
                <input
                  type="number"
                  value={designParams.pillarWidth}
                  onChange={(e) => setDesignParams({...designParams, pillarWidth: parseFloat(e.target.value) || 20})}
                  className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white"
                />
              </div>
            </div>

            {/* 边界煤柱 */}
            <div>
              <label className="text-[10px] text-gray-500">边界煤柱宽度 (m)</label>
              <input
                type="number"
                value={designParams.boundaryMargin}
                onChange={(e) => setDesignParams({...designParams, boundaryMargin: parseFloat(e.target.value) || 30})}
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white"
              />
            </div>

            {/* 布置方向 */}
            <div>
              <label className="text-[10px] text-gray-500">布置方向</label>
              <select
                value={designParams.layoutDirection}
                onChange={(e) => setDesignParams({...designParams, layoutDirection: e.target.value})}
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white"
              >
                <option value="strike">走向长壁</option>
                <option value="dip">倾向长壁</option>
              </select>
            </div>

            {/* 煤层倾角 */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-gray-500">煤层倾角 (°)</label>
                <input
                  type="number"
                  value={designParams.dipAngle}
                  onChange={(e) => setDesignParams({...designParams, dipAngle: parseFloat(e.target.value) || 0})}
                  className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white"
                  min="0" max="45" step="1"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500">煤层倾向 (°)</label>
                <input
                  type="number"
                  value={designParams.dipDirection}
                  onChange={(e) => setDesignParams({...designParams, dipDirection: parseFloat(e.target.value) || 0})}
                  className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white"
                  min="0" max="360" step="1"
                />
              </div>
            </div>
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
      {/* 地质建模视图模式 */}
      {leftPanelMode === 'model' && boreholes.length > 0 ? (
        <div className="flex flex-col h-full">
          {/* 模型视图头部 */}
          <div className="px-4 py-3 border-b border-gray-700/50 flex items-center justify-between bg-gray-900/30">
            <h3 className="text-xs uppercase tracking-[0.2em] text-cyan-400 font-bold flex items-center gap-2">
              <Box size={12} /> 地质建模
            </h3>
            <button
              onClick={() => setLeftPanelMode('import')}
              className="flex items-center gap-1.5 px-2 py-1 text-[10px] rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors border border-gray-600"
            >
              <Upload size={10} /> 重新导入
            </button>
          </div>

          {/* 3D 地质模型预览 - 占据主要空间 */}
          <div className="flex-1 min-h-0">
            <GeoModelPreview data={boreholes} />
          </div>

          {/* 数据摘要 */}
          <div className="px-4 py-3 border-t border-gray-700/50 bg-gray-900/30 space-y-2">
            <div className="text-[10px] text-gray-400 uppercase tracking-wider">数据摘要</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-2 text-blue-300">
                <CheckCircle size={10} /> 边界: {boundary.length} 点
              </div>
              <div className="flex items-center gap-2 text-amber-300">
                <CheckCircle size={10} /> 钻孔: {boreholes.length} 个
              </div>
            </div>
          </div>

          {/* 参数设置和生成按钮 */}
          <div className="p-4 border-t border-gray-700/50 space-y-4 overflow-y-auto max-h-80">
            <div className="space-y-4">
              <h3 className="text-xs uppercase tracking-[0.2em] text-purple-400 font-bold flex items-center gap-2 pb-2 border-b border-gray-700/50">
                <Settings size={12} /> 评分权重
              </h3>

              {[
                { key: 'safety', label: '安全系数', icon: ShieldCheck, color: 'text-blue-400', bg: 'bg-blue-500' },
                { key: 'economic', label: '经济效益', icon: DollarSign, color: 'text-amber-400', bg: 'bg-amber-500' },
                { key: 'env', label: '环境友好', icon: Leaf, color: 'text-emerald-400', bg: 'bg-emerald-500' },
              ].map(item => (
                <div key={item.key} className="space-y-2">
                  <div className="flex justify-between text-xs items-center">
                    <span className={`flex items-center gap-1.5 ${item.color} font-medium`}>
                      <item.icon size={12}/> {item.label}
                    </span>
                    <span className={`font-mono ${item.color} bg-gray-800 px-1.5 py-0.5 rounded text-[10px]`}>
                      {weights[item.key]}%
                    </span>
                  </div>
                  <div className="relative h-1 bg-gray-700 rounded-full overflow-hidden">
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

            <button
              onClick={handleGenerateDesign}
              disabled={boreholes.length === 0 || isLoading}
              className={`
                relative w-full py-4 rounded-xl flex items-center justify-center gap-2 font-bold text-xs tracking-wider uppercase transition-all overflow-hidden group
                ${boreholes.length > 0
                  ? 'text-white shadow-[0_0_15px_rgba(59,130,246,0.4)] hover:shadow-[0_0_25px_rgba(59,130,246,0.6)]'
                  : 'bg-gray-800/50 text-gray-500 cursor-not-allowed border border-gray-700'}
              `}
            >
              {boreholes.length > 0 && (
                <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-purple-600 transition-transform duration-300 group-hover:scale-105"></div>
              )}
              <div className="relative z-10 flex items-center gap-2">
                {isLoading ? <Activity className="animate-spin" size={14} /> : <Play fill="currentColor" size={14} />}
                {isLoading ? '正在计算...' : '生成最优设计'}
              </div>
            </button>
          </div>
        </div>
      ) : (
        /* 数据导入模式 */
        <div className="p-5 space-y-8 overflow-y-auto">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-gray-700/50">
              <h3 className="text-xs uppercase tracking-[0.2em] text-blue-400 font-bold flex items-center gap-2">
                <Database size={12} /> 数据源
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
                {/* 切换到模型视图按钮 */}
                {boreholes.length > 0 && (
                  <button
                    onClick={() => setLeftPanelMode('model')}
                    className="mt-2 w-full py-2 text-xs text-cyan-400 hover:text-cyan-300 bg-cyan-900/20 hover:bg-cyan-900/30 border border-cyan-500/30 rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <Box size={12} /> 查看地质建模
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="space-y-6">
            <h3 className="text-xs uppercase tracking-[0.2em] text-purple-400 font-bold flex items-center gap-2 pb-2 border-b border-gray-700/50">
              <Settings size={12} /> 参数设置
            </h3>

            {[
              { key: 'safety', label: '安全系数', icon: ShieldCheck, color: 'text-blue-400', accent: 'accent-blue-500', bg: 'bg-blue-500' },
              { key: 'economic', label: '经济效益', icon: DollarSign, color: 'text-amber-400', accent: 'accent-amber-500', bg: 'bg-amber-500' },
              { key: 'env', label: '环境友好', icon: Leaf, color: 'text-emerald-400', accent: 'accent-emerald-500', bg: 'bg-emerald-500' },
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
                {isLoading ? '正在计算...' : '生成最优设计方案'}
              </div>
            </button>
          </div>
        </div>
      )}
    </aside>

    <section className="flex-1 relative flex flex-col rounded-xl overflow-hidden glass-panel border-gray-700/50 shadow-2xl">
      <div className="absolute top-0 left-0 right-0 h-12 bg-gradient-to-b from-gray-900/90 to-transparent z-10 flex items-center justify-between px-4 pointer-events-none">
        <div className="flex gap-4 text-[10px] text-gray-400 font-mono">
          <span className="flex items-center gap-1"><Crosshair size={10} /> 坐标: {mousePos.x}, {mousePos.y}</span>
          <span className="flex items-center gap-1"><Maximize2 size={10} /> 比例: {(scale * 100).toFixed(0)}%</span>
        </div>
        <div className="flex gap-2">
          <div className="bg-black/40 backdrop-blur rounded px-2 py-1 border border-gray-700/50 flex items-center gap-2 text-[10px] text-gray-300">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.8)]"></span> 高适宜区
          </div>
          <div className="bg-black/40 backdrop-blur rounded px-2 py-1 border border-gray-700/50 flex items-center gap-2 text-[10px] text-gray-300">
            <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.8)]"></span> 危险区域
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
          className={`w-full h-full object-contain ${isPanning ? 'cursor-grabbing' : (isEditing ? 'cursor-crosshair' : 'cursor-default')}`}
          onMouseMove={handleCanvasMouseMove}
          onMouseDown={handleCanvasMouseDown}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          onClick={handleCanvasClick}
          onDoubleClick={handleCanvasDoubleClick}
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
        
        {/* 编辑模式按钮 */}
        <button 
          onClick={() => toggleEditMode('roadway')} 
          className={`flex items-center gap-2 px-3 py-1 rounded-full transition-colors ${isEditing && editMode === 'roadway' ? 'bg-blue-900/50 text-blue-400 border border-blue-500/50' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
          title="绘制巷道"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6 L12 4 L20 6 L20 18 L12 20 L4 18 Z M4 6 L20 18 M20 6 L4 18"></path>
          </svg>
          <span className="text-xs font-bold">绘制巷道</span>
        </button>
        <button 
          onClick={() => toggleEditMode('workface')} 
          className={`flex items-center gap-2 px-3 py-1 rounded-full transition-colors ${isEditing && editMode === 'workface' ? 'bg-orange-900/50 text-orange-400 border border-orange-500/50' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
          title="绘制工作面"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          </svg>
          <span className="text-xs font-bold">绘制工作面</span>
        </button>
        {(userEdits.roadways.length > 0 || userEdits.workfaces.length > 0) && (
          <button 
            onClick={clearUserEdits} 
            className="text-red-400 hover:text-red-300 transition-colors"
            title="清除用户编辑"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        )}
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
          className="text-gray-400 hover:text-white transition-colors"
          title="一键复位视图"
        >
          <Crosshair size={18}/>
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

    <aside className="w-80 glass-panel rounded-xl flex flex-col overflow-hidden animate-[slideInRight_0.5s_ease-out]">
      {/* 设计依据 & 预计指标 (条件渲染) */}
      {activeTab === 'synthesis' && designData && (
        <div className="flex-1 flex flex-col overflow-y-auto">
          <div className="border-b border-gray-700/50 bg-gray-900/20 p-4 shrink-0">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
              <Cpu size={14} className="text-purple-400"/> 设计依据
            </h4>

            {/* Selected Workface Details */}
            {selectedWorkface ? (
              <div className="bg-purple-900/20 border border-purple-500/30 rounded-lg p-3 mb-3 animate-pulse-once">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-purple-300 font-bold text-sm">{selectedWorkface.id}</span>
                  <span className="text-xs bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded">已选中</span>
                </div>
                <div className="space-y-1 text-xs text-gray-300">
                  <div className="flex justify-between"><span>推进长度:</span> <span className="font-mono">{selectedWorkface.width?.toFixed(0)}m</span></div>
                  <div className="flex justify-between"><span>工作面长度:</span> <span className="font-mono">{selectedWorkface.length?.toFixed(0)}m</span></div>
                  <div className="flex justify-between"><span>面积:</span> <span className="font-mono">{selectedWorkface.area?.toFixed(0)}m²</span></div>
                  <div className="flex justify-between"><span>评分:</span> <span className="font-mono text-green-400">{selectedWorkface.avgScore?.toFixed(1)}</span></div>
                </div>
              </div>
            ) : (
              <div className="text-[10px] text-gray-500 italic mb-3 text-center border border-dashed border-gray-700 rounded p-2">
                点击工作面查看详情
              </div>
            )}

            {/* General Design Params */}
            <div className="space-y-2 text-[10px]">
              <div className="flex justify-between items-center border-b border-gray-800 pb-1">
                <span className="text-gray-400">开采方式</span>
                <span className="text-white font-mono">{designData.stats?.miningMethod || 'N/A'}</span>
              </div>
              <div className="flex justify-between items-center border-b border-gray-800 pb-1">
                <span className="text-gray-400">布置方向</span>
                <span className="text-white font-mono uppercase">{designData.stats?.layoutDirection || 'N/A'}</span>
              </div>
              <div className="flex justify-between items-center border-b border-gray-800 pb-1">
                <span className="text-gray-400">工作面数量</span>
                <span className="text-white font-mono">{designData.stats?.count || 0} 个</span>
              </div>
              <div className="flex justify-between items-center border-b border-gray-800 pb-1">
                <span className="text-gray-400">平均长度</span>
                <span className="text-white font-mono">{designData.stats?.avgFaceLength?.toFixed(0) || 0}m</span>
              </div>
              <div className="flex justify-between items-center border-b border-gray-800 pb-1">
                <span className="text-gray-400">区段煤柱</span>
                <span className="text-amber-300 font-mono">{designData.designParams?.pillarWidth}m</span>
              </div>
               <div className="flex justify-between items-center border-b border-gray-800 pb-1">
                <span className="text-gray-400">推进长度</span>
                <span className="text-blue-300 font-mono">{designData.designParams?.workfaceWidth}m</span>
              </div>
            </div>
          </div>

          <div className="flex-1 border-b border-gray-700/50 bg-gradient-to-t from-blue-900/20 to-transparent p-4 flex flex-col">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <BarChart3 size={14} className="text-blue-400"/> 设计指标
            </h4>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-gray-800/50 p-3 rounded-lg border border-gray-700 hover:border-blue-500/50 transition-colors group">
                <div className="text-[10px] text-gray-400 uppercase mb-1">平均评分</div>
                <div className="text-2xl font-black text-white group-hover:text-blue-400 transition-colors">{designData.stats?.avgScore?.toFixed(1) || 0}</div>
              </div>
              <div className="bg-gray-800/50 p-3 rounded-lg border border-gray-700 hover:border-amber-500/50 transition-colors group">
                <div className="text-[10px] text-gray-400 uppercase mb-1 flex items-center gap-1"><Hammer size={10}/> 有效工作面</div>
                <div className="text-xl font-bold text-white group-hover:text-amber-400 transition-colors">{designData.stats?.validCount || 0}<span className="text-xs ml-0.5 opacity-50">个</span></div>
              </div>
              <div className="bg-gray-800/50 p-3 rounded-lg border border-gray-700 hover:border-emerald-500/50 transition-colors group">
                <div className="text-[10px] text-gray-400 uppercase mb-1 flex items-center gap-1"><ShieldCheck size={10}/> 合规率</div>
                <div className="text-xl font-bold text-emerald-400">
                  {designData.stats?.count > 0 ? Math.round((designData.stats?.validCount || 0) / designData.stats?.count * 100) : 0}%
                </div>
              </div>
              <div className="bg-gray-800/50 p-3 rounded-lg border border-gray-700 hover:border-purple-500/50 transition-colors group">
                <div className="text-[10px] text-gray-400 uppercase mb-1 flex items-center gap-1"><Wind size={10}/> 巷道数</div>
                <div className="text-xl font-bold text-gray-200 group-hover:text-purple-400">{designData.roadways?.length || 0}</div>
              </div>
            </div>
            
            {/* 智能评价 (填充剩余空间) */}
            <div className="mt-auto pt-4 border-t border-gray-700/30">
               <h5 className="text-[10px] font-bold text-gray-400 uppercase mb-3 flex items-center gap-2">
                 <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></div> 智能评价
               </h5>
               
               <div className="space-y-3">
                 {/* 综合建议 */}
                 <div className="text-xs text-gray-300 leading-relaxed bg-gray-800/30 p-3 rounded border border-gray-700/50">
                    {designData.stats?.avgScore >= 80 ? (
                      <span className="text-emerald-300">设计方案优秀。各项指标均衡，资源回收率高，建议按此方案实施。</span>
                    ) : designData.stats?.avgScore >= 60 ? (
                      <span className="text-blue-300">设计方案良好。符合基本规范，建议进一步优化工作面长度以提升评分。</span>
                    ) : (
                      <span className="text-amber-400">设计方案有待改进。建议调整开采方向或减少无效区域。</span>
                    )}
                 </div>

                 {/* 关键指标进度条 */}
                 <div className="space-y-2">
                    <div className="flex justify-between text-[9px] text-gray-400 mb-0.5">
                      <span>资源回收率</span>
                      <span className="text-emerald-400 font-mono">
                        {designData.stats?.count > 0 ? Math.round((designData.stats?.validCount || 0) / designData.stats?.count * 95) : 0}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-emerald-500 rounded-full transition-all duration-1000" 
                        style={{width: `${designData.stats?.count > 0 ? Math.round((designData.stats?.validCount || 0) / designData.stats?.count * 95) : 0}%`}}
                      ></div>
                    </div>

                    <div className="flex justify-between text-[9px] text-gray-400 mb-0.5 mt-2">
                      <span>安全系数</span>
                      <span className="text-blue-400 font-mono">9.2</span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full w-[92%]"></div>
                    </div>
                 </div>

                 {/* 优化建议列表 */}
                 <div className="bg-gray-800/20 p-2 rounded border border-gray-700/30">
                    <div className="text-[9px] text-gray-500 mb-1 uppercase">优化建议</div>
                    <ul className="space-y-1">
                      <li className="text-[10px] text-gray-400 flex items-start gap-1.5">
                        <span className="text-blue-500 mt-0.5">•</span>
                        <span>建议增加工作面长度以提高单产</span>
                      </li>
                      <li className="text-[10px] text-gray-400 flex items-start gap-1.5">
                        <span className="text-blue-500 mt-0.5">•</span>
                        <span>注意 {designData.designParams?.pillarWidth}m 煤柱区域的应力集中</span>
                      </li>
                    </ul>
                 </div>
               </div>
            </div>
          </div>
        </div>
      )}

      {/* 无设计数据时显示提示 */}
      {!(activeTab === 'synthesis' && designData) && (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full border-2 border-dashed border-gray-700 flex items-center justify-center">
              <BarChart3 size={28} className="text-gray-600" />
            </div>
            <h3 className="text-sm font-bold text-gray-400 mb-2">设计分析</h3>
            <p className="text-xs text-gray-500">
              {boreholes.length === 0
                ? '请先导入数据'
                : '点击"生成最优设计"查看设计结果'}
            </p>
          </div>
        </div>
      )}

      {/* 后端日志 (固定高度) */}
      <div className="h-40 border-t border-gray-700/50 flex flex-col bg-black/20">
        <div className="px-4 py-2 border-b border-gray-700/30 bg-gray-900/30">
          <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
            <Terminal size={10}/> 后端日志
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-[10px] scroll-smooth">
          {systemLog.length === 0 && <span className="text-gray-600 animate-pulse">_ 等待输入...</span>}
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
      </div>
    </aside>
    </main>
  </div>
  );
};

export default MiningDesignSystem;