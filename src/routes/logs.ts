/**
 * 操作日志查询路由
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { queryLogs, getLogServiceNames } from '../services';

const router = Router();

/**
 * GET /api/logs
 * 查询维度 (query params):
 *   startTime    - 起始时间 (ISO)
 *   endTime      - 结束时间 (ISO)
 *   serviceName  - 服务名称
 *   action       - 操作类型: publish|rollback|stop|start|create|delete|webhook|config-env|config-pipeline
 *   success      - 执行结果: true|false
 *   keyword      - 关键字搜索
 *   page         - 页码 (默认 1)
 *   pageSize     - 每页条数 (默认 20, 最大 100)
 */
router.get('/', (req: Request, res: Response) => {
  const result = queryLogs({
    startTime: req.query.startTime as string,
    endTime: req.query.endTime as string,
    serviceName: req.query.serviceName as string,
    action: req.query.action as any,
    success: req.query.success as string,
    keyword: req.query.keyword as string,
    page: Number(req.query.page) || 1,
    pageSize: Number(req.query.pageSize) || 20,
  });
  return res.json({ data: result });
});

/** GET /api/logs/service-names — 获取所有服务名 (用于下拉选择) */
router.get('/service-names', (_req: Request, res: Response) => {
  return res.json({ data: getLogServiceNames() });
});

export default router;
