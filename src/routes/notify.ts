/**
 * 通知告警 API 路由
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getNotifyConfig, saveNotifyConfig, testChannel } from '../services/notify';

const router = Router();

/** GET /api/notify/config — 获取通知配置 */
router.get('/config', (_req: Request, res: Response) => {
  res.json({ data: getNotifyConfig() });
});

/** PUT /api/notify/config — 更新通知配置 */
router.put('/config', (req: Request, res: Response) => {
  const config = req.body;
  if (!config || typeof config.enabled !== 'boolean') {
    res.status(400).json({ message: '无效的通知配置' });
    return;
  }
  saveNotifyConfig(config);
  res.json({ data: config });
});

/** POST /api/notify/test — 测试指定渠道 */
router.post('/test', async (req: Request, res: Response) => {
  const channel = req.body;
  if (!channel || !channel.type) {
    res.status(400).json({ message: '请提供渠道配置' });
    return;
  }
  const result = await testChannel(channel);
  res.json({ data: result });
});

export default router;
