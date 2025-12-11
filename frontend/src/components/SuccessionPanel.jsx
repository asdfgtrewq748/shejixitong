import React, { useState, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  RefreshCw,
  BarChart3,
  Calendar,
  Layers,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  Zap,
  FileText,
  ChevronDown,
  ChevronRight,
  Info,
  Shield,
  Target,
} from 'lucide-react';
import {
  quickOptimizeSuccession,
  startSuccessionTraining,
  getSuccessionTrainingStatus,
  compareSuccessionStrategies,
  generateDetailedPlan,
  trainWithAlgorithm,
  getAlgorithmInfo,
} from '../api';

/**
 * 工作面接续优化面板
 */
export default function SuccessionPanel({ panels = [], initialSuccession = null, onClose }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [strategy, setStrategy] = useState('greedy');
  const [trainingStatus, setTrainingStatus] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [activeTab, setActiveTab] = useState('current'); // current, quick, detailed, train, compare
  const [detailedPlan, setDetailedPlan] = useState(null);
  const [selectedWorkface, setSelectedWorkface] = useState(null);
  const [algorithm, setAlgorithm] = useState('ppo');
  const [expandedSections, setExpandedSections] = useState({});

  // 如果有初始方案，默认显示当前方案标签页
  useEffect(() => {
    if (initialSuccession) {
      setResult(initialSuccession);
      setActiveTab('current');
    }
  }, [initialSuccession]);

  // 转换panels数据格式
  const formatPanels = useCallback(() => {
    return panels.map((panel, index) => ({
      id: panel.id || `WF-${String(index + 1).padStart(2, '0')}`,
      length: panel.length || 200,
      width: panel.width || 1000,
      center_x: panel.center_x || panel.center?.[0] || 0,
      center_y: panel.center_y || panel.center?.[1] || 0,
      avgThickness: panel.avgThickness || 2.0,
      avgScore: panel.avgScore || 75,
    }));
  }, [panels]);

  // 快速优化
  const handleQuickOptimize = async () => {
    if (panels.length === 0) {
      setError('请先生成工作面设计');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const formattedPanels = formatPanels();
      const res = await quickOptimizeSuccession(formattedPanels, strategy);
      setResult(res);
    } catch (err) {
      setError(err.message || '优化失败');
    } finally {
      setLoading(false);
    }
  };

  // 开始训练
  const handleStartTraining = async () => {
    if (panels.length === 0) {
      setError('请先生成工作面设计');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const formattedPanels = formatPanels();
      await startSuccessionTraining(formattedPanels, {
        n_episodes: 500,
        monthly_target: 100000,
      });
      // 开始轮询训练状态
      pollTrainingStatus();
    } catch (err) {
      setError(err.message || '启动训练失败');
      setLoading(false);
    }
  };

  // 轮询训练状态
  const pollTrainingStatus = useCallback(async () => {
    try {
      const status = await getSuccessionTrainingStatus();
      setTrainingStatus(status);

      if (status.is_training) {
        setTimeout(pollTrainingStatus, 2000);
      } else {
        setLoading(false);
      }
    } catch (err) {
      console.error('获取训练状态失败:', err);
      setLoading(false);
    }
  }, []);

  // 比较策略
  const handleCompare = async () => {
    if (panels.length === 0) {
      setError('请先生成工作面设计');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const formattedPanels = formatPanels();
      const res = await compareSuccessionStrategies(formattedPanels);
      setComparison(res.comparison);
    } catch (err) {
      setError(err.message || '比较失败');
    } finally {
      setLoading(false);
    }
  };

  // 生成详细计划
  const handleDetailedPlan = async () => {
    if (panels.length === 0) {
      setError('请先生成工作面设计');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const formattedPanels = formatPanels();
      const res = await generateDetailedPlan(formattedPanels, {
        start_date: new Date().toISOString().split('T')[0],
      });
      setDetailedPlan(res.detailed_plan);
    } catch (err) {
      setError(err.message || '生成详细计划失败');
    } finally {
      setLoading(false);
    }
  };

  // 使用指定算法训练
  const handleAlgorithmTraining = async () => {
    if (panels.length === 0) {
      setError('请先生成工作面设计');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const formattedPanels = formatPanels();
      await trainWithAlgorithm(formattedPanels, algorithm, {
        n_episodes: 500,
        monthly_target: 100000,
      });
      pollTrainingStatus();
    } catch (err) {
      setError(err.message || '启动训练失败');
      setLoading(false);
    }
  };

  // 切换展开/折叠
  const toggleSection = (sectionId) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionId]: !prev[sectionId]
    }));
  };

  // 策略名称映射
  const strategyNames = {
    greedy: '贪心策略',
    sequential: '顺序策略',
    score_based: '评分优先',
  };

  // 算法名称映射
  const algorithmNames = {
    ppo: 'PPO (近端策略优化)',
    a2c: 'A2C (优势演员-评论家)',
    sac: 'SAC (软演员-评论家)',
    td3: 'TD3 (孪生延迟DDPG)',
  };

  return (
    <div className="w-full max-w-5xl mx-auto bg-gray-900/70 border border-gray-700 rounded-xl p-3 sm:p-4 text-white shadow-lg">
      <div className="flex items-start justify-between gap-2 mb-3 flex-wrap">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Layers className="w-4 h-4 text-blue-400" />
          工作面接续优化
        </h3>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors text-sm"
          >
            ×
          </button>
        )}
      </div>

      {/* 标签页 */}
      <div className="flex flex-wrap gap-1.5 mb-3 text-xs">
        {/* 当前方案标签 - 只有在有初始方案时显示 */}
        {initialSuccession && (
          <button
            onClick={() => setActiveTab('current')}
            className={`px-2 py-1 rounded flex items-center gap-1 transition-colors ${
              activeTab === 'current'
                ? 'bg-green-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            <CheckCircle className="w-3 h-3" />
            当前方案
          </button>
        )}
        <button
          onClick={() => setActiveTab('quick')}
          className={`px-2 py-1 rounded flex items-center gap-1 transition-colors ${
            activeTab === 'quick'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          <Zap className="w-3 h-3" />
          优化方案
        </button>
        <button
          onClick={() => setActiveTab('detailed')}
          className={`px-2 py-1 rounded flex items-center gap-1 transition-colors ${
            activeTab === 'detailed'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          <FileText className="w-3 h-3" />
          详细计划
        </button>
        <button
          onClick={() => setActiveTab('train')}
          className={`px-2 py-1 rounded flex items-center gap-1 transition-colors ${
            activeTab === 'train'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          <TrendingUp className="w-3 h-3" />
          RL训练
        </button>
        <button
          onClick={() => setActiveTab('compare')}
          className={`px-2 py-1 rounded flex items-center gap-1 transition-colors ${
            activeTab === 'compare'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          <BarChart3 className="w-3 h-3" />
          策略对比
        </button>
      </div>

      {/* 工作面信息 */}
      <div className="bg-gray-800/70 border border-gray-700 rounded-lg p-2 sm:p-3 mb-3">
        <div className="text-xs text-gray-400">当前工作面</div>
        <div className="text-sm font-semibold">
          {panels.length > 0 ? `${panels.length} 个工作面` : '未生成设计'}
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-900/50 border border-red-500 rounded p-2 mb-3 flex items-center gap-1.5 text-xs">
          <AlertTriangle className="w-4 h-4 text-red-400" />
          <span className="text-red-200">{error}</span>
        </div>
      )}

      {/* 当前方案面板 - 显示初始接续方案 */}
      {activeTab === 'current' && initialSuccession && (
        <div className="space-y-3">
          <div className="bg-green-900/20 border border-green-500/30 rounded-lg p-2 sm:p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <CheckCircle className="w-3.5 h-3.5 text-green-400" />
              <span className="text-xs font-medium text-green-300">初始接续方案 (顺序策略)</span>
            </div>
            <p className="text-[10px] text-gray-400 leading-relaxed">
              此方案在生成设计时自动创建，按工作面编号顺序安排开采。
              您可以切换到"优化方案"标签页选择其他策略进行优化。
            </p>
          </div>

          {/* 显示初始方案的结果 */}
          {initialSuccession && (
            <div className="bg-gray-900/60 border border-gray-700/80 rounded-xl p-3">
              <h4 className="text-xs font-medium mb-2 flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                当前方案详情
              </h4>

              {/* 汇总信息 */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="bg-gray-800/70 border border-gray-700 rounded p-2">
                  <div className="text-[10px] text-gray-400">总工期</div>
                  <div className="text-sm font-semibold">
                    {initialSuccession.summary?.total_months || 0} 月
                  </div>
                </div>
                <div className="bg-gray-800/70 border border-gray-700 rounded p-2">
                  <div className="text-[10px] text-gray-400">完成工作面</div>
                  <div className="text-sm font-semibold">
                    {initialSuccession.summary?.completed_workfaces || 0} / {initialSuccession.summary?.total_workfaces || 0}
                  </div>
                </div>
                <div className="bg-gray-800/70 border border-gray-700 rounded p-2">
                  <div className="text-[10px] text-gray-400">累计产量</div>
                  <div className="text-sm font-semibold">
                    {((initialSuccession.summary?.cumulative_production || 0) / 10000).toFixed(1)} 万吨
                  </div>
                </div>
              </div>

              {/* 甘特图 */}
              {initialSuccession.gantt_data && initialSuccession.gantt_data.length > 0 && (
                <div className="bg-gray-900/50 border border-gray-700 rounded p-2">
                  <div className="text-xs font-medium mb-1.5 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    接续时序图
                  </div>
                  <GanttChart data={initialSuccession.gantt_data} />
                </div>
              )}

              {/* 工作面时间表 */}
              {initialSuccession.plan?.workface_schedule && (
                <div className="mt-2">
                  <div className="text-xs font-medium mb-1.5">工作面时间表</div>
                  <div className="max-h-32 overflow-y-auto space-y-1 pr-1 scrollbar-thin scrollbar-thumb-gray-600">
                    {Object.entries(initialSuccession.plan.workface_schedule).map(([id, schedule]) => (
                      <div
                        key={id}
                        className="flex items-center justify-between bg-gray-800/70 border border-gray-700 rounded px-2 py-1.5 text-[10px]"
                      >
                        <span className="font-medium text-gray-200">{id}</span>
                        <div className="flex items-center gap-2 text-gray-400">
                          <span className="inline-flex items-center gap-0.5" title="准备开始时间">
                            <Clock className="w-2.5 h-2.5" />
                            准备: {schedule.prep_start ?? '-'}月
                          </span>
                          <span className="inline-flex items-center gap-0.5" title="回采开始时间">
                            <Play className="w-2.5 h-2.5" />
                            回采: {schedule.mining_start ?? '-'}月
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-medium border ${
                              schedule.status === '已采'
                                ? 'bg-green-900/60 text-green-300 border-green-700'
                                : schedule.status === '在采'
                                ? 'bg-blue-900/60 text-blue-300 border-blue-700'
                                : 'bg-gray-700 text-gray-300 border-gray-600'
                            }`}
                          >
                            {schedule.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 快速优化面板 */}
      {activeTab === 'quick' && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="block text-xs text-gray-400">选择策略</label>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition"
            >
              <option value="greedy">贪心策略 - 优先储量大的工作面</option>
              <option value="sequential">顺序策略 - 按编号顺序开采</option>
              <option value="score_based">评分优先 - 优先地质条件好的</option>
            </select>
          </div>

          <button
            onClick={handleQuickOptimize}
            disabled={loading || panels.length === 0}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white py-1.5 text-xs rounded flex items-center justify-center gap-1.5 shadow-sm transition-colors"
          >
            {loading ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                优化中...
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                开始优化
              </>
            )}
          </button>
        </div>
      )}

      {/* RL训练面板 */}
      {activeTab === 'train' && (
        <div className="space-y-3">
          <div className="bg-gray-800/70 border border-gray-700 rounded-lg p-2 sm:p-3">
            <div className="text-xs text-gray-400 mb-1.5">强化学习训练</div>
            <p className="text-[10px] text-gray-500 mb-2 leading-relaxed">
              使用PPO算法训练智能体，自动学习最优接续策略。
              训练需要一定时间，但能获得更好的优化效果。
            </p>

            {trainingStatus && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span>训练进度</span>
                  <span>{trainingStatus.progress?.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-gray-600 rounded-full h-1.5">
                  <div
                    className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
                    style={{ width: `${trainingStatus.progress || 0}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-gray-400">
                  <span>Episode: {trainingStatus.current_episode || 0}</span>
                  <span>最佳奖励: {trainingStatus.best_reward?.toFixed(2) || 0}</span>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={handleStartTraining}
            disabled={loading || panels.length === 0}
            className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white py-1.5 text-xs rounded flex items-center justify-center gap-1.5 shadow-sm transition-colors"
          >
            {loading ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                训练中...
              </>
            ) : (
              <>
                <TrendingUp className="w-3.5 h-3.5" />
                开始训练
              </>
            )}
          </button>
        </div>
      )}

      {/* 策略对比面板 */}
      {activeTab === 'compare' && (
        <div className="space-y-3">
          <button
            onClick={handleCompare}
            disabled={loading || panels.length === 0}
            className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white py-1.5 text-xs rounded flex items-center justify-center gap-1.5 shadow-sm transition-colors"
          >
            {loading ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                对比中...
              </>
            ) : (
              <>
                <BarChart3 className="w-3.5 h-3.5" />
                对比所有策略
              </>
            )}
          </button>

          {comparison && (
            <div className="space-y-2">
              {Object.entries(comparison).map(([key, value]) => (
                <div key={key} className="bg-gray-800/70 border border-gray-700 rounded-lg p-2">
                  <div className="text-xs font-medium mb-1.5 flex items-center justify-between">
                    <span>{strategyNames[key]}</span>
                    <span className="text-[10px] text-gray-400">Score: {value.summary?.score?.toFixed?.(1) || '--'}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 text-[10px]">
                    <div>
                      <span className="text-gray-400">总工期:</span>
                      <span className="ml-1">{value.summary.total_months} 月</span>
                    </div>
                    <div>
                      <span className="text-gray-400">完成:</span>
                      <span className="ml-1">
                        {value.summary.completed_workfaces}/{value.summary.total_workfaces}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400">累计产量:</span>
                      <span className="ml-1">
                        {(value.summary.cumulative_production / 10000).toFixed(1)} 万吨
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 详细计划面板 */}
      {activeTab === 'detailed' && (
        <div className="space-y-3">
          <div className="bg-gray-800/70 border border-gray-700 rounded-lg p-2 sm:p-3">
            <div className="text-xs text-gray-400 mb-1.5">详细接续计划</div>
            <p className="text-[10px] text-gray-500 mb-2 leading-relaxed">
              生成贴近现场的详细计划，包括工序分解、时间节点、日/周/月计划、关键路径分析、风险评估等。
              基于《煤矿安全规程》等标准。
            </p>
          </div>

          <button
            onClick={handleDetailedPlan}
            disabled={loading || panels.length === 0}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white py-1.5 text-xs rounded flex items-center justify-center gap-1.5 shadow-sm transition-colors"
          >
            {loading ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <FileText className="w-3.5 h-3.5" />
                生成详细计划
              </>
            )}
          </button>


          {/* 详细计划结果 */}
          {detailedPlan && (
            <DetailedPlanView
              plan={detailedPlan}
              expandedSections={expandedSections}
              toggleSection={toggleSection}
              selectedWorkface={selectedWorkface}
              setSelectedWorkface={setSelectedWorkface}
            />
          )}
        </div>
      )}

      {/* 优化结果 */}
      {result && (
        <div className="mt-4 bg-gray-900/60 border border-gray-700/80 rounded-lg p-3">
          <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
            <CheckCircle className="w-3.5 h-3.5 text-green-400" />
            优化结果
          </h4>

          {/* 汇总信息 */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="bg-gray-800/70 border border-gray-700 rounded px-2 py-1.5">
              <div className="text-[10px] text-gray-400">总工期</div>
              <div className="text-sm font-semibold">
                {result.summary?.total_months || 0} 月
              </div>
            </div>
            <div className="bg-gray-800/70 border border-gray-700 rounded px-2 py-1.5">
              <div className="text-[10px] text-gray-400">完成工作面</div>
              <div className="text-sm font-semibold">
                {result.summary?.completed_workfaces || 0}/{result.summary?.total_workfaces || 0}
              </div>
            </div>
            <div className="bg-gray-800/70 border border-gray-700 rounded px-2 py-1.5">
              <div className="text-[10px] text-gray-400">累计产量</div>
              <div className="text-sm font-semibold">
                {((result.summary?.cumulative_production || 0) / 10000).toFixed(1)} 万吨
              </div>
            </div>
          </div>

          {/* 甘特图 */}
          {result.gantt_data && result.gantt_data.length > 0 && (
            <div className="bg-gray-900/50 border border-gray-700 rounded p-2">
              <div className="text-xs font-medium mb-1.5 flex items-center gap-1.5">
                <Calendar className="w-3 h-3" />
                接续时序图
              </div>
              <GanttChart data={result.gantt_data} />
            </div>
          )}

          {/* 工作面时间表 */}
          {result.plan?.workface_schedule && (
            <div className="mt-2">
              <div className="text-xs font-medium mb-1.5">工作面时间表</div>
              <div className="max-h-32 overflow-y-auto space-y-1 pr-1 scrollbar-thin scrollbar-thumb-gray-600">
                {Object.entries(result.plan.workface_schedule).map(([id, schedule]) => (
                  <div
                    key={id}
                    className="flex items-center justify-between bg-gray-800/70 border border-gray-700 rounded px-2 py-1 text-[11px]"
                  >
                    <span className="font-medium text-gray-200">{id}</span>
                    <div className="flex items-center gap-2 text-gray-400">
                      <span className="inline-flex items-center gap-0.5" title="准备开始时间">
                        <Clock className="w-2.5 h-2.5" />
                        准备:{schedule.prep_start ?? '-'}月
                      </span>
                      <span className="inline-flex items-center gap-0.5" title="回采开始时间">
                        <Play className="w-2.5 h-2.5" />
                        回采:{schedule.mining_start ?? '-'}月
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                          schedule.status === '已采'
                            ? 'bg-green-900/60 text-green-300 border-green-700'
                            : schedule.status === '在采'
                            ? 'bg-blue-900/60 text-blue-300 border-blue-700'
                            : 'bg-gray-700 text-gray-300 border-gray-600'
                        }`}
                      >
                        {schedule.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 简单的甘特图组件 - 紧凑版
 */
function GanttChart({ data }) {
  if (!data || data.length === 0) return null;

  // 计算时间范围
  const minStart = Math.min(...data.map((d) => d.start));
  const maxEnd = Math.max(...data.map((d) => d.end));
  const totalMonths = maxEnd - minStart;

  // 按工作面分组
  const workfaces = [...new Set(data.map((d) => d.workface))];

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[400px] space-y-1">
        {/* 时间轴 */}
        <div className="flex mb-1 text-[10px] text-gray-500">
          <div className="w-16 flex-shrink-0" />
          <div className="flex-1 grid grid-cols-5 text-center">
            {[0, Math.floor(totalMonths / 4), Math.floor(totalMonths / 2),
              Math.floor(totalMonths * 3 / 4), totalMonths].map((m) => (
              <span key={m}>{minStart + m}月</span>
            ))}
          </div>
        </div>

        {/* 甘特条 */}
        {workfaces.map((wf) => {
          const wfData = data.filter((d) => d.workface === wf);
          return (
            <div key={wf} className="flex items-center gap-1.5">
              <div className="w-16 flex-shrink-0 text-[10px] truncate pr-1 text-gray-300">{wf}</div>
              <div className="flex-1 h-5 bg-gray-700/80 rounded relative">
                {wfData.map((item, idx) => {
                  const left = ((item.start - minStart) / totalMonths) * 100;
                  const width = ((item.end - item.start) / totalMonths) * 100;
                  return (
                    <div
                      key={idx}
                      className={`absolute h-full rounded shadow-inner ${
                        item.type === 'preparation'
                          ? 'bg-yellow-500'
                          : 'bg-green-500'
                      }`}
                      style={{
                        left: `${left}%`,
                        width: `${Math.max(width, 2)}%`,
                      }}
                      title={`${item.task}: ${item.start}-${item.end}月`}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* 图例 */}
        <div className="flex gap-3 mt-2 text-[10px] text-gray-400">
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 bg-yellow-500 rounded" />
            <span>准备</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 bg-green-500 rounded" />
            <span>回采</span>
          </div>
        </div>
      </div>
    </div>
  );
}


/**
 * 详细计划视图组件
 */
function DetailedPlanView({ plan, expandedSections, toggleSection, selectedWorkface, setSelectedWorkface }) {
  if (!plan) return null;

  const { summary, workface_plans, timeline, critical_path, risk_analysis, gantt_data } = plan;

  return (
    <div className="space-y-3">
      {/* 汇总信息 */}
      <div className="bg-gray-800/70 border border-gray-700 rounded-lg p-2.5">
        <h4 className="text-xs font-medium mb-2 flex items-center gap-1.5">
          <Target className="w-3.5 h-3.5 text-blue-400" />
          计划汇总
        </h4>
        <div className="grid grid-cols-4 gap-2 text-[10px]">
          <div className="bg-gray-900/50 rounded p-1.5">
            <div className="text-gray-400">工作面数</div>
            <div className="text-sm font-semibold">{summary?.total_workfaces || 0}</div>
          </div>
          <div className="bg-gray-900/50 rounded p-1.5">
            <div className="text-gray-400">总工期</div>
            <div className="text-sm font-semibold">{summary?.total_months || 0} 月</div>
          </div>
          <div className="bg-gray-900/50 rounded p-1.5">
            <div className="text-gray-400">总产量</div>
            <div className="text-sm font-semibold">{summary?.total_output_wan_ton || 0} 万吨</div>
          </div>
          <div className="bg-gray-900/50 rounded p-1.5">
            <div className="text-gray-400">月均产量</div>
            <div className="text-sm font-semibold">{((summary?.average_monthly_output || 0) / 10000).toFixed(1)} 万吨</div>
          </div>
        </div>
        <div className="mt-2 text-[10px] text-gray-400">
          计划周期: {summary?.start_date} ~ {summary?.end_date}
        </div>
      </div>

      {/* 开采顺序 */}
      <div className="bg-gray-800/70 border border-gray-700 rounded-lg p-2.5">
        <h4 className="text-xs font-medium mb-2 flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-green-400" />
          开采顺序
        </h4>
        <div className="flex flex-wrap gap-1.5">
          {(plan.succession_order || []).map((wfId, idx) => (
            <button
              key={wfId}
              onClick={() => setSelectedWorkface(selectedWorkface === wfId ? null : wfId)}
              className={`px-2 py-1 rounded text-[10px] transition-colors ${
                selectedWorkface === wfId
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {idx + 1}. {wfId}
            </button>
          ))}
        </div>
      </div>

      {/* 选中工作面详情 */}
      {selectedWorkface && workface_plans?.[selectedWorkface] && (
        <WorkfaceDetailView
          wfPlan={workface_plans[selectedWorkface]}
          expandedSections={expandedSections}
          toggleSection={toggleSection}
        />
      )}

      {/* 风险分析 */}
      {risk_analysis && risk_analysis.risks?.length > 0 && (
        <div className="bg-gray-800/70 border border-gray-700 rounded-lg p-2.5">
          <h4 className="text-xs font-medium mb-2 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />
            风险分析
            <span className="ml-auto text-[10px]">
              <span className="text-red-400">高风险: {risk_analysis.high_risk_count}</span>
              <span className="mx-1 text-yellow-400">中风险: {risk_analysis.medium_risk_count}</span>
            </span>
          </h4>
          <div className="space-y-1.5 max-h-32 overflow-y-auto">
            {risk_analysis.risks.map((risk, idx) => (
              <div
                key={idx}
                className={`p-1.5 rounded text-[10px] border ${
                  risk.level === 'high'
                    ? 'bg-red-900/30 border-red-700'
                    : risk.level === 'medium'
                    ? 'bg-yellow-900/30 border-yellow-700'
                    : 'bg-gray-700/50 border-gray-600'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="font-medium">{risk.workface}</span>
                  <span className="text-[9px] px-1 py-0.5 rounded bg-gray-700">{risk.risk_type}</span>
                </div>
                <div className="text-gray-400">{risk.description}</div>
                {risk.mitigation && (
                  <div className="mt-0.5 text-gray-500">
                    措施: {risk.mitigation.join('; ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 增强甘特图 */}
      {gantt_data && gantt_data.length > 0 && (
        <div className="bg-gray-800/70 border border-gray-700 rounded-lg p-2.5">
          <h4 className="text-xs font-medium mb-2 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-purple-400" />
            接续时序图（详细）
          </h4>
          <EnhancedGanttChart data={gantt_data} />
        </div>
      )}
    </div>
  );
}


/**
 * 工作面详情视图
 */
function WorkfaceDetailView({ wfPlan, expandedSections, toggleSection }) {
  if (!wfPlan) return null;

  const { workface_id, basic_info, key_dates, duration, production, procedures, daily_plans } = wfPlan;

  return (
    <div className="bg-gray-800/70 border border-blue-600 rounded-lg p-2.5 space-y-2">
      <h4 className="text-xs font-medium flex items-center gap-1.5">
        <Info className="w-3.5 h-3.5 text-blue-400" />
        {workface_id} 详细计划
      </h4>

      {/* 基本信息 */}
      <div className="grid grid-cols-4 gap-1.5 text-[10px]">
        <div className="bg-gray-900/50 rounded p-1.5">
          <div className="text-gray-400">工作面长度</div>
          <div className="font-medium">{basic_info?.length || 0} m</div>
        </div>
        <div className="bg-gray-900/50 rounded p-1.5">
          <div className="text-gray-400">推进长度</div>
          <div className="font-medium">{basic_info?.advance_length || 0} m</div>
        </div>
        <div className="bg-gray-900/50 rounded p-1.5">
          <div className="text-gray-400">煤厚</div>
          <div className="font-medium">{basic_info?.thickness?.toFixed(1) || 0} m</div>
        </div>
        <div className="bg-gray-900/50 rounded p-1.5">
          <div className="text-gray-400">储量</div>
          <div className="font-medium">{basic_info?.reserves?.toFixed(1) || 0} 万吨</div>
        </div>
      </div>

      {/* 关键时间节点 */}
      <div>
        <button
          onClick={() => toggleSection(`${workface_id}-dates`)}
          className="w-full flex items-center gap-1.5 text-[10px] font-medium mb-1.5"
        >
          {expandedSections[`${workface_id}-dates`] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <Clock className="w-3 h-3 text-yellow-400" />
          关键时间节点
        </button>
        {expandedSections[`${workface_id}-dates`] && key_dates && (
          <div className="grid grid-cols-2 gap-1.5 text-[10px] ml-4">
            <div className="flex justify-between p-1.5 bg-gray-900/50 rounded">
              <span className="text-gray-400">准备开始</span>
              <span>{key_dates.prep_start_date}</span>
            </div>
            <div className="flex justify-between p-1.5 bg-gray-900/50 rounded">
              <span className="text-gray-400">掘进完成</span>
              <span>{key_dates.tunneling_end_date}</span>
            </div>
            <div className="flex justify-between p-1.5 bg-gray-900/50 rounded">
              <span className="text-gray-400">设备就绪</span>
              <span>{key_dates.install_end_date}</span>
            </div>
            <div className="flex justify-between p-1.5 bg-gray-900/50 rounded">
              <span className="text-gray-400">回采开始</span>
              <span className="text-green-400">{key_dates.mining_start_date}</span>
            </div>
            <div className="flex justify-between p-1.5 bg-gray-900/50 rounded">
              <span className="text-gray-400">初次来压</span>
              <span className="text-yellow-400">{key_dates.first_weighting_date}</span>
            </div>
            <div className="flex justify-between p-1.5 bg-gray-900/50 rounded">
              <span className="text-gray-400">回采结束</span>
              <span>{key_dates.mining_end_date}</span>
            </div>
          </div>
        )}
      </div>

      {/* 工序列表 */}
      <div>
        <button
          onClick={() => toggleSection(`${workface_id}-procedures`)}
          className="w-full flex items-center gap-1.5 text-[10px] font-medium mb-1.5"
        >
          {expandedSections[`${workface_id}-procedures`] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <Layers className="w-3 h-3 text-green-400" />
          工序分解 ({procedures?.length || 0} 项)
        </button>
        {expandedSections[`${workface_id}-procedures`] && procedures && (
          <div className="space-y-1 ml-4 max-h-40 overflow-y-auto">
            {procedures.map((proc, idx) => (
              <div key={idx} className="p-1.5 bg-gray-900/50 rounded text-[10px]">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-medium">{proc.name}</span>
                  <span className="text-gray-400">{proc.duration_days} 天</span>
                </div>
                <div className="text-gray-500">{proc.start_date} ~ {proc.end_date}</div>
                {proc.description && (
                  <div className="text-gray-400 mt-0.5">{proc.description}</div>
                )}
                {proc.safety_measures?.length > 0 && (
                  <div className="mt-0.5 flex flex-wrap gap-0.5">
                    {proc.safety_measures.slice(0, 3).map((measure, i) => (
                      <span key={i} className="px-1 py-0.5 bg-green-900/30 text-green-400 rounded text-[9px]">
                        {measure}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 产量计划 */}
      <div className="grid grid-cols-4 gap-1.5 text-[10px]">
        <div className="bg-gray-900/50 rounded p-1.5">
          <div className="text-gray-400">日推进</div>
          <div className="font-medium">{production?.daily_advance?.toFixed(1) || 0} m</div>
        </div>
        <div className="bg-gray-900/50 rounded p-1.5">
          <div className="text-gray-400">月推进</div>
          <div className="font-medium">{production?.monthly_advance?.toFixed(0) || 0} m</div>
        </div>
        <div className="bg-gray-900/50 rounded p-1.5">
          <div className="text-gray-400">日产量</div>
          <div className="font-medium">{production?.daily_output?.toFixed(0) || 0} 吨</div>
        </div>
        <div className="bg-gray-900/50 rounded p-1.5">
          <div className="text-gray-400">月产量</div>
          <div className="font-medium">{((production?.monthly_output || 0) / 10000).toFixed(2)} 万吨</div>
        </div>
      </div>
    </div>
  );
}


/**
 * 增强版甘特图组件 - 紧凑版
 */
function EnhancedGanttChart({ data }) {
  if (!data || data.length === 0) return null;

  // 计算时间范围
  const minStart = Math.min(...data.map((d) => d.start));
  const maxEnd = Math.max(...data.map((d) => d.end));
  const totalDays = maxEnd - minStart;

  // 按工作面分组
  const workfaces = [...new Set(data.map((d) => d.workface))];

  // 阶段颜色映射
  const phaseColors = {
    tunneling: 'bg-orange-500',
    installation: 'bg-purple-500',
    first_mining: 'bg-lime-500',
    normal_mining: 'bg-green-600',
    end_mining: 'bg-emerald-700',
    withdrawal: 'bg-gray-500',
    preparation: 'bg-yellow-500',
    mining: 'bg-green-500',
  };

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[400px] space-y-1">
        {/* 时间轴 */}
        <div className="flex mb-1 text-[9px] text-gray-500">
          <div className="w-14 flex-shrink-0" />
          <div className="flex-1 flex justify-between px-1">
            {[0, 0.25, 0.5, 0.75, 1].map((pct) => (
              <span key={pct}>{Math.round(minStart + totalDays * pct)} 天</span>
            ))}
          </div>
        </div>

        {/* 甘特条 */}
        {workfaces.map((wf) => {
          const wfData = data.filter((d) => d.workface === wf);
          return (
            <div key={wf} className="flex items-center gap-1">
              <div className="w-14 flex-shrink-0 text-[9px] truncate text-gray-300">{wf}</div>
              <div className="flex-1 h-4 bg-gray-700/50 rounded relative">
                {wfData.map((item, idx) => {
                  const left = ((item.start - minStart) / totalDays) * 100;
                  const width = ((item.end - item.start) / totalDays) * 100;
                  const colorClass = phaseColors[item.phase] || phaseColors[item.type] || 'bg-gray-500';
                  return (
                    <div
                      key={idx}
                      className={`absolute h-full rounded ${colorClass} opacity-90 hover:opacity-100 transition-opacity cursor-pointer`}
                      style={{
                        left: `${left}%`,
                        width: `${Math.max(width, 1)}%`,
                      }}
                      title={`${item.task}: ${item.start_date || item.start} ~ ${item.end_date || item.end}`}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* 图例 */}
        <div className="flex flex-wrap gap-2 mt-2 text-[9px] text-gray-400">
          <div className="flex items-center gap-0.5">
            <div className="w-2 h-2 bg-orange-500 rounded" />
            <span>掘进</span>
          </div>
          <div className="flex items-center gap-0.5">
            <div className="w-2 h-2 bg-purple-500 rounded" />
            <span>安装</span>
          </div>
          <div className="flex items-center gap-0.5">
            <div className="w-2 h-2 bg-lime-500 rounded" />
            <span>初采</span>
          </div>
          <div className="flex items-center gap-0.5">
            <div className="w-2 h-2 bg-green-600 rounded" />
            <span>正常回采</span>
          </div>
          <div className="flex items-center gap-0.5">
            <div className="w-2 h-2 bg-emerald-700 rounded" />
            <span>末采</span>
          </div>
          <div className="flex items-center gap-0.5">
            <div className="w-2 h-2 bg-gray-500 rounded" />
            <span>回撤</span>
          </div>
        </div>
      </div>
    </div>
  );
}
