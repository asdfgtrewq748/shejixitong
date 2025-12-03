import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import gsap from 'gsap';
import { Box, Layers, Eye, RotateCw, Maximize } from 'lucide-react';

const GeoModelPreview = () => {
  const containerRef = useRef(null);
  const [modelData, setModelData] = useState(null);
  const [selectedLayerId, setSelectedLayerId] = useState(2);
  const [opacity, setOpacity] = useState(0.8);
  const [wireframe, setWireframe] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  
  // Refs for Three.js objects
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const layerMeshesRef = useRef([]);
  const frameIdRef = useRef(null);
  const controlsRef = useRef({ isDragging: false, prevPos: { x: 0, y: 0 } });

  // 1. Fetch Data
  useEffect(() => {
    fetch('/model_data.json')
      .then(res => res.json())
      .then(data => {
        setModelData(data);
        if (data.standard_sequence.length > 0) {
          setSelectedLayerId(Math.floor(data.standard_sequence.length / 2));
        }
      })
      .catch(err => console.error("Failed to load model data:", err));
  }, []);

  // 2. IDW Interpolation
  const calculateIDW = (x, z, boreholes, layerKey, p = 2) => {
    let numerator = 0;
    let denominator = 0;
    
    for (let bh of boreholes) {
      // Simple distance check
      const dist = Math.sqrt((x - bh.x) ** 2 + (z - bh.y) ** 2);
      if (dist < 1.0) return bh.layers[layerKey] || 0; // Close enough
      
      const weight = 1 / Math.pow(dist, p);
      numerator += weight * (bh.layers[layerKey] || 0);
      denominator += weight;
    }
    
    return denominator === 0 ? 0 : numerator / denominator;
  };

  // 3. Initialize Scene & Build Model
  useEffect(() => {
    if (!containerRef.current || !modelData) return;

    // Cleanup previous scene
    if (rendererRef.current) {
      containerRef.current.innerHTML = '';
      rendererRef.current.dispose();
    }

    // Scene Setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
    camera.position.set(80, 60, 80);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xaaccff, 1.0);
    dirLight.position.set(50, 100, 50);
    scene.add(dirLight);

    // --- Build Geology Model ---
    const boreholes = modelData.boreholes;
    if (boreholes.length === 0) return;

    // Calculate Bounds
    const xs = boreholes.map(b => b.x);
    const ys = boreholes.map(b => b.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...ys);
    const maxZ = Math.max(...ys);
    
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const rangeX = maxX - minX;
    const rangeZ = maxZ - minZ;
    const maxRange = Math.max(rangeX, rangeZ);
    
    // Scale factor to fit in view (e.g., map 1000m to 50 units)
    const scale = 60 / maxRange; 
    const verticalScale = 2.0; // Exaggerate height

    // Grid Settings
    const gridRes = 30; // 30x30 grid
    const stepX = rangeX / gridRes;
    const stepZ = rangeZ / gridRes;

    const layersGroup = new THREE.Group();
    const meshes = [];

    // Base Elevation (Arbitrary start)
    let currentElevationGrid = new Array((gridRes + 1) * (gridRes + 1)).fill(-20); 

    modelData.standard_sequence.forEach((layerKey, layerIdx) => {
      // Skip empty layers if needed, but we want continuity
      
      // 1. Calculate Thickness Grid
      const thicknessGrid = [];
      for (let i = 0; i <= gridRes; i++) {
        for (let j = 0; j <= gridRes; j++) {
          const worldX = minX + i * stepX;
          const worldZ = minZ + j * stepZ;
          const thick = calculateIDW(worldX, worldZ, boreholes, layerKey);
          thicknessGrid.push(thick);
        }
      }

      // 2. Build Geometry
      // We build a "Block" for this layer. 
      // Top surface is currentElevation + thickness
      // Bottom surface is currentElevation
      
      const geometry = new THREE.BufferGeometry();
      const vertices = [];
      const indices = [];
      const colors = [];

      // Color based on type
      const isCoal = layerKey.includes('煤');
      const baseColor = isCoal 
        ? new THREE.Color(0x1a1a1a) // Black/Dark Grey for Coal
        : new THREE.Color().setHSL((layerIdx * 0.1) % 1, 0.4, 0.5); // Varied colors for rocks

      // Generate Vertices
      // Structure: [Top Grid Points] followed by [Bottom Grid Points]
      // Index k corresponds to grid point (i, j)
      
      const nextElevationGrid = [];

      for (let k = 0; k < currentElevationGrid.length; k++) {
        const i = Math.floor(k / (gridRes + 1));
        const j = k % (gridRes + 1);
        
        // Local Coordinates (Centered)
        const localX = ((minX + i * stepX) - centerX) * scale;
        const localZ = ((minZ + j * stepZ) - centerZ) * scale;
        
        const bottomY = currentElevationGrid[k];
        const thick = thicknessGrid[k] * verticalScale;
        const topY = bottomY + thick;
        
        nextElevationGrid.push(topY);

        // Top Vertex
        vertices.push(localX, topY, localZ);
        // Bottom Vertex
        vertices.push(localX, bottomY, localZ);
        
        // Colors (Simple vertex coloring)
        colors.push(baseColor.r, baseColor.g, baseColor.b);
        colors.push(baseColor.r * 0.6, baseColor.g * 0.6, baseColor.b * 0.6); // Darker bottom
      }

      // Generate Indices (Triangles)
      const rowSize = gridRes + 1;
      
      for (let i = 0; i < gridRes; i++) {
        for (let j = 0; j < gridRes; j++) {
          const a = i * rowSize + j;
          const b = i * rowSize + (j + 1);
          const c = (i + 1) * rowSize + j;
          const d = (i + 1) * rowSize + (j + 1);

          // Top Surface (Clockwise)
          // Vertices are at indices 2*k (Top) and 2*k+1 (Bottom)
          const tA = 2 * a;
          const tB = 2 * b;
          const tC = 2 * c;
          const tD = 2 * d;

          // Top Face
          indices.push(tA, tC, tB);
          indices.push(tB, tC, tD);

          // Bottom Face (Counter-Clockwise)
          const bA = 2 * a + 1;
          const bB = 2 * b + 1;
          const bC = 2 * c + 1;
          const bD = 2 * d + 1;
          
          indices.push(bA, bB, bC);
          indices.push(bC, bB, bD); // Fixed winding

          // Side Walls (Only for boundary)
          if (i === 0) { // Left
             indices.push(tA, bA, tC); indices.push(bA, bC, tC);
          }
          if (i === gridRes - 1) { // Right
             indices.push(tB, tD, bB); indices.push(bB, tD, bD);
          }
          if (j === 0) { // Back
             indices.push(tA, tB, bA); indices.push(bA, tB, bB);
          }
          if (j === gridRes - 1) { // Front
             indices.push(tC, bC, tD); indices.push(bC, bD, tD);
          }
        }
      }

      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();

      const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.8,
        metalness: 0.1,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        wireframe: false
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData = { id: layerIdx, name: modelData.sequence_labels[layerIdx] };
      
      layersGroup.add(mesh);
      meshes.push(mesh);

      // Update elevation for next layer
      currentElevationGrid = nextElevationGrid;
    });

    scene.add(layersGroup);
    layerMeshesRef.current = meshes;

    // Grid Helper
    const gridHelper = new THREE.GridHelper(100, 20, 0x444444, 0x222222);
    gridHelper.position.y = -25;
    scene.add(gridHelper);

    // Animation Loop
    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);
      
      if (autoRotate && cameraRef.current) {
        const angle = 0.002;
        const x = cameraRef.current.position.x;
        const z = cameraRef.current.position.z;
        cameraRef.current.position.x = x * Math.cos(angle) - z * Math.sin(angle);
        cameraRef.current.position.z = x * Math.sin(angle) + z * Math.cos(angle);
        cameraRef.current.lookAt(0, 0, 0);
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
  }, [modelData]); // Re-run when data loads

  // Handle Interactions (Opacity, Selection)
  useEffect(() => {
    layerMeshesRef.current.forEach((mesh, idx) => {
      if (mesh.material) {
        mesh.material.wireframe = wireframe;
        
        if (idx === selectedLayerId) {
          gsap.to(mesh.material, { opacity: Math.min(opacity + 0.2, 1.0), duration: 0.3 });
          // Highlight color effect could be added here
        } else {
          // Dim others
          gsap.to(mesh.material, { opacity: 0.1, duration: 0.3 });
        }
      }
    });
  }, [selectedLayerId, opacity, wireframe]);

  // Mouse Controls (Simple Orbit)
  const handleMouseDown = (e) => {
    controlsRef.current.isDragging = true;
    controlsRef.current.prevPos = { x: e.clientX, y: e.clientY };
    setAutoRotate(false);
  };

  const handleMouseMove = (e) => {
    if (!controlsRef.current.isDragging || !cameraRef.current) return;
    
    const deltaX = e.clientX - controlsRef.current.prevPos.x;
    const deltaY = e.clientY - controlsRef.current.prevPos.y;
    
    // Rotate camera around 0,0,0
    // Simplified logic
    const camera = cameraRef.current;
    // ... (Orbit logic omitted for brevity, auto-rotate is main mode)
    
    controlsRef.current.prevPos = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = () => {
    controlsRef.current.isDragging = false;
  };

  if (!modelData) {
    return (
      <div className="flex items-center justify-center h-full text-blue-400 font-mono text-xs animate-pulse">
        LOADING GEOLOGY DATA...
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
      >
        {/* HUD Overlay */}
        <div className="absolute top-3 left-4 right-4 flex justify-between items-center z-10 pointer-events-none">
          <span className="text-[10px] font-bold tracking-widest text-blue-400/80">REAL-TIME MODEL</span>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
            <span className="text-[10px] text-green-500/80 font-bold">LIVE</span>
          </div>
        </div>
        
        {/* Tech Corners */}
        <div className="absolute top-0 left-0 w-2 h-2 border-t-2 border-l-2 border-blue-500/50"></div>
        <div className="absolute top-0 right-0 w-2 h-2 border-t-2 border-r-2 border-blue-500/50"></div>
        <div className="absolute bottom-0 left-0 w-2 h-2 border-b-2 border-l-2 border-blue-500/50"></div>
        <div className="absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 border-blue-500/50"></div>
      </div>

      {/* Controls Panel */}
      <div className="h-48 border-t border-gray-700/50 bg-gray-900/40 flex flex-col">
        <div className="px-3 py-2 border-b border-gray-700/50 flex justify-between items-center bg-gray-900/30">
          <h3 className="text-xs font-bold text-gray-200 flex items-center gap-2">
            <Layers size={12} className="text-blue-400"/> 地质分层 ({modelData.standard_sequence.length})
          </h3>
          <div className="flex gap-1">
             <button className="p-1 hover:bg-gray-800 rounded transition" title="Maximize">
                <Maximize size={10} className="text-gray-400"/>
             </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Layer List */}
          <div className="w-2/3 overflow-y-auto p-1 border-r border-gray-700/50 scrollbar-thin scrollbar-thumb-blue-900 scrollbar-track-transparent">
            {modelData.sequence_labels.map((label, idx) => (
              <div 
                key={idx}
                onClick={() => setSelectedLayerId(idx)}
                className={`
                  p-2 mb-1 rounded cursor-pointer transition text-xs border-l-2
                  ${selectedLayerId === idx 
                    ? 'bg-gradient-to-r from-blue-500/20 to-transparent border-blue-400 text-white' 
                    : 'border-transparent text-gray-400 hover:bg-gray-800'}
                `}
              >
                <div className="font-bold truncate">{label}</div>
                <div className="text-[9px] opacity-60">LAYER ID: {idx}</div>
              </div>
            ))}
          </div>

          {/* Sliders & Toggles */}
          <div className="w-1/3 p-2 flex flex-col justify-center gap-3 bg-gray-900/20">
            <div className="space-y-1">
              <label className="text-[9px] text-gray-500 uppercase flex justify-between">
                Opacity <span className="text-blue-400">{opacity.toFixed(1)}</span>
              </label>
              <input 
                type="range" 
                min="0.1" max="1" step="0.1" 
                value={opacity}
                onChange={(e) => setOpacity(parseFloat(e.target.value))}
                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-blue-400 [&::-webkit-slider-thumb]:rounded-full"
              />
            </div>
            
            <div className="flex items-center justify-between">
              <label className="text-[9px] text-gray-500 uppercase">Wireframe</label>
              <button 
                onClick={() => setWireframe(!wireframe)}
                className={`w-8 h-4 rounded-full relative transition-colors ${wireframe ? 'bg-blue-900' : 'bg-gray-700'}`}
              >
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${wireframe ? 'left-4.5 bg-blue-400 translate-x-0' : 'left-0.5'}`}></div>
              </button>
            </div>

            <div className="flex items-center justify-between">
              <label className="text-[9px] text-gray-500 uppercase">Spin</label>
              <button 
                onClick={() => setAutoRotate(!autoRotate)}
                className={`p-1 rounded transition ${autoRotate ? 'text-blue-400 bg-blue-900/30' : 'text-gray-500'}`}
              >
                <RotateCw size={12} className={autoRotate ? 'animate-spin' : ''}/>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GeoModelPreview;
