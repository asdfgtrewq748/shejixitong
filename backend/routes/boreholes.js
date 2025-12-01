import { Router } from 'express';
import multer from 'multer';
import csv from 'csv-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import iconv from 'iconv-lite';
import store from '../store.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 配置文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname}`);
  }
});

const upload = multer({ storage });

/**
 * POST /api/boreholes
 * 批量导入钻孔数据
 * body: { boreholes: [{ id, x, y, rockHardness, gasContent, coalThickness, groundWater, ... }, ...] }
 */
router.post('/', (req, res) => {
  const { boreholes } = req.body;
  if (!Array.isArray(boreholes) || boreholes.length === 0) {
    return res.status(400).json({ error: '钻孔数组不能为空' });
  }
  store.boreholes = boreholes.map((b, i) => ({
    id: b.id || `ZK-${100 + i}`,
    x: b.x,
    y: b.y,
    rockHardness: b.rockHardness ?? 5,
    gasContent: b.gasContent ?? 0,
    coalThickness: b.coalThickness ?? 3,
    groundWater: b.groundWater ?? 0,
    
    // 地质模型相关字段
    topElevation: b.topElevation ?? b.coalTopElevation ?? null,       // 煤层顶板标高
    bottomElevation: b.bottomElevation ?? b.coalBottomElevation ?? null, // 煤层底板标高
    surfaceElevation: b.surfaceElevation ?? null,                     // 地表标高
    depth: b.depth ?? null,                                           // 钻孔深度
    
    // 保留额外字段
    ...b,
  }));
  // 重置后续数据
  store.scores = null;
  store.design = null;
  store.geology = null;  // 重置地质模型
  res.json({ message: '钻孔数据已保存', count: store.boreholes.length });
});

/**
 * GET /api/boreholes
 * 返回全部钻孔
 */
router.get('/', (_req, res) => {
  res.json({ boreholes: store.boreholes });
});

/**
 * 检测文件编码
 */
const detectEncoding = (filePath) => {
  const buffer = fs.readFileSync(filePath);
  if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) return 'utf8';
  for (let i = 0; i < Math.min(buffer.length - 1, 1000); i++) {
    const byte1 = buffer[i];
    const byte2 = buffer[i + 1];
    if (byte1 >= 0x81 && byte1 <= 0xFE && byte2 >= 0x40 && byte2 <= 0xFE) return 'gbk';
  }
  return 'utf8';
};

/**
 * 解析 CSV（支持GBK编码）
 */
const parseCSV = (filePath) => {
  return new Promise((resolve, reject) => {
    const results = [];
    const encoding = detectEncoding(filePath);
    fs.createReadStream(filePath)
      .pipe(iconv.decodeStream(encoding))
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (err) => reject(err));
  });
};

/**
 * 从分层数据提取煤层信息
 */
const extractCoalSeamData = (layerData, boreholeId, targetCoalSeam = null) => {
  const layers = [];
  let currentDepth = 0;
  
  layerData.forEach((row, index) => {
    const name = (row['名称'] || row['name'] || row['岩性'] || '').trim();
    const thickness = parseFloat(row['厚度/m'] || row['厚度'] || row['thickness'] || 0);
    
    if (name && !isNaN(thickness) && thickness > 0) {
      layers.push({
        序号: index + 1,
        名称: name,
        厚度: thickness,
        顶板深度: currentDepth,
        底板深度: currentDepth + thickness,
        顶板标高: -currentDepth,
        底板标高: -(currentDepth + thickness),
        是否煤层: name.includes('煤')
      });
      currentDepth += thickness;
    }
  });
  
  const coalLayers = layers.filter(l => l.是否煤层);
  if (coalLayers.length === 0) {
    throw new Error(`钻孔 ${boreholeId} 未发现煤层`);
  }
  
  let targetLayer = null;
  if (targetCoalSeam) {
    targetLayer = coalLayers.find(l => l.名称.includes(targetCoalSeam));
    if (!targetLayer) {
      const available = coalLayers.map(l => l.名称).join(', ');
      throw new Error(`钻孔 ${boreholeId} 未找到 "${targetCoalSeam}"，可用: ${available}`);
    }
  } else {
    targetLayer = coalLayers.reduce((max, layer) => layer.厚度 > max.厚度 ? layer : max);
  }
  
  return {
    钻孔编号: boreholeId,
    总深度: currentDepth,
    煤层数量: coalLayers.length,
    所有煤层: coalLayers.map(l => ({ 名称: l.名称, 厚度: l.厚度, 深度: l.顶板深度 })),
    目标煤层: {
      名称: targetLayer.名称,
      厚度: targetLayer.厚度,
      顶板深度: targetLayer.顶板深度,
      底板深度: targetLayer.底板深度,
      顶板标高: targetLayer.顶板标高,
      底板标高: targetLayer.底板标高
    },
    完整分层: layers
  };
};

