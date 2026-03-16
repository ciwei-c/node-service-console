/**
 * 密码重置脚本
 *
 * 用法：npm run reset-password
 *
 * 当管理员忘记密码时，在服务器上运行此命令即可重新生成一个随机密码。
 */
import crypto from 'crypto';
import { readLocalSettings, writeLocalSettings } from './store';

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function createPasswordHash(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  return `${salt}:${hash}`;
}

function main(): void {
  const settings = readLocalSettings();

  if (!settings.auth) {
    settings.auth = {};
  }

  const newPassword = crypto.randomBytes(6).toString('base64url');
  settings.auth.passwordHash = createPasswordHash(newPassword);
  writeLocalSettings(settings);

  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  管理员密码已重置：                            ║');
  console.log(`║  新密码: ${newPassword.padEnd(35)}║`);
  console.log('║  请妥善保管，登录后可在页面上修改。             ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
}

main();
