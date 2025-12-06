const API_BASE = 'http://localhost:3001/api';

// ==================== 通用请求封装（带重试机制）====================

class ApiError extends Error {
  constructor(message, status, detail = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

/**
 * 通用请求函数，支持自动重试
 * @param {string} url - 请求URL
 * @param {Object} options - fetch选项
 * @param {number} maxRetries - 最大重试次数（默认3次）
 * @param {number} retryDelay - 重试延迟基数（毫秒，会指数增长）
 */
async function apiRequest(url, options = {}, maxRetries = 3, retryDelay = 1000) {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30秒超时

      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        let errorDetail = null;
        try {
          errorDetail = await res.json();
        } catch (e) {
          // 无法解析JSON
        }
        throw new ApiError(
          errorDetail?.detail || errorDetail?.error || res.statusText || '请求失败',
          res.status,
          errorDetail
        );
      }

      return res;
    } catch (err) {
      lastError = err;

      // 不重试的情况：客户端错误(4xx)、主动取消
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        throw err;
      }
      if (err.name === 'AbortError') {
        throw new ApiError('请求超时', 408);
      }

      // 网络错误或服务器错误，等待后重试
      if (attempt < maxRetries - 1) {
        const delay = retryDelay * Math.pow(2, attempt); // 指数退避
        console.warn(`API请求失败，${delay}ms后重试 (${attempt + 1}/${maxRetries}):`, err.message);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // 所有重试都失败
  if (lastError?.message === 'Failed to fetch') {
    throw new ApiError('无法连接到后端服务，请确保后端已启动 (端口 3001)', 0);
  }
  throw lastError;
}

/**
 * GET请求封装
 */
async function apiGet(endpoint) {
  const res = await apiRequest(`${API_BASE}${endpoint}`);
  return res.json();
}

/**
 * POST请求封装（JSON）
 */
async function apiPost(endpoint, data = {}) {
  const res = await apiRequest(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

/**
 * POST请求封装（FormData，用于文件上传）
 */
async function apiPostForm(endpoint, formData) {
  const res = await apiRequest(`${API_BASE}${endpoint}`, {
    method: 'POST',
    body: formData,
  });
  return res.json();
}

// ==================== CSV 文件上传 API ====================

/**
 * 上传采区边界 CSV 文件
 */
export async function uploadBoundaryCSV(file) {
  const formData = new FormData();
  formData.append('file', file);
  const result = await apiPostForm('/upload/boundary', formData);
  return result.data || result;
}

/**
 * 上传钻孔坐标 CSV 文件
 */
export async function uploadBoreholeCoordinatesCSV(file) {
  const formData = new FormData();
  formData.append('file', file);
  const result = await apiPostForm('/upload/borehole-coordinates', formData);
  return result.data || result;
}

/**
 * 上传钻孔数据 CSV 文件
 */
export async function uploadBoreholeDataCSV(file) {
  const formData = new FormData();
  formData.append('file', file);
  const result = await apiPostForm('/upload/borehole-data', formData);
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
  return apiPostForm('/upload/batch', formData);
}

/**
 * 获取 CSV 模板说明
 */
export async function getCSVTemplate(type) {
  return apiGet(`/upload/template/${type}`);
}

/**
 * 获取数据导入状态
 */
export async function getUploadStatus() {
  return apiGet('/upload/status');
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
  return apiPostForm('/boreholes/batch-upload', formData);
}

/**
 * 合并钻孔坐标和分层数据
 */
export async function mergeBoreholeData() {
  return apiPost('/boreholes/merge-with-coordinates');
}

/**
 * 获取可用的煤层列表
 */
export async function getCoalSeams() {
  return apiGet('/boreholes/coal-seams');
}

// ==================== 原有 API ====================

/**
 * 上传采区边界
 */
export async function uploadBoundary(points) {
  return apiPost('/boundary/', { points });
}

/**
 * 获取当前边界
 */
export async function getBoundary() {
  return apiGet('/boundary/');
}

/**
 * 上传钻孔数据
 */
export async function uploadBoreholes(boreholes) {
  return apiPost('/boreholes/', { boreholes });
}

/**
 * 获取钻孔列表
 */
export async function getBoreholes() {
  return apiGet('/boreholes/');
}

/**
 * 计算评分（传入权重）
 */
export async function calculateScore(weights, resolution = 50) {
  return apiPost('/score/', { weights, resolution });
}

/**
 * 获取评分结果
 */
export async function getScore() {
  return apiGet('/score/');
}

/**
 * 获取指定类型的评分网格
 */
export async function getScoreGrid(type) {
  return apiGet(`/score/grid/${type}`);
}

/**
 * 生成设计方案
 */
export async function generateDesign(options = {}) {
  return apiPost('/design/', options);
}

/**
 * 获取设计方案
 */
export async function getDesign() {
  return apiGet('/design/');
}

/**
 * 生成地质模型
 */
export async function generateGeology(resolution = 50) {
  return apiPost('/geology/', { resolution });
}

/**
 * 获取地质模型
 */
export async function getGeology() {
  return apiGet('/geology/');
}

/**
 * 获取钻孔分层数据（用于3D地质建模）
 */
export async function getBoreholeLayers() {
  return apiGet('/geology/layers');
}

/**
 * 导出设计方案为DXF文件
 */
export async function exportDesignDXF() {
  const res = await apiRequest(`${API_BASE}/design/export/dxf`);

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

// 导出ApiError类供外部使用
export { ApiError };
