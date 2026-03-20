/**
 * JSON 文件持久化层
 *
 * 配置与数据目录规则：
 *   Linux  — 配置 /etc/node-service-console/config.json
 *            数据 /var/lib/node-service-console/
 *   其他   — 回退到项目目录下 config/ 和 data/
 */
import fs from 'fs';
import path from 'path';
import type { Store, LocalSettings, OAuthToken } from './types';

const isLinux = process.platform === 'linux';

const configDir = isLinux
  ? '/etc/node-service-console'
  : path.join(__dirname, '..', 'config');
const configPath = path.join(configDir, isLinux ? 'config.json' : 'local-settings.json');

const dataDir = isLinux
  ? '/var/lib/node-service-console'
  : path.join(__dirname, '..', 'data');
const dataPath = path.join(dataDir, 'store.json');
const logsPath = path.join(dataDir, 'logs.json');

const defaultStore: Store = { services: [], sites: [] };
const defaultLocalSettings: LocalSettings = { server: { port: 80 } };

/** 确保数据文件存在 */
function ensureFiles(): void {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dataPath))
    fs.writeFileSync(dataPath, JSON.stringify(defaultStore, null, 2), 'utf-8');
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  if (!fs.existsSync(configPath))
    fs.writeFileSync(configPath, JSON.stringify(defaultLocalSettings, null, 2), 'utf-8');
}

export function readStore(): Store {
  ensureFiles();
  return JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
}

export function writeStore(store: Store): void {
  fs.writeFileSync(dataPath, JSON.stringify(store, null, 2), 'utf-8');
}

export function readLocalSettings(): LocalSettings {
  ensureFiles();
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

export function writeLocalSettings(settings: LocalSettings): void {
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(settings, null, 2), 'utf-8');
}

/** 返回数据目录路径（供其他模块使用） */
export function getDataDir(): string {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

/* ── OAuth Token 持久化 ── */

const oauthPath = path.join(dataDir, 'oauth-token.json');

export function readOAuthToken(): OAuthToken | null {
  try {
    if (fs.existsSync(oauthPath)) {
      return JSON.parse(fs.readFileSync(oauthPath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return null;
}

export function writeOAuthToken(token: OAuthToken): void {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(oauthPath, JSON.stringify(token, null, 2), 'utf-8');
}

export function removeOAuthToken(): void {
  if (fs.existsSync(oauthPath)) fs.unlinkSync(oauthPath);
}


