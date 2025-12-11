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
import { useCanvasInteraction, useDesignActions } from './hooks';
import { scoreToColor } from './utils';
import {
  renderGrid,
  renderHeatmap,
  shouldShowHeatmap,
  renderContours,
  shouldShowContours,
  renderRoadways,
  renderWorkfaces,
  renderBoreholes,
  renderBoundary,
  createBoundaryClipPath,
  renderScoreLegend,
  renderRoadwayLegend,
  renderUserEdits,
  renderTempElements,
  renderScanLine
} from './renderers';

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
  const [initialSuccession, setInitialSuccession] = useState(null); // 初始接续方案
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showContours, setShowContours] = useState(true);
  const [showDesign, setShowDesign] = useState(true);
  const [displayDimension, setDisplayDimension] = useState('composite'); // safety | economic | env | composite
  const [viewMode, setViewMode] = useState('design'); // 'design' | 'heatmap' - 视图模式

  // UI 面板状态
  const [showGrid, setShowGrid] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBorehole, setSelectedBorehole] = useState(null);
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

  // 使用画布交互 Hook
  const {
    scale,
    setScale,
    mousePos,
    panOffset,
    setPanOffset,
    isPanning,
    isEditing,
    editMode,
    tempRoadway,
    tempWorkface,
    userEdits,
    selectedWorkface,
    setSelectedWorkface,
    viewInitialized,
    setViewInitialized,
    handleCanvasMouseMove,
    handleCanvasClick,
    handleCanvasMouseDown,
    handleCanvasMouseUp,
    handleCanvasDoubleClick,
    handleZoomIn,
    handleZoomOut,
    handleResetView,
    initializeView,
    toggleEditMode,
    clearUserEdits,
  } = useCanvasInteraction({
    canvasRef,
    boundary,
    designData,
    activeTab,
    addLog
  });

  // 自动适配视图 - 当边界数据加载后调整视窗
  useEffect(() => {
    initializeView();
  }, [boundary, viewInitialized, initializeView]);

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

  // 使用业务逻辑 Hook
  const {
    handleExportReport,
    handleExportDXF,
    handleFileUploadComplete,
    handleImportBoundary,
    handleImportBoreholes,
    handleGenerateDesign,
    handleResetAll,
  } = useDesignActions({
    boundary,
    boreholes,
    weights,
    designParams,
    displayDimension,
    userEdits,
    activeTab,
    setBoundary,
    setBoreholes,
    setScoreData,
    setDesignData,
    setActiveTab,
    setLeftPanelMode,
    setIsLoading,
    setSystemLog,
    setSettingsOpen,
    setViewInitialized,
    setInitialSuccession,
    addLog
  });

  // 搜索钻孔
  const filteredBoreholes = boreholes.filter(b =>
    b.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

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

    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    // High DPI Support
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    // Only resize if dimensions changed
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    }

    const width = canvas.width / dpr;
    const height = canvas.height / dpr;

    // Reset transform and clear
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);

    frameRef.current += 1;
    const time = frameRef.current;

    // 应用缩放和平移变换
    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(panOffset.x, panOffset.y);

    // 网格绘制
    if (showGrid) {
      renderGrid(ctx, { scale, panOffset, width, height, time });
    }

    if (boundary.length === 0) {
      ctx.restore();
      requestRef.current = requestAnimationFrame(animate);
      return;
    }

    // 创建边界裁剪区域
    createBoundaryClipPath(ctx, boundary);

    // 热力图渲染
    if (shouldShowHeatmap({ showHeatmap, scoreData, activeTab, viewMode })) {
      renderHeatmap(ctx, { scoreData, displayDimension, viewMode });
    }

    // 等值线渲染
    if (shouldShowContours({ showContours, scoreData, activeTab, viewMode })) {
      renderContours(ctx, { scoreData, displayDimension, scale });
    }

    // 智能设计渲染 (巷道和工作面)
    if (showDesign && designData && activeTab === 'synthesis') {
      ctx.globalCompositeOperation = 'source-over';
      renderRoadways(ctx, { designData, scale, time });
      renderWorkfaces(ctx, { designData, scale, selectedWorkface });
    }

    ctx.restore(); // 恢复裁剪

    // 边界轮廓
    renderBoundary(ctx, { boundary, scale });

    // 钻孔点标记
    if (boreholes.length > 0) {
      renderBoreholes(ctx, { boreholes, selectedBorehole, scale });
    }

    // 扫描线动画
    if (isLoading || activeTab === 'analysis') {
      renderScanLine(ctx, { width, height, scale, panOffset, time });
    }

    ctx.restore(); // 恢复变换

    // 图例绘制 (不受变换影响)
    if (scoreData && (showHeatmap || showContours) && (activeTab === 'analysis' || activeTab === 'synthesis')) {
      renderScoreLegend(ctx, { width, height, displayDimension });
    }

    // 巷道图例
    if (designData && designData.roadways && designData.roadways.length > 0 && activeTab === 'synthesis') {
      renderRoadwayLegend(ctx, { width, height });
    }

    // 用户自定义元素
    renderUserEdits(ctx, { userEdits, scale });

    // 临时绘制元素
    renderTempElements(ctx, { isEditing, tempRoadway, tempWorkface, mousePos, scale });

    requestRef.current = requestAnimationFrame(animate);
  };

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
      initialSuccession={initialSuccession}
    />
    </main>
  </div>
  );
};

export default MiningDesignSystem;