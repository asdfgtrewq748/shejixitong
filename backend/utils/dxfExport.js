/**
 * DXF (AutoCAD Drawing Exchange Format) 导出工具
 * 将设计方案导出为CAD可读的DXF文件
 */

/**
 * 生成DXF文件内容
 * @param {Object} design - 设计方案对象
 * @param {Array} boundary - 采区边界
 * @returns {string} DXF文件内容
 */
export function generateDXF(design, boundary) {
  const dxf = [];
  
  // DXF文件头
  dxf.push('0', 'SECTION');
  dxf.push('2', 'HEADER');
  dxf.push('9', '$ACADVER');
  dxf.push('1', 'AC1015'); // AutoCAD 2000
  dxf.push('0', 'ENDSEC');
  
  // 表段
  dxf.push('0', 'SECTION');
  dxf.push('2', 'TABLES');
  
  // 图层表
  dxf.push('0', 'TABLE');
  dxf.push('2', 'LAYER');
  dxf.push('70', '6'); // 最大图层数
  
  // 定义图层
  addLayer(dxf, 'BOUNDARY', 1);  // 红色 - 边界
  addLayer(dxf, 'ROADWAY', 2);   // 黄色 - 巷道
  addLayer(dxf, 'WORKFACE', 3);  // 绿色 - 工作面
  addLayer(dxf, 'PILLAR', 8);    // 灰色 - 煤柱
  addLayer(dxf, 'HATCH', 252);   // 浅灰色 - 填充图案
  addLayer(dxf, 'TEXT', 7);      // 白色 - 文字标注
  
  dxf.push('0', 'ENDTAB');
  dxf.push('0', 'ENDSEC');
  
  // 实体段
  dxf.push('0', 'SECTION');
  dxf.push('2', 'ENTITIES');
  
  // 1. 绘制采区边界
  if (boundary && boundary.length > 0) {
    addPolyline(dxf, boundary, 'BOUNDARY', true);
  }
  
  // 2. 绘制主巷道
  if (design.roadways) {
    design.roadways.forEach(roadway => {
      if (roadway.type === 'main' && roadway.path) {
        addPolyline(dxf, roadway.path, 'ROADWAY', false);
        
        // 添加巷道标注
        if (roadway.path.length > 0) {
          const midPoint = roadway.path[Math.floor(roadway.path.length / 2)];
          addText(dxf, midPoint.x, midPoint.y, roadway.id, 'TEXT', 5);
        }
      }
    });
  }
  
  // 3. 绘制工作面（支持新的矩形格式）
  if (design.workfaces) {
    design.workfaces.forEach(workface => {
      let corners;
      
      // 支持两种格式：corners数组 或 x,y,width,length
      if (workface.corners) {
        corners = workface.corners;
      } else if (workface.x !== undefined && workface.y !== undefined) {
        // 从x,y,width,length构建矩形顶点
        const { x, y, width, length } = workface;
        corners = [
          { x, y },
          { x: x + width, y },
          { x: x + width, y: y + length },
          { x, y: y + length }
        ];
      }
      
      if (corners && corners.length > 0) {
        addPolyline(dxf, corners, 'WORKFACE', true);
        
        // 计算中心点
        const centerX = workface.center?.x || (workface.x + workface.width / 2);
        const centerY = workface.center?.y || (workface.y + workface.length / 2);
        
        // 添加工作面标注
        addText(dxf, centerX, centerY, workface.id, 'TEXT', 8);
        
        // 添加工作面参数标注
        const w = workface.width || 0;
        const l = workface.length || 0;
        const info = `${Math.round(w)}x${Math.round(l)}m`;
        addText(dxf, centerX, centerY - 10, info, 'TEXT', 4);
        
        // 添加评分标注
        if (workface.avgScore !== undefined) {
          addText(dxf, centerX, centerY - 20, `评分: ${Math.round(workface.avgScore)}`, 'TEXT', 3);
        }
      }
    });
  }
  
  // 4. 绘制煤柱
  if (design.pillars) {
    design.pillars.forEach(pillar => {
      const { x, y, width, length } = pillar;
      const corners = [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + length },
        { x, y: y + length }
      ];
      
      // 绘制煤柱边界
      addPolyline(dxf, corners, 'PILLAR', true);
      
      // 添加填充图案（斜线）
      addHatch(dxf, corners, 'HATCH');
      
      // 添加煤柱标注
      const centerX = x + width / 2;
      const centerY = y + length / 2;
      addText(dxf, centerX, centerY, pillar.id || 'PILLAR', 'TEXT', 6);
    });
  }
  
  // 5. 添加图例和说明
  if (design.designParams || design.stats) {
    const { minX, maxY } = design.gridInfo || { minX: 0, maxY: 1000 };
    let legendY = maxY + 50;
    const legendX = minX + 50;
    
    addText(dxf, legendX, legendY, '采区工作面设计方案', 'TEXT', 12);
    legendY -= 25;
    
    // 地质参数
    if (design.geologyParams) {
      const gp = design.geologyParams;
      addText(dxf, legendX, legendY, `煤层倾角: ${gp.dipAngle?.toFixed(1)}°`, 'TEXT', 6);
      legendY -= 15;
      addText(dxf, legendX, legendY, `平均厚度: ${gp.avgThickness?.toFixed(2)}m`, 'TEXT', 6);
      legendY -= 15;
      addText(dxf, legendX, legendY, `平均埋深: ${gp.avgDepth?.toFixed(0)}m`, 'TEXT', 6);
      legendY -= 20;
    }
    
    // 设计参数
    if (design.designParams) {
      const dp = design.designParams;
      addText(dxf, legendX, legendY, `工作面宽度: ${dp.workfaceWidth}m`, 'TEXT', 6);
      legendY -= 15;
      addText(dxf, legendX, legendY, `煤柱宽度: ${dp.pillarWidth}m`, 'TEXT', 6);
      legendY -= 15;
      addText(dxf, legendX, legendY, `开采方式: ${dp.miningMethod || '水平开采'}`, 'TEXT', 6);
      legendY -= 15;
      addText(dxf, legendX, legendY, `布局方向: ${dp.layoutDirection || 'horizontal'}`, 'TEXT', 6);
      legendY -= 20;
    }
    
    // 统计信息
    const stats = design.stats || design.designScore;
    if (stats) {
      addText(dxf, legendX, legendY, `工作面数量: ${stats.totalWorkfaces || stats.workfaceCount || 0}`, 'TEXT', 6);
      legendY -= 15;
      addText(dxf, legendX, legendY, `煤柱数量: ${stats.totalPillars || 0}`, 'TEXT', 6);
      legendY -= 15;
      addText(dxf, legendX, legendY, `总开采面积: ${stats.totalArea || 0}m²`, 'TEXT', 6);
      legendY -= 15;
      if (stats.avgFaceScore) {
        addText(dxf, legendX, legendY, `平均评分: ${stats.avgFaceScore.toFixed(1)}`, 'TEXT', 6);
      }
    }
    
    // 生成时间
    legendY -= 20;
    const date = new Date().toLocaleString('zh-CN');
    addText(dxf, legendX, legendY, `生成时间: ${date}`, 'TEXT', 4);
  }
  
  dxf.push('0', 'ENDSEC');
  
  // 文件结束
  dxf.push('0', 'EOF');
  
  return dxf.join('\n');
}

