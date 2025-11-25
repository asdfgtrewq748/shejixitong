import React, { useState, useRef } from 'react';
import { Upload, File, CheckCircle, AlertCircle, X, FileText, Info } from 'lucide-react';
import * as api from './api';

const FILE_TYPES = {
  boundary: {
    label: '采区边界',
    description: '定义采区的多边形边界顶点坐标',
    columns: 'x, y',
    example: '文件名包含"边界"或"boundary"',
    color: 'blue'
  },
  'borehole-coordinates': {
    label: '钻孔坐标',
    description: '定义每个钻孔的位置',
    columns: 'id, x, y 或 钻孔编号, 坐标X, 坐标Y',
    example: '文件名包含"坐标"或"coordinate"',
    color: 'amber'
  },
  'borehole-data': {
    label: '钻孔数据',
    description: '每个钻孔的地质参数',
    columns: 'id, rockHardness, gasContent, coalThickness, groundWater',
    example: '文件名包含"数据"或"data"',
    color: 'emerald'
  }
};

const FileUploader = ({ onUploadComplete, onLog }) => {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState([]);
  const [showHelp, setShowHelp] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files);
    addFiles(selectedFiles);
  };

  const addFiles = (newFiles) => {
    const csvFiles = newFiles.filter(f => f.name.endsWith('.csv'));
    if (csvFiles.length !== newFiles.length) {
      onLog?.('部分文件不是 CSV 格式，已忽略', 'warning');
    }
    setFiles(prev => [...prev, ...csvFiles.map(f => ({
      file: f,
      id: Date.now() + Math.random(),
      status: 'pending',
      type: detectFileType(f.name)
    }))]);
  };

  const detectFileType = (filename) => {
    const lower = filename.toLowerCase();
    if (lower.includes('边界') || lower.includes('boundary') || lower.includes('采区')) {
      return 'boundary';
    }
    if (lower.includes('坐标') || lower.includes('coordinate') || lower.includes('位置')) {
      return 'borehole-coordinates';
    }
    if (lower.includes('数据') || lower.includes('data') || lower.includes('属性')) {
      return 'borehole-data';
    }
    return 'unknown';
  };

  const removeFile = (id) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    addFiles(droppedFiles);
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    
    setUploading(true);
    setUploadResults([]);
    onLog?.('开始上传文件...', 'info');

    try {
      // 使用批量上传 API
      const fileList = files.map(f => f.file);
      const result = await api.uploadBatchCSV(fileList);
      
      setUploadResults(result.results || { success: [], errors: [] });
      
      if (result.success) {
        onLog?.(`${result.message}`, 'success');
        
        // 通知父组件更新数据
        if (onUploadComplete) {
          onUploadComplete({
            boundary: result.data?.boundary || [],
            boreholes: result.data?.boreholes || []
          });
        }
        
        // 更新文件状态
        setFiles(prev => prev.map(f => ({
          ...f,
          status: result.results?.success.some(s => f.file.name.includes(s.file.split('_')[0])) 
            ? 'success' 
            : result.results?.errors.some(e => f.file.name.includes(e.file.split('_')[0]))
              ? 'error'
              : 'success'
        })));
      } else {
        onLog?.(`上传失败: ${result.error}`, 'warning');
      }
    } catch (err) {
      onLog?.(`上传出错: ${err.message}`, 'warning');
      setFiles(prev => prev.map(f => ({ ...f, status: 'error' })));
    } finally {
      setUploading(false);
    }
  };

  const clearAll = () => {
    setFiles([]);
    setUploadResults([]);
  };

  const getTypeColor = (type) => {
    const colors = {
      boundary: 'text-blue-400 bg-blue-900/30 border-blue-500/50',
      'borehole-coordinates': 'text-amber-400 bg-amber-900/30 border-amber-500/50',
      'borehole-data': 'text-emerald-400 bg-emerald-900/30 border-emerald-500/50',
      unknown: 'text-gray-400 bg-gray-800/50 border-gray-600'
    };
    return colors[type] || colors.unknown;
  };

  const getStatusIcon = (status) => {
    if (status === 'success') return <CheckCircle size={16} className="text-green-400" />;
    if (status === 'error') return <AlertCircle size={16} className="text-red-400" />;
    return <File size={16} className="text-gray-400" />;
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
        <div className="bg-gray-800/50 rounded-lg p-3 space-y-3 text-xs border border-gray-700">
          <p className="text-gray-300">支持三种 CSV 文件类型，系统会根据文件名自动识别：</p>
          {Object.entries(FILE_TYPES).map(([key, info]) => (
            <div key={key} className={`p-2 rounded border ${getTypeColor(key)}`}>
              <div className="font-bold">{info.label}</div>
              <div className="text-gray-400 mt-1">{info.description}</div>
              <div className="text-gray-500 mt-1">列名: {info.columns}</div>
              <div className="text-gray-500">识别: {info.example}</div>
            </div>
          ))}
        </div>
      )}

      {/* 拖拽上传区域 */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`
          relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all
          ${dragOver 
            ? 'border-blue-500 bg-blue-900/20' 
            : 'border-gray-700 hover:border-gray-500 hover:bg-gray-800/30'}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".csv"
          onChange={handleFileSelect}
          className="hidden"
        />
        <Upload size={32} className={`mx-auto mb-2 ${dragOver ? 'text-blue-400' : 'text-gray-500'}`} />
        <p className="text-sm text-gray-300">拖拽 CSV 文件到此处</p>
        <p className="text-xs text-gray-500 mt-1">或点击选择文件（支持多选）</p>
      </div>

      {/* 文件列表 */}
      {files.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>已选择 {files.length} 个文件</span>
            <button onClick={clearAll} className="hover:text-white">清空列表</button>
          </div>
          
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {files.map((item) => (
              <div
                key={item.id}
                className={`flex items-center gap-2 p-2 rounded-lg border ${getTypeColor(item.type)}`}
              >
                {getStatusIcon(item.status)}
                <span className="flex-1 text-sm truncate">{item.file.name}</span>
                <span className="text-xs opacity-70">
                  {FILE_TYPES[item.type]?.label || '待识别'}
                </span>
                {item.status === 'pending' && (
                  <button
                    onClick={() => removeFile(item.id)}
                    className="text-gray-400 hover:text-white"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 上传结果 */}
      {uploadResults.success?.length > 0 && (
        <div className="bg-green-900/20 border border-green-500/50 rounded-lg p-3">
          <div className="text-green-400 text-xs font-bold mb-2">✓ 上传成功</div>
          {uploadResults.success.map((item, idx) => (
            <div key={idx} className="text-green-300 text-xs">
              {item.message}
            </div>
          ))}
        </div>
      )}

      {uploadResults.errors?.length > 0 && (
        <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-3">
          <div className="text-red-400 text-xs font-bold mb-2">✗ 上传失败</div>
          {uploadResults.errors.map((item, idx) => (
            <div key={idx} className="text-red-300 text-xs">
              {item.file}: {item.error}
            </div>
          ))}
        </div>
      )}

      {/* 上传按钮 */}
      {files.length > 0 && files.some(f => f.status === 'pending') && (
        <button
          onClick={handleUpload}
          disabled={uploading}
          className={`
            w-full py-3 rounded-xl font-bold text-sm uppercase tracking-wider transition-all
            ${uploading 
              ? 'bg-gray-700 text-gray-400 cursor-wait' 
              : 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-500 hover:to-purple-500'}
          `}
        >
          {uploading ? '上传中...' : `上传 ${files.filter(f => f.status === 'pending').length} 个文件`}
        </button>
      )}
    </div>
  );
};

export default FileUploader;
