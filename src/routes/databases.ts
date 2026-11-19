/**
 * 数据库实例 API
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  listDatabases,
  getDatabase,
  createDatabase,
  deleteDatabase,
  startDatabase,
  stopDatabase,
  restartDatabase,
  getDatabaseLogs,
  getDatabaseStats,
} from '../services/databases';
import type { ErrorResult } from '../types';

const router = Router();

const ERROR_MAP: Record<string, { status: number; message: string }> = {
  'invalid-name': { status: 400, message: '实例名称只能包含小写字母、数字和连字符，长度 2-31' },
  'invalid-image': { status: 400, message: '镜像名称不合法' },
  'invalid-database': { status: 400, message: '数据库名不合法' },
  'invalid-username': { status: 400, message: '账号不合法' },
  'invalid-volume': { status: 400, message: '数据卷名称不合法' },
  'invalid-port': { status: 400, message: '端口不合法' },
  'invalid-memory': { status: 400, message: '内存限制需在 128-8192 MB' },
  'name-duplicate': { status: 409, message: '实例名称已存在' },
  'volume-exists': { status: 409, message: '数据卷已存在，请换一个名称' },
  'port-in-use': { status: 409, message: '端口已被占用' },
  'no-port': { status: 409, message: '3306-3399 没有可用端口' },
  'not-found': { status: 404, message: '数据库实例不存在' },
  'not-managed': { status: 403, message: '外部容器不允许通过控制台删除' },
  'confirm-mismatch': { status: 400, message: '请输入正确的实例名称以确认删除' },
  'docker-failed': { status: 500, message: 'Docker 操作失败' },
};

function sendError(res: Response, result: ErrorResult): void {
  const info = ERROR_MAP[result.error] || { status: 500, message: result.error };
  res.status(info.status).json({ message: info.message, logs: result.logs });
}

router.get('/', (_req: Request, res: Response) => {
  return res.json({ data: listDatabases() });
});

router.post('/', async (req: Request, res: Response) => {
  const result = await createDatabase(req.body || {});
  if ('error' in result) return sendError(res, result);
  return res.status(201).json({ data: result });
});

router.get('/:id', (req: Request<{ id: string }>, res: Response) => {
  const instance = getDatabase(req.params.id);
  if (!instance) return res.status(404).json({ message: '数据库实例不存在' });
  return res.json({ data: instance });
});

router.delete('/:id', (req: Request<{ id: string }>, res: Response) => {
  const body = req.body || {};
  const result = deleteDatabase(req.params.id, {
    confirmName: body.confirmName,
    removeVolume: !!body.removeVolume,
  });
  if ('error' in result) return sendError(res, result);
  return res.json({ data: result });
});

router.post('/:id/start', (req: Request<{ id: string }>, res: Response) => {
  const result = startDatabase(req.params.id);
  if ('error' in result) return sendError(res, result);
  return res.json({ data: result });
});

router.post('/:id/stop', (req: Request<{ id: string }>, res: Response) => {
  const result = stopDatabase(req.params.id);
  if ('error' in result) return sendError(res, result);
  return res.json({ data: result });
});

router.post('/:id/restart', (req: Request<{ id: string }>, res: Response) => {
  const result = restartDatabase(req.params.id);
  if ('error' in result) return sendError(res, result);
  return res.json({ data: result });
});

router.get('/:id/logs', (req: Request<{ id: string }>, res: Response) => {
  const tail = Math.min(Math.max(parseInt(req.query.tail as string) || 200, 10), 2000);
  const logs = getDatabaseLogs(req.params.id, tail);
  if (logs === null) return res.status(404).json({ message: '数据库实例不存在' });
  return res.json({ data: logs });
});

router.get('/:id/stats', (req: Request<{ id: string }>, res: Response) => {
  return res.json({ data: getDatabaseStats(req.params.id) });
});

export default router;
