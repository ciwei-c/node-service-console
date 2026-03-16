/**
 * 服务相关 API 路由
 */
import http from 'http';
import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  listServices, createService, getServiceById, getServiceByName, deleteService,
  publishServiceAsync, rollbackService, deleteDeployment, stopServicePublish,
  stopService, startService, updateServiceEnvVars, updateServicePipeline,
  getPublishStatus, isPublishing, addSseClient,
} from '../services';
import { maskService, maskServices } from '../helpers';
import type { ErrorResult } from '../types';

const router = Router();

/* ── CRUD ── */

router.get('/', (_req: Request, res: Response) => {
  res.json({ data: maskServices(listServices()) });
});

router.post('/', (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name || !name.trim())
    return res.status(400).json({ message: '服务名称不能为空' });
  const result = createService({ name: name.trim() });
  if ('error' in result && result.error === 'invalid-name')
    return res.status(400).json({ message: '服务名称只能包含字母、数字、连字符和下划线，长度 2-50' });
  if ('error' in result && result.error === 'name-duplicate')
    return res.status(400).json({ message: '服务名称已存在，请使用其他名称' });
  return res.status(201).json({ data: result });
});

router.get('/by-name/:name', (req: Request<{ name: string }>, res: Response) => {
  const svc = getServiceByName(req.params.name);
  if (!svc) return res.status(404).json({ message: '服务不存在' });
  return res.json({ data: maskService(svc) });
});

router.get('/:id', (req: Request<{ id: string }>, res: Response) => {
  const svc = getServiceById(req.params.id);
  if (!svc) return res.status(404).json({ message: '服务不存在' });
  return res.json({ data: maskService(svc) });
});

router.delete('/:id', (req: Request<{ id: string }>, res: Response) => {
  const removed = deleteService(req.params.id);
  if (!removed) return res.status(404).json({ message: '服务不存在' });
  return res.json({ data: removed });
});

/* ── 发布 / 回退 ── */

router.post('/:id/publish', (req: Request<{ id: string }>, res: Response) => {
  const result = publishServiceAsync(req.params.id);
  if (!result) return res.status(404).json({ message: '服务不存在' });
  if ('error' in result) {
    if (result.error === 'already-publishing')
      return res.status(409).json({ message: '该服务正在发布中，请等待完成' });
    return res.status(500).json({ message: result.error });
  }
  return res.json({ data: { status: 'publishing', version: result.version } });
});

router.post('/:id/stop-publish', (req: Request<{ id: string }>, res: Response) => {
  const result = stopServicePublish(req.params.id);
  if (!result) return res.status(400).json({ message: '没有正在进行的发布' });
  return res.json({ data: { version: result.version, message: '发布已停止' } });
});

router.get('/:id/publish-status', (req: Request<{ id: string }>, res: Response) => {
  const status = getPublishStatus(req.params.id);
  if (!status) return res.json({ data: null });
  return res.json({ data: status });
});

/* SSE — 实时推送发布状态和日志 */
router.get('/:id/publish-events', (req: Request<{ id: string }>, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('\n');

  // 立即发送当前状态
  const current = getPublishStatus(req.params.id);
  if (current) {
    res.write(`event: status\ndata: ${JSON.stringify(current)}\n\n`);
  }

  addSseClient(req.params.id, res);

  // 心跳保活
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
  }, 15000);
  res.on('close', () => clearInterval(heartbeat));
});

router.post('/:id/rollback', async (req: Request<{ id: string }>, res: Response) => {
  const { targetVersion, note, operator } = req.body;
  if (!targetVersion || !targetVersion.trim())
    return res.status(400).json({ message: '回退目标版本不能为空' });
  const result = await rollbackService(req.params.id, { targetVersion: targetVersion.trim(), note, operator });
  if (!result) return res.status(404).json({ message: '服务不存在' });
  if ('error' in result) {
    if (result.error === 'target-version-not-found')
      return res.status(400).json({ message: '历史版本不存在，无法回退' });
    if (result.error === 'docker-failed')
      return res.status(500).json({ message: 'Docker 回退失败，镜像可能已被清理', logs: (result as ErrorResult).logs });
  }
  return res.json({ data: result });
});

