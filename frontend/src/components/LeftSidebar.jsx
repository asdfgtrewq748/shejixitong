import React from 'react';
import {
  Upload, Database, Activity, ShieldCheck, DollarSign, Leaf,
  Settings, Play, CheckCircle, Box
} from 'lucide-react';
import FileUploader from '../FileUploader';
import GeoModelPreview from './GeoModelPreview';

/**
 * 左侧边栏组件 - 包含数据导入和地质建模功能
 */
const LeftSidebar = ({
  leftPanelMode,
  setLeftPanelMode,
  importMode,
  setImportMode,
  boundary,
  boreholes,
  weights,
  setWeights,
  isLoading,
  handleImportBoundary,
  handleImportBoreholes,
  handleGenerateDesign,
  handleFileUploadComplete,
  addLog,
}) => {
  return (
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
  );
};

export default LeftSidebar;
