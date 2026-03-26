/**
 * 数据备份与恢复 API 路由
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import os from 'os';
import path from 'path';
import { listBackups, createBackup, getBackupPath, deleteBackup, restoreBackup } from '../services/backup';

const router = Router();

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.zip') {
      cb(new Error('仅支持 .zip 文件'));
      return;
    }
    cb(null, true);
  },
});

/** GET /api/backup — 列出备份 */
router.get('/', (_req: Request, res: Response) => {
  res.json({ data: listBackups() });
});

/** POST /api/backup — 创建新备份 */
router.post('/', (_req: Request, res: Response) => {
  try {
    const info = createBackup();
    res.status(201).json({ data: info });
  } catch (err: any) {
    res.status(500).json({ message: `备份失败: ${err.message}` });
  }
});

/** GET /api/backup/download/:filename — 下载备份 */
router.get('/download/:filename', (req: Request<{ filename: string }>, res: Response) => {
  const filePath = getBackupPath(req.params.filename);
  if (!filePath) {
    res.status(404).json({ message: '备份文件不存在' });
    return;
  }
  res.download(filePath);
});

/** DELETE /api/backup/:filename — 删除备份 */
router.delete('/:filename', (req: Request<{ filename: string }>, res: Response) => {
  if (!deleteBackup(req.params.filename)) {
    res.status(404).json({ message: '备份文件不存在' });
    return;
  }
  res.json({ data: { deleted: true } });
});

/** POST /api/backup/restore — 上传 zip 恢复 */
router.post('/restore', upload.single('file'), (req: Request, res: Response) => {
  try {
    const file = (req as any).file;
    if (!file) {
      res.status(400).json({ message: '请上传备份 .zip 文件' });
      return;
    }
    const result = restoreBackup(file.path);
    res.json({ data: result });
  } catch (err: any) {
    res.status(500).json({ message: `恢复失败: ${err.message}` });
  }
});

export default router;
