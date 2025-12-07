import React from 'react';
import { Crosshair, Maximize2, Cpu, Layers, Search } from 'lucide-react';
import CanvasToolbar from './CanvasToolbar';

/**
 * 画布区域组件 - 包含主画布、工具栏和搜索面板
 */
const CanvasSection = ({
  // Canvas refs and state
  canvasRef,
  scale,
  mousePos,
  isPanning,
  isEditing,
  isLoading,
  boundary,
  // Canvas event handlers
  handleCanvasMouseMove,
  handleCanvasMouseDown,
  handleCanvasMouseUp,
  handleCanvasClick,
  handleCanvasDoubleClick,
  // Toolbar props
  showGrid,
  setShowGrid,
  searchOpen,
  setSearchOpen,
  editMode,
  toggleEditMode,
  userEdits,
  clearUserEdits,
  handleZoomIn,
  handleZoomOut,
  handleResetView,
  // Search props
  searchQuery,
  setSearchQuery,
  filteredBoreholes,
  setSelectedBorehole,
  setPanOffset,
  addLog,
}) => {
  return (
    <section className="flex-1 relative flex flex-col rounded-xl overflow-hidden glass-panel border-gray-700/50 shadow-2xl">
      {/* 顶部状态栏 */}
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

      {/* 画布容器 */}
      <div className="relative flex-1 bg-gray-900 flex items-center justify-center overflow-hidden">
        {/* 背景网格 */}
        <div className="absolute inset-0 pointer-events-none opacity-20"
          style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '100px 100px' }}>
        </div>

        {/* 主画布 */}
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

        {/* 加载动画 */}
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

        {/* 空数据提示 */}
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

      {/* 画布工具栏 */}
      <CanvasToolbar
        showGrid={showGrid}
        setShowGrid={setShowGrid}
        searchOpen={searchOpen}
        setSearchOpen={setSearchOpen}
        isEditing={isEditing}
        editMode={editMode}
        toggleEditMode={toggleEditMode}
        userEdits={userEdits}
        clearUserEdits={clearUserEdits}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetView={handleResetView}
      />

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
  );
};

export default CanvasSection;
