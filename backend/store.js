/**
 * 内存存储 - 实际项目中应替换为数据库
 */
const store = {
  boundary: [],              // 采区边界顶点数组 [{ x, y }, ...]
  boreholes: [],             // 钻孔列表 (合并后)
  boreholeCoordinates: [],   // 钻孔坐标 (临时)
  boreholeData: [],          // 钻孔数据 (临时)
  scores: null,              // 计算后的评分结果
  design: null,              // 生成的设计方案
};

export default store;
