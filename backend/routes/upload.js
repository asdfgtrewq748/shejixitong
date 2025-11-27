import express from 'express';
import multer from 'multer';
import csv from 'csv-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import store from '../store.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 配置文件上传存储
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // 处理中文文件名
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const timestamp = Date.now();
    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext);
    cb(null, `${baseName}_${timestamp}${ext}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('只支持 CSV 文件格式'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

/**
 * 解析 CSV 文件
 * @param {string} filePath - 文件路径
 * @returns {Promise<Array>} - 解析后的数据数组
 */
const parseCSV = (filePath) => {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (err) => reject(err));
  });
};

/**
 * 解析采区坐标 CSV
 * 期望格式: x,y 或 序号,x,y
 */
const parseBoundaryCSV = (data) => {
  return data.map((row, index) => {
    // 尝试多种可能的列名
    const x = parseFloat(row.x || row.X || row['坐标X'] || row['x坐标'] || Object.values(row)[0]);
    const y = parseFloat(row.y || row.Y || row['坐标Y'] || row['y坐标'] || Object.values(row)[1]);
    
    if (isNaN(x) || isNaN(y)) {
      throw new Error(`第 ${index + 1} 行坐标数据无效`);
    }
    
    return { x, y };
  });
};

/**
 * 解析钻孔坐标 CSV
 * 期望格式: id,x,y 或 钻孔编号,x坐标,y坐标
 */
const parseBoreholeCoordinatesCSV = (data) => {
  return data.map((row, index) => {
    const id = row.id || row.ID || row['钻孔编号'] || row['钻孔ID'] || row['编号'] || `ZK-${index + 1}`;
    const x = parseFloat(row.x || row.X || row['坐标X'] || row['x坐标'] || Object.values(row)[1]);
    const y = parseFloat(row.y || row.Y || row['坐标Y'] || row['y坐标'] || Object.values(row)[2]);
    
    if (isNaN(x) || isNaN(y)) {
      throw new Error(`钻孔 ${id} 坐标数据无效`);
    }
    
    return { id: String(id), x, y };
  });
};

/**
 * 解析钻孔数据 CSV
 * 期望格式: id,rockHardness,gasContent,coalThickness,groundWater
 * 或中文: 钻孔编号,岩石硬度,瓦斯含量,煤层厚度,地下水位
 */
const parseBoreholeDataCSV = (data) => {
  return data.map((row, index) => {
    const id = row.id || row.ID || row['钻孔编号'] || row['钻孔ID'] || row['编号'] || `ZK-${index + 1}`;
    
    // 岩石硬度 (普氏系数，一般 1-20)
    const rockHardness = parseFloat(
      row.rockHardness || row['岩石硬度'] || row['普氏系数'] || row['rock_hardness'] || 6
    );
    
    // 瓦斯含量 (m³/t，一般 0-30)
    const gasContent = parseFloat(
      row.gasContent || row['瓦斯含量'] || row['gas_content'] || row['瓦斯'] || 5
    );
    
    // 煤层厚度 (m，一般 0.5-10)
    const coalThickness = parseFloat(
      row.coalThickness || row['煤层厚度'] || row['coal_thickness'] || row['厚度'] || 3
    );
    
    // 地下水位 (m，一般 0-100)
    const groundWater = parseFloat(
      row.groundWater || row['地下水位'] || row['ground_water'] || row['水位'] || 20
    );
    
    return {
      id: String(id),
      rockHardness: isNaN(rockHardness) ? 6 : rockHardness,
      gasContent: isNaN(gasContent) ? 5 : gasContent,
      coalThickness: isNaN(coalThickness) ? 3 : coalThickness,
      groundWater: isNaN(groundWater) ? 20 : groundWater
    };
  });
};

/**
 * 合并钻孔坐标和数据
 */
const mergeBoreholeData = (coordinates, data) => {
  const dataMap = new Map(data.map(d => [d.id, d]));
  
  return coordinates.map(coord => {
    const boreholeData = dataMap.get(coord.id) || {};
    return {
      id: coord.id,
      x: coord.x,
      y: coord.y,
      rockHardness: boreholeData.rockHardness || 6,
      gasContent: boreholeData.gasContent || 5,
      coalThickness: boreholeData.coalThickness || 3,
      groundWater: boreholeData.groundWater || 20,
      scores: { safety: 0, economic: 0, env: 0 }
    };
  });
};

// ==================== API 路由 ====================

/**
 * POST /api/upload/boundary
 * 上传采区坐标 CSV 文件
 */
router.post('/boundary', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请选择文件' });
    }
    
    const rawData = await parseCSV(req.file.path);
    const boundary = parseBoundaryCSV(rawData);
    
    // 确保边界闭合
    if (boundary.length > 2) {
      const first = boundary[0];
      const last = boundary[boundary.length - 1];
      if (first.x !== last.x || first.y !== last.y) {
        boundary.push({ ...first });
      }
    }
    
    store.boundary = boundary;
    
    // 删除临时文件
    fs.unlinkSync(req.file.path);
    
    res.json({
      success: true,
      message: `成功导入采区边界，共 ${boundary.length} 个顶点`,
      data: {
        pointCount: boundary.length,
        boundary: boundary
      }
    });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/upload/borehole-coordinates
 * 上传钻孔坐标 CSV 文件
 */
router.post('/borehole-coordinates', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请选择文件' });
    }
    
    const rawData = await parseCSV(req.file.path);
    const coordinates = parseBoreholeCoordinatesCSV(rawData);
    
    // 临时存储坐标数据，等待与钻孔数据合并
    store.boreholeCoordinates = coordinates;
    
    // 如果已有钻孔数据，则合并
    if (store.boreholeData && store.boreholeData.length > 0) {
      store.boreholes = mergeBoreholeData(coordinates, store.boreholeData);
    } else {
      // 否则只存坐标，数据用默认值
      store.boreholes = coordinates.map(coord => ({
        ...coord,
        rockHardness: 6,
        gasContent: 5,
        coalThickness: 3,
        groundWater: 20,
        scores: { safety: 0, economic: 0, env: 0 }
      }));
    }
    
    fs.unlinkSync(req.file.path);
    
    res.json({
      success: true,
      message: `成功导入钻孔坐标，共 ${coordinates.length} 个钻孔`,
      data: {
        count: coordinates.length,
        boreholes: store.boreholes
      }
    });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/upload/borehole-data
 * 上传钻孔数据 CSV 文件
 */
router.post('/borehole-data', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请选择文件' });
    }
    
    const rawData = await parseCSV(req.file.path);
    const boreholeData = parseBoreholeDataCSV(rawData);
    
    // 临时存储数据
    store.boreholeData = boreholeData;
    
    // 如果已有坐标数据，则合并
    if (store.boreholeCoordinates && store.boreholeCoordinates.length > 0) {
      store.boreholes = mergeBoreholeData(store.boreholeCoordinates, boreholeData);
    }
    
    fs.unlinkSync(req.file.path);
    
    res.json({
      success: true,
      message: `成功导入钻孔数据，共 ${boreholeData.length} 条记录`,
      data: {
        count: boreholeData.length,
        merged: store.boreholes?.length > 0,
        boreholes: store.boreholes || []
      }
    });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/upload/batch
 * 批量上传多个 CSV 文件
 */
router.post('/batch', upload.array('files', 3), async (req, res) => {
  const results = {
    success: [],
    errors: []
  };
  
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '请选择文件' });
    }
    
    for (const file of req.files) {
      try {
        const rawData = await parseCSV(file.path);
        const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        
        // 根据文件名或内容判断文件类型
        const lowerName = originalName.toLowerCase();
        let fileType = 'unknown';
        let parsedData;
        
        if (lowerName.includes('边界') || lowerName.includes('boundary') || lowerName.includes('采区')) {
          fileType = 'boundary';
          parsedData = parseBoundaryCSV(rawData);
          if (parsedData.length > 2) {
            const first = parsedData[0];
            const last = parsedData[parsedData.length - 1];
            if (first.x !== last.x || first.y !== last.y) {
              parsedData.push({ ...first });
            }
          }
          store.boundary = parsedData;
          results.success.push({
            file: originalName,
            type: 'boundary',
            message: `采区边界 ${parsedData.length} 个顶点`
          });
        } else if (lowerName.includes('坐标') || lowerName.includes('coordinate') || lowerName.includes('位置')) {
          fileType = 'borehole-coordinates';
          parsedData = parseBoreholeCoordinatesCSV(rawData);
          store.boreholeCoordinates = parsedData;
          results.success.push({
            file: originalName,
            type: 'borehole-coordinates',
            message: `钻孔坐标 ${parsedData.length} 条`
          });
        } else if (lowerName.includes('数据') || lowerName.includes('data') || lowerName.includes('属性')) {
          fileType = 'borehole-data';
          parsedData = parseBoreholeDataCSV(rawData);
          store.boreholeData = parsedData;
          results.success.push({
            file: originalName,
            type: 'borehole-data',
            message: `钻孔数据 ${parsedData.length} 条`
          });
        } else {
          // 尝试自动检测文件类型
          const firstRow = rawData[0];
          const keys = Object.keys(firstRow).map(k => k.toLowerCase());
          
          if (keys.some(k => k.includes('瓦斯') || k.includes('gas') || k.includes('硬度') || k.includes('厚度'))) {
            fileType = 'borehole-data';
            parsedData = parseBoreholeDataCSV(rawData);
            store.boreholeData = parsedData;
            results.success.push({
              file: originalName,
              type: 'borehole-data',
              message: `钻孔数据 ${parsedData.length} 条 (自动识别)`
            });
          } else if (keys.length <= 3 && keys.some(k => k.includes('x') || k.includes('y'))) {
            // 只有 x, y 列，可能是边界或坐标
            if (rawData.length < 20) {
              fileType = 'boundary';
              parsedData = parseBoundaryCSV(rawData);
              store.boundary = parsedData;
              results.success.push({
                file: originalName,
                type: 'boundary',
                message: `采区边界 ${parsedData.length} 个顶点 (自动识别)`
              });
            } else {
              fileType = 'borehole-coordinates';
              parsedData = parseBoreholeCoordinatesCSV(rawData);
              store.boreholeCoordinates = parsedData;
              results.success.push({
                file: originalName,
                type: 'borehole-coordinates',
                message: `钻孔坐标 ${parsedData.length} 条 (自动识别)`
              });
            }
          } else {
            results.errors.push({
              file: originalName,
              error: '无法识别文件类型，请在文件名中包含"边界"、"坐标"或"数据"关键字'
            });
          }
        }
        
        fs.unlinkSync(file.path);
      } catch (err) {
        const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        results.errors.push({
          file: originalName,
          error: err.message
        });
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
    }
    
    // 如果同时有坐标和数据，则合并
    if (store.boreholeCoordinates && store.boreholeData) {
      store.boreholes = mergeBoreholeData(store.boreholeCoordinates, store.boreholeData);
    } else if (store.boreholeCoordinates) {
      store.boreholes = store.boreholeCoordinates.map(coord => ({
        ...coord,
        rockHardness: 6,
        gasContent: 5,
        coalThickness: 3,
        groundWater: 20,
        scores: { safety: 0, economic: 0, env: 0 }
      }));
    }
    
    res.json({
      success: true,
      message: `批量导入完成: ${results.success.length} 成功, ${results.errors.length} 失败`,
      results,
      data: {
        boundary: store.boundary,
        boreholes: store.boreholes
      }
    });
  } catch (err) {
    // 清理所有临时文件
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/upload/template/:type
 * 获取 CSV 模板说明
 */
router.get('/template/:type', (req, res) => {
  const templates = {
    boundary: {
      name: '采区边界坐标',
      description: '定义采区的多边形边界顶点',
      columns: ['x', 'y'],
      example: 'x,y\n100,100\n700,80\n750,500\n600,550\n200,520',
      notes: '坐标按顺时针或逆时针顺序排列，系统会自动闭合多边形'
    },
    'borehole-coordinates': {
      name: '钻孔坐标',
      description: '定义每个钻孔的位置',
      columns: ['id', 'x', 'y'],
      alternativeColumns: ['钻孔编号', '坐标X', '坐标Y'],
      example: 'id,x,y\nZK-101,150,130\nZK-102,280,210\nZK-103,420,180',
      notes: '钻孔ID应与钻孔数据文件中的ID对应'
    },
    'borehole-data': {
      name: '钻孔数据',
      description: '每个钻孔的地质参数',
      columns: ['id', 'rockHardness', 'gasContent', 'coalThickness', 'groundWater'],
      alternativeColumns: ['钻孔编号', '岩石硬度', '瓦斯含量', '煤层厚度', '地下水位'],
      example: 'id,rockHardness,gasContent,coalThickness,groundWater\nZK-101,6.5,4.2,3.8,25\nZK-102,7.2,5.8,4.1,32',
      notes: '岩石硬度(普氏系数1-20)、瓦斯含量(m³/t)、煤层厚度(m)、地下水位(m)'
    }
  };
  
  const template = templates[req.params.type];
  if (!template) {
    return res.status(404).json({ error: '未知的模板类型' });
  }
  
  res.json(template);
});

/**
 * GET /api/upload/status
 * 获取当前数据导入状态
 */
router.get('/status', (req, res) => {
  res.json({
    boundary: {
      imported: store.boundary?.length > 0,
      count: store.boundary?.length || 0
    },
    boreholeCoordinates: {
      imported: store.boreholeCoordinates?.length > 0,
      count: store.boreholeCoordinates?.length || 0
    },
    boreholeData: {
      imported: store.boreholeData?.length > 0,
      count: store.boreholeData?.length || 0
    },
    boreholes: {
      merged: store.boreholes?.length > 0,
      count: store.boreholes?.length || 0
    }
  });
});

export default router;