/**
 * POST /api/boreholes/batch-upload
 * 批量上传钻孔分层CSV文件
 */
router.post('/batch-upload', upload.array('files', 100), async (req, res) => {
  const results = { success: [], errors: [] };
  
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '请选择钻孔文件' });
    }
    
    const targetCoalSeam = req.body.targetCoalSeam || null;
    console.log(`\n🔍 处理 ${req.files.length} 个钻孔，目标煤层: ${targetCoalSeam || '自动最厚'}`);
    
    const boreholeDataList = [];
    
    for (const file of req.files) {
      try {
        const boreholeId = path.basename(file.originalname, path.extname(file.originalname));
        const rawData = await parseCSV(file.path);
        
        if (rawData.length === 0) throw new Error('文件为空');
        
        const coalData = extractCoalSeamData(rawData, boreholeId, targetCoalSeam);
        boreholeDataList.push(coalData);
        
        results.success.push({
          文件名: file.originalname,
          钻孔: boreholeId,
          煤层: coalData.目标煤层.名称,
          厚度: coalData.目标煤层.厚度,
          深度: coalData.目标煤层.顶板深度
        });
        
        fs.unlinkSync(file.path);
      } catch (err) {
        results.errors.push({ 文件名: file.originalname, 错误: err.message });
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      }
    }
    
    store.boreholeLayerData = boreholeDataList;
    
    console.log(`✅ 完成: ${results.success.length}成功, ${results.errors.length}失败`);
    
    res.json({
      success: true,
      message: `导入 ${results.success.length}/${req.files.length} 个钻孔`,
      results,
      data: boreholeDataList
    });
    
  } catch (err) {
    if (req.files) {
      req.files.forEach(f => {
        if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
      });
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/boreholes/merge-with-coordinates
 * 合并分层数据和坐标
 */
router.post('/merge-with-coordinates', (req, res) => {
  try {
    console.log('\n🔍 开始合并数据...');
    console.log(`store.boreholeLayerData: ${store.boreholeLayerData?.length || 0} 条`);
    console.log(`store.boreholeCoordinates: ${store.boreholeCoordinates?.length || 0} 条`);
    
    if (!store.boreholeLayerData || !store.boreholeLayerData.length) {
      return res.status(400).json({ error: '请先上传钻孔分层数据' });
    }
    if (!store.boreholeCoordinates || !store.boreholeCoordinates.length) {
      return res.status(400).json({ error: '请先上传钻孔坐标' });
    }
    
    // 打印前3个钻孔编号对比
    console.log('分层数据钻孔编号示例:', store.boreholeLayerData.slice(0, 3).map(d => d.钻孔编号));
    console.log('坐标数据钻孔编号示例:', store.boreholeCoordinates.slice(0, 3).map(c => c.id));
    
    const coordMap = new Map(store.boreholeCoordinates.map(c => [c.id, { x: c.x, y: c.y }]));
    const merged = [];
    const unmatched = [];
    
    store.boreholeLayerData.forEach(layerData => {
      const coord = coordMap.get(layerData.钻孔编号);
      if (coord) {
        merged.push({
          id: layerData.钻孔编号,
          name: layerData.钻孔编号,
          x: coord.x,
          y: coord.y,
          coalSeam: layerData.目标煤层.名称,
          coalThickness: layerData.目标煤层.厚度,
          topElevation: layerData.目标煤层.顶板标高,
          bottomElevation: layerData.目标煤层.底板标高,
          depth: layerData.目标煤层.顶板深度,
          layers: layerData.完整分层,
          allCoalSeams: layerData.所有煤层
        });
      } else {
        unmatched.push(layerData.钻孔编号);
      }
    });
    
    if (unmatched.length > 0) {
      console.warn(`⚠️  无坐标: ${unmatched.join(', ')}`);
    }
    
    store.boreholes = merged;
    console.log(`✅ 合并完成: ${merged.length}个钻孔`);
    
    res.json({
      success: true,
      message: `合并 ${merged.length} 个钻孔`,
      unmatched: unmatched.length > 0 ? unmatched : undefined,
      data: { count: merged.length, boreholes: merged }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/boreholes/coal-seams
 * 获取所有可用煤层
 */
router.get('/coal-seams', (req, res) => {
  if (!store.boreholeLayerData || !store.boreholeLayerData.length) {
    return res.status(404).json({ error: '尚未上传钻孔数据' });
  }
  
  const coalSeamsSet = new Set();
  store.boreholeLayerData.forEach(bh => {
    bh.所有煤层.forEach(coal => coalSeamsSet.add(coal.名称));
  });
  
  const coalSeams = Array.from(coalSeamsSet).sort();
  res.json({ coalSeams, count: coalSeams.length });
});

export default router;
