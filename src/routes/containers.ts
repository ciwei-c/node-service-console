/**
 * Docker 容器查询路由
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { dockerListContainers, dockerInspectContainer, dockerContainerLogs } from '../docker';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  return res.json({ data: dockerListContainers() });
});

router.get('/:id/inspect', (req: Request<{ id: string }>, res: Response) => {
  const detail = dockerInspectContainer(req.params.id);
  if (!detail) return res.status(404).json({ message: '容器不存在' });
  return res.json({ data: detail });
});

router.get('/:id/logs', (req: Request<{ id: string }>, res: Response) => {
  const tail = parseInt(req.query.tail as string) || 100;
  const logs = dockerContainerLogs(req.params.id, tail);
  return res.json({ data: logs });
});

export default router;
