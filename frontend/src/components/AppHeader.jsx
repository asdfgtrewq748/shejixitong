import React from 'react';
import { Cpu, Upload, Activity, Map as MapIcon, Settings, Save, FolderOpen } from 'lucide-react';

/**
 * 应用顶部导航栏组件
 */
const AppHeader = ({
  activeTab,
  setActiveTab,
  isLoading,
  settingsOpen,
  setSettingsOpen,
  onExportReport,
  onExportDXF,
  designData,
}) => {
  const tabs = [
    { key: 'import', label: '数据源', icon: Upload },
    { key: 'analysis', label: '地质算力', icon: Activity },
    { key: 'synthesis', label: '工程决策', icon: MapIcon },
  ];

  return (
    <header className="glass-panel z-50 flex items-center justify-between px-6 py-3 mx-4 mt-4 rounded-xl">
      {/* Logo区域 */}
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

      {/* Tab切换 */}
      <div className="flex bg-gray-900/50 p-1 rounded-full border border-gray-700 backdrop-blur-sm">
        {tabs.map(({ key, label, icon: Icon }) => {
          const isActive = activeTab === key;
          return (
            <button
              key={key}
              onClick={() => !isLoading && setActiveTab(key)}
              className={`
                relative flex items-center gap-2 px-6 py-2 rounded-full text-xs font-bold transition-all duration-300
                ${isActive ? 'text-white bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.5)]' : 'text-gray-500 hover:text-gray-300'}
              `}
            >
              <Icon size={14} />
              {label}
            </button>
          );
        })}
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-3">
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          className={`p-2.5 hover:bg-white/10 rounded-lg transition-colors border hover:border-gray-600 ${settingsOpen ? 'text-blue-400 border-blue-500/50' : 'text-gray-400 border-transparent'}`}
        >
          <Settings size={18} />
        </button>
        <button
          onClick={onExportReport}
          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-lg shadow-emerald-900/20 border border-emerald-400/20 transition-all hover:scale-105"
        >
          <Save size={14} /> 导出报告
        </button>
        <button
          onClick={onExportDXF}
          disabled={!designData}
          className={`flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-lg shadow-blue-900/20 border border-blue-400/20 transition-all hover:scale-105 ${!designData ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <FolderOpen size={14} /> 导出 DXF
        </button>
      </div>
    </header>
  );
};

export default AppHeader;
