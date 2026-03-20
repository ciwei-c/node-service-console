/**
 * 静态站点路由
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import os from 'os';
import { listSites, getSiteById, createSite, deleteSite, deploySite } from '../services/sites';

const router = Router();

// multer 配置 — 存到系统临时目录
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
  fileFilter: (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.zip') {
      cb(new Error('仅支持 .zip 文件'));
      return;
    }
    cb(null, true);
  },
});

/** GET /api/sites — 站点列表 */
router.get('/', (_req: Request, res: Response) => {
  res.json({ data: listSites() });
});

/** POST /api/sites — 创建站点 */
router.post('/', (req: Request, res: Response) => {
  const result = createSite(req.body);
  if ('error' in result) {
    res.status(400).json({ message: result.error });
    return;
  }
  res.status(201).json({ data: result });
});

/** DELETE /api/sites/:id — 删除站点 */
router.delete('/:id', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const removed = deleteSite(id);
  if (!removed) {
    res.status(404).json({ message: '站点不存在' });
    return;
  }
  res.json({ data: removed });
});

/** POST /api/sites/:id/deploy — 上传 zip 部署 */
router.post('/:id/deploy', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const file = (req as any).file;
    if (!file) {
      res.status(400).json({ message: '请上传 .zip 文件' });
      return;
    }
    const version = (req.body?.version as string) || '';
    const id = req.params.id as string;
    const result = await deploySite(id, file.path, version);
    if ('error' in result) {
      res.status(400).json({ message: result.error });
      return;
    }
    res.json({ data: result });
  } catch (err: any) {
    res.status(500).json({ message: err.message || '部署失败' });
  }
});

export default router;
