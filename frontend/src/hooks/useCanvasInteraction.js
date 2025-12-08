import { useState, useRef, useCallback } from 'react';

/**
 * 画布交互 Hook - 管理缩放、平移、鼠标事件等
 */
const useCanvasInteraction = ({
  canvasRef,
  boundary,
  designData,
  activeTab,
  addLog
}) => {
  // 画布交互状态
  const [scale, setScale] = useState(1);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [viewInitialized, setViewInitialized] = useState(false);
  const lastPanPos = useRef({ x: 0, y: 0 });

  // 编辑模式状态
  const [isEditing, setIsEditing] = useState(false);
  const [editMode, setEditMode] = useState(null);
  const [tempRoadway, setTempRoadway] = useState(null);
  const [tempWorkface, setTempWorkface] = useState(null);
  const [userEdits, setUserEdits] = useState({ roadways: [], workfaces: [] });
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState(null);

  // 选择状态
  const [selectedWorkface, setSelectedWorkface] = useState(null);

  // 获取画布坐标
  const getCanvasCoords = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX / scale - panOffset.x);
    const y = Math.round((e.clientY - rect.top) * scaleY / scale - panOffset.y);
    return { x, y };
  }, [canvasRef, scale, panOffset]);

  // 鼠标移动
  const handleCanvasMouseMove = useCallback((e) => {
    const { x, y } = getCanvasCoords(e);
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
  }, [getCanvasCoords, isPanning, scale, isEditing, editMode, isDrawing, drawStart]);

  // 鼠标点击
  const handleCanvasClick = useCallback((e) => {
    if (isPanning || isEditing) return;

    const { x, y } = getCanvasCoords(e);

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
  }, [isPanning, isEditing, getCanvasCoords, designData, activeTab, addLog]);

  // 鼠标按下
  const handleCanvasMouseDown = useCallback((e) => {
    if (!isEditing) {
      // 非编辑模式：平移功能
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        setIsPanning(true);
        lastPanPos.current = { x: e.clientX, y: e.clientY };
        e.preventDefault();
      }
      return;
    }

    const { x, y } = getCanvasCoords(e);

    if (editMode === 'roadway') {
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
      setIsDrawing(true);
      setDrawStart({ x, y });
      setTempWorkface({ x, y, width: 0, height: 0 });
    }
  }, [isEditing, editMode, tempRoadway, getCanvasCoords, addLog]);

  // 鼠标抬起
  const handleCanvasMouseUp = useCallback(() => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }

    if (isEditing && editMode === 'workface' && isDrawing) {
      setIsDrawing(false);
      if (tempWorkface && (Math.abs(tempWorkface.width) > 20 || Math.abs(tempWorkface.height) > 20)) {
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
  }, [isPanning, isEditing, editMode, isDrawing, tempWorkface, userEdits.workfaces.length, addLog]);

  // 双击完成巷道绘制
  const handleCanvasDoubleClick = useCallback(() => {
    if (isEditing && editMode === 'roadway' && tempRoadway && tempRoadway.path.length >= 2) {
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
    }
  }, [isEditing, editMode, tempRoadway, userEdits.roadways.length, addLog]);

  // 缩放控制
  const handleZoomIn = useCallback(() => setScale(prev => Math.min(4, prev * 1.25)), []);
  const handleZoomOut = useCallback(() => setScale(prev => Math.max(0.25, prev * 0.8)), []);

  // 重置视图
  const handleResetView = useCallback(() => {
    if (boundary.length > 0 && canvasRef.current) {
      const canvas = canvasRef.current;
      const canvasWidth = canvas.width || 900;
      const canvasHeight = canvas.height || 700;

      const xs = boundary.map(p => p.x);
      const ys = boundary.map(p => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const dataWidth = maxX - minX;
      const dataHeight = maxY - minY;

      const scaleX = (canvasWidth * 0.30) / dataWidth;
      const scaleY = (canvasHeight * 0.30) / dataHeight;
      const newScale = Math.min(scaleX, scaleY, 3);

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
  }, [boundary, canvasRef, addLog]);

  // 自动适配视图
  const initializeView = useCallback(() => {
    if (boundary.length > 0 && !viewInitialized && canvasRef.current) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const canvasWidth = rect.width || 900;
      const canvasHeight = rect.height || 700;

      const xs = boundary.map(p => p.x);
      const ys = boundary.map(p => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const dataWidth = maxX - minX;
      const dataHeight = maxY - minY;

      const scaleX = (canvasWidth * 0.70) / dataWidth;
      const scaleY = (canvasHeight * 0.70) / dataHeight;
      const newScale = Math.min(scaleX, scaleY, 3);

      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const offsetX = (canvasWidth / 2 / newScale) - centerX;
      const offsetY = (canvasHeight / 2 / newScale) - centerY;

      setScale(newScale);
      setPanOffset({ x: offsetX, y: offsetY });
      setViewInitialized(true);
      addLog(`视图已自动适配至采区范围`, 'success');
    }
  }, [boundary, viewInitialized, canvasRef, addLog]);

  // 编辑模式控制
  const toggleEditMode = useCallback((mode) => {
    if (isEditing && editMode === mode) {
      setIsEditing(false);
      setEditMode(null);
      setTempRoadway(null);
      setTempWorkface(null);
      addLog('已退出编辑模式', 'info');
    } else {
      setIsEditing(true);
      setEditMode(mode);
      setTempRoadway(null);
      setTempWorkface(null);
      if (mode === 'roadway') {
        addLog('进入巷道编辑模式：点击添加路径点，双击完成', 'info');
      } else if (mode === 'workface') {
        addLog('进入工作面编辑模式：拖拽绘制矩形', 'info');
      }
    }
  }, [isEditing, editMode, addLog]);

  // 清除用户编辑
  const clearUserEdits = useCallback(() => {
    setUserEdits({ roadways: [], workfaces: [] });
    addLog('已清除所有用户编辑', 'info');
  }, [addLog]);

  return {
    // 状态
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
    // 事件处理
    handleCanvasMouseMove,
    handleCanvasClick,
    handleCanvasMouseDown,
    handleCanvasMouseUp,
    handleCanvasDoubleClick,
    // 控制函数
    handleZoomIn,
    handleZoomOut,
    handleResetView,
    initializeView,
    toggleEditMode,
    clearUserEdits,
  };
};

export default useCanvasInteraction;