router.delete('/:id/deployments/:did', (req: Request<{ id: string; did: string }>, res: Response) => {
  // 不允许删除当前运行中的版本
  const svc = getServiceById(req.params.id);
  if (!svc) return res.status(404).json({ message: '服务不存在' });
  const dep = svc.deployments.find((d) => d.id === req.params.did);
  if (dep && dep.version === svc.currentVersion) {
    return res.status(400).json({ message: '不能删除当前运行中的版本记录' });
  }
  const result = deleteDeployment(req.params.id, req.params.did);
  if (!result) return res.status(404).json({ message: '服务不存在' });
  if ('error' in result && result.error === 'deployment-not-found')
    return res.status(404).json({ message: '部署记录不存在' });
  return res.json({ data: result });
});

/* ── 停止 / 启动 ── */

router.post('/:id/stop', (req: Request<{ id: string }>, res: Response) => {
  const svc = stopService(req.params.id);
  if (!svc) return res.status(404).json({ message: '服务不存在' });
  return res.json({ data: svc });
});

router.post('/:id/start', (req: Request<{ id: string }>, res: Response) => {
  const svc = startService(req.params.id);
  if (!svc) return res.status(404).json({ message: '服务不存在' });
  return res.json({ data: svc });
});

/* ── 环境变量 / 流水线 ── */

router.put('/:id/env', (req: Request<{ id: string }>, res: Response) => {
  const result = updateServiceEnvVars(req.params.id, req.body.envVars);
  if (result === null) return res.status(404).json({ message: '服务不存在' });
  return res.json({ data: result });
});

router.put('/:id/pipeline', (req: Request<{ id: string }>, res: Response) => {
  const result = updateServicePipeline(req.params.id, req.body);
  if (result === null) return res.status(404).json({ message: '服务不存在' });
  return res.json({ data: result });
});

/* ── 云端调试 — HTTP 代理 ── */

router.post('/:id/debug/http', async (req: Request<{ id: string }>, res: Response) => {
  const svc = getServiceById(req.params.id);
  if (!svc) return res.status(404).json({ message: '服务不存在' });
  if (svc.status !== 'running') return res.status(400).json({ message: '服务未运行，请先启动服务' });

  const {
    method = 'GET',
    path = '/',
    headers = {},
    query = {},
    body,
  } = req.body;

  const port = svc.hostPort || svc.pipeline?.port;
  if (!port) return res.status(400).json({ message: '服务未配置端口' });

  // 构建目标 URL
  const url = new URL(`http://127.0.0.1:${port}${path}`);
  if (query && typeof query === 'object') {
    Object.entries(query as Record<string, string>).forEach(([k, v]) => {
      if (k.trim()) url.searchParams.set(k, String(v));
    });
  }

  const proxyHeaders: Record<string, string> = {};
  if (headers && typeof headers === 'object') {
    Object.entries(headers as Record<string, string>).forEach(([k, v]) => {
      if (k.trim()) proxyHeaders[k] = String(v);
    });
  }

  const start = Date.now();

  try {
    const result = await new Promise<{
      status: number;
      statusText: string;
      headers: Record<string, string>;
      body: string;
    }>((resolve, reject) => {
      const proxyReq = http.request(url.toString(), {
        method: method.toUpperCase(),
        headers: proxyHeaders,
      }, (proxyRes) => {
        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          const resHeaders: Record<string, string> = {};
          Object.entries(proxyRes.headers).forEach(([k, v]) => {
            resHeaders[k] = Array.isArray(v) ? v.join(', ') : (v || '');
          });
          resolve({
            status: proxyRes.statusCode || 0,
            statusText: proxyRes.statusMessage || '',
            headers: resHeaders,
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
      });

      proxyReq.on('error', reject);

      if (body !== undefined && body !== null && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
        const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
        if (!proxyHeaders['content-type'] && !proxyHeaders['Content-Type']) {
          proxyReq.setHeader('Content-Type', 'application/json');
        }
        proxyReq.write(bodyStr);
      }

      proxyReq.end();
    });

    const duration = Date.now() - start;
    return res.json({ data: { ...result, duration } });
  } catch (err: any) {
    return res.status(502).json({ message: `请求失败: ${err.message}` });
  }
});

export default router;
