/**
 * 认证模块 — 密码登录 + JWT 校验中间件
 *
 * 首次启动时自动为配置文件生成随机密码和 JWT 密钥，
 * 并将初始密码打印到控制台（仅首次）。
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { readLocalSettings, writeLocalSettings } from '../store';

const router = Router();

/* ── 密码哈希工具 ── */

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

/** 生成密码哈希（格式：salt:hash） */
function createPasswordHash(password: string): string {
  const salt = generateSalt();
  const hash = hashPassword(password, salt);
  return `${salt}:${hash}`;
}

/** 校验密码 */
function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  return hashPassword(password, salt) === hash;
}

/* ── 初始化：首次启动生成密码和 JWT 密钥 ── */

export function initAuth(): void {
  const settings = readLocalSettings();
  let changed = false;

  if (!settings.auth) {
    settings.auth = {};
  }

  if (!settings.auth.jwtSecret) {
    settings.auth.jwtSecret = crypto.randomBytes(32).toString('hex');
    changed = true;
  }

  if (!settings.auth.passwordHash) {
    const defaultPassword = crypto.randomBytes(6).toString('base64url');
    settings.auth.passwordHash = createPasswordHash(defaultPassword);
    changed = true;
    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║  首次启动，已自动生成管理员密码：              ║');
    console.log(`║  密码: ${defaultPassword.padEnd(37)}║`);
    console.log('║  请妥善保管，可在配置文件中修改。              ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');
  }

  if (changed) {
    writeLocalSettings(settings);
  }
}

/* ── 获取 JWT 密钥 ── */

function getJwtSecret(): string {
  const settings = readLocalSettings();
  return settings.auth?.jwtSecret || 'fallback-secret';
}

function getTokenExpireSeconds(): number {
  const settings = readLocalSettings();
  const days = settings.auth?.tokenExpireDays ?? 7;
  return days * 24 * 60 * 60;
}

/* ── 登录 API ── */

router.post('/login', (req: Request, res: Response) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ message: '请输入密码' });
  }

  const settings = readLocalSettings();
  const storedHash = settings.auth?.passwordHash;
  if (!storedHash) {
    return res.status(500).json({ message: '服务端密码未初始化' });
  }

  if (!verifyPassword(password, storedHash)) {
    return res.status(401).json({ message: '密码错误' });
  }

  const token = jwt.sign(
    { role: 'admin', iat: Math.floor(Date.now() / 1000) },
    getJwtSecret(),
    { expiresIn: getTokenExpireSeconds() },
  );

  return res.json({
    data: {
      token,
      expiresIn: getTokenExpireSeconds(),
    },
  });
});

/** 修改密码 API */
router.post('/change-password', (req: Request, res: Response) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ message: '请输入旧密码和新密码' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ message: '新密码长度至少 6 位' });
  }

  const settings = readLocalSettings();
  const storedHash = settings.auth?.passwordHash;
  if (!storedHash || !verifyPassword(oldPassword, storedHash)) {
    return res.status(401).json({ message: '旧密码错误' });
  }

  settings.auth!.passwordHash = createPasswordHash(newPassword);
  writeLocalSettings(settings);

  return res.json({ data: { ok: true } });
});

/* ── JWT 校验中间件 ── */

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // 登录接口和 Webhook 不需要鉴权
  if (req.path === '/api/auth/login') {
    next();
    return;
  }
  // Webhook 使用自身的签名验证
  if (req.path.startsWith('/api/webhook')) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ message: '未登录，请先登录' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    jwt.verify(token, getJwtSecret());
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      res.status(401).json({ message: '登录已过期，请重新登录' });
    } else {
      res.status(401).json({ message: '无效的登录凭证' });
    }
  }
}

export default router;
