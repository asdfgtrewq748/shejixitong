/**
 * 全局样式组件 - 定义系统级CSS样式
 */
const GlobalStyles = () => (
  <style>{`
    @keyframes scanline {
      0% { transform: translateY(-100%); }
      100% { transform: translateY(100%); }
    }
    @keyframes grid-move {
      0% { background-position: 0 0; }
      100% { background-position: 50px 50px; }
    }
    .bg-cyber-grid {
      background-image: linear-gradient(rgba(30, 58, 138, 0.1) 1px, transparent 1px),
      linear-gradient(90deg, rgba(30, 58, 138, 0.1) 1px, transparent 1px);
      background-size: 30px 30px;
    }
    .glass-panel {
      background: rgba(17, 24, 39, 0.7);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: 0 4px 30px rgba(0, 0, 0, 0.3);
    }
    .neon-border {
      box-shadow: 0 0 5px rgba(59, 130, 246, 0.5), inset 0 0 10px rgba(59, 130, 246, 0.1);
    }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: #0f172a; }
    ::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #475569; }
  `}</style>
);

export default GlobalStyles;
