/**
 * Express 应用配置
 */
import express from 'express';
import cors from 'cors';
import path from 'path';
import { servicesRouter, containersRouter, webhookRouter, logsRouter } from './routes';

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'web', 'dist')));

/* ── 路由挂载 ── */
app.use('/api/services', servicesRouter);
app.use('/api/containers', containersRouter);
app.use('/api/webhook', webhookRouter);
app.use('/api/logs', logsRouter);

/* ── SPA fallback ── */
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'web', 'dist', 'index.html'));
});

export default app;
