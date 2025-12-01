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
  geology: null,             // 地质模型数据
  
  // ========== 全局上下文参数（用于评分计算）==========
  globalContext: {
    // 经济性参数
    idealCoalThickness: 6,         // 理想煤层厚度 (m)
    maxLocalReserveRadius: 200,    // 认为储量充分的边界距离 (m)
    calorificMin: 18,              // 矿区最低发热量 (MJ/kg)
    calorificMax: 30,              // 矿区最高发热量 (MJ/kg)
    
    // 环保性参数
    waterSafeDistance: 200,        // 距水体安全距离 (m)
    protectedSafeDistance: 500,    // 距生态保护区安全距离 (m)
    criticalWaterPressure: 0.1,    // 突水系数临界值 (MPa/m)
    subsidenceK: 5,                // 沉陷风险系数
    
    // 安全性参数
    gasThreshold: 8,               // 瓦斯含量警戒值 (m³/t)
    idealRockHardness: 7,          // 理想岩石硬度（普氏系数）
    
    // 权重配置
    envWeights: { subsidence: 0.4, water: 0.3, eco: 0.3 },
    econWeights: { reserve: 0.33, thickness: 0.33, quality: 0.34 },
  }
};

/**
 * 计算点到多边形边界的最近距离
 */
function calculateDistanceToBoundary(point, boundary) {
  if (!boundary || boundary.length < 3) return 0;
  
  let minDist = Infinity;
  
  for (let i = 0; i < boundary.length; i++) {
    const j = (i + 1) % boundary.length;
    const dist = pointToSegmentDistance(point, boundary[i], boundary[j]);
    minDist = Math.min(minDist, dist);
  }
  
  return minDist;
}

/**
 * 计算点到线段的距离
 */
function pointToSegmentDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  
  if (lenSq === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  
  const nearestX = a.x + t * dx;
  const nearestY = a.y + t * dy;
  
  return Math.hypot(p.x - nearestX, p.y - nearestY);
}

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

    // 1) 读取坐标文件 - 优先选择"钻孔"相关文件，排除"采区"边界文件
    let coordFile = null
    const inputFiles = fs.readdirSync(inputDir)
    
    // 第一优先级：文件名包含"钻孔"和"坐标"
    for (const f of inputFiles) {
      if (f.endsWith('.csv') && f.includes('钻孔') && f.includes('坐标')) {
        coordFile = path.join(inputDir, f)
        console.log(`[store] 找到坐标文件: ${f}`)
        break
      }
    }
    
    // 第二优先级：文件名包含"坐标"但不包含"采区"或"边界"
    if (!coordFile) {
      for (const f of inputFiles) {
        const low = f.toLowerCase()
        if (low.endsWith('.csv') && 
            (low.includes('坐标') || low.includes('zuobiao') || low.includes('coordinate')) &&
            !low.includes('采区') && !low.includes('边界') && !low.includes('boundary')) {
          coordFile = path.join(inputDir, f)
          console.log(`[store] 找到坐标文件: ${f}`)
          break
        }
      }
    }

    let coords = []
    if (coordFile && fs.existsSync(coordFile)) {
      const txt = fs.readFileSync(coordFile, 'utf8')
      const rows = parseCSV(txt)
      rows.forEach(r => {
        // 兼容多种列名
        const id = r.id || r.ID || r['钻孔编号'] || r['钻孔ID'] || r['钻孔名'] || (r.name || r.Name)
        const x = parseFloat(r.x || r.X || r['坐标X'] || r['坐标x'] || r['x'])
        const y = parseFloat(r.y || r.Y || r['坐标Y'] || r['坐标y'] || r['y'])
        if (!Number.isNaN(x) && !Number.isNaN(y)) {
          coords.push({ id: id ? String(id).trim() : `BH_${coords.length + 1}`, x, y })
        }
      })
      console.log(`[store] 解析到 ${coords.length} 个钻孔坐标`)
    }

    // 2) 读取钻孔数据目录 - 按优先级排序
    const possibleDataDirs = ['各个钻孔-补充', '钻孔数据', '测试钻孔', 'boreholes']
    let boreholeDataDir = null
    for (const dirName of possibleDataDirs) {
      const testPath = path.join(inputDir, dirName)
      if (fs.existsSync(testPath) && fs.statSync(testPath).isDirectory()) {
        boreholeDataDir = testPath
        console.log(`[store] 找到钻孔数据目录: ${dirName}`)
        break
      }
    }

    const bkMap = new Map()
    if (boreholeDataDir) {
      const files = fs.readdirSync(boreholeDataDir).filter(f => f.toLowerCase().endsWith('.csv'))
      console.log(`[store] 发现 ${files.length} 个钻孔数据文件`)
      
      for (const f of files) {
        try {
          const content = fs.readFileSync(path.join(boreholeDataDir, f), 'utf8')
          const rows = parseCSV(content)
          if (rows.length === 0) continue

          // 检测数据格式 - 是否是地层数据（包含"名称"和"厚度"列）
          const firstRow = rows[0]
          const keys = Object.keys(firstRow)
          const isStratumData = keys.some(k => k.includes('名称')) && keys.some(k => k.includes('厚度'))
          
          let agg = {}
          
          if (isStratumData) {
            // 地层数据格式：提取煤层厚度和岩层信息
            let totalCoalThickness = 0
            let totalDepth = 0
            let coalLayers = []
            let rockLayers = []
            
            for (const row of rows) {
              const name = row['名称'] || row['岩性'] || ''
              const thickness = parseFloat(row['厚度/m'] || row['厚度'] || row['厚度(m)'] || 0)
              
              if (!isNaN(thickness) && thickness > 0) {
                totalDepth += thickness
                
                // 判断是否是煤层
                if (name.includes('煤')) {
                  totalCoalThickness += thickness
                  coalLayers.push({ name, thickness })
                } else {
                  rockLayers.push({ name, thickness })
                }
              }
            }
            
            // 计算平均岩石硬度（根据岩性估算普氏系数）
            let totalHardness = 0
            let hardnessCount = 0
            for (const layer of rockLayers) {
              let hardness = 5 // 默认
              if (layer.name.includes('砾岩') || layer.name.includes('砂岩')) hardness = 7
              else if (layer.name.includes('泥岩')) hardness = 4
              else if (layer.name.includes('炭质')) hardness = 3
              else if (layer.name.includes('粉砂')) hardness = 5
              totalHardness += hardness * layer.thickness
              hardnessCount += layer.thickness
            }
            
            agg = {
              '煤层厚度': Math.round(totalCoalThickness * 100) / 100,
              '埋深': Math.round(totalDepth * 100) / 100,
              '岩石硬度': hardnessCount > 0 ? Math.round((totalHardness / hardnessCount) * 10) / 10 : 5,
              '瓦斯含量': 5 + Math.random() * 5, // 默认值，可后续补充真实数据
              '地下水位': 20 + Math.random() * 30,
              'coalLayers': coalLayers.length,
              'rockLayers': rockLayers.length
            }
          } else {
            // 普通数据格式：计算数值列的平均值
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
            Object.keys(numericSums).forEach(k => {
              agg[k] = Math.round((numericSums[k] / numericCounts[k]) * 100) / 100
            })
          }

          // 用文件名作为钻孔ID（去掉.csv后缀）
          const bid = path.parse(f).name.trim()
          bkMap.set(bid, agg)
        } catch (e) {
          console.warn(`[store] 解析文件失败: ${f}`, e.message)
          continue
        }
      }
      console.log(`[store] 成功解析 ${bkMap.size} 个钻孔数据`)
    }

    // 3) 合并坐标与钻孔数据
    const merged = []
    let matchedCount = 0
    
    if (coords.length > 0) {
      coords.forEach(c => {
        // 精确匹配钻孔ID
        let data = bkMap.get(c.id) || null
        
        // 如果精确匹配失败，尝试去除空格后匹配
        if (!data) {
          const cleanId = c.id.replace(/\s+/g, '')
          for (const [k, v] of bkMap.entries()) {
            if (k.replace(/\s+/g, '') === cleanId) {
              data = v
              break
            }
          }
        }
        
        if (data) matchedCount++
        
        // 构建钻孔对象，添加派生字段
        const borehole = { 
          id: c.id, 
          x: c.x, 
          y: c.y, 
          data: data || {}, 
          scores: { safety: 0, economic: 0, env: 0 }
        };
        
        // 从data中提取标准字段（兼容多种命名）
        if (data) {
          borehole.depth = parseFloat(data['埋深'] || data['depth'] || data['Depth'] || 100);
          borehole.coalThickness = parseFloat(data['煤层厚度'] || data['厚度'] || data['coalThickness'] || data['煤厚'] || 3);
          borehole.rockHardness = parseFloat(data['岩石硬度'] || data['普氏系数'] || data['rockHardness'] || 5);
          borehole.gasContent = parseFloat(data['瓦斯含量'] || data['瓦斯'] || data['gasContent'] || 5);
          borehole.groundWater = parseFloat(data['地下水位'] || data['水位'] || data['groundWater'] || 20);
          borehole.calorificValue = parseFloat(data['发热量'] || data['热值'] || data['calorificValue'] || 25);
          
          // 地质模型相关字段
          borehole.topElevation = parseFloat(data['煤层顶板标高'] || data['顶板标高'] || data['topElevation'] || data['coalTopElevation'] || null);
          borehole.bottomElevation = parseFloat(data['煤层底板标高'] || data['底板标高'] || data['bottomElevation'] || data['coalBottomElevation'] || null);
          borehole.surfaceElevation = parseFloat(data['地表标高'] || data['surfaceElevation'] || null);
          
          // 如果没有顶底板标高但有地表标高和埋深，可以计算
          if (borehole.surfaceElevation !== null && borehole.depth > 0) {
            if (borehole.topElevation === null) {
              borehole.topElevation = borehole.surfaceElevation - borehole.depth;
            }
            if (borehole.bottomElevation === null && borehole.coalThickness > 0) {
              borehole.bottomElevation = borehole.topElevation - borehole.coalThickness;
            }
          }
          
          // 环保相关字段（可选）
          borehole.aquiferPressure = parseFloat(data['含水层水压'] || data['aquiferPressure'] || null);
          borehole.aquicludeThickness = parseFloat(data['隔水层厚度'] || data['aquicludeThickness'] || null);
          borehole.waterRichnessIndex = parseFloat(data['富水指数'] || data['waterRichnessIndex'] || 0);
          borehole.ecoLandType = data['土地类型'] || data['ecoLandType'] || 'wasteland';
          borehole.distanceToWaterBody = parseFloat(data['距水体距离'] || data['distanceToWaterBody'] || 1000);
          borehole.distanceToProtectedArea = parseFloat(data['距保护区距离'] || data['distanceToProtectedArea'] || 2000);
        } else {
          // 没有数据时使用默认值
          borehole.depth = 100;
          borehole.coalThickness = 3;
          borehole.rockHardness = 5;
          borehole.gasContent = 5;
          borehole.groundWater = 20;
          borehole.calorificValue = 25;
        }
        
        merged.push(borehole);
      })
      
      console.log(`[store] 合并完成: ${merged.length} 个钻孔, ${matchedCount} 个匹配到数据`)
    } else if (bkMap.size > 0) {
      // 没有坐标文件，仅从数据文件生成条目
      console.log(`[store] 未找到坐标文件，使用数据文件创建钻孔`)
      for (const [k, v] of bkMap.entries()) {
        merged.push({ 
          id: k, 
          x: 0, 
          y: 0, 
          data: v, 
          scores: { safety: 0, economic: 0, env: 0 },
          depth: 100,
          coalThickness: 3,
          rockHardness: 5,
          gasContent: 5,
          groundWater: 20,
          calorificValue: 25
        })
      }
    }

    store.boreholeCoordinates = coords
    store.boreholeData = Array.from(bkMap.entries()).map(([k, v]) => ({ id: k, data: v }))
    store.boreholes = merged

    // 4) 尝试读取采区边界文件
    let boundaryFile = null
    for (const f of inputFiles) {
      if (f.endsWith('.csv') && (f.includes('采区') || f.includes('边界') || f.includes('boundary'))) {
        // 排除钻孔坐标文件
        if (!f.includes('钻孔')) {
          boundaryFile = path.join(inputDir, f)
          console.log(`[store] 找到边界文件: ${f}`)
          break
        }
      }
    }
    
    if (boundaryFile && fs.existsSync(boundaryFile)) {
      const txt = fs.readFileSync(boundaryFile, 'utf8')
      const rows = parseCSV(txt)
      const boundary = []
      rows.forEach(r => {
        const x = parseFloat(r.x || r.X || r['坐标X'] || r['坐标x'])
        const y = parseFloat(r.y || r.Y || r['坐标Y'] || r['坐标y'])
        if (!Number.isNaN(x) && !Number.isNaN(y)) {
          boundary.push({ x, y })
        }
      })
      if (boundary.length >= 3) {
        store.boundary = boundary
        console.log(`[store] 加载采区边界: ${boundary.length} 个顶点`)
      }
    } else if (merged.length > 0) {
      // 5) 如果没有边界文件，基于钻孔坐标生成近似边界（外扩 15% margin）
      const xs = merged.map(b => b.x)
      const ys = merged.map(b => b.y)
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const minY = Math.min(...ys)
      const maxY = Math.max(...ys)
      const w = maxX - minX || 1
      const h = maxY - minY || 1
      const margin = Math.max(w, h) * 0.15
      const boundary = [
        { x: Math.round(minX - margin), y: Math.round(minY - margin) },
        { x: Math.round(maxX + margin), y: Math.round(minY - margin) },
        { x: Math.round(maxX + margin), y: Math.round(maxY + margin) },
        { x: Math.round(minX - margin), y: Math.round(maxY + margin) }
      ]
      store.boundary = boundary
      console.log(`[store] 自动生成边界: ${boundary.length} 个顶点`)
    }
    
    // 6) 计算每个钻孔到边界的距离（用于经济评分）
    if (store.boundary && store.boundary.length >= 3 && merged.length > 0) {
      merged.forEach(bh => {
        bh.distanceToBoundary = calculateDistanceToBoundary(bh, store.boundary);
      });
    }

  } catch (err) {
    // 忽略加载错误，保持 store 初始空状态
    // console.warn('load builtin input failed', err)
  }
}

// 禁用内置数据加载 - 完全依赖用户上传
// tryLoadInput()
console.log('[store] 内置数据加载已禁用，请通过前端上传数据')

export default store;
