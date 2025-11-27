import React, { useState } from 'react';
import { Upload, CheckCircle, AlertCircle, X, FileText, Info } from 'lucide-react';
import * as api from './api';

const FileUploader = ({ onUploadComplete, onLog }) => {
  const [boundaryFile, setBoundaryFile] = useState(null);
  const [coordinatesFile, setCoordinatesFile] = useState(null);
  const [dataFiles, setDataFiles] = useState([]); // 改为数组支持多文件
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
          const boundaryResult = await api.uploadBoundaryCSV(boundaryFile);
          setUploadStatus(prev => ({ ...prev, boundary: 'success' }));
          results.boundary = boundaryResult.boundary;
          onLog?.(`采区边界上传成功 [${boundaryResult.boundary?.length || 0}个顶点]`, 'success');
        } catch (err) {
          setUploadStatus(prev => ({ ...prev, boundary: 'error' }));
          onLog?.(`采区边界上传失败: ${err.message}`, 'warning');
        }
      }

      // 2. 上传钻孔坐标
      if (coordinatesFile) {
        try {
          onLog?.('正在上传钻孔坐标...', 'loading');
          const coordResult = await api.uploadBoreholeCoordinatesCSV(coordinatesFile);
          setUploadStatus(prev => ({ ...prev, coordinates: 'success' }));
          onLog?.(`钻孔坐标上传成功 [${coordResult.count || 0}个钻孔]`, 'success');
        } catch (err) {
          setUploadStatus(prev => ({ ...prev, coordinates: 'error' }));
          onLog?.(`钻孔坐标上传失败: ${err.message}`, 'warning');
        }
      }

      // 3. 上传钻孔数据（支持多个文件）
      if (dataFiles.length > 0) {
        try {
          onLog?.(`正在上传钻孔数据 [${dataFiles.length}个文件]...`, 'loading');
          let successCount = 0;
          let errorCount = 0;
          
          for (const file of dataFiles) {
            try {
              await api.uploadBoreholeDataCSV(file);
              successCount++;
            } catch (err) {
              errorCount++;
              onLog?.(`${file.name} 上传失败: ${err.message}`, 'warning');
            }
          }
          
          if (successCount > 0) {
            setUploadStatus(prev => ({ ...prev, data: 'success' }));
            onLog?.(`钻孔数据上传完成 [成功${successCount}个，失败${errorCount}个]`, 'success');
          } else {
            setUploadStatus(prev => ({ ...prev, data: 'error' }));
          }
        } catch (err) {
          setUploadStatus(prev => ({ ...prev, data: 'error' }));
          onLog?.(`钻孔数据上传失败: ${err.message}`, 'warning');
        }
      }

      // 4. 获取合并后的钻孔数据
      if (coordinatesFile || dataFiles.length > 0) {
        try {
          const boreholesResult = await api.getBoreholes();
          results.boreholes = boreholesResult;
          onLog?.('钻孔数据合并完成', 'success');
        } catch (err) {
          onLog?.('获取钻孔数据失败', 'warning');
        }
      }

      // 回调通知父组件
      onUploadComplete?.(results);
      
    } catch (error) {
      onLog?.(`上传过程出错: ${error.message}`, 'warning');
    } finally {
      setUploading(false);
    }
  };

  const renderFileInput = (type, file, setFile, label, description, color, isMultiple = false) => {
    const status = uploadStatus[type];
    const files = isMultiple ? file : (file ? [file] : []);
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
            <div>• <span className="text-amber-400">钻孔坐标</span>：包含孔号、x、y、孔口高程列</div>
            <div>• <span className="text-emerald-400">钻孔数据</span>：包含孔号、顶板高程、底板高程列（可选择多个钻孔文件）</div>
          </div>
        </div>
      )}

      {/* 三个独立的文件上传区 */}
      <div className="space-y-3">
        {renderFileInput('boundary', boundaryFile, setBoundaryFile, '采区边界', '上传采区边界坐标 CSV 文件', 'blue', false)}
        {renderFileInput('coordinates', coordinatesFile, setCoordinatesFile, '钻孔坐标', '上传钻孔坐标 CSV 文件', 'amber', false)}
        {renderFileInput('data', dataFiles, setDataFiles, '钻孔数据', '上传钻孔数据 CSV 文件（支持多个文件）', 'emerald', true)}
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
