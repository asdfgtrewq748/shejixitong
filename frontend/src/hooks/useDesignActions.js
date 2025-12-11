/**
 * useDesignActions Hook
 * 包含设计系统的业务逻辑：导入/导出/生成设计等函数
 */

import { useCallback } from 'react';
import * as api from '../api';
import { quickOptimizeSuccession } from '../api';

// 模拟边界数据（演示用）
const MINING_BOUNDARY = [
  { x: 100, y: 100 }, { x: 700, y: 80 }, { x: 750, y: 500 },
  { x: 600, y: 550 }, { x: 200, y: 520 }, { x: 100, y: 100 },
];

// 生成模拟钻孔数据
const generateBoreholes = (count) => {
  return Array.from({ length: count }, (_, i) => ({
    id: `ZK-${100 + i}`,
    x: 150 + Math.random() * 500,
    y: 120 + Math.random() * 350,
    rockHardness: 4 + Math.random() * 6,
    gasContent: Math.random() * 10,
    coalThickness: 2 + Math.random() * 5,
    groundWater: Math.random() * 100,
    scores: { safety: 0, economic: 0, env: 0 }
  }));
};

// 计算钻孔评分（本地计算，作为后备）
export const calculateScores = (boreholes) => {
  return boreholes.map(hole => {
    const safetyScore = Math.max(0, 100 - (hole.gasContent * 8) - (Math.abs(hole.rockHardness - 7) * 5));
    const economicScore = Math.min(100, hole.coalThickness * 15 + 20);
    const envScore = Math.max(0, 100 - (hole.groundWater * 0.8));
    return {
      ...hole,
      scores: {
        safety: Math.round(safetyScore),
        economic: Math.round(economicScore),
        env: Math.round(envScore)
      }
    };
  });
};

/**
 * useDesignActions Hook
 * @param {Object} options - 配置选项
 * @param {Array} options.boundary - 边界数据
 * @param {Array} options.boreholes - 钻孔数据
 * @param {Object} options.weights - 权重配置
 * @param {Object} options.designParams - 设计参数
 * @param {string} options.displayDimension - 显示维度
 * @param {Object} options.userEdits - 用户编辑
 * @param {string} options.activeTab - 当前标签页
 * @param {Function} options.setBoundary - 设置边界
 * @param {Function} options.setBoreholes - 设置钻孔
 * @param {Function} options.setScoreData - 设置评分数据
 * @param {Function} options.setDesignData - 设置设计数据
 * @param {Function} options.setActiveTab - 设置标签页
 * @param {Function} options.setLeftPanelMode - 设置左侧面板模式
 * @param {Function} options.setIsLoading - 设置加载状态
 * @param {Function} options.setSystemLog - 设置系统日志
 * @param {Function} options.setSettingsOpen - 设置设置面板状态
 * @param {Function} options.setViewInitialized - 设置视图初始化状态
 * @param {Function} options.setInitialSuccession - 设置初始接续方案
 * @param {Function} options.addLog - 添加日志
 */
