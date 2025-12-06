import React from 'react';
import { Settings } from 'lucide-react';

/**
 * 设置面板组件
 */
const SettingsPanel = ({
  onClose,
  // 显示选项
  showGrid, setShowGrid,
  showHeatmap, setShowHeatmap,
  showContours, setShowContours,
  showDesign, setShowDesign,
  // 视图模式
  viewMode, setViewMode,
  displayDimension, setDisplayDimension,
  // 设计参数
  designParams, setDesignParams,
  // 缩放
  scale, setScale,
  // 操作
  onResetView,
  onResetAll,
}) => {
  return (
    <div className="absolute top-20 right-8 z-50 glass-panel rounded-xl p-5 w-80 shadow-2xl border border-gray-700 max-h-[80vh] overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Settings size={16} className="text-blue-400" /> 系统设置
        </h3>
        <button onClick={onClose} className="text-gray-400 hover:text-white">
          <span className="text-lg">&times;</span>
        </button>
      </div>

      <div className="space-y-4">
        {/* 显示选项 */}
        <div className="space-y-2">
          <label className="text-xs text-gray-400 uppercase tracking-wider">显示选项</label>
          <div className="space-y-2">
            {[
              { label: '显示网格', checked: showGrid, onChange: setShowGrid },
              { label: '显示热力图', checked: showHeatmap, onChange: setShowHeatmap },
              { label: '显示等值线', checked: showContours, onChange: setShowContours },
              { label: '显示设计方案', checked: showDesign, onChange: setShowDesign },
            ].map(({ label, checked, onChange }) => (
              <label key={label} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => onChange(e.target.checked)}
                  className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-300">{label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* 视图模式切换 */}
        <div className="space-y-2">
          <label className="text-xs text-gray-400 uppercase tracking-wider">视图模式</label>
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('design')}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                viewMode === 'design'
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              设计方案
            </button>
            <button
              onClick={() => setViewMode('heatmap')}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                viewMode === 'heatmap'
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              评分热力图
            </button>
          </div>
        </div>

        {/* 分析维度 */}
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

        {/* 采矿规程参数 */}
        <div className="space-y-2">
          <label className="text-xs text-gray-400 uppercase tracking-wider">采矿规程参数</label>

          {/* 工作面长度范围 */}
          <div className="space-y-1">
            <label className="text-[10px] text-gray-500">工作面长度范围 (m)</label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                value={designParams.faceLengthMin}
                onChange={(e) => setDesignParams({ ...designParams, faceLengthMin: parseFloat(e.target.value) || 150 })}
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white"
                placeholder="最小"
              />
              <input
                type="number"
                value={designParams.faceLengthMax}
                onChange={(e) => setDesignParams({ ...designParams, faceLengthMax: parseFloat(e.target.value) || 300 })}
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white"
                placeholder="最大"
              />
            </div>
          </div>

          {/* 推进长度和煤柱宽度 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-gray-500">推进长度 (m)</label>
              <input
                type="number"
                value={designParams.faceWidth}
                onChange={(e) => setDesignParams({ ...designParams, faceWidth: parseFloat(e.target.value) || 200 })}
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-500">区段煤柱 (m)</label>
              <input
                type="number"
                value={designParams.pillarWidth}
                onChange={(e) => setDesignParams({ ...designParams, pillarWidth: parseFloat(e.target.value) || 20 })}
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
              onChange={(e) => setDesignParams({ ...designParams, boundaryMargin: parseFloat(e.target.value) || 30 })}
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white"
            />
          </div>

          {/* 布置方向 */}
          <div>
            <label className="text-[10px] text-gray-500">布置方向</label>
            <select
              value={designParams.layoutDirection}
              onChange={(e) => setDesignParams({ ...designParams, layoutDirection: e.target.value })}
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
                onChange={(e) => setDesignParams({ ...designParams, dipAngle: parseFloat(e.target.value) || 0 })}
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white"
                min="0" max="45" step="1"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-500">煤层倾向 (°)</label>
              <input
                type="number"
                value={designParams.dipDirection}
                onChange={(e) => setDesignParams({ ...designParams, dipDirection: parseFloat(e.target.value) || 0 })}
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white"
                min="0" max="360" step="1"
              />
            </div>
          </div>
        </div>

        {/* 缩放级别 */}
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

        {/* 操作按钮 */}
        <div className="pt-3 border-t border-gray-700 space-y-2">
          <button
            onClick={onResetView}
            className="w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors"
          >
            重置视图
          </button>
          <button
            onClick={onResetAll}
            className="w-full py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 text-sm rounded-lg transition-colors border border-red-800/50"
          >
            重置所有数据
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
