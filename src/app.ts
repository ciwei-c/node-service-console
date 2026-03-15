/**
 * Express 应用配置
 */
import express, { Router } from 'express';
import cors from 'cors';
import path from 'path';
import { servicesRouter, containersRouter, webhookRouter, logsRouter, gitRouter } from './routes';

export const BASE_PATH = '/node-service-console';

const app = express();
const baseRouter = Router();

app.use(cors());
app.use(express.json());

/* ── 静态资源 ── */
baseRouter.use(express.static(path.join(__dirname, '..', 'web', 'dist')));

/* ── API 路由挂载 ── */
baseRouter.use('/api/services', servicesRouter);
baseRouter.use('/api/containers', containersRouter);
baseRouter.use('/api/webhook', webhookRouter);
baseRouter.use('/api/logs', logsRouter);
baseRouter.use('/api/git', gitRouter);

/* ── SPA fallback ── */
baseRouter.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'web', 'dist', 'index.html'));
});

/* ── 挂载到基础路径 ── */
app.use(BASE_PATH, baseRouter);

/* ── 根路径重定向到控制台 ── */
app.get('/', (_req, res) => res.redirect(BASE_PATH));

export default app;
