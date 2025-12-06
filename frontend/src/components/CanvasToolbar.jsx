import React from 'react';
import { Grid, Search, Maximize2, Minimize2, Crosshair } from 'lucide-react';

/**
 * 画布工具栏组件 - 提供缩放、网格、编辑等功能
 */
const CanvasToolbar = ({
  showGrid,
  setShowGrid,
  searchOpen,
  setSearchOpen,
  isEditing,
  editMode,
  toggleEditMode,
  userEdits,
  clearUserEdits,
  onZoomIn,
  onZoomOut,
  onResetView,
}) => {
  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 bg-gray-900/90 backdrop-blur px-6 py-3 rounded-full border border-gray-700 shadow-2xl">
      <button
        onClick={() => setShowGrid(!showGrid)}
        className={`transition-colors ${showGrid ? 'text-blue-400' : 'text-gray-400 hover:text-white'}`}
        title="切换网格"
      >
        <Grid size={18} />
      </button>
      <button
        onClick={() => setSearchOpen(!searchOpen)}
        className={`transition-colors ${searchOpen ? 'text-blue-400' : 'text-gray-400 hover:text-white'}`}
        title="搜索钻孔"
      >
        <Search size={18} />
      </button>
      <div className="w-px h-6 bg-gray-700"></div>

      {/* 编辑模式按钮 */}
      <button
        onClick={() => toggleEditMode('roadway')}
        className={`flex items-center gap-2 px-3 py-1 rounded-full transition-colors ${
          isEditing && editMode === 'roadway'
            ? 'bg-blue-900/50 text-blue-400 border border-blue-500/50'
            : 'text-gray-400 hover:text-white hover:bg-gray-800'
        }`}
        title="绘制巷道"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6 L12 4 L20 6 L20 18 L12 20 L4 18 Z M4 6 L20 18 M20 6 L4 18"></path>
        </svg>
        <span className="text-xs font-bold">绘制巷道</span>
      </button>
      <button
        onClick={() => toggleEditMode('workface')}
        className={`flex items-center gap-2 px-3 py-1 rounded-full transition-colors ${
          isEditing && editMode === 'workface'
            ? 'bg-orange-900/50 text-orange-400 border border-orange-500/50'
            : 'text-gray-400 hover:text-white hover:bg-gray-800'
        }`}
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
        onClick={onZoomOut}
        className="text-gray-400 hover:text-white transition-colors"
        title="缩小"
      >
        <Minimize2 size={18} />
      </button>
      <button
        onClick={onZoomIn}
        className="text-gray-400 hover:text-white transition-colors"
        title="放大"
      >
        <Maximize2 size={18} />
      </button>
      <button
        onClick={onResetView}
        className="text-gray-400 hover:text-white transition-colors"
        title="一键复位视图"
      >
        <Crosshair size={18} />
      </button>
    </div>
  );
};

export default CanvasToolbar;