/**
 * 添加图层定义
 */
function addLayer(dxf, name, color) {
  dxf.push('0', 'LAYER');
  dxf.push('2', name);
  dxf.push('70', '0'); // 标准标志
  dxf.push('62', color.toString()); // 颜色编号
  dxf.push('6', 'CONTINUOUS'); // 线型
}

/**
 * 添加多段线
 */
function addPolyline(dxf, points, layer, closed) {
  if (!points || points.length === 0) return;
  
  dxf.push('0', 'LWPOLYLINE');
  dxf.push('8', layer); // 图层
  dxf.push('90', points.length.toString()); // 顶点数
  dxf.push('70', closed ? '1' : '0'); // 是否闭合
  
  points.forEach(point => {
    dxf.push('10', point.x.toFixed(2));
    dxf.push('20', point.y.toFixed(2));
  });
}

/**
 * 添加文字标注
 */
function addText(dxf, x, y, text, layer, height = 5) {
  dxf.push('0', 'TEXT');
  dxf.push('8', layer); // 图层
  dxf.push('10', x.toFixed(2)); // 插入点 X
  dxf.push('20', y.toFixed(2)); // 插入点 Y
  dxf.push('40', height.toString()); // 文字高度
  dxf.push('1', text); // 文字内容
  dxf.push('72', '1'); // 水平对齐：居中
  dxf.push('73', '2'); // 垂直对齐：中间
  dxf.push('11', x.toFixed(2)); // 对齐点 X
  dxf.push('21', y.toFixed(2)); // 对齐点 Y
}

/**
 * 添加填充图案（用于煤柱）
 */
function addHatch(dxf, boundary, layer) {
  if (!boundary || boundary.length < 3) return;
  
  dxf.push('0', 'HATCH');
  dxf.push('8', layer); // 图层
  dxf.push('2', 'ANSI31'); // 填充图案：斜线
  dxf.push('70', '1'); // 实体填充标志
  dxf.push('71', '0'); // 关联性：非关联
  dxf.push('91', '1'); // 边界路径数量
  
  // 边界路径
  dxf.push('92', '1'); // 边界路径类型：外部
  dxf.push('72', '0'); // 边界路径类型标志
  dxf.push('73', '1'); // 是否闭合
  dxf.push('93', boundary.length.toString()); // 边界顶点数
  
  boundary.forEach(point => {
    dxf.push('10', point.x.toFixed(2));
    dxf.push('20', point.y.toFixed(2));
  });
  
  dxf.push('97', '0'); // 边界对象数量
  dxf.push('75', '1'); // 填充样式：普通
  dxf.push('76', '1'); // 填充图案类型：预定义
  dxf.push('98', '1'); // 种子点数量
  dxf.push('10', boundary[0].x.toFixed(2)); // 种子点 X
  dxf.push('20', boundary[0].y.toFixed(2)); // 种子点 Y
}

/**
 * 添加矩形
 */
function addRectangle(dxf, x, y, width, height, layer) {
  const corners = [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height }
  ];
  addPolyline(dxf, corners, layer, true);
}
