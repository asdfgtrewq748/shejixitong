import React, { useState } from 'react';
import { Upload, CheckCircle, AlertCircle, X, FileText, Info } from 'lucide-react';
import * as api from './api';

const FileUploader = ({ onUploadComplete, onLog }) => {
  const [boundaryFile, setBoundaryFile] = useState(null);
  const [coordinatesFile, setCoordinatesFile] = useState(null);
  const [dataFiles, setDataFiles] = useState([]); // 改为数组支持多文件
  const [targetCoalSeam, setTargetCoalSeam] = useState(''); // 目标煤层
  const [uploading, setUploading] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [uploadStatus, setUploadStatus] = useState({
    boundary: null,
    coordinates: null,
    data: null
  });

  const handleFileSelect = (type, e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    
    // 检查文件类型
    const invalidFiles = files.filter(f => !f.name.endsWith('.csv'));
    if (invalidFiles.length > 0) {
      onLog?.(`请选择 CSV 文件`, 'warning');
      return;
    }

    switch (type) {
      case 'boundary':
        setBoundaryFile(files[0]);
        setUploadStatus(prev => ({ ...prev, boundary: null }));
        break;
      case 'coordinates':
        setCoordinatesFile(files[0]);
        setUploadStatus(prev => ({ ...prev, coordinates: null }));
        break;
      case 'data':
        setDataFiles(files); // 支持多个钻孔文件
        setUploadStatus(prev => ({ ...prev, data: null }));
        break;
    }
  };

  const handleUpload = async () => {
    if (!boundaryFile && !coordinatesFile && dataFiles.length === 0) {
      onLog?.('请至少选择一个文件', 'warning');
      return;
    }

    setUploading(true);
    onLog?.('开始上传文件...', 'info');

    try {
      const results = { boundary: null, boreholes: null };

      // 1. 上传采区边界
      if (boundaryFile) {
        try {
          onLog?.('正在上传采区边界...', 'loading');
          const result = await api.uploadBoundaryCSV(boundaryFile);
          setUploadStatus(prev => ({ ...prev, boundary: 'success' }));
          results.boundary = result.boundary;
          onLog?.(`采区边界上传成功 [${result.boundary?.length || 0}个顶点]`, 'success');
        } catch (err) {
          setUploadStatus(prev => ({ ...prev, boundary: 'error' }));
          onLog?.(`采区边界上传失败: ${err.message}`, 'warning');
        }
      }

      // 2. 上传钻孔坐标
      if (coordinatesFile) {
        try {
          onLog?.('正在上传钻孔坐标...', 'loading');
          const result = await api.uploadBoreholeCoordinatesCSV(coordinatesFile);
          setUploadStatus(prev => ({ ...prev, coordinates: 'success' }));
          onLog?.(`钻孔坐标上传成功 [${result.count || 0}个钻孔]`, 'success');
        } catch (err) {
          setUploadStatus(prev => ({ ...prev, coordinates: 'error' }));
          onLog?.(`钻孔坐标上传失败: ${err.message}`, 'warning');
        }
      }

      // 3. 上传钻孔分层数据（使用新API批量上传）
      if (dataFiles.length > 0) {
        try {
          onLog?.(`正在上传钻孔数据 [${dataFiles.length}个文件]...`, 'loading');
          
          const result = await api.uploadBoreholeLayers(dataFiles, targetCoalSeam || null);
          
          if (result.results?.success?.length > 0) {
            setUploadStatus(prev => ({ ...prev, data: 'success' }));
            onLog?.(`钻孔数据上传完成 [成功${result.results.success.length}个，失败${result.results.errors.length}个]`, 'success');
            
            // 显示煤层信息
            if (result.results.summary?.煤层统计) {
              const coalInfo = Object.entries(result.results.summary.煤层统计)
                .map(([name, stat]) => `${name}(${stat.钻孔数}孔,平均${stat.平均厚度}m)`)
                .join(', ');
              onLog?.(`煤层分布: ${coalInfo}`, 'info');
            }
          } else {
            setUploadStatus(prev => ({ ...prev, data: 'error' }));
            onLog?.(`钻孔数据上传失败`, 'warning');
          }
        } catch (err) {
          setUploadStatus(prev => ({ ...prev, data: 'error' }));
          onLog?.(`钻孔数据上传失败: ${err.message}`, 'warning');
        }
      }

      // 4. 合并钻孔坐标和分层数据
      if (coordinatesFile && dataFiles.length > 0) {
        try {
          onLog?.('正在合并钻孔数据...', 'loading');
          const mergeResult = await api.mergeBoreholeData();
          results.boreholes = mergeResult.data?.boreholes || [];
          onLog?.(`钻孔数据合并完成 [${mergeResult.data?.count || 0}个钻孔]`, 'success');
          
          if (mergeResult.unmatched && mergeResult.unmatched.length > 0) {
            onLog?.(`⚠️ ${mergeResult.unmatched.length}个钻孔未找到坐标: ${mergeResult.unmatched.join(', ')}`, 'warning');
          }
        } catch (err) {
          onLog?.(`数据合并失败: ${err.message}`, 'warning');
        }
      } else if (dataFiles.length > 0) {
        onLog?.('⚠️ 请同时上传钻孔坐标文件以完成数据合并', 'warning');
      }

      // 回调通知父组件
      onUploadComplete?.(results);
      
    } catch (error) {
      onLog?.(`上传过程出错: ${error.message}`, 'warning');
    } finally {
      setUploading(false);
    }
  };

  const renderFileInput = (type, fileOrFiles, setFile, label, description, color, isMultiple = false) => {
    const status = uploadStatus[type];
    const files = isMultiple ? fileOrFiles : (fileOrFiles ? [fileOrFiles] : []);
    const hasFiles = files.length > 0;
    
    return (
      <div className={`glass-panel rounded-lg p-4 border-2 ${
        status === 'success' ? 'border-green-500/50' :
        status === 'error' ? 'border-red-500/50' :
        hasFiles ? `border-${color}-500/50` : 'border-gray-700'
      }`}>
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <h3 className={`font-semibold text-${color}-400 flex items-center gap-2`}>
              <FileText size={16} />
              {label}
              {isMultiple && hasFiles && <span className="text-xs text-gray-400">({files.length}个文件)</span>}
            </h3>
            <p className="text-xs text-gray-400 mt-1">{description}</p>
          </div>
          {status === 'success' && <CheckCircle size={20} className="text-green-400" />}
          {status === 'error' && <AlertCircle size={20} className="text-red-400" />}
        </div>

        {hasFiles ? (
          <div className="space-y-2">
            {files.slice(0, isMultiple ? files.length : 1).map((f, idx) => (
              <div key={idx} className="flex items-center justify-between bg-gray-800/50 rounded px-3 py-2">
                <span className="text-sm text-gray-300 truncate flex-1">{f.name}</span>
                {!isMultiple && (
                  <button
                    onClick={() => {
                      setFile(null);
                      setUploadStatus(prev => ({ ...prev, [type]: null }));
                    }}
                    className="ml-2 text-gray-400 hover:text-red-400 transition-colors"
                    disabled={uploading}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            ))}
            {isMultiple && (
              <button
                onClick={() => {
                  setFile([]);
                  setUploadStatus(prev => ({ ...prev, [type]: null }));
                }}
                className="text-xs text-gray-400 hover:text-red-400 transition-colors flex items-center gap-1"
                disabled={uploading}
              >
                <X size={14} /> 清除所有文件
              </button>
            )}
          </div>
        ) : (
          <label className={`block border-2 border-dashed border-gray-600 rounded-lg p-4 text-center cursor-pointer hover:border-${color}-500 transition-colors`}>
            <input
              type="file"
              accept=".csv"
              multiple={isMultiple}
              onChange={(e) => handleFileSelect(type, e)}
              className="hidden"
              disabled={uploading}
            />
            <Upload size={24} className="mx-auto mb-2 text-gray-500" />
            <p className="text-sm text-gray-400">点击选择 CSV 文件{isMultiple ? '（支持多选）' : ''}</p>
          </label>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* 帮助说明 */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-white flex items-center gap-2">
          <Upload size={16} className="text-blue-400" /> CSV 文件导入
        </h4>
        <button
          onClick={() => setShowHelp(!showHelp)}
          className="text-gray-400 hover:text-white text-xs flex items-center gap-1"
        >
          <Info size={14} /> {showHelp ? '隐藏说明' : '查看说明'}
        </button>
      </div>

      {showHelp && (
        <div className="bg-gray-800/50 rounded-lg p-3 text-xs border border-gray-700 space-y-2">
          <p className="text-gray-300">请分别上传以下三种 CSV 文件：</p>
          <div className="space-y-1 text-gray-400">
            <div>• <span className="text-blue-400">采区边界</span>：包含 x, y 坐标列</div>
            <div>• <span className="text-amber-400">钻孔坐标</span>：包含 钻孔名, 坐标x, 坐标y 列</div>
            <div>• <span className="text-emerald-400">钻孔数据</span>：分层岩性数据（序号, 名称, 厚度/m 列，支持多个钻孔文件）</div>
            <div className="text-yellow-400 mt-2">💡 系统会自动从岩层数据中识别煤层并计算埋深</div>
          </div>
        </div>
      )}

      {/* 目标煤层选择 */}
      {dataFiles.length > 0 && (
        <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-lg p-3">
          <label className="block text-xs text-yellow-400 mb-2">
            目标煤层（可选，留空则自动选择最厚煤层）
          </label>
          <input
            type="text"
            value={targetCoalSeam}
            onChange={(e) => setTargetCoalSeam(e.target.value)}
            placeholder="例如: 16-3煤"
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-yellow-500 focus:outline-none"
            disabled={uploading}
          />
          <p className="text-xs text-gray-400 mt-1">
            提示：如果钻孔包含多个煤层，请指定要设计的煤层名称
          </p>
        </div>
      )}

      {/* 三个独立的文件上传区 */}
      <div className="space-y-3">
        {renderFileInput('boundary', boundaryFile, setBoundaryFile, '采区边界', '上传采区边界坐标 CSV 文件（x, y）', 'blue', false)}
        {renderFileInput('coordinates', coordinatesFile, setCoordinatesFile, '钻孔坐标', '上传钻孔坐标 CSV 文件（钻孔名, 坐标x, 坐标y）', 'amber', false)}
        {renderFileInput('data', dataFiles, setDataFiles, '钻孔分层数据', '上传所有钻孔的岩层CSV文件（序号, 名称, 厚度/m）', 'emerald', true)}
      </div>

      {/* 上传按钮 */}
      <button
        onClick={handleUpload}
        disabled={uploading || (!boundaryFile && !coordinatesFile && dataFiles.length === 0)}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
      >
        {uploading ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
            <span>上传中...</span>
          </>
        ) : (
          <>
            <Upload size={16} />
            <span>开始上传</span>
          </>
        )}
      </button>
    </div>
  );
};

export default FileUploader;
