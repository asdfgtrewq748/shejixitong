import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import gsap from 'gsap';
import { Layers, Eye, RotateCw, RefreshCw } from 'lucide-react';
import * as api from '../api';

const GeoModelPreview = ({ data }) => {
  const containerRef = useRef(null);
  const [layerData, setLayerData] = useState(null);
  const [selectedCoalIdx, setSelectedCoalIdx] = useState(-1); // -1表示高亮全部煤层
  const [opacity, setOpacity] = useState(0.2); // 默认围岩透明
  const [autoRotate, setAutoRotate] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Refs for Three.js objects
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const layerMeshesRef = useRef([]);
  const coalMeshesRef = useRef([]); // 专门存储煤层mesh
  const frameIdRef = useRef(null);
  const controlsRef = useRef({ isDragging: false, prevPos: { x: 0, y: 0 } });
  const modelCenterYRef = useRef(0);

  // 岩层颜色配置 - 使用暖色调，与黑色煤层形成对比
  const LAYER_COLORS = {
    '煤': { color: 0x0a0a0a, emissive: 0x000000, name: '煤层' },
    '砂岩': { color: 0xe8d4a8, emissive: 0x4a4030, name: '砂岩' },
    '细砂岩': { color: 0xf0e0c0, emissive: 0x504535, name: '细砂岩' },
    '中砂岩': { color: 0xdcc090, emissive: 0x453520, name: '中砂岩' },
    '粗砂岩': { color: 0xc8a870, emissive: 0x403018, name: '粗砂岩' },
    '泥岩': { color: 0xb89878, emissive: 0x352818, name: '泥岩' },
    '粉砂岩': { color: 0xd8c8a8, emissive: 0x403828, name: '粉砂岩' },
    '页岩': { color: 0xa08870, emissive: 0x282018, name: '页岩' },
    '石灰岩': { color: 0xd0d0c0, emissive: 0x404038, name: '石灰岩' },
    '灰岩': { color: 0xc8c8b8, emissive: 0x383830, name: '灰岩' },
    '炭质泥岩': { color: 0x706050, emissive: 0x181410, name: '炭质泥岩' },
    '碳质泥岩': { color: 0x706050, emissive: 0x181410, name: '碳质泥岩' },
    '第四系': { color: 0xc8a878, emissive: 0x3a2818, name: '第四系' },
    '表土': { color: 0xb89060, emissive: 0x302010, name: '表土层' },
    'default': { color: 0xd0b890, emissive: 0x403020, name: '岩层' }
  };

  // 根据岩性名称获取颜色配置
  const getLayerColor = (layerName) => {
    const name = (layerName || '').toLowerCase();

    if (name.includes('煤') || name.includes('coal')) {
      return LAYER_COLORS['煤'];
    }

    for (const [key, value] of Object.entries(LAYER_COLORS)) {
      if (key !== 'default' && name.includes(key.toLowerCase())) {
        return value;
      }
    }

    if (name.includes('砂') && name.includes('细')) return LAYER_COLORS['细砂岩'];
    if (name.includes('砂') && name.includes('粗')) return LAYER_COLORS['粗砂岩'];
    if (name.includes('砂') && name.includes('粉')) return LAYER_COLORS['粉砂岩'];
    if (name.includes('砂')) return LAYER_COLORS['砂岩'];
    if (name.includes('泥') && (name.includes('炭') || name.includes('碳'))) return LAYER_COLORS['炭质泥岩'];
    if (name.includes('泥')) return LAYER_COLORS['泥岩'];
    if (name.includes('页')) return LAYER_COLORS['页岩'];
    if (name.includes('灰') || name.includes('lime')) return LAYER_COLORS['灰岩'];
    if (name.includes('第四') || name.includes('表土') || name.includes('土')) return LAYER_COLORS['第四系'];

    return LAYER_COLORS['default'];
  };

  // 加载分层数据
  useEffect(() => {
    const fetchLayerData = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.getBoreholeLayers();
        if (result && result.boreholes && result.boreholes.length > 0) {
          setLayerData(result);
          console.log(`加载了 ${result.count} 个钻孔的分层数据，共 ${result.total_layers} 层`);
        } else {
          setError('未获取到分层数据');
        }
      } catch (err) {
        console.error('获取分层数据失败:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (data && Array.isArray(data) && data.length > 0) {
      fetchLayerData();
    }
  }, [data]);

  // 构建3D模型
  useEffect(() => {
    if (!containerRef.current || !layerData || !layerData.boreholes) return;
    if (layerData.boreholes.length === 0) return;

    // Cleanup previous scene
    if (rendererRef.current) {
      containerRef.current.innerHTML = '';
      rendererRef.current.dispose();
    }

    // Scene Setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a15);
    sceneRef.current = scene;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    scene.add(dirLight);
    const dirLight2 = new THREE.DirectionalLight(0x6699cc, 0.4);
    dirLight2.position.set(-50, 50, -50);
    scene.add(dirLight2);

    // --- 构建地质模型 ---
    const boreholes = layerData.boreholes;

    // 计算坐标范围
    const xs = boreholes.map(b => b.x);
    const ys = boreholes.map(b => b.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    // 计算最大深度
    const maxDepth = Math.max(...boreholes.map(b => b.total_depth || 0));

    const rangeX = maxX - minX || 100;
    const rangeY = maxY - minY || 100;
    const maxRange = Math.max(rangeX, rangeY);

    // ========== 关键：XYZ比例调整 ==========
    // 目标：模型宽度约80，深度方向（Z轴在Three.js中是Y轴）要扁平
    // 整体放大1.2 * 1.1 = 1.32倍
    const modelScale = 1.32;
    const targetWidth = 80 * modelScale;
    const horizontalScale = targetWidth / maxRange;

    // 垂直方向比例：大幅缩小，让模型扁平
    // 深度方向目标高度约为宽度的 1/5 到 1/3
    const targetHeight = targetWidth * 0.2; // 目标高度为宽度的20%
    const verticalScale = targetHeight / maxDepth;

    console.log(`坐标范围: X[${minX.toFixed(0)}-${maxX.toFixed(0)}], Y[${minY.toFixed(0)}-${maxY.toFixed(0)}]`);
    console.log(`最大深度: ${maxDepth.toFixed(1)}m`);
    console.log(`比例: 水平=${horizontalScale.toFixed(4)}, 垂直=${verticalScale.toFixed(4)}`);

    const refBorehole = boreholes[0];
    const meshes = [];
    const coalMeshes = [];
    const layersGroup = new THREE.Group();

    // 从底部往上构建
    const reversedLayers = [...refBorehole.layers].reverse();

    reversedLayers.forEach((layer, layerIdx) => {
      const realLayerIdx = refBorehole.layers.length - 1 - layerIdx;
      const colorConfig = getLayerColor(layer.name);
      const isCoalLayer = layer.is_coal || layer.name.includes('煤');

      const layerWidth = rangeX * horizontalScale * 0.95;
      const layerLength = rangeY * horizontalScale * 0.95;
      const layerHeight = layer.thickness * verticalScale;

      // 煤层最小高度稍大一些，确保可见
      const minHeight = isCoalLayer ? 0.8 : 0.3;
      const actualHeight = Math.max(layerHeight, minHeight);

      const geometry = new THREE.BoxGeometry(layerWidth, actualHeight, layerLength);

      const layerTopDepth = layer.top_depth * verticalScale;
      const layerBottomDepth = layer.bottom_depth * verticalScale;
      const layerCenterY = -(layerTopDepth + layerBottomDepth) / 2;

      // Material - 煤层使用纯黑色，非煤层使用亮色调
      const material = new THREE.MeshStandardMaterial({
        color: isCoalLayer ? 0x000000 : colorConfig.color,  // 煤层纯黑
        emissive: isCoalLayer ? 0x000000 : colorConfig.emissive,
        emissiveIntensity: isCoalLayer ? 0 : 0.3,
        roughness: isCoalLayer ? 0.1 : 0.5,
        metalness: isCoalLayer ? 0.3 : 0.1,
        transparent: true,
        opacity: isCoalLayer ? 1.0 : 0.2, // 非煤层更透明
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(0, layerCenterY, 0);
      mesh.userData = {
        id: realLayerIdx,
        name: layer.name,
        thickness: layer.thickness,
        topDepth: layer.top_depth,
        bottomDepth: layer.bottom_depth,
        isCoal: isCoalLayer,
      };
      mesh.receiveShadow = true;
      mesh.castShadow = true;

      layersGroup.add(mesh);
      meshes.push(mesh);

      // 煤层特殊处理 - 不使用白色边框，通过颜色区分选中状态
      if (isCoalLayer) {
        // 只添加发光效果层用于选中时显示
        const glowGeo = new THREE.BoxGeometry(layerWidth + 0.8, actualHeight + 0.5, layerLength + 0.8);
        const glowMat = new THREE.MeshBasicMaterial({
          color: 0x00ff88, // 亮绿色光晕
          transparent: true,
          opacity: 0,  // 默认不显示，选中时显示
          side: THREE.BackSide
        });
        const glowMesh = new THREE.Mesh(glowGeo, glowMat);
        glowMesh.position.copy(mesh.position);
        layersGroup.add(glowMesh);
        mesh.userData.glowMesh = glowMesh;

        coalMeshes.push({
          mesh,
          index: realLayerIdx,
          name: layer.name,
          thickness: layer.thickness,
          topDepth: layer.top_depth,
          bottomDepth: layer.bottom_depth
        });
      }

      // 非煤层添加非常淡化的边线
      if (!isCoalLayer) {
        const lineGeo = new THREE.EdgesGeometry(geometry);
        const lineMat = new THREE.LineBasicMaterial({
          color: 0x333333,
          transparent: true,
          opacity: 0.1
        });
        const lineMesh = new THREE.LineSegments(lineGeo, lineMat);
        lineMesh.position.copy(mesh.position);
        layersGroup.add(lineMesh);
      }
    });

    scene.add(layersGroup);
    layerMeshesRef.current = meshes;
    coalMeshesRef.current = coalMeshes;

    // 计算模型中心Y
    const modelCenterY = -(maxDepth * verticalScale) / 2;
    modelCenterYRef.current = modelCenterY;

    // Grid Helper
    const gridHelper = new THREE.GridHelper(100, 20, 0x333355, 0x222233);
    gridHelper.position.y = -(maxDepth * verticalScale) - 2;
    scene.add(gridHelper);

    // Axes Helper
    const axesHelper = new THREE.AxesHelper(15);
    axesHelper.position.set(-45, modelCenterY, -45);
    scene.add(axesHelper);

    // 设置相机位置 - 斜上方俯视
    const cameraDistance = 120;
    camera.position.set(cameraDistance * 0.8, cameraDistance * 0.5, cameraDistance * 0.8);
    camera.lookAt(0, modelCenterY, 0);

    // Animation Loop
    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);

      if (autoRotate && cameraRef.current) {
        const angle = 0.003;
        const x = cameraRef.current.position.x;
        const z = cameraRef.current.position.z;
        cameraRef.current.position.x = x * Math.cos(angle) - z * Math.sin(angle);
        cameraRef.current.position.z = x * Math.sin(angle) + z * Math.cos(angle);
        cameraRef.current.lookAt(0, modelCenterYRef.current, 0);
      }

      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    return () => {
      cancelAnimationFrame(frameIdRef.current);
      if (rendererRef.current) rendererRef.current.dispose();
    };
  }, [layerData]);

  // 处理煤层选择高亮
  useEffect(() => {
    layerMeshesRef.current.forEach((mesh) => {
      if (mesh.material) {
        const isCoal = mesh.userData.isCoal;

        if (isCoal) {
          const isSelected = selectedCoalIdx === -1 || mesh.userData.id === selectedCoalIdx;

          if (isSelected) {
            // 选中的煤层：纯黑色，完全不透明
            mesh.material.color.setHex(0x000000);
            mesh.material.opacity = 1.0;
            mesh.material.emissive.setHex(0x050505);
            mesh.material.emissiveIntensity = 0.1;
          } else {
            // 未选中的煤层：深灰色，略透明，区分开
            mesh.material.color.setHex(0x3a3a3a);
            mesh.material.opacity = 0.6;
            mesh.material.emissive.setHex(0x000000);
            mesh.material.emissiveIntensity = 0;
          }

          mesh.visible = true;

          // 发光效果只在选中特定煤层时显示
          if (mesh.userData.glowMesh) {
            if (selectedCoalIdx !== -1 && mesh.userData.id === selectedCoalIdx) {
              mesh.userData.glowMesh.material.opacity = 0.25;
            } else {
              mesh.userData.glowMesh.material.opacity = 0;
            }
          }
        } else {
          // 非煤层使用透明度
          gsap.to(mesh.material, {
            opacity: opacity,
            duration: 0.3
          });
          mesh.visible = true;
        }
      }
    });
  }, [selectedCoalIdx, opacity]);

  // Mouse Controls
  const handleMouseDown = (e) => {
    controlsRef.current.isDragging = true;
    controlsRef.current.prevPos = { x: e.clientX, y: e.clientY };
    setAutoRotate(false);
  };

  const handleMouseMove = (e) => {
    if (!controlsRef.current.isDragging || !cameraRef.current) return;

    const deltaX = e.clientX - controlsRef.current.prevPos.x;
    const deltaY = e.clientY - controlsRef.current.prevPos.y;

    const camera = cameraRef.current;
    const radius = Math.sqrt(camera.position.x ** 2 + camera.position.z ** 2);

    const currentAngle = Math.atan2(camera.position.z, camera.position.x);
    const newAngle = currentAngle - deltaX * 0.01;

    camera.position.x = radius * Math.cos(newAngle);
    camera.position.z = radius * Math.sin(newAngle);
    camera.position.y = Math.max(10, Math.min(200, camera.position.y - deltaY * 0.5));

    camera.lookAt(0, modelCenterYRef.current, 0);

    controlsRef.current.prevPos = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = () => {
    controlsRef.current.isDragging = false;
  };

  const handleWheel = (e) => {
    if (!cameraRef.current) return;
    const camera = cameraRef.current;
    const zoomSpeed = 0.1;
    const factor = e.deltaY > 0 ? (1 + zoomSpeed) : (1 - zoomSpeed);

    camera.position.x *= factor;
    camera.position.y *= factor;
    camera.position.z *= factor;

    const dist = camera.position.length();
    if (dist < 40) {
      camera.position.normalize().multiplyScalar(40);
    } else if (dist > 300) {
      camera.position.normalize().multiplyScalar(300);
    }
  };

  // 刷新分层数据
  const refreshLayers = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getBoreholeLayers();
      if (result && result.boreholes) {
        setLayerData(result);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 获取煤层列表（只显示煤层）
  const allLayers = layerData?.boreholes?.[0]?.layers || [];
  const coalLayers = allLayers.filter(layer =>
    layer.is_coal || layer.name.includes('煤')
  ).map((layer, idx) => ({
    ...layer,
    coalIndex: idx,
    originalIndex: allLayers.findIndex(l => l === layer)
  }));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-blue-400 font-mono text-xs">
        <RefreshCw className="animate-spin mr-2" size={16} />
        加载分层数据...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 text-xs p-4">
        <p className="text-amber-400 mb-2">未能加载分层数据</p>
        <p className="text-gray-500 mb-3">{error}</p>
        <button
          onClick={refreshLayers}
          className="px-3 py-1 bg-blue-900/30 text-blue-400 rounded hover:bg-blue-900/50 transition"
        >
          重试
        </button>
      </div>
    );
  }

  if (!layerData) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 font-mono text-xs">
        等待数据加载...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full bg-gray-900/40 relative group">
      {/* 3D Viewport */}
      <div
        ref={containerRef}
        className="flex-1 w-full min-h-0 cursor-move relative"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        {/* HUD Overlay */}
        <div className="absolute top-3 left-4 right-4 flex justify-between items-center z-10 pointer-events-none">
          <span className="text-[10px] font-bold tracking-widest text-blue-400/80">
            地质剖面 ({allLayers.length}层 / {coalLayers.length}煤层)
          </span>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
            <span className="text-[10px] text-green-500/80 font-bold">3D</span>
          </div>
        </div>

        {/* 操作提示 */}
        <div className="absolute bottom-3 left-4 text-[9px] text-gray-500 pointer-events-none">
          滚轮缩放 | 拖拽旋转
        </div>

        {/* Tech Corners */}
        <div className="absolute top-0 left-0 w-2 h-2 border-t-2 border-l-2 border-blue-500/50"></div>
        <div className="absolute top-0 right-0 w-2 h-2 border-t-2 border-r-2 border-blue-500/50"></div>
        <div className="absolute bottom-0 left-0 w-2 h-2 border-b-2 border-l-2 border-blue-500/50"></div>
        <div className="absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 border-blue-500/50"></div>
      </div>

      {/* Controls Panel - 只显示煤层 */}
      <div className="h-48 border-t border-gray-700/50 bg-gray-900/40 flex flex-col">
        <div className="px-3 py-2 border-b border-gray-700/50 flex justify-between items-center bg-gray-900/30">
          <h3 className="text-xs font-bold text-gray-200 flex items-center gap-2">
            <Layers size={12} className="text-green-400"/>
            煤层 ({coalLayers.length})
          </h3>
          <div className="flex gap-1">
            <button
              onClick={refreshLayers}
              className="p-1 hover:bg-gray-800 rounded transition"
              title="刷新"
            >
              <RefreshCw size={10} className={`text-gray-400 ${loading ? 'animate-spin' : ''}`}/>
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Coal Layer List */}
          <div className="w-2/3 overflow-y-auto p-1 border-r border-gray-700/50">
            {/* 全部煤层选项 */}
            <div
              onClick={() => setSelectedCoalIdx(-1)}
              className={`
                p-2 mb-1 rounded cursor-pointer transition text-xs border-l-2
                ${selectedCoalIdx === -1
                  ? 'bg-gradient-to-r from-green-500/20 to-transparent border-green-400 text-white'
                  : 'border-transparent text-gray-400 hover:bg-gray-800'}
              `}
            >
              <div className="font-bold truncate flex items-center gap-2">
                <Eye size={10} /> 高亮全部煤层
              </div>
            </div>

            {coalLayers.map((layer, idx) => (
              <div
                key={idx}
                onClick={() => setSelectedCoalIdx(layer.originalIndex)}
                className={`
                  p-2 mb-1 rounded cursor-pointer transition text-xs border-l-2
                  ${selectedCoalIdx === layer.originalIndex
                    ? 'bg-gradient-to-r from-green-500/20 to-transparent border-green-400 text-white'
                    : 'border-transparent text-gray-400 hover:bg-gray-800'}
                `}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-sm flex-shrink-0 ${
                    selectedCoalIdx === layer.originalIndex || selectedCoalIdx === -1
                      ? 'bg-gray-900'
                      : 'bg-gray-500 opacity-60'
                  }`}></span>
                  <span className="font-bold truncate flex-1">{layer.name}</span>
                </div>
                <div className="text-[9px] opacity-60 ml-5 flex justify-between">
                  <span>厚度: {layer.thickness?.toFixed(2)}m</span>
                  <span>深度: {layer.top_depth?.toFixed(1)}m</span>
                </div>
              </div>
            ))}

            {coalLayers.length === 0 && (
              <div className="text-center text-gray-500 text-xs py-4">
                未识别到煤层
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="w-1/3 p-2 flex flex-col justify-start gap-2 bg-gray-900/20 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
            <div className="space-y-1 shrink-0">
              <label className="text-[9px] text-gray-500 uppercase flex justify-between">
                围岩透明度 <span className="text-blue-400">{opacity.toFixed(2)}</span>
              </label>
              <input
                type="range"
                min="0.05" max="0.5" step="0.05"
                value={opacity}
                onChange={(e) => setOpacity(parseFloat(e.target.value))}
                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between shrink-0">
              <label className="text-[9px] text-gray-500 uppercase">自动旋转</label>
              <button
                onClick={() => setAutoRotate(!autoRotate)}
                className={`p-1 rounded transition ${autoRotate ? 'text-blue-400 bg-blue-900/30' : 'text-gray-500'}`}
              >
                <RotateCw size={12} className={autoRotate ? 'animate-spin' : ''}/>
              </button>
            </div>

            {/* 图例 */}
            <div className="mt-1 pt-2 border-t border-gray-700/30 shrink-0">
              <div className="text-[8px] text-gray-500 uppercase mb-1">图例</div>
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-[9px]">
                  <span className="w-3 h-2 bg-black rounded-sm"></span>
                  <span className="text-white">选中煤层</span>
                </div>
                <div className="flex items-center gap-1 text-[9px]">
                  <span className="w-3 h-2 rounded-sm" style={{backgroundColor: '#3a3a3a'}}></span>
                  <span className="text-gray-400">未选中煤层</span>
                </div>
                <div className="flex items-center gap-1 text-[9px] text-gray-400">
                  <span className="w-3 h-2 rounded-sm" style={{backgroundColor: '#e8d4a8', opacity: 0.3}}></span>
                  围岩 (透明)
                </div>
              </div>
            </div>

            {/* 统计 */}
            {layerData && (
              <div className="mt-auto pt-2 border-t border-gray-700/30 text-[9px] text-gray-500 shrink-0">
                <div>总层数: {allLayers.length}</div>
                {layerData.is_mock && <div className="text-amber-500">* 模拟数据</div>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GeoModelPreview;
