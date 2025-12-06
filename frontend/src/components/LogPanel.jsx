import React from 'react';
import { Terminal, AlertCircle, CheckCircle, Zap } from 'lucide-react';

/**
 * 日志面板组件 - 显示系统操作日志
 */
const LogPanel = ({ logs = [] }) => {
  const getLogIcon = (type) => {
    switch (type) {
      case 'success':
        return <CheckCircle size={12} className="text-green-400" />;
      case 'warning':
        return <AlertCircle size={12} className="text-yellow-400" />;
      case 'loading':
        return <Zap size={12} className="text-blue-400 animate-pulse" />;
      default:
        return <Terminal size={12} className="text-gray-400" />;
    }
  };

  const getLogStyle = (type) => {
    switch (type) {
      case 'success':
        return 'text-green-300';
      case 'warning':
        return 'text-yellow-300';
      case 'loading':
        return 'text-blue-300';
      default:
        return 'text-gray-400';
    }
  };

  return (
    <div className="glass-panel rounded-xl p-3 h-36 overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 pb-2 border-b border-gray-700/50">
        <Terminal size={12} className="text-green-400" />
        <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">系统日志</span>
      </div>
      <div className="flex-1 overflow-y-auto space-y-1 py-2 font-mono text-[11px]">
        {logs.length === 0 ? (
          <div className="text-gray-500 text-center py-4">暂无日志</div>
        ) : (
          logs.map((log, i) => {
            const [content, type] = log.split('|');
            return (
              <div key={i} className={`flex items-start gap-2 ${getLogStyle(type)}`}>
                {getLogIcon(type)}
                <span className="flex-1 break-all">{content}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default LogPanel;
