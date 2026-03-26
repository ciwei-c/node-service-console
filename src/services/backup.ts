/**
 * 数据备份与恢复
 *
 * 备份内容：
 *   - store.json（服务+站点数据）
 *   - logs.json（操作日志）
 *   - config.json / local-settings.json（配置）
 *   - static-sites/（静态站点文件）
 *
 * 使用 zip 命令（Linux）或 PowerShell（Windows）打包。
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getDataDir, readLocalSettings } from '../store';
import { getSitesRoot } from './sites';

const isLinux = process.platform === 'linux';

const configDir = isLinux
  ? '/etc/node-service-console'
  : path.join(__dirname, '..', '..', 'config');

export interface BackupInfo {
  filename: string;
  createdAt: string;
  sizeMB: number;
}

/** 列出已有的备份 */
export function listBackups(): BackupInfo[] {
  const backupDir = getBackupDir();
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter((f) => f.endsWith('.zip'))
    .map((f) => {
      const stat = fs.statSync(path.join(backupDir, f));
      return {
        filename: f,
        createdAt: stat.mtime.toISOString(),
        sizeMB: Math.round(stat.size / 1024 / 1024 * 100) / 100,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 备份存储目录 */
function getBackupDir(): string {
  const dir = path.join(getDataDir(), 'backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 创建备份 zip */
export function createBackup(): BackupInfo {
  const dataDir = getDataDir();
  const sitesRoot = getSitesRoot();
  const backupDir = getBackupDir();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `backup-${timestamp}.zip`;
  const zipPath = path.join(backupDir, filename);

  // 创建临时目录组织备份结构
  const tmpDir = path.join(dataDir, `_backup_tmp_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // 复制数据文件
    const dataFiles = ['store.json', 'logs.json', 'oauth-token.json'];
    for (const f of dataFiles) {
      const src = path.join(dataDir, f);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(tmpDir, f));
      }
    }

    // 复制配置文件
    const configDst = path.join(tmpDir, 'config');
    fs.mkdirSync(configDst, { recursive: true });
    if (fs.existsSync(configDir)) {
      for (const f of fs.readdirSync(configDir)) {
        const src = path.join(configDir, f);
        if (fs.statSync(src).isFile()) {
          fs.copyFileSync(src, path.join(configDst, f));
        }
      }
    }

    // 复制静态站点
    if (fs.existsSync(sitesRoot)) {
      const sitesDst = path.join(tmpDir, 'static-sites');
      copyDirSync(sitesRoot, sitesDst);
    }

    // 打包
    if (isLinux) {
      execSync(`cd "${tmpDir}" && zip -r "${zipPath}" .`, { timeout: 60000 });
    } else {
      execSync(
        `powershell -Command "Compress-Archive -Path '${tmpDir}\\*' -DestinationPath '${zipPath}' -Force"`,
        { timeout: 60000 },
      );
    }
  } finally {
    // 清理临时目录
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const stat = fs.statSync(zipPath);
  return {
    filename,
    createdAt: new Date().toISOString(),
    sizeMB: Math.round(stat.size / 1024 / 1024 * 100) / 100,
  };
}

/** 获取备份文件的完整路径 */
export function getBackupPath(filename: string): string | null {
  // 防止路径遍历
  const safe = path.basename(filename);
  const filePath = path.join(getBackupDir(), safe);
  if (!fs.existsSync(filePath)) return null;
  return filePath;
}

/** 删除备份 */
export function deleteBackup(filename: string): boolean {
  const filePath = getBackupPath(filename);
  if (!filePath) return false;
  fs.unlinkSync(filePath);
  return true;
}

/** 从上传的 zip 文件恢复数据 */
export function restoreBackup(zipPath: string): { restored: string[] } {
  const dataDir = getDataDir();
  const sitesRoot = getSitesRoot();
  const tmpDir = path.join(dataDir, `_restore_tmp_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // 解压
    if (isLinux) {
      execSync(`unzip -o "${zipPath}" -d "${tmpDir}"`, { timeout: 60000 });
    } else {
      execSync(
        `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tmpDir}' -Force"`,
        { timeout: 60000 },
      );
    }

    const restored: string[] = [];

    // 恢复数据文件
    const dataFiles = ['store.json', 'logs.json', 'oauth-token.json'];
    for (const f of dataFiles) {
      const src = path.join(tmpDir, f);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(dataDir, f));
        restored.push(f);
      }
    }

    // 恢复配置文件
    const configSrc = path.join(tmpDir, 'config');
    if (fs.existsSync(configSrc)) {
      if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
      for (const f of fs.readdirSync(configSrc)) {
        const src = path.join(configSrc, f);
        if (fs.statSync(src).isFile()) {
          fs.copyFileSync(src, path.join(configDir, f));
          restored.push(`config/${f}`);
        }
      }
    }

    // 恢复静态站点
    const sitesSrc = path.join(tmpDir, 'static-sites');
    if (fs.existsSync(sitesSrc)) {
      copyDirSync(sitesSrc, sitesRoot);
      restored.push('static-sites/');
    }

    return { restored };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  }
}

/** 递归复制目录 */
function copyDirSync(src: string, dst: string): void {
  if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}
