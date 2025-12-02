const API_BASE = 'http://localhost:3001/api';

// ==================== CSV 文件上传 API ====================

/**
 * 上传采区边界 CSV 文件
 */
export async function uploadBoundaryCSV(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/upload/boundary`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || error.error || '上传失败');
  }
  const result = await res.json();
  return result.data || result;
}

/**
 * 上传钻孔坐标 CSV 文件
 */
export async function uploadBoreholeCoordinatesCSV(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/upload/borehole-coordinates`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || error.error || '上传失败');
  }
  const result = await res.json();
  return result.data || result;
}

/**
 * 上传钻孔数据 CSV 文件
 */
export async function uploadBoreholeDataCSV(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/upload/borehole-data`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || error.error || '上传失败');
  }
  const result = await res.json();
  return result.data || result;
}

/**
 * 批量上传多个 CSV 文件
 */
export async function uploadBatchCSV(files) {
  const formData = new FormData();
  files.forEach(file => {
    formData.append('files', file);
  });
  const res = await fetch(`${API_BASE}/upload/batch`, {
    method: 'POST',
    body: formData,
  });
  return res.json();
}

/**
 * 获取 CSV 模板说明
 */
export async function getCSVTemplate(type) {
  const res = await fetch(`${API_BASE}/upload/template/${type}`);
  return res.json();
}

/**
 * 获取数据导入状态
 */
export async function getUploadStatus() {
  const res = await fetch(`${API_BASE}/upload/status`);
  return res.json();
}

/**
 * 批量上传钻孔分层数据（新API）
 */
export async function uploadBoreholeLayers(files, targetCoalSeam = null) {
  const formData = new FormData();
  files.forEach(file => {
    formData.append('files', file);
  });
  if (targetCoalSeam) {
    formData.append('targetCoalSeam', targetCoalSeam);
  }
  const res = await fetch(`${API_BASE}/boreholes/batch-upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || error.error || '上传失败');
  }
  return res.json();
}

/**
 * 合并钻孔坐标和分层数据
 */
export async function mergeBoreholeData() {
  const res = await fetch(`${API_BASE}/boreholes/merge-with-coordinates`, {
    method: 'POST',
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || error.error || '合并失败');
  }
  return res.json();
}

/**
 * 获取可用的煤层列表
 */
export async function getCoalSeams() {
  const res = await fetch(`${API_BASE}/boreholes/coal-seams`);
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || '获取煤层列表失败');
  }
  return res.json();
}

// ==================== 原有 API ====================

/**
 * 上传采区边界
 */
export async function uploadBoundary(points) {
  const res = await fetch(`${API_BASE}/boundary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ points }),
  });
  return res.json();
}

/**
 * 获取当前边界
 */
export async function getBoundary() {
  const res = await fetch(`${API_BASE}/boundary`);
  return res.json();
}

/**
 * 上传钻孔数据
 */
export async function uploadBoreholes(boreholes) {
  const res = await fetch(`${API_BASE}/boreholes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ boreholes }),
  });
  return res.json();
}

/**
 * 获取钻孔列表
 */
export async function getBoreholes() {
  const res = await fetch(`${API_BASE}/boreholes`);
  return res.json();
}

/**
 * 计算评分（传入权重）
 */
export async function calculateScore(weights, resolution = 50) {
  const res = await fetch(`${API_BASE}/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weights, resolution }),
  });
  return res.json();
}

/**
 * 获取评分结果
 */
export async function getScore() {
  const res = await fetch(`${API_BASE}/score`);
  return res.json();
}

/**
 * 获取指定类型的评分网格
 */
export async function getScoreGrid(type) {
  const res = await fetch(`${API_BASE}/score/grid/${type}`);
  return res.json();
}

/**
 * 生成设计方案
 */
export async function generateDesign(options = {}) {
  const res = await fetch(`${API_BASE}/design`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  return res.json();
}

/**
 * 获取设计方案
 */
export async function getDesign() {
  const res = await fetch(`${API_BASE}/design`);
  return res.json();
}

/**
 * 生成地质模型
 */
export async function generateGeology(resolution = 50) {
  const res = await fetch(`${API_BASE}/geology`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolution }),
  });
  return res.json();
}

/**
 * 获取地质模型
 */
export async function getGeology() {
  const res = await fetch(`${API_BASE}/geology`);
  return res.json();
}

/**
 * 导出设计方案为DXF文件
 */
export async function exportDesignDXF() {
  const res = await fetch(`${API_BASE}/design/export/dxf`);
  
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || '导出失败');
  }
  
  // 获取文件blob
  const blob = await res.blob();
  
  // 创建下载链接
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mining_design_${Date.now()}.dxf`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}