const useDesignActions = ({
  boundary,
  boreholes,
  weights,
  designParams,
  displayDimension,
  userEdits,
  activeTab,
  setBoundary,
  setBoreholes,
  setScoreData,
  setDesignData,
  setActiveTab,
  setLeftPanelMode,
  setIsLoading,
  setSystemLog,
  setSettingsOpen,
  setViewInitialized,
  setInitialSuccession,
  addLog
}) => {

  // 导出报告
  const handleExportReport = useCallback(() => {
    const reportData = {
      generatedAt: new Date().toISOString(),
      boundary: boundary,
      boreholes: boreholes.map(b => ({
        id: b.id,
        x: b.x,
        y: b.y,
        scores: b.scores
      })),
      weights: weights,
      activeTab: activeTab
    };
    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `geomind-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addLog('报告已导出', 'success');
  }, [boundary, boreholes, weights, activeTab, addLog]);

  // DXF导出
  const handleExportDXF = useCallback(async () => {
    try {
      addLog('正在导出 DXF 设计图纸...', 'loading');
      await api.exportDesignDXF();
      addLog('DXF 导出成功', 'success');
    } catch (e) {
      addLog('DXF 导出失败: ' + e.message, 'warning');
    }
  }, [addLog]);

  // CSV 文件上传完成回调
  const handleFileUploadComplete = useCallback(async (data) => {
    if (data.boundary && data.boundary.length > 0) {
      setBoundary(data.boundary);
      addLog(`采区边界已导入 [顶点: ${data.boundary.length}]`, 'success');
    }

    if (data.boreholes && data.boreholes.length > 0) {
      // 设置钻孔数据
      setBoreholes(data.boreholes);
      addLog(`钻孔数据已导入 [数量: ${data.boreholes.length}]`, 'success');

      // 生成地质模型
      try {
        addLog('正在生成地质模型...', 'loading');
        await api.generateGeology(50);
        addLog('地质模型生成成功', 'success');
      } catch (err) {
        addLog(`地质模型生成失败: ${err.message}`, 'warning');
      }

      // 切换到分析标签页
      setActiveTab('analysis');
      // 切换左侧面板到地质模型视图
      setLeftPanelMode('model');
    }
  }, [setBoundary, setBoreholes, setActiveTab, setLeftPanelMode, addLog]);

  // 导入边界（演示模式）
  const handleImportBoundary = useCallback(async () => {
    setIsLoading(true);
    addLog('正在解析 DXF 矢量数据...', 'loading');
    try {
      // 实际项目中可替换为文件解析，这里用模拟边界演示
      await api.uploadBoundary(MINING_BOUNDARY);
      setBoundary(MINING_BOUNDARY);
      addLog(`采区边界模型构建完成 [顶点: ${MINING_BOUNDARY.length}]`, 'success');
    } catch (err) {
      addLog('边界上传失败: ' + err.message, 'warning');
    } finally {
      setIsLoading(false);
    }
  }, [setBoundary, setIsLoading, addLog]);

  // 导入钻孔（演示模式）
  const handleImportBoreholes = useCallback(async () => {
    if (boundary.length === 0) return;
    setIsLoading(true);
    addLog('正在连接地质数据库 GeoDB_v4...', 'loading');
    try {
      // 生成模拟钻孔并上传到后端
      const rawData = generateBoreholes(30);
      await api.uploadBoreholes(rawData);
      addLog(`检索到 ${rawData.length} 个钻孔样本`, 'info');
      addLog('正在执行多维评分算法...', 'loading');
      // 调用后端计算评分
      const result = await api.calculateScore(weights);
      setBoreholes(result.boreholes || []);
      addLog('地质数据评分矩阵计算完毕', 'success');
      setActiveTab('analysis');
      // 切换左侧面板到地质模型视图
      setLeftPanelMode('model');
    } catch (err) {
      addLog('钻孔数据处理失败: ' + err.message, 'warning');
    } finally {
      setIsLoading(false);
    }
  }, [boundary.length, weights, setBoreholes, setActiveTab, setLeftPanelMode, setIsLoading, addLog]);

  // 生成设计方案
  const handleGenerateDesign = useCallback(async () => {
    setIsLoading(true);
    addLog('启动智能采矿设计引擎...', 'warning');
    try {
      // 1. 获取高分辨率评分网格数据
      addLog('生成全区地质评分网格 (50x50分辨率)...', 'info');
      const scoreResult = await api.calculateScore(weights, 50);
      setScoreData({
        grids: scoreResult.grids,
        contours: scoreResult.contours,
        stats: scoreResult.stats
      });

      // 更新边界和钻孔为归一化坐标（评分API现在也返回归一化数据）
      if (scoreResult.boundary && scoreResult.boundary.length > 0) {
        setBoundary(scoreResult.boundary);
      }
      if (scoreResult.boreholes && scoreResult.boreholes.length > 0) {
        setBoreholes(scoreResult.boreholes);
      }

      addLog(`评分网格生成完成 (${Object.keys(scoreResult.grids || {}).length}个维度)`, 'success');

      // 2. 调用后端生成设计方案（传入规程参数）
      addLog('应用采矿规程约束，优化工作面布局...', 'info');

      const params = {
        mode: displayDimension,
        faceWidth: designParams.faceWidth,
        pillarWidth: designParams.pillarWidth,
        boundaryMargin: designParams.boundaryMargin,
        dipAngle: designParams.dipAngle,
        dipDirection: designParams.dipDirection,
        miningRules: {
          faceLength: {
            min: designParams.faceLengthMin,
            max: designParams.faceLengthMax,
            preferred: Math.round((designParams.faceLengthMin + designParams.faceLengthMax) / 2)
          },
          layoutDirection: designParams.layoutDirection
        },
        userEdits: userEdits.roadways.length > 0 || userEdits.workfaces.length > 0
          ? userEdits
          : undefined
      };

      addLog(`设计参数: 工作面长度=${designParams.faceLengthMin}-${designParams.faceLengthMax}m, 推进长度=${designParams.faceWidth}m`, 'info');
      addLog(`布置方式: ${designParams.layoutDirection === 'strike' ? '走向长壁' : '倾向长壁'}`, 'info');

      if (params.userEdits) {
        addLog(`包含用户自定义: ${userEdits.roadways.length}条巷道, ${userEdits.workfaces.length}个工作面`, 'info');
      }

      const design = await api.generateDesign(params);
      setDesignData(design);

      // 更新边界和钻孔数据为归一化后的坐标（与设计方案一致）
      if (design.boundary && design.boundary.length > 0) {
        setBoundary(design.boundary);
      }
      if (design.boreholes && design.boreholes.length > 0) {
        setBoreholes(design.boreholes);
      }

      // 重置视图以适应新的坐标
      if (setViewInitialized) {
        setViewInitialized(false);
      }

      // 显示设计结果统计
      const workfaces = design.workfaces || design.panels || [];
      const roadways = design.roadways || [];
      const stats = design.stats || {};

      addLog(`======= 设计方案生成完成 =======`, 'success');
      addLog(`工作面数量: ${workfaces.length}个`, 'info');
      addLog(`  - 符合规程: ${stats.validCount || workfaces.length}个`, 'success');
      if (stats.invalidCount > 0) {
        addLog(`  - 需调整: ${stats.invalidCount}个`, 'warning');
      }
      addLog(`平均工作面长度: ${stats.avgFaceLength || 0}m`, 'info');
      addLog(`巷道总数: ${roadways.length}条`, 'info');
      addLog(`平均评分: ${stats.avgScore || 0}分`, 'info');
      addLog(`开采方式: ${stats.miningMethod || '走向长壁后退式'}`, 'info');

      // 3. 自动生成初始接续方案
      if (workfaces.length > 0 && setInitialSuccession) {
        addLog('正在生成初始接续方案...', 'loading');
        try {
          // 格式化工作面数据
          const formattedPanels = workfaces.map((panel, index) => ({
            id: panel.id || `WF-${String(index + 1).padStart(2, '0')}`,
            length: panel.length || 200,
            width: panel.width || 1000,
            center_x: panel.center_x || panel.center?.[0] || 0,
            center_y: panel.center_y || panel.center?.[1] || 0,
            avgThickness: panel.avgThickness || 2.0,
            avgScore: panel.avgScore || 75,
          }));

          // 使用顺序策略生成初始接续方案
          const successionResult = await quickOptimizeSuccession(formattedPanels, 'sequential');
          setInitialSuccession(successionResult);
          addLog(`初始接续方案已生成 (顺序策略)`, 'success');
          addLog(`  - 总工期: ${successionResult.summary?.total_months || 0}月`, 'info');
          addLog(`  - 累计产量: ${((successionResult.summary?.cumulative_production || 0) / 10000).toFixed(1)}万吨`, 'info');
        } catch (successionErr) {
          addLog('初始接续方案生成失败: ' + successionErr.message, 'warning');
          // 不影响主流程，继续执行
        }
      }

      setActiveTab('synthesis');
    } catch (err) {
      addLog('设计生成失败: ' + err.message, 'warning');
    } finally {
      setIsLoading(false);
    }
  }, [
    weights, designParams, displayDimension, userEdits,
    setBoundary, setBoreholes, setScoreData, setDesignData,
    setActiveTab, setIsLoading, setViewInitialized, setInitialSuccession, addLog
  ]);

  // 重置所有数据
  const handleResetAll = useCallback(() => {
    setBoundary([]);
    setBoreholes([]);
    setScoreData(null);
    setDesignData(null);
    setActiveTab('import');
    setSystemLog([]);
    addLog('系统已重置', 'warning');
    setSettingsOpen(false);
  }, [setBoundary, setBoreholes, setScoreData, setDesignData, setActiveTab, setSystemLog, setSettingsOpen, addLog]);

  return {
    handleExportReport,
    handleExportDXF,
    handleFileUploadComplete,
    handleImportBoundary,
    handleImportBoreholes,
    handleGenerateDesign,
    handleResetAll,
  };
};

export default useDesignActions;
