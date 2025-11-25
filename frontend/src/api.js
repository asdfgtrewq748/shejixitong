const API_BASE = 'http://localhost:3001/api';

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
export async function calculateScore(weights) {
  const res = await fetch(`${API_BASE}/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weights }),
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
 * 生成设计方案
 */
export async function generateDesign(mode = 'composite') {
  const res = await fetch(`${API_BASE}/design`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
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
