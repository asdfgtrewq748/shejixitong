import express from 'express';
import cors from 'cors';

import boundaryRoutes from './routes/boundary.js';
import boreholeRoutes from './routes/boreholes.js';
import scoreRoutes from './routes/score.js';
import designRoutes from './routes/design.js';
import uploadRoutes from './routes/upload.js';
import geologyRoutes from './routes/geology.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// --------- API 路由 ---------
app.use('/api/boundary', boundaryRoutes);
app.use('/api/boreholes', boreholeRoutes);
app.use('/api/score', scoreRoutes);
app.use('/api/design', designRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/geology', geologyRoutes);

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.listen(PORT, () => {
  console.log(`🚀 后端服务已启动: http://localhost:${PORT}`);
});
