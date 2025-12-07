import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as api from './api';
import FileUploader from './FileUploader';
import {
  GlobalStyles,
  AppHeader,
  SettingsPanel,
  CanvasSection,
  LeftSidebar,
  RightPanel,
  GeoModelPreview
} from './components';

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
  const [viewMode, setViewMode] = useState('design'); // 'design' | 'heatmap' - 视图模式

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
      // 使用 getBoundingClientRect 获取 CSS 尺寸（不受 DPR 影响）
      const rect = canvas.getBoundingClientRect();
      const canvasWidth = rect.width || 900;
      const canvasHeight = rect.height || 700;
      
      // 计算边界的范围
      const xs = boundary.map(p => p.x);
      const ys = boundary.map(p => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const dataWidth = maxX - minX;
      const dataHeight = maxY - minY;
      
      // 计算缩放比例（留出适当边距，让采区占据大部分画布）
      const scaleX = (canvasWidth * 0.70) / dataWidth;  // 70% 画布宽度（确保可见）
      const scaleY = (canvasHeight * 0.70) / dataHeight; // 70% 画布高度
      const newScale = Math.min(scaleX, scaleY, 3); // 最大3倍，适应不同尺寸的采区

      // 计算平移偏移使数据精确居中
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const offsetX = (canvasWidth / 2 / newScale) - centerX;
      const offsetY = (canvasHeight / 2 / newScale) - centerY;
      
      setScale(newScale);
      setPanOffset({ x: offsetX, y: offsetY });
      setViewInitialized(true);
      
      console.log(`[视图适配] canvasSize=${canvasWidth.toFixed(0)}x${canvasHeight.toFixed(0)}, scale=${newScale.toFixed(4)}`);
      console.log(`[视图适配] 数据范围: X[${minX.toFixed(0)}-${maxX.toFixed(0)}], Y[${minY.toFixed(0)}-${maxY.toFixed(0)}], size=${dataWidth.toFixed(0)}x${dataHeight.toFixed(0)}`);
      console.log(`[视图适配] offset=(${offsetX.toFixed(0)}, ${offsetY.toFixed(0)})`);
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
      
      // 计算缩放比例（留出适当边距，让采区占据大部分画布）
      const scaleX = (canvasWidth * 0.30) / dataWidth;  // 30% 画布宽度
      const scaleY = (canvasHeight * 0.30) / dataHeight; // 30% 画布高度
      const newScale = Math.min(scaleX, scaleY, 3); // 最大3倍，适应不同尺寸的采区

      // 计算平移偏移使数据精确居中
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
      
      // 更新边界和钻孔为归一化坐标（评分API现在也返回归一化数据）
      if (scoreResult.boundary && scoreResult.boundary.length > 0) {
        setBoundary(scoreResult.boundary);
      }
      if (scoreResult.boreholes && scoreResult.boreholes.length > 0) {
        setBoreholes(scoreResult.boreholes);
      }
      
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
      const workfaces = design.workfaces || design.panels || [];
      const roadways = design.roadways || [];
      const stats = design.stats || {};

      addLog(`======= 设计方案生成完成 =======`, 'success');
      addLog(`工作面数量: ${workfaces.length}个`, 'info');
      addLog(`  - 符合规程: ${stats.validCount || workfaces.length}个`, 'success');
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

  // 帧率控制 - 限制最大60fps以节省资源
  const lastFrameTimeRef = useRef(0);
  const targetFPS = 60;
  const frameInterval = 1000 / targetFPS;

  const animate = (timestamp) => {
    // 帧率限制
    if (timestamp - lastFrameTimeRef.current < frameInterval) {
      requestRef.current = requestAnimationFrame(animate);
      return;
    }
    lastFrameTimeRef.current = timestamp;

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
    // ctx.clip() // 暂时禁用裁剪，防止设计元素因精度问题不可见

    // ====== 热力图渲染 ======
    // 在分析阶段始终显示，在综合阶段只有viewMode='heatmap'时显示
    const shouldShowHeatmap = showHeatmap && scoreData && scoreData.grids && (
      activeTab === 'analysis' ||
      (activeTab === 'synthesis' && viewMode === 'heatmap')
    );

    if (shouldShowHeatmap) {
      const gridData = scoreData.grids[displayDimension]

      if (gridData && gridData.data && gridData.data.length > 0) {
        const { data, minX, minY, stepX, stepY, resolution } = gridData

        // 在热力图模式下，透明度更高，更明显
        ctx.globalAlpha = viewMode === 'heatmap' ? 0.9 : 0.7
        for (let i = 0; i < data.length; i++) {
          for (let j = 0; j < data[i].length; j++) {
            const score = data[i][j]
            if (score === null) continue

            const x = minX + j * stepX
            const y = minY + i * stepY

            // 热力图模式使用更强烈的颜色
            const alpha = viewMode === 'heatmap' ? 0.8 : 0.6
            ctx.fillStyle = scoreToColor(score, alpha)
            ctx.fillRect(x, y, stepX + 1, stepY + 1)
          }
        }
        ctx.globalAlpha = 1.0
      }
    }

    // ====== 等值线渲染 ======
    // 在分析阶段始终显示，在综合阶段只有viewMode='heatmap'时显示
    const shouldShowContours = showContours && scoreData && scoreData.contours && (
      activeTab === 'analysis' ||
      (activeTab === 'synthesis' && viewMode === 'heatmap')
    );

    if (shouldShowContours) {
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
    // 只要有设计数据且在综合阶段，就显示（viewMode='design'时不显示热力图，viewMode='heatmap'时叠加热力图）
    if (frameRef.current % 100 === 0) {
      console.log('[渲染调试] showDesign:', showDesign, 'designData:', !!designData, 'activeTab:', activeTab);
      if (designData) {
        console.log('[渲染调试] roadways:', designData.roadways?.length, 'panels:', designData.panels?.length);
        if (designData.panels && designData.panels.length > 0) {
          const p = designData.panels[0];
          console.log('[渲染调试] 第一个工作面:', p.id, 'points:', p.points?.length, 'x:', p.x?.toFixed(0), 'y:', p.y?.toFixed(0));
        }
      }
    }

    if (showDesign && designData && activeTab === 'synthesis') {
      console.log('[渲染调试] 开始渲染设计方案');
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
      const drawDoubleLineRoadway = (path, width, color, isMain = false, isDashed = false) => {
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
        ctx.lineWidth = isMain ? 2.5 / scale : (isDashed ? 2 / scale : 1.5 / scale);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // 设置虚线样式（回风巷道使用虚线）
        if (isDashed) {
          ctx.setLineDash([10/scale, 5/scale]);
        } else {
          ctx.setLineDash([]);
        }

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
        ctx.setLineDash([]); // 重置虚线

        // 绘制端部封闭线（可选，在交叉口处不封闭更好看）
        // ctx.beginPath();
        // ctx.moveTo(leftPoints[0].x, leftPoints[0].y);
        // ctx.lineTo(rightPoints[0].x, rightPoints[0].y);
        // ctx.stroke();
      };

      // 调试：打印所有巷道信息
      if (frameRef.current % 100 === 0) {
        console.log('[巷道调试] 总数:', roadways.length);
        roadways.forEach((r, i) => {
          console.log(`[巷道${i}] id:${r.id} type:${r.type} path:${r.path?.length} points:`, r.path);
        });
      }

      roadways.forEach(road => {
        if (road.path && road.path.length > 1) {
          const roadType = road.type || '';
          const isMain = roadType === 'main' || road.id?.startsWith('Main') || road.id?.startsWith('MR-');
          const isTransport = roadType === 'transport' || road.id?.startsWith('Transport');
          const isVentilation = roadType === 'ventilation' || roadType === 'return' || road.id?.startsWith('Ventilation');
          const isCut = roadType === 'cut' || road.id?.startsWith('Cut');

          // 调试输出
          if (isMain) {
            console.log('[主巷道]', road.id, road.type, '路径点数:', road.path.length);
          }

          // 颜色和宽度配置（符合CAD规范）
          let color, width, isDashed = false;
          if (isMain) {
            color = '#00ffff'; // 明亮的青色 - 主运输大巷
            width = roadwayWidths.main;
          } else if (isVentilation) {
            color = '#ff9933'; // 橙色 - 回风巷道
            width = roadwayWidths.ventilation;
            isDashed = true; // 回风巷道使用虚线
          } else if (isTransport) {
            color = '#66ff66'; // 明绿色 - 运输顺槽
            width = roadwayWidths.transport;
          } else if (isCut) {
            color = '#45b7d1'; // 蓝色 - 开切眼
            width = roadwayWidths.cut;
          } else {
            color = '#a8a8a8'; // 灰色 - 联络巷
            width = roadwayWidths.gate;
          }

          // 绘制双线巷道
          drawDoubleLineRoadway(road.path, width, color, isMain, isDashed);

          // 主大巷添加加粗的中心线和箭头标识
          if (isMain) {
            // 加粗中心线
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.5 / scale;
            ctx.setLineDash([12/scale, 6/scale]);
            ctx.lineDashOffset = -time * 2;
            ctx.shadowBlur = 15;
            ctx.shadowColor = color;
            ctx.beginPath();
            ctx.moveTo(road.path[0].x, road.path[0].y);
            road.path.forEach(p => ctx.lineTo(p.x, p.y));
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.shadowBlur = 0;

            // 在主巷道上绘制箭头标记（只有路径点数大于2时才绘制多个箭头）
            const arrowInterval = Math.max(1, Math.floor(road.path.length / 5));
            for (let i = arrowInterval; i < road.path.length && arrowInterval > 0; i += arrowInterval) {
              const p1 = road.path[i - 1];
              const p2 = road.path[i];
              const dx = p2.x - p1.x;
              const dy = p2.y - p1.y;
              const angle = Math.atan2(dy, dx);
              const arrowSize = 8 / scale;

              ctx.save();
              ctx.translate(p2.x, p2.y);
              ctx.rotate(angle);
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.moveTo(0, 0);
              ctx.lineTo(-arrowSize, -arrowSize/2);
              ctx.lineTo(-arrowSize, arrowSize/2);
              ctx.closePath();
              ctx.fill();
              ctx.restore();
            }
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
      // 调试：打印工作面数据
      if (frameRef.current % 100 === 0) {
        console.log('[工作面调试] 总数:', workfaceList.length);
        workfaceList.forEach((wf, i) => {
          console.log(`[工作面${i}] id:${wf.id} center:(${wf.center_x?.toFixed(0)}, ${wf.center_y?.toFixed(0)}) points:${wf.points?.length}`);
        });
      }
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
              // 重新创建工作面路径用于裁剪
              ctx.beginPath();
              ctx.moveTo(face.points[0].x, face.points[0].y);
              face.points.forEach(p => ctx.lineTo(p.x, p.y));
              ctx.closePath();
              ctx.clip(); // 裁剪到工作面区域内

              // 计算工作面边界
              const minX = Math.min(...face.points.map(p => p.x));
              const maxX = Math.max(...face.points.map(p => p.x));
              const minY = Math.min(...face.points.map(p => p.y));
              const maxY = Math.max(...face.points.map(p => p.y));

              // 绘制斜线填充（带安全边界保护）
              ctx.strokeStyle = isInvalid ? 'rgba(239, 68, 68, 0.4)' : 'rgba(255, 255, 255, 0.25)';
              ctx.lineWidth = 0.8 / scale;
              const spacing = Math.max(1, 12 / scale); // 斜线间距，确保最小为1避免无限循环
              const maxIterations = 10000; // 安全迭代上限
              let iterations = 0;

              for (let i = minX - (maxY - minY); i < maxX + (maxY - minY) && iterations < maxIterations; i += spacing) {
                ctx.beginPath();
                ctx.moveTo(i, minY);
                ctx.lineTo(i + (maxY - minY), maxY);
                ctx.stroke();
                iterations++;
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
              const spacing = Math.max(1, 12 / scale); // 确保最小为1避免无限循环
              const maxIterations = 10000; // 安全迭代上限
              let iterations = 0;

              for (let i = x - h; i < x + w + h && iterations < maxIterations; i += spacing) {
                ctx.beginPath();
                ctx.moveTo(i, y);
                ctx.lineTo(i + h, y + h);
                ctx.stroke();
                iterations++;
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
    // 调试：每100帧打印一次边界信息
    if (frameRef.current % 100 === 0) {
      console.log(`[边界渲染] boundary.length=${boundary.length}, scale=${scale.toFixed(4)}, panOffset=(${panOffset.x.toFixed(0)}, ${panOffset.y.toFixed(0)})`);
      if (boundary.length > 0) {
        const xs = boundary.map(p => p.x);
        const ys = boundary.map(p => p.y);
        console.log(`[边界渲染] X范围: ${Math.min(...xs).toFixed(0)} - ${Math.max(...xs).toFixed(0)}, Y范围: ${Math.min(...ys).toFixed(0)} - ${Math.max(...ys).toFixed(0)}`);
      }
    }
    ctx.shadowBlur = 10
    ctx.shadowColor = '#0ea5e9'
    ctx.strokeStyle = '#0ea5e9'
    ctx.lineWidth = Math.max(2 / scale, 1)
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
        { color: '#00ffff', label: '主运输大巷', width: 5 },
        { color: '#66ff66', label: '运输顺槽', width: 4 },
        { color: '#ff9933', label: '回风顺槽', width: 4, dashed: true },
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
    // 使用requestAnimationFrame启动动画循环
    const startAnimation = () => {
      requestRef.current = requestAnimationFrame(animate);
    };
    startAnimation();
    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [boundary, boreholes, weights, activeTab, isLoading, scale, showGrid, panOffset, scoreData, designData, showHeatmap, showContours, showDesign, displayDimension, selectedBorehole, userEdits, tempRoadway, tempWorkface, isEditing, editMode, mousePos, viewMode, selectedWorkface])
  
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

  // DXF导出处理函数
  const handleExportDXF = async () => {
    try {
      addLog('正在导出 DXF 设计图纸...', 'loading');
      await api.exportDesignDXF();
      addLog('DXF 导出成功', 'success');
    } catch (e) {
      addLog('DXF 导出失败: ' + e.message, 'warning');
    }
  };

  // 重置所有数据处理函数
  const handleResetAll = () => {
    setBoundary([]);
    setBoreholes([]);
    setScoreData(null);
    setDesignData(null);
    setActiveTab('import');
    setSystemLog([]);
    addLog('系统已重置', 'warning');
    setSettingsOpen(false);
  };

  return (
  <div className="flex flex-col h-screen bg-gray-950 text-gray-100 font-sans overflow-hidden bg-cyber-grid selection:bg-blue-500/30">
    <GlobalStyles />

    <AppHeader
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      isLoading={isLoading}
      settingsOpen={settingsOpen}
      setSettingsOpen={setSettingsOpen}
      onExportReport={handleExportReport}
      onExportDXF={handleExportDXF}
      designData={designData}
    />

    {/* 设置面板 */}
    {settingsOpen && (
      <SettingsPanel
        onClose={() => setSettingsOpen(false)}
        showGrid={showGrid}
        setShowGrid={setShowGrid}
        showHeatmap={showHeatmap}
        setShowHeatmap={setShowHeatmap}
        showContours={showContours}
        setShowContours={setShowContours}
        showDesign={showDesign}
        setShowDesign={setShowDesign}
        viewMode={viewMode}
        setViewMode={setViewMode}
        displayDimension={displayDimension}
        setDisplayDimension={setDisplayDimension}
        designParams={designParams}
        setDesignParams={setDesignParams}
        scale={scale}
        setScale={setScale}
        onResetView={handleResetView}
        onResetAll={handleResetAll}
      />
    )}

    <main className="flex flex-1 overflow-hidden p-4 gap-4">

    <LeftSidebar
      leftPanelMode={leftPanelMode}
      setLeftPanelMode={setLeftPanelMode}
      importMode={importMode}
      setImportMode={setImportMode}
      boundary={boundary}
      boreholes={boreholes}
      weights={weights}
      setWeights={setWeights}
      isLoading={isLoading}
      handleImportBoundary={handleImportBoundary}
      handleImportBoreholes={handleImportBoreholes}
      handleGenerateDesign={handleGenerateDesign}
      handleFileUploadComplete={handleFileUploadComplete}
      addLog={addLog}
    />

    <CanvasSection
      canvasRef={canvasRef}
      scale={scale}
      mousePos={mousePos}
      isPanning={isPanning}
      isEditing={isEditing}
      isLoading={isLoading}
      boundary={boundary}
      handleCanvasMouseMove={handleCanvasMouseMove}
      handleCanvasMouseDown={handleCanvasMouseDown}
      handleCanvasMouseUp={handleCanvasMouseUp}
      handleCanvasClick={handleCanvasClick}
      handleCanvasDoubleClick={handleCanvasDoubleClick}
      showGrid={showGrid}
      setShowGrid={setShowGrid}
      searchOpen={searchOpen}
      setSearchOpen={setSearchOpen}
      editMode={editMode}
      toggleEditMode={toggleEditMode}
      userEdits={userEdits}
      clearUserEdits={clearUserEdits}
      handleZoomIn={handleZoomIn}
      handleZoomOut={handleZoomOut}
      handleResetView={handleResetView}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      filteredBoreholes={filteredBoreholes}
      setSelectedBorehole={setSelectedBorehole}
      setPanOffset={setPanOffset}
      addLog={addLog}
    />

    <RightPanel
      activeTab={activeTab}
      designData={designData}
      selectedWorkface={selectedWorkface}
      boreholes={boreholes}
      systemLog={systemLog}
    />
    </main>
  </div>
  );
};

export default MiningDesignSystem;