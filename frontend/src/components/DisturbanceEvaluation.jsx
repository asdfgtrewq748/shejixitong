import React, { useState, useEffect, useRef, useCallback, Suspense, lazy } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, Upload, Database, Settings, Play, FileUp, Map,
  Layers, Target, AlertTriangle, CheckCircle, Download, RefreshCw,
  ChevronDown, ChevronRight, Info, BarChart3, Sliders, Eye, ArrowLeft
} from 'lucide-react';
import * as api from '../api';

// 懒加载Canvas渲染器 (仅在关闭高质量模式时加载)
const CanvasRenderer = lazy(() => import('./CanvasRenderer'));

// 场景配置
const SCENARIOS = {
  surface_subsidence: {
    name: '地表下沉',
    description: '评价地表沉陷风险',
    color: 'blue',
    icon: Layers
  },
  aquifer_disturbance: {
    name: '含水层扰动',
    description: '预测突水风险',
    color: 'cyan',
    icon: Activity
  },
  upward_mining: {
    name: '上行开采可行性',
    description: '评估上煤层开采难度',
    color: 'purple',
    icon: Target
  }
};

// ODI等级颜色 - 与图片一致的配色方案
const LEVEL_COLORS = {
  1: { bg: 'bg-blue-500', text: 'text-blue-400', label: 'I级 轻微扰动', hex: '#3b82f6', odiMax: 0.045, subsidenceMax: 0.30 },
  2: { bg: 'bg-yellow-400', text: 'text-yellow-400', label: 'II级 较弱扰动', hex: '#facc15', odiMax: 0.345, subsidenceMax: 1.20 },
  3: { bg: 'bg-orange-400', text: 'text-orange-400', label: 'III级 中等扰动', hex: '#fb923c', odiMax: 0.825, subsidenceMax: 2.80 },
  4: { bg: 'bg-red-400', text: 'text-red-400', label: 'IV级 较强扰动', hex: '#f87171', odiMax: 0.847, subsidenceMax: 4.20 },
  5: { bg: 'bg-red-600', text: 'text-red-500', label: 'V级 强扰动', hex: '#dc2626', odiMax: 1.0, subsidenceMax: 99999 }
};

// 可视化字段映射
const CONTOUR_FIELDS = {
  odi_normalized: 'ODI(归一化)',
  odi: 'ODI',
  Ti: '目标层厚度 Ti',
  Ei: '目标层弹模 Ei',
  Hi: '煤层-目标层间距 Hi',
  Di: '目标层埋深 Di',
  Mi: '采高 Mi'
};

