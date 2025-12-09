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
} from 'lucide-react';
import {
  quickOptimizeSuccession,
  startSuccessionTraining,
  getSuccessionTrainingStatus,
  compareSuccessionStrategies,
} from '../api';

/**
 * 工作面接续优化面板
 */
export default function SuccessionPanel({ panels = [], onClose }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [strategy, setStrategy] = useState('greedy');
  const [trainingStatus, setTrainingStatus] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [activeTab, setActiveTab] = useState('quick'); // quick, train, compare

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

  // 策略名称映射
  const strategyNames = {
    greedy: '贪心策略',
    sequential: '顺序策略',
    score_based: '评分优先',
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 text-white">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Layers className="w-5 h-5 text-blue-400" />
          工作面接续优化
        </h3>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            ×
          </button>
        )}
      </div>

      {/* 标签页 */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setActiveTab('quick')}
          className={`px-3 py-1.5 rounded text-sm ${
            activeTab === 'quick'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          <Zap className="w-4 h-4 inline mr-1" />
          快速优化
        </button>
        <button
          onClick={() => setActiveTab('train')}
          className={`px-3 py-1.5 rounded text-sm ${
            activeTab === 'train'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          <TrendingUp className="w-4 h-4 inline mr-1" />
          RL训练
        </button>
        <button
          onClick={() => setActiveTab('compare')}
          className={`px-3 py-1.5 rounded text-sm ${
            activeTab === 'compare'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          <BarChart3 className="w-4 h-4 inline mr-1" />
          策略对比
        </button>
      </div>

      {/* 工作面信息 */}
      <div className="bg-gray-700 rounded p-3 mb-4">
        <div className="text-sm text-gray-400 mb-1">当前工作面</div>
        <div className="text-lg font-semibold">
          {panels.length > 0 ? `${panels.length} 个工作面` : '未生成设计'}
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-900/50 border border-red-500 rounded p-3 mb-4 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-400" />
          <span className="text-red-200">{error}</span>
        </div>
      )}

      {/* 快速优化面板 */}
      {activeTab === 'quick' && (
        <div>
          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-2">选择策略</label>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
            >
              <option value="greedy">贪心策略 - 优先储量大的工作面</option>
              <option value="sequential">顺序策略 - 按编号顺序开采</option>
              <option value="score_based">评分优先 - 优先地质条件好的</option>
            </select>
          </div>

          <button
            onClick={handleQuickOptimize}
            disabled={loading || panels.length === 0}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600
                       disabled:cursor-not-allowed text-white py-2 rounded flex
                       items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                优化中...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                开始优化
              </>
            )}
          </button>
        </div>
      )}

      {/* RL训练面板 */}
      {activeTab === 'train' && (
        <div>
          <div className="bg-gray-700 rounded p-3 mb-4">
            <div className="text-sm text-gray-400 mb-2">强化学习训练</div>
            <p className="text-xs text-gray-500 mb-3">
              使用PPO算法训练智能体，自动学习最优接续策略。
              训练需要一定时间，但能获得更好的优化效果。
            </p>

            {trainingStatus && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>训练进度</span>
                  <span>{trainingStatus.progress?.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-gray-600 rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all"
                    style={{ width: `${trainingStatus.progress || 0}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Episode: {trainingStatus.current_episode || 0}</span>
                  <span>最佳奖励: {trainingStatus.best_reward?.toFixed(2) || 0}</span>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={handleStartTraining}
            disabled={loading || panels.length === 0}
            className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-600
                       disabled:cursor-not-allowed text-white py-2 rounded flex
                       items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                训练中...
              </>
            ) : (
              <>
                <TrendingUp className="w-4 h-4" />
                开始训练
              </>
            )}
          </button>
        </div>
      )}

      {/* 策略对比面板 */}
      {activeTab === 'compare' && (
        <div>
          <button
            onClick={handleCompare}
            disabled={loading || panels.length === 0}
            className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600
                       disabled:cursor-not-allowed text-white py-2 rounded flex
                       items-center justify-center gap-2 mb-4"
          >
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                对比中...
              </>
            ) : (
              <>
                <BarChart3 className="w-4 h-4" />
                对比所有策略
              </>
            )}
          </button>

          {comparison && (
            <div className="space-y-3">
              {Object.entries(comparison).map(([key, value]) => (
                <div key={key} className="bg-gray-700 rounded p-3">
                  <div className="font-medium mb-2">{strategyNames[key]}</div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-gray-400">总工期:</span>
                      <span className="ml-2">{value.summary.total_months} 月</span>
                    </div>
                    <div>
                      <span className="text-gray-400">完成:</span>
                      <span className="ml-2">
                        {value.summary.completed_workfaces}/{value.summary.total_workfaces}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-gray-400">累计产量:</span>
                      <span className="ml-2">
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

      {/* 优化结果 */}
      {result && (
        <div className="mt-4 border-t border-gray-700 pt-4">
          <h4 className="font-medium mb-3 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-400" />
            优化结果
          </h4>

          {/* 汇总信息 */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-gray-700 rounded p-3">
              <div className="text-xs text-gray-400">总工期</div>
              <div className="text-lg font-semibold">
                {result.summary?.total_months || 0} 月
              </div>
            </div>
            <div className="bg-gray-700 rounded p-3">
              <div className="text-xs text-gray-400">完成工作面</div>
              <div className="text-lg font-semibold">
                {result.summary?.completed_workfaces || 0} / {result.summary?.total_workfaces || 0}
              </div>
            </div>
            <div className="bg-gray-700 rounded p-3 col-span-2">
              <div className="text-xs text-gray-400">累计产量</div>
              <div className="text-lg font-semibold">
                {((result.summary?.cumulative_production || 0) / 10000).toFixed(1)} 万吨
              </div>
            </div>
          </div>

          {/* 甘特图 */}
          {result.gantt_data && result.gantt_data.length > 0 && (
            <div className="bg-gray-700 rounded p-3">
              <div className="text-sm font-medium mb-2 flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                接续时序图
              </div>
              <GanttChart data={result.gantt_data} />
            </div>
          )}

          {/* 工作面时间表 */}
          {result.plan?.workface_schedule && (
            <div className="mt-3">
              <div className="text-sm font-medium mb-2">工作面时间表</div>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {Object.entries(result.plan.workface_schedule).map(([id, schedule]) => (
                  <div
                    key={id}
                    className="flex items-center justify-between bg-gray-700 rounded px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{id}</span>
                    <div className="flex items-center gap-4 text-gray-400">
                      <span>
                        <Clock className="w-3 h-3 inline mr-1" />
                        准备: {schedule.prep_start ?? '-'}月
                      </span>
                      <span>
                        <Play className="w-3 h-3 inline mr-1" />
                        回采: {schedule.mining_start ?? '-'}月
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${
                          schedule.status === '已采'
                            ? 'bg-green-600'
                            : schedule.status === '在采'
                            ? 'bg-blue-600'
                            : 'bg-gray-600'
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
 * 简单的甘特图组件
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
      <div className="min-w-[400px]">
        {/* 时间轴 */}
        <div className="flex mb-1 text-xs text-gray-500">
          <div className="w-20 flex-shrink-0" />
          <div className="flex-1 flex justify-between">
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
            <div key={wf} className="flex items-center mb-1">
              <div className="w-20 flex-shrink-0 text-xs truncate pr-2">{wf}</div>
              <div className="flex-1 h-6 bg-gray-600 rounded relative">
                {wfData.map((item, idx) => {
                  const left = ((item.start - minStart) / totalMonths) * 100;
                  const width = ((item.end - item.start) / totalMonths) * 100;
                  return (
                    <div
                      key={idx}
                      className={`absolute h-full rounded ${
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
        <div className="flex gap-4 mt-2 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-yellow-500 rounded" />
            <span>准备</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-green-500 rounded" />
            <span>回采</span>
          </div>
        </div>
      </div>
    </div>
  );
}
