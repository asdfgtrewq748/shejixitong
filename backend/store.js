/**
 * 内存存储 - 实际项目中应替换为数据库
 *
 * 说明：为了便于开发体验，模块加载时会尝试从仓库根目录下的 `input/` 目录读取
 * - `zuobiao.csv`（或同名坐标文件）作为钻孔坐标：包含 id,x,y
 * - `测试钻孔/` 目录下的 BK-*.csv 作为每个钻孔的属性数据（会计算数值列的均值聚合）
 *
 * 生成结果会写入 `store.boundary` 和 `store.boreholes`，便于前端直接使用内置数据。
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const store = {
  boundary: [],              // 采区边界顶点数组 [{ x, y }, ...]
  boreholes: [],             // 钻孔列表 (合并后)
  boreholeCoordinates: [],   // 钻孔坐标 (临时)
  boreholeData: [],          // 钻孔数据 (临时)
  scores: null,              // 计算后的评分结果
  design: null,              // 生成的设计方案
};

// Helper: 简单 CSV 解析（用于内置示例，不处理复杂 CSV 转义）
function parseCSV(content) {
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return []
  const headers = lines[0].split(',').map(h => h.trim())
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    const obj = {}
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = (cols[j] || '').trim()
    }
    rows.push(obj)
  }
  return rows
}

function tryLoadInput() {
  try {
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = path.dirname(__filename)
    const projectRoot = path.resolve(__dirname, '..')
    const inputDir = path.join(projectRoot, 'input')

    if (!fs.existsSync(inputDir)) return

    // 1) 读取坐标文件 (优先 zuobiao.csv / zuobiao .csv 忽略大小写)
    const coordCandidates = ['zuobiao.csv', 'zuobiao.csv'.toLowerCase(), 'zuobiao.csv'.toUpperCase(), 'coordinates.csv', '坐标.csv']
    let coordFile = null
    for (const f of fs.readdirSync(inputDir)) {
      const low = f.toLowerCase()
      if (low.includes('zuobiao') || low.includes('坐标') || low.includes('coordinate')) {
        coordFile = path.join(inputDir, f)
        break
      }
    }

    let coords = []
    if (coordFile && fs.existsSync(coordFile)) {
      const txt = fs.readFileSync(coordFile, 'utf8')
      const rows = parseCSV(txt)
      rows.forEach(r => {
        // 兼容多种列名
        const id = r.id || r.ID || r['钻孔编号'] || r['钻孔ID'] || (r.name || r.Name)
        const x = parseFloat(r.x || r.X || r['坐标X'] || r['x'])
        const y = parseFloat(r.y || r.Y || r['坐标Y'] || r['y'])
        if (!Number.isNaN(x) && !Number.isNaN(y)) {
          coords.push({ id: id ? String(id) : `BH_${coords.length + 1}`, x, y })
        }
      })
    }

    // 2) 读取测试钻孔目录（如存在），把每个 BK-*.csv 聚合为属性对象
    const boreholeDataDir = path.join(inputDir, '测试钻孔')
    const bkMap = new Map()
    if (fs.existsSync(boreholeDataDir) && fs.statSync(boreholeDataDir).isDirectory()) {
      const files = fs.readdirSync(boreholeDataDir).filter(f => f.toLowerCase().endsWith('.csv'))
      for (const f of files) {
        try {
          const content = fs.readFileSync(path.join(boreholeDataDir, f), 'utf8')
          const rows = parseCSV(content)
          if (rows.length === 0) continue

          // 计算数值列的平均值作为简要属性
          const numericSums = {}
          const numericCounts = {}
          for (const row of rows) {
            Object.entries(row).forEach(([k, v]) => {
              const n = parseFloat(v)
              if (!Number.isNaN(n)) {
                numericSums[k] = (numericSums[k] || 0) + n
                numericCounts[k] = (numericCounts[k] || 0) + 1
              }
            })
          }
          const agg = {}
          Object.keys(numericSums).forEach(k => {
            agg[k] = Math.round((numericSums[k] / numericCounts[k]) * 10) / 10
          })

          // 尝试从文件中提取id列，若没有则用文件名
          let bid = null
          if (rows[0].id) bid = rows[0].id
          if (!bid) {
            const nameOnly = path.parse(f).name
            bid = nameOnly
          }
          bkMap.set(String(bid), agg)
        } catch (e) {
          // 忽略单个文件解析错误
          continue
        }
      }
    }

    // 3) 合并坐标与钻孔数据，若没有坐标则尝试用BK文件名生成条目
    const merged = []
    if (coords.length > 0) {
      coords.forEach(c => {
        // 尝试匹配 bkMap
        let data = bkMap.get(c.id) || null
        // 还尝试无前缀匹配（如 BK-1 匹配 1）
        if (!data) {
          for (const [k, v] of bkMap.entries()) {
            if (String(k).includes(String(c.id)) || String(c.id).includes(String(k))) {
              data = v; break
            }
          }
        }
        merged.push({ id: c.id, x: c.x, y: c.y, data: data || {}, scores: { safety: 0, economic: 0, env: 0 } })
      })
    } else {
      // 没有坐标，尝试仅从 BK 文件生成条目
      for (const [k, v] of bkMap.entries()) {
        merged.push({ id: k, x: 0, y: 0, data: v, scores: { safety: 0, economic: 0, env: 0 } })
      }
    }

    store.boreholeCoordinates = coords
    store.boreholeData = Array.from(bkMap.entries()).map(([k, v]) => ({ id: k, data: v }))
    store.boreholes = merged

    // 4) 基于坐标计算近似矩形边界（外扩 5% margin）
    if (merged.length > 0) {
      const xs = merged.map(b => b.x)
      const ys = merged.map(b => b.y)
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const minY = Math.min(...ys)
      const maxY = Math.max(...ys)
      const w = maxX - minX || 1
      const h = maxY - minY || 1
      const margin = Math.max(w, h) * 0.05
      const boundary = [
        { x: Math.round(minX - margin), y: Math.round(minY - margin) },
        { x: Math.round(maxX + margin), y: Math.round(minY - margin) },
        { x: Math.round(maxX + margin), y: Math.round(maxY + margin) },
        { x: Math.round(minX - margin), y: Math.round(maxY + margin) }
      ]
      store.boundary = boundary
    }

  } catch (err) {
    // 忽略加载错误，保持 store 初始空状态
    // console.warn('load builtin input failed', err)
  }
}

// 尝试在模块加载时读取内置 input 数据
tryLoadInput()

export default store;
