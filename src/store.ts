/**
 * JSON 文件持久化层
 */
import fs from 'fs';
import path from 'path';
import type { Store, LocalSettings } from './types';

const dataDir = path.join(__dirname, '..', 'data');
const dataPath = path.join(dataDir, 'store.json');
const configDir = path.join(__dirname, '..', 'config');
const configPath = path.join(configDir, 'local-settings.json');

const defaultStore: Store = { services: [] };
const defaultLocalSettings: LocalSettings = { server: { port: 3000 } };

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
