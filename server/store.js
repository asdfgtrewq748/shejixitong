/**
 * 内存存储 - 实际项目中应替换为数据库
 */
const store = {
  boundary: [],      // 采区边界顶点数组 [{ x, y }, ...]
  boreholes: [],     // 钻孔列表
  scores: null,      // 计算后的评分结果
  design: null,      // 生成的设计方案
};

export default store;
