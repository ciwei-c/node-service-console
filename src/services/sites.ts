/**
 * 静态站点管理 — 业务逻辑层
 *
 * 站点文件存储目录：
 *   Linux  — /var/lib/node-service-console/static-sites/{name}/
 *   其他   — <project>/static-sites/{name}/
 */
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { readStore, writeStore } from '../store';
import type { StaticSite, ErrorResult } from '../types';

/** 站点名称：字母、数字、连字符、下划线，2-50 字符 */
const SITE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,49}$/;

/** 返回 static-sites 根目录 */
export function getSitesRoot(): string {
  const isLinux = process.platform === 'linux';
  const root = isLinux
    ? '/var/lib/node-service-console/static-sites'
    : path.join(__dirname, '..', '..', 'static-sites');
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

/** 返回指定站点的文件目录 */
export function getSiteDir(name: string): string {
  return path.join(getSitesRoot(), name);
}

/**
 * 递归查找目录下所有 .html 文件
 */
function findHtmlFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findHtmlFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * 自动修正所有 HTML 文件 —— 注入 <base> 标签 + 将绝对路径转为相对路径
 *
 * 大多数前端构建工具（Vite / CRA / Next.js export）默认生成绝对路径：
 *   <script src="/assets/index-xxx.js">
 *   <link href="/assets/index-xxx.css">
 *
 * 部署在 /web/{name}/ 下时需要改为相对路径 + <base> 标签：
 *   <base href="/web/{name}/">
 *   <script src="assets/index-xxx.js">
 */
function rewriteHtmlFiles(dir: string, accessPath: string): void {
  const htmlFiles = findHtmlFiles(dir);
  const basePath = accessPath.endsWith('/') ? accessPath : accessPath + '/';

  for (const filePath of htmlFiles) {
    let html = fs.readFileSync(filePath, 'utf-8');

    // 如果已经有 <base> 标签，跳过
    if (/<base\s/i.test(html)) continue;

    // 1) src="/xxx" 和 href="/xxx" 中的绝对路径转为相对路径
    //    排除 protocol-relative (//xxx) 和完整 URL (http://)
    html = html.replace(
      /((?:src|href|action)\s*=\s*["'])\/(?!\/|[a-zA-Z]+:)/g,
      '$1',
    );

    // 2) 在 <head> 中注入 <base> 标签
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(
        /(<head[^>]*>)/i,
        `$1\n  <base href="${basePath}">`,
      );
    }

    fs.writeFileSync(filePath, html, 'utf-8');
  }
}

/* ── CRUD ── */

export function listSites(): StaticSite[] {
  const store = readStore();
  return store.sites || [];
}

export function getSiteById(id: string): StaticSite | null {
  return listSites().find((s) => s.id === id) || null;
}

export function createSite(payload: { name: string }): StaticSite | ErrorResult {
  const store = readStore();
  if (!store.sites) store.sites = [];

  const name = payload.name?.trim();
  if (!name || !SITE_NAME_RE.test(name)) {
    return { error: '站点名称不合法（仅允许字母、数字、连字符、下划线，2-50 字符）' };
  }

  // 检查重名
  if (store.sites.find((s) => s.name === name)) {
    return { error: '站点名称已存在' };
  }

  // 同时检查是否和服务的 accessPath 冲突（虽然前缀 /web/ 已经隔离，但名称保持唯一更好）
  const dir = getSiteDir(name);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const now = new Date().toISOString();
  const site: StaticSite = {
    id: uuidv4(),
    name,
    accessPath: `/web/${name}`,
    currentVersion: '',
    createdAt: now,
    updatedAt: now,
  };
  store.sites.push(site);
  writeStore(store);
  return site;
}

export function deleteSite(id: string): StaticSite | null {
  const store = readStore();
  if (!store.sites) return null;
  const idx = store.sites.findIndex((s) => s.id === id);
  if (idx === -1) return null;

  const removed = store.sites.splice(idx, 1)[0];

  // 删除文件目录
  const dir = getSiteDir(removed.name);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  writeStore(store);
  return removed;
}

/* ── 部署（解压 zip） ── */

/**
 * 将上传的 zip 文件解压部署到站点目录
 * @param id 站点 ID
 * @param zipPath 上传的 zip 临时文件路径
 * @param version 可选版本号
 */
export async function deploySite(
  id: string,
  zipPath: string,
  version?: string,
): Promise<StaticSite | ErrorResult> {
  const store = readStore();
  if (!store.sites) store.sites = [];
  const site = store.sites.find((s) => s.id === id);
  if (!site) return { error: '站点不存在' };

  const dir = getSiteDir(site.name);

  // 清空旧文件
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });

  // 使用 unzip 解压（Linux 上可用 unzip，Windows 上用 PowerShell）
  const { execSync } = await import('child_process');
  try {
    if (process.platform === 'linux') {
      execSync(`unzip -o "${zipPath}" -d "${dir}"`, { stdio: 'pipe' });
    } else {
      execSync(
        `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${dir}' -Force"`,
        { stdio: 'pipe' },
      );
    }
  } catch (err: any) {
    return { error: `解压失败: ${err.message}` };
  } finally {
    // 清理临时文件
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  }

  // 如果解压后只有一个顶层目录，将内容移到站点根目录
  const entries = fs.readdirSync(dir);
  if (entries.length === 1) {
    const single = path.join(dir, entries[0]);
    if (fs.statSync(single).isDirectory()) {
      const innerEntries = fs.readdirSync(single);
      for (const entry of innerEntries) {
        fs.renameSync(path.join(single, entry), path.join(dir, entry));
      }
      fs.rmdirSync(single);
    }
  }

  // 自动修正所有 HTML 文件中的资源路径（注入 <base> + 绝对路径转相对路径）
  rewriteHtmlFiles(dir, site.accessPath);

  // 更新站点信息
  const now = new Date().toISOString();
  site.currentVersion = version || now;
  site.deployedAt = now;
  site.updatedAt = now;
  writeStore(store);

  return site;
}