const DisturbanceEvaluation = () => {
  const navigate = useNavigate();

  // 状态管理
  const [activeScenario, setActiveScenario] = useState('surface_subsidence');
  const [step, setStep] = useState(1); // 1:数据导入 2:参数配置 3:计算 4:结果
  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState([]);

  // 数据状态
  const [boreholeCoords, setBoreholeCoords] = useState([]);
  const [boreholeLayers, setBoreholeLayers] = useState({});
  const [workfaceCoords, setWorkfaceCoords] = useState([]);
  const [measuredData, setMeasuredData] = useState([]);

  // 参数状态
  const [miningHeight, setMiningHeight] = useState(3.0);
  const [stepSize, setStepSize] = useState(25);
  const [collapseAngle, setCollapseAngle] = useState(75);
  const [customWeights, setCustomWeights] = useState({ wd: 0.45, wo: 0.30, wf: 0.25 });

  // 结果状态
  const [results, setResults] = useState(null);
  const [contours, setContours] = useState(null);
  const [statistics, setStatistics] = useState(null);
  const [contourField, setContourField] = useState('odi_normalized');

  // 画布相关 (用于Canvas备用模式)
  const [scale, setScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

  // 视图控制状态
  const [showContourFill, setShowContourFill] = useState(true);
  const [showContourLines, setShowContourLines] = useState(true);
  const [showPoints, setShowPoints] = useState(false);  // 默认关闭散点
  const [contourLevels, setContourLevels] = useState(10);

  // 后端图片模式 (默认开启高质量模式)
  const [useBackendImage, setUseBackendImage] = useState(true);
  const [backendImage, setBackendImage] = useState(null);
  const [isLoadingImage, setIsLoadingImage] = useState(false);

  // 添加日志
  const addLog = useCallback((msg, type = 'info') => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [`[${time}] ${msg}|${type}`, ...prev].slice(0, 50));
  }, []);

  // 加载场景默认权重
  useEffect(() => {
    const scenarioWeights = {
      surface_subsidence: { wd: 0.45, wo: 0.30, wf: 0.25 },
      aquifer_disturbance: { wd: 0.60, wo: 0.25, wf: 0.15 },
      upward_mining: { wd: 0.20, wo: 0.45, wf: 0.35 }
    };
    setCustomWeights(scenarioWeights[activeScenario]);
  }, [activeScenario]);

  // 文件上传处理
  const handleFileUpload = async (type, file) => {
    setIsLoading(true);
    addLog(`正在上传 ${file.name}...`, 'loading');

    try {
      let result;
      switch (type) {
        case 'boreholes':
          result = await api.uploadDisturbanceBoreholes(file);
          if (result.success) {
            setBoreholeCoords(result.data);
            addLog(`成功导入 ${result.count} 个钻孔坐标`, 'success');
          }
          break;
        case 'workface':
          result = await api.uploadDisturbanceWorkface(file);
          if (result.success) {
            setWorkfaceCoords(result.data);
            addLog(`成功导入 ${result.count} 个工作面坐标点`, 'success');
          }
          break;
        case 'measured':
          result = await api.uploadMeasuredData(file);
          if (result.success) {
            setMeasuredData(result.data);
            addLog(`成功导入 ${result.count} 个实测数据点`, 'success');
          }
          break;
        default:
          break;
      }
    } catch (err) {
      addLog(`上传失败: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // 批量上传实测数据
  const handleMeasuredUpload = async (files) => {
    setIsLoading(true);
    let totalCount = 0;
    let allData = [...measuredData]; // 保留已有数据

    for (const file of files) {
      addLog(`正在解析实测数据 ${file.name}...`, 'loading');
      try {
        const result = await api.uploadMeasuredData(file);
        if (result.success) {
          allData = [...allData, ...result.data];
          totalCount += result.count;
        }
      } catch (err) {
        addLog(`${file.name} 解析失败: ${err.message}`, 'warning');
      }
    }

    // 去重 (基于ID)
    const uniqueData = [];
    const seenIds = new Set();
    for (const item of allData) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        uniqueData.push(item);
      }
    }

    setMeasuredData(uniqueData);
    addLog(`成功导入 ${totalCount} 个实测数据点 (去重后 ${uniqueData.length} 个)`, 'success');
    setIsLoading(false);
  };

  // 批量上传钻孔分层
  const handleLayersUpload = async (files) => {
    setIsLoading(true);
    const newLayers = { ...boreholeLayers };
    let successCount = 0;

    for (const file of files) {
      const boreholeId = file.name.replace(/\.(xlsx|csv|xls)$/i, '').replace('_marked', '');
      addLog(`正在解析 ${boreholeId} 分层数据...`, 'loading');

      try {
        const result = await api.uploadBoreholeLayers_Disturbance(boreholeId, file);
        if (result.success) {
          newLayers[boreholeId] = {
            layers: result.layers,
            geo_params: result.geo_params
          };
          successCount++;
        }
      } catch (err) {
        addLog(`${boreholeId} 解析失败: ${err.message}`, 'warning');
      }
    }

    setBoreholeLayers(newLayers);
    addLog(`成功解析 ${successCount}/${files.length} 个钻孔分层数据`, 'success');
    setIsLoading(false);
  };

  // 执行ODI计算
  const handleCalculate = async () => {
    if (boreholeCoords.length === 0 || workfaceCoords.length === 0) {
      addLog('请先导入钻孔坐标和工作面坐标', 'error');
      return;
    }

    setIsLoading(true);
    addLog('正在计算ODI...', 'loading');

    try {
      // 构建钻孔完整数据
      const boreholeData = boreholeCoords.map(bh => {
        const layers = boreholeLayers[bh.id];
        return {
          ...bh,
          ...(layers?.geo_params || {}),
        };
      });

      const result = await api.calculateODI({
        scenario: activeScenario,
        mining_height: miningHeight,
        step_size: stepSize,
        custom_weights: customWeights,
        borehole_data: boreholeData,
        workface_coords: workfaceCoords,
        measured_data: measuredData // 传入实测数据用于校准
      });

      if (result.success) {
        setResults(result.results);
        setContours(result.contours);
        setStatistics(result.statistics);
        setStep(4);
        addLog(`计算完成，共 ${result.point_count} 个评价点`, 'success');
      }
    } catch (err) {
      addLog(`计算失败: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // 实测校准
  const handleCalibrate = async () => {
    if (measuredData.length === 0) {
      addLog('请先导入实测数据', 'error');
      return;
    }

    setIsLoading(true);
    addLog('正在进行实测约束校准...', 'loading');

    try {
      const result = await api.calibrateODI(measuredData);
      if (result.success) {
        addLog(`校准完成，平均误差: ${result.statistics.mean_error.toFixed(4)}`, 'success');
      }
    } catch (err) {
      addLog(`校准失败: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // 获取后端生成的热力图图片
  const fetchBackendImage = useCallback(async (field = contourField) => {
    if (!results) return;

    setIsLoadingImage(true);
    addLog(`正在获取高质量热力图 (${field})...`, 'loading');

    try {
      const result = await api.getHeatmapImage(field, 500, 'png');
      if (result.success) {
        setBackendImage(result.image);
        addLog('热力图加载完成', 'success');
      }
    } catch (err) {
      addLog(`获取热力图失败: ${err.message}`, 'error');
    } finally {
      setIsLoadingImage(false);
    }
  }, [results, contourField, addLog]);

  // 当切换到后端图片模式时自动获取图片
  useEffect(() => {
    if (useBackendImage && results && !backendImage) {
      fetchBackendImage();
    }
  }, [useBackendImage, results, backendImage, fetchBackendImage]);

  // 当字段变化时重新获取后端图片
  useEffect(() => {
    if (useBackendImage && results) {
      fetchBackendImage(contourField);
    }
  }, [contourField, useBackendImage, results, fetchBackendImage]);

  // Canvas绑图代码已抽离到 CanvasRenderer.jsx 组件 (懒加载)
  // 这大幅减少了主组件的复杂度和初始加载时间

  // 渲染场景选择器
  const renderScenarioSelector = () => (
    <div className="grid grid-cols-3 gap-3">
      {Object.entries(SCENARIOS).map(([key, scenario]) => {
        const Icon = scenario.icon;
        const isActive = activeScenario === key;
        return (
          <button
            key={key}
            onClick={() => setActiveScenario(key)}
            className={`p-4 rounded-xl border-2 transition-all ${
              isActive
                ? `border-${scenario.color}-500 bg-${scenario.color}-500/20`
                : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
            }`}
          >
            <Icon className={`mx-auto mb-2 ${isActive ? `text-${scenario.color}-400` : 'text-gray-400'}`} size={24} />
            <div className={`font-bold text-sm ${isActive ? 'text-white' : 'text-gray-300'}`}>
              {scenario.name}
            </div>
            <div className="text-[10px] text-gray-500 mt-1">{scenario.description}</div>
          </button>
        );
      })}
    </div>
  );

  // 渲染数据导入面板
  const renderDataImport = () => (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-cyan-400 flex items-center gap-2">
        <Database size={14} /> 数据导入
      </h3>

      {/* 钻孔坐标 */}
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-gray-300">钻孔坐标</span>
          {boreholeCoords.length > 0 && (
            <span className="text-xs text-green-400 flex items-center gap-1">
              <CheckCircle size={12} /> {boreholeCoords.length} 个
            </span>
          )}
        </div>
        <label className="flex items-center justify-center gap-2 py-3 px-4 bg-gray-700/50 rounded-lg cursor-pointer hover:bg-gray-700 transition-colors border border-dashed border-gray-600">
          <Upload size={16} className="text-gray-400" />
          <span className="text-xs text-gray-400">选择 CSV/Excel 文件</span>
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => e.target.files[0] && handleFileUpload('boreholes', e.target.files[0])}
          />
        </label>
      </div>

      {/* 钻孔分层 */}
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-gray-300">钻孔分层数据</span>
          {Object.keys(boreholeLayers).length > 0 && (
            <span className="text-xs text-green-400 flex items-center gap-1">
              <CheckCircle size={12} /> {Object.keys(boreholeLayers).length} 个
            </span>
          )}
        </div>
        <label className="flex items-center justify-center gap-2 py-3 px-4 bg-gray-700/50 rounded-lg cursor-pointer hover:bg-gray-700 transition-colors border border-dashed border-gray-600">
          <FileUp size={16} className="text-gray-400" />
          <span className="text-xs text-gray-400">批量选择分层文件</span>
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            multiple
            className="hidden"
            onChange={(e) => e.target.files.length > 0 && handleLayersUpload(Array.from(e.target.files))}
          />
        </label>
      </div>

      {/* 工作面坐标 */}
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-gray-300">工作面坐标</span>
          {workfaceCoords.length > 0 && (
            <span className="text-xs text-green-400 flex items-center gap-1">
              <CheckCircle size={12} /> {workfaceCoords.length} 点
            </span>
          )}
        </div>
        <label className="flex items-center justify-center gap-2 py-3 px-4 bg-gray-700/50 rounded-lg cursor-pointer hover:bg-gray-700 transition-colors border border-dashed border-gray-600">
          <Map size={16} className="text-gray-400" />
          <span className="text-xs text-gray-400">选择工作面边界文件</span>
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => e.target.files[0] && handleFileUpload('workface', e.target.files[0])}
          />
        </label>
      </div>

      {/* 实测数据 (可选) */}
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-gray-300">实测数据 (可选)</span>
          {measuredData.length > 0 && (
            <span className="text-xs text-green-400 flex items-center gap-1">
              <CheckCircle size={12} /> {measuredData.length} 点
            </span>
          )}
        </div>
        <label className="flex items-center justify-center gap-2 py-3 px-4 bg-gray-700/50 rounded-lg cursor-pointer hover:bg-gray-700 transition-colors border border-dashed border-gray-600">
          <BarChart3 size={16} className="text-gray-400" />
          <span className="text-xs text-gray-400">批量选择实测数据文件</span>
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            multiple
            className="hidden"
            onChange={(e) => e.target.files.length > 0 && handleMeasuredUpload(Array.from(e.target.files))}
          />
        </label>
      </div>
    </div>
  );

  // 渲染参数配置面板
  const renderParamsConfig = () => (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-purple-400 flex items-center gap-2">
        <Settings size={14} /> 参数配置
      </h3>

      {/* 开采参数 */}
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 space-y-4">
        <div className="text-xs text-gray-400 uppercase tracking-wider">开采参数</div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-300">采高 (m)</span>
            <span className="text-cyan-400 font-mono">{miningHeight}</span>
          </div>
          <input
            type="range"
            min="1"
            max="10"
            step="0.1"
            value={miningHeight}
            onChange={(e) => setMiningHeight(parseFloat(e.target.value))}
            className="w-full accent-cyan-500"
          />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-300">评价点步长 (m)</span>
            <span className="text-cyan-400 font-mono">{stepSize}</span>
          </div>
          <input
            type="range"
            min="10"
            max="100"
            step="5"
            value={stepSize}
            onChange={(e) => setStepSize(parseInt(e.target.value))}
            className="w-full accent-cyan-500"
          />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-300">垮落角 (°)</span>
            <span className="text-cyan-400 font-mono">{collapseAngle}</span>
          </div>
          <input
            type="range"
            min="45"
            max="90"
            step="1"
            value={collapseAngle}
            onChange={(e) => setCollapseAngle(parseInt(e.target.value))}
            className="w-full accent-cyan-500"
          />
        </div>
      </div>

      {/* 响应权重 */}
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-400 uppercase tracking-wider">响应权重</div>
          <button
            onClick={() => {
              const scenarioWeights = {
                surface_subsidence: { wd: 0.45, wo: 0.30, wf: 0.25 },
                aquifer_disturbance: { wd: 0.60, wo: 0.25, wf: 0.15 },
                upward_mining: { wd: 0.20, wo: 0.45, wf: 0.35 }
              };
              setCustomWeights(scenarioWeights[activeScenario]);
            }}
            className="text-[10px] text-cyan-400 hover:text-cyan-300"
          >
            重置默认
          </button>
        </div>

        {[
          { key: 'wd', label: '位移响应', color: 'blue' },
          { key: 'wo', label: '力学响应', color: 'amber' },
          { key: 'wf', label: '水力响应', color: 'emerald' }
        ].map(item => (
          <div key={item.key} className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className={`text-${item.color}-400`}>{item.label}</span>
              <span className={`text-${item.color}-400 font-mono`}>
                {(customWeights[item.key] * 100).toFixed(0)}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={customWeights[item.key] * 100}
              onChange={(e) => {
                const newVal = parseInt(e.target.value) / 100;
                const others = Object.keys(customWeights).filter(k => k !== item.key);
                const remaining = 1 - newVal;
                const otherSum = others.reduce((s, k) => s + customWeights[k], 0);
                const ratio = otherSum > 0 ? remaining / otherSum : 0.5;
                setCustomWeights({
                  ...customWeights,
                  [item.key]: newVal,
                  [others[0]]: customWeights[others[0]] * ratio,
                  [others[1]]: customWeights[others[1]] * ratio
                });
              }}
              className={`w-full accent-${item.color}-500`}
            />
          </div>
        ))}

        <div className="text-[10px] text-gray-500 flex items-center gap-1">
          <Info size={10} /> 三项权重之和自动归一化为 100%
        </div>
      </div>
    </div>
  );

  // 渲染统计信息
  const renderStatistics = () => {
    if (!statistics) return null;

    return (
      <div className="space-y-4">
        <h3 className="text-sm font-bold text-amber-400 flex items-center gap-2">
          <BarChart3 size={14} /> 统计信息
        </h3>

        <div className="grid grid-cols-3 gap-3">
          <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700 text-center">
            <div className="text-2xl font-bold text-cyan-400">{statistics.min_odi?.toFixed(3)}</div>
            <div className="text-[10px] text-gray-400">最小ODI</div>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700 text-center">
            <div className="text-2xl font-bold text-amber-400">{statistics.mean_odi?.toFixed(3)}</div>
            <div className="text-[10px] text-gray-400">平均ODI</div>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700 text-center">
            <div className="text-2xl font-bold text-red-400">{statistics.max_odi?.toFixed(3)}</div>
            <div className="text-[10px] text-gray-400">最大ODI</div>
          </div>
        </div>

        {/* 等级分布 */}
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
          <div className="text-xs text-gray-400 mb-3">扰动等级分布</div>
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map(level => {
              const count = statistics.level_distribution?.[`level_${level}`] || 0;
              const total = results?.length || 1;
              const percentage = (count / total * 100).toFixed(1);
              const info = LEVEL_COLORS[level];

              return (
                <div key={level} className="flex items-center gap-2">
                  <div className={`w-4 h-4 rounded`} style={{ backgroundColor: info.hex }}></div>
                  <div className="text-xs text-gray-300 flex-1">{info.label}</div>
                  <div className="text-xs text-gray-400 font-mono">{count} ({percentage}%)</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ODI等级对照表 */}
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
          <div className="text-xs text-gray-400 mb-3">ODI等级标准</div>
          <div className="overflow-hidden rounded border border-gray-700">
            <table className="w-full text-[10px]">
              <thead className="bg-gray-700/50">
                <tr>
                  <th className="px-2 py-1 text-left text-gray-300">等级</th>
                  <th className="px-2 py-1 text-left text-gray-300">ODI范围</th>
                  <th className="px-2 py-1 text-left text-gray-300">下沉/m</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { level: 'I级', odi: '≤0.045', sub: '≤0.30' },
                  { level: 'II级', odi: '0.045~0.345', sub: '0.30~1.20' },
                  { level: 'III级', odi: '0.345~0.825', sub: '1.20~2.80' },
                  { level: 'IV级', odi: '0.825~0.847', sub: '2.80~4.20' },
                  { level: 'V级', odi: '>0.847', sub: '>4.20' },
                ].map((row, idx) => (
                  <tr key={idx} className="border-t border-gray-700/50">
                    <td className="px-2 py-1 text-gray-300">{row.level}</td>
                    <td className="px-2 py-1 text-gray-400 font-mono">{row.odi}</td>
                    <td className="px-2 py-1 text-gray-400 font-mono">{row.sub}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // 渲染日志面板
  const renderLogs = () => (
    <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-800 h-32 overflow-y-auto">
      {logs.length === 0 ? (
        <div className="text-xs text-gray-500 text-center py-4">暂无日志</div>
      ) : (
        logs.map((log, i) => {
          const [msg, type] = log.split('|');
          const colors = {
            info: 'text-gray-400',
            success: 'text-green-400',
            warning: 'text-yellow-400',
            error: 'text-red-400',
            loading: 'text-cyan-400'
          };
          return (
            <div key={i} className={`text-[10px] font-mono ${colors[type] || 'text-gray-400'}`}>
              {msg}
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100">
      {/* 顶部导航 */}
      <header className="h-14 bg-gray-900/80 backdrop-blur border-b border-gray-800 flex items-center px-6">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors mr-4"
        >
          <ArrowLeft size={18} />
          <span className="text-sm">返回主页</span>
        </button>

        <div className="flex items-center gap-3">
          <Activity className="text-cyan-400" size={24} />
          <h1 className="text-lg font-bold tracking-wide">覆岩扰动评价系统</h1>
        </div>

        <div className="ml-auto flex items-center gap-4">
          {results && (
            <>
              <button
                onClick={handleCalibrate}
                disabled={measuredData.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600/20 text-purple-400 rounded-lg hover:bg-purple-600/30 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                <Sliders size={14} /> 实测校准
              </button>
              <button
                onClick={async () => {
                  const data = await api.exportDisturbanceResults();
                  // 简单的CSV导出
                  const csv = [
                    Object.keys(data.data[0]).join(','),
                    ...data.data.map(row => Object.values(row).join(','))
                  ].join('\n');
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `ODI_results_${Date.now()}.csv`;
                  a.click();
                }}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600/20 text-emerald-400 rounded-lg hover:bg-emerald-600/30 text-sm"
              >
                <Download size={14} /> 导出结果
              </button>
            </>
          )}
        </div>
      </header>

      {/* 主内容区 */}
      <main className="flex flex-1 overflow-hidden">
        {/* 左侧配置面板 */}
        <aside className="w-80 bg-gray-900/50 border-r border-gray-800 p-4 overflow-y-auto space-y-6">
          {/* 场景选择 */}
          <div>
            <h3 className="text-sm font-bold text-gray-300 mb-3 flex items-center gap-2">
              <Target size={14} /> 评价场景
            </h3>
            {renderScenarioSelector()}
          </div>

          {/* 数据导入 */}
          {renderDataImport()}

          {/* 参数配置 */}
          {renderParamsConfig()}

          {/* 计算按钮 */}
          <button
            onClick={handleCalculate}
            disabled={isLoading || boreholeCoords.length === 0 || workfaceCoords.length === 0}
            className={`w-full py-4 rounded-xl flex items-center justify-center gap-2 font-bold text-sm transition-all ${
              boreholeCoords.length > 0 && workfaceCoords.length > 0
                ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:from-cyan-500 hover:to-blue-500 shadow-lg shadow-cyan-500/25'
                : 'bg-gray-800 text-gray-500 cursor-not-allowed'
            }`}
          >
            {isLoading ? (
              <>
                <RefreshCw className="animate-spin" size={16} /> 计算中...
              </>
            ) : (
              <>
                <Play size={16} /> 开始计算 ODI
              </>
            )}
          </button>
        </aside>

        {/* 中间可视化区域 */}
        <div className="flex-1 flex flex-col p-4">
          <div className="flex-1 bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden relative">
            {/* 后端图片模式 (高质量，默认) */}
            {useBackendImage && backendImage ? (
              <div className="w-full h-full flex items-center justify-center p-4 bg-white/5">
                <img
                  src={`data:image/png;base64,${backendImage}`}
                  alt="ODI热力图"
                  className="max-w-full max-h-full object-contain rounded shadow-lg"
                  style={{
                    transform: `scale(${scale})`,
                    transition: 'transform 0.2s ease'
                  }}
                />
              </div>
            ) : !useBackendImage && results ? (
              /* Canvas模式 - 懒加载组件 */
              <Suspense fallback={
                <div className="w-full h-full flex items-center justify-center">
                  <RefreshCw className="animate-spin text-cyan-400" size={32} />
                  <span className="ml-2 text-gray-400">加载渲染器...</span>
                </div>
              }>
                <CanvasRenderer
                  results={results}
                  workfaceCoords={workfaceCoords}
                  scale={scale}
                  panOffset={panOffset}
                  showContourFill={showContourFill}
                  showContourLines={showContourLines}
                  showPoints={showPoints}
                  contourLevels={contourLevels}
                  contourField={contourField}
                />
              </Suspense>
            ) : null}

            {!results && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center text-gray-500">
                  <Eye size={48} className="mx-auto mb-4 opacity-50" />
                  <div className="text-lg">等待数据导入与计算</div>
                  <div className="text-sm mt-2">请在左侧面板配置参数后开始计算</div>
                </div>
              </div>
            )}

            {/* 工具栏 */}
            <div className="absolute top-4 right-4 flex gap-2">
              <button
                onClick={() => setScale(s => Math.min(3, s * 1.2))}
                className="p-2 bg-gray-800/80 rounded-lg hover:bg-gray-700 text-gray-300"
                title="放大"
              >
                +
              </button>
              <button
                onClick={() => setScale(s => Math.max(0.5, s / 1.2))}
                className="p-2 bg-gray-800/80 rounded-lg hover:bg-gray-700 text-gray-300"
                title="缩小"
              >
                -
              </button>
              <button
                onClick={() => { setScale(1); setPanOffset({ x: 0, y: 0 }); }}
                className="p-2 bg-gray-800/80 rounded-lg hover:bg-gray-700 text-gray-300"
                title="重置视图"
              >
                <RefreshCw size={14} />
              </button>
            </div>

            {/* 图层控制 */}
            {results && (
              <div className="absolute top-4 left-4 bg-gray-900/90 backdrop-blur rounded-lg p-3 space-y-2 border border-gray-700">
                <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">图层控制</div>

                {/* 高质量模式切换 */}
                <div className="pb-2 mb-2 border-b border-gray-700">
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useBackendImage}
                      onChange={(e) => {
                        setUseBackendImage(e.target.checked);
                        if (e.target.checked && !backendImage) {
                          fetchBackendImage();
                        }
                      }}
                      className="rounded accent-emerald-500"
                    />
                    <span className={useBackendImage ? 'text-emerald-400 font-medium' : 'text-gray-300'}>
                      高质量模式 (后端渲染)
                    </span>
                  </label>
                  {isLoadingImage && (
                    <div className="text-[10px] text-cyan-400 mt-1 flex items-center gap-1">
                      <RefreshCw size={10} className="animate-spin" /> 加载中...
                    </div>
                  )}
                </div>

                {!useBackendImage && (
                  <>
                    <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showContourFill}
                        onChange={(e) => setShowContourFill(e.target.checked)}
                        className="rounded accent-cyan-500"
                      />
                      等值线填充
                    </label>
                    <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showContourLines}
                        onChange={(e) => setShowContourLines(e.target.checked)}
                        className="rounded accent-cyan-500"
                      />
                      等值线
                    </label>
                    <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showPoints}
                        onChange={(e) => setShowPoints(e.target.checked)}
                        className="rounded accent-cyan-500"
                      />
                      评价点
                    </label>
                  </>
                )}

                <div className="pt-2 border-t border-gray-700">
                  <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                    <span>等值线字段</span>
                    <span>{CONTOUR_FIELDS[contourField] || contourField}</span>
                  </div>
                  <select
                    value={contourField}
                    onChange={(e) => setContourField(e.target.value)}
                    className="w-full bg-gray-800 text-xs text-gray-200 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:border-cyan-500"
                  >
                    {Object.entries(CONTOUR_FIELDS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>

                {!useBackendImage && (
                  <div className="pt-2 border-t border-gray-700">
                    <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                      <span>等值线数量</span>
                      <span>{contourLevels}</span>
                    </div>
                    <input
                      type="range"
                      min="5"
                      max="20"
                      value={contourLevels}
                      onChange={(e) => setContourLevels(parseInt(e.target.value))}
                      className="w-full accent-cyan-500"
                    />
                  </div>
                )}

                {useBackendImage && (
                  <button
                    onClick={() => fetchBackendImage(contourField)}
                    disabled={isLoadingImage}
                    className="w-full mt-2 py-1 px-2 text-xs bg-emerald-600/20 text-emerald-400 rounded hover:bg-emerald-600/30 disabled:opacity-50"
                  >
                    {isLoadingImage ? '刷新中...' : '刷新图片'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 日志区域 */}
          <div className="mt-4">
            {renderLogs()}
          </div>
        </div>

        {/* 右侧统计面板 */}
        <aside className="w-72 bg-gray-900/50 border-l border-gray-800 p-4 overflow-y-auto">
          {results ? (
            renderStatistics()
          ) : (
            <div className="text-center text-gray-500 py-8">
              <BarChart3 size={32} className="mx-auto mb-2 opacity-50" />
              <div className="text-sm">计算完成后显示统计</div>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
};

export default DisturbanceEvaluation;
