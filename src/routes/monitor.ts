/**
 * 系统监控 API 路由
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getSystemStats } from '../services/monitor';

const router = Router();

/** GET /api/monitor — 获取系统状态快照 */
router.get('/', (_req: Request, res: Response) => {
  try {
    const stats = getSystemStats();
    res.json({ data: stats });
  } catch (err: any) {
    res.status(500).json({ message: `获取系统状态失败: ${err.message}` });
  }
});

export default router;
