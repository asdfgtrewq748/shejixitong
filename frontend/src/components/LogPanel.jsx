import React from 'react';
import { Terminal } from 'lucide-react';

/**
 * 日志面板组件 - 显示系统操作日志
 */
const LogPanel = ({ logs = [] }) => {
  const colors = {
    info: 'text-gray-300 border-gray-600',
    success: 'text-green-400 border-green-600',
    warning: 'text-amber-400 border-amber-600',
    loading: 'text-blue-300 border-blue-600'
  };

  return (
    <div className="h-40 border-t border-gray-700/50 flex flex-col bg-black/20">
      <div className="px-4 py-2 border-b border-gray-700/30 bg-gray-900/30">
        <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
          <Terminal size={10} /> 后端日志
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-[10px] scroll-smooth">
        {logs.length === 0 && <span className="text-gray-600 animate-pulse">_ 等待输入...</span>}
        {logs.map((log, index) => {
          const [text, type] = log.split('|');
          const timeMatch = text.match(/^\[(.*?)\]/);
          return (
            <div key={index} className={`border-l-2 pl-2 py-1 mb-1 animate-[fadeIn_0.2s_ease-out] ${colors[type] || colors.info}`}>
              {timeMatch && <span className="opacity-50 mr-2">{timeMatch[0]}</span>}
              <span>{text.replace(/^\[.*?\]\s/, '')}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default LogPanel;
