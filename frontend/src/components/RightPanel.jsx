import React, { useState } from 'react';
import {
  Cpu, BarChart3, ShieldCheck, Wind, Hammer, Layers, ChevronDown, ChevronUp
} from 'lucide-react';
import LogPanel from './LogPanel';
import SuccessionPanel from './SuccessionPanel';

/**
 * 右侧面板组件 - 包含设计结果统计和日志
 */
const RightPanel = ({
  activeTab,
  designData,
  selectedWorkface,
  boreholes,
  systemLog,
  initialSuccession,
}) => {
  const [showSuccession, setShowSuccession] = useState(false);

  return (
    <aside className="w-80 glass-panel rounded-xl flex flex-col overflow-hidden animate-[slideInRight_0.5s_ease-out]">
      {/* 设计依据 & 预计指标 (条件渲染) */}
      {activeTab === 'synthesis' && designData && (
        <div className="flex-1 flex flex-col overflow-y-auto">
          <div className="border-b border-gray-700/50 bg-gray-900/20 p-4 shrink-0">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
              <Cpu size={14} className="text-purple-400"/> 设计依据
            </h4>

            {/* Selected Workface Details */}
            {selectedWorkface ? (
              <div className="bg-purple-900/20 border border-purple-500/30 rounded-lg p-3 mb-3 animate-pulse-once">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-purple-300 font-bold text-sm">{selectedWorkface.id}</span>
                  <span className="text-xs bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded">已选中</span>
                </div>
                <div className="space-y-1 text-xs text-gray-300">
                  <div className="flex justify-between"><span>推进长度:</span> <span className="font-mono">{selectedWorkface.width?.toFixed(0)}m</span></div>
                  <div className="flex justify-between"><span>工作面长度:</span> <span className="font-mono">{selectedWorkface.length?.toFixed(0)}m</span></div>
                  <div className="flex justify-between"><span>面积:</span> <span className="font-mono">{selectedWorkface.area?.toFixed(0)}m²</span></div>
                  <div className="flex justify-between"><span>评分:</span> <span className="font-mono text-green-400">{selectedWorkface.avgScore?.toFixed(1)}</span></div>
                </div>
              </div>
            ) : (
              <div className="text-[10px] text-gray-500 italic mb-3 text-center border border-dashed border-gray-700 rounded p-2">
                点击工作面查看详情
              </div>
            )}

            {/* General Design Params */}
            <div className="space-y-2 text-[10px]">
              <div className="flex justify-between items-center border-b border-gray-800 pb-1">
                <span className="text-gray-400">开采方式</span>
                <span className="text-white font-mono">{designData.stats?.miningMethod || 'N/A'}</span>
              </div>
              <div className="flex justify-between items-center border-b border-gray-800 pb-1">
                <span className="text-gray-400">布置方向</span>
                <span className="text-white font-mono uppercase">{designData.stats?.layoutDirection || 'N/A'}</span>
              </div>
              <div className="flex justify-between items-center border-b border-gray-800 pb-1">
                <span className="text-gray-400">工作面数量</span>
                <span className="text-white font-mono">{designData.stats?.count || 0} 个</span>
              </div>
              <div className="flex justify-between items-center border-b border-gray-800 pb-1">
                <span className="text-gray-400">平均长度</span>
                <span className="text-white font-mono">{designData.stats?.avgFaceLength?.toFixed(0) || 0}m</span>
              </div>
              <div className="flex justify-between items-center border-b border-gray-800 pb-1">
                <span className="text-gray-400">区段煤柱</span>
                <span className="text-amber-300 font-mono">{designData.designParams?.pillarWidth}m</span>
              </div>
               <div className="flex justify-between items-center border-b border-gray-800 pb-1">
                <span className="text-gray-400">推进长度</span>
                <span className="text-blue-300 font-mono">{designData.designParams?.workfaceWidth}m</span>
              </div>
            </div>
          </div>

          <div className="flex-1 border-b border-gray-700/50 bg-gradient-to-t from-blue-900/20 to-transparent p-4 flex flex-col">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <BarChart3 size={14} className="text-blue-400"/> 设计指标
            </h4>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-gray-800/50 p-3 rounded-lg border border-gray-700 hover:border-blue-500/50 transition-colors group">
                <div className="text-[10px] text-gray-400 uppercase mb-1">平均评分</div>
                <div className="text-2xl font-black text-white group-hover:text-blue-400 transition-colors">{designData.stats?.avgScore?.toFixed(1) || 0}</div>
              </div>
              <div className="bg-gray-800/50 p-3 rounded-lg border border-gray-700 hover:border-amber-500/50 transition-colors group">
                <div className="text-[10px] text-gray-400 uppercase mb-1 flex items-center gap-1"><Hammer size={10}/> 有效工作面</div>
                <div className="text-xl font-bold text-white group-hover:text-amber-400 transition-colors">{designData.stats?.validCount || 0}<span className="text-xs ml-0.5 opacity-50">个</span></div>
              </div>
              <div className="bg-gray-800/50 p-3 rounded-lg border border-gray-700 hover:border-emerald-500/50 transition-colors group">
                <div className="text-[10px] text-gray-400 uppercase mb-1 flex items-center gap-1"><ShieldCheck size={10}/> 合规率</div>
                <div className="text-xl font-bold text-emerald-400">
                  {designData.stats?.count > 0 ? Math.round((designData.stats?.validCount || 0) / designData.stats?.count * 100) : 0}%
                </div>
              </div>
              <div className="bg-gray-800/50 p-3 rounded-lg border border-gray-700 hover:border-purple-500/50 transition-colors group">
                <div className="text-[10px] text-gray-400 uppercase mb-1 flex items-center gap-1"><Wind size={10}/> 巷道数</div>
                <div className="text-xl font-bold text-gray-200 group-hover:text-purple-400">{designData.roadways?.length || 0}</div>
              </div>
            </div>

            {/* 智能评价 (填充剩余空间) */}
            <div className="mt-auto pt-4 border-t border-gray-700/30">
               <h5 className="text-[10px] font-bold text-gray-400 uppercase mb-3 flex items-center gap-2">
                 <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></div> 智能评价
               </h5>

               <div className="space-y-3">
                 {/* 综合建议 */}
                 <div className="text-xs text-gray-300 leading-relaxed bg-gray-800/30 p-3 rounded border border-gray-700/50">
                    {designData.stats?.avgScore >= 80 ? (
                      <span className="text-emerald-300">设计方案优秀。各项指标均衡，资源回收率高，建议按此方案实施。</span>
                    ) : designData.stats?.avgScore >= 60 ? (
                      <span className="text-blue-300">设计方案良好。符合基本规范，建议进一步优化工作面长度以提升评分。</span>
                    ) : (
                      <span className="text-amber-400">设计方案有待改进。建议调整开采方向或减少无效区域。</span>
                    )}
                 </div>

                 {/* 关键指标进度条 */}
                 <div className="space-y-2">
                    <div className="flex justify-between text-[9px] text-gray-400 mb-0.5">
                      <span>资源回收率</span>
                      <span className="text-emerald-400 font-mono">
                        {designData.stats?.count > 0 ? Math.round((designData.stats?.validCount || 0) / designData.stats?.count * 95) : 0}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all duration-1000"
                        style={{width: `${designData.stats?.count > 0 ? Math.round((designData.stats?.validCount || 0) / designData.stats?.count * 95) : 0}%`}}
                      ></div>
                    </div>

                    <div className="flex justify-between text-[9px] text-gray-400 mb-0.5 mt-2">
                      <span>安全系数</span>
                      <span className="text-blue-400 font-mono">9.2</span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full w-[92%]"></div>
                    </div>
                 </div>

                 {/* 优化建议列表 */}
                 <div className="bg-gray-800/20 p-2 rounded border border-gray-700/30">
                    <div className="text-[9px] text-gray-500 mb-1 uppercase">优化建议</div>
                    <ul className="space-y-1">
                      <li className="text-[10px] text-gray-400 flex items-start gap-1.5">
                        <span className="text-blue-500 mt-0.5">•</span>
                        <span>建议增加工作面长度以提高单产</span>
                      </li>
                      <li className="text-[10px] text-gray-400 flex items-start gap-1.5">
                        <span className="text-blue-500 mt-0.5">•</span>
                        <span>注意 {designData.designParams?.pillarWidth}m 煤柱区域的应力集中</span>
                      </li>
                    </ul>
                 </div>

                 {/* 接续优化入口 */}
                 <button
                   onClick={() => setShowSuccession(!showSuccession)}
                   className="w-full mt-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white py-2 px-3 rounded-lg flex items-center justify-between text-xs font-medium transition-all"
                 >
                   <span className="flex items-center gap-2">
                     <Layers size={14} />
                     {initialSuccession ? '查看/优化接续方案' : '工作面接续优化'}
                   </span>
                   {showSuccession ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                 </button>
                 {/* 初始接续方案简要信息 */}
                 {initialSuccession && !showSuccession && (
                   <div className="mt-2 p-2 bg-green-900/20 border border-green-500/30 rounded text-[10px] text-green-300">
                     <div className="flex justify-between">
                       <span>初始方案已生成</span>
                       <span>工期: {initialSuccession.summary?.total_months || 0}月</span>
                     </div>
                   </div>
                 )}
               </div>
            </div>
          </div>

          {/* 接续优化面板 */}
          {showSuccession && (
            <div className="border-t border-gray-700/50 p-3">
              <SuccessionPanel
                panels={designData.panels || []}
                initialSuccession={initialSuccession}
                onClose={() => setShowSuccession(false)}
              />
            </div>
          )}
        </div>
      )}

      {/* 无设计数据时显示提示 */}
      {!(activeTab === 'synthesis' && designData) && (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full border-2 border-dashed border-gray-700 flex items-center justify-center">
              <BarChart3 size={28} className="text-gray-600" />
            </div>
            <h3 className="text-sm font-bold text-gray-400 mb-2">设计分析</h3>
            <p className="text-xs text-gray-500">
              {boreholes.length === 0
                ? '请先导入数据'
                : '点击"生成最优设计"查看设计结果'}
            </p>
          </div>
        </div>
      )}

      {/* 后端日志 */}
      <LogPanel logs={systemLog} />
    </aside>
  );
};

export default RightPanel;
