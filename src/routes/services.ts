/**
 * 服务相关 API 路由
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  listServices, createService, getServiceById, getServiceByName, deleteService,
  publishService, rollbackService, deleteDeployment,
  stopService, startService, updateServiceEnvVars, updateServicePipeline,
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
  const result = publishService(req.params.id);
  if (!result) return res.status(404).json({ message: '服务不存在' });
  if ('error' in result && result.error === 'docker-failed')
    return res.status(500).json({ message: 'Docker 执行失败', logs: (result as ErrorResult).logs });
  return res.json({ data: result });
});

router.post('/:id/rollback', (req: Request<{ id: string }>, res: Response) => {
  const { targetVersion, note, operator } = req.body;
  if (!targetVersion || !targetVersion.trim())
    return res.status(400).json({ message: '回退目标版本不能为空' });
  const result = rollbackService(req.params.id, { targetVersion: targetVersion.trim(), note, operator });
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

export default router;
