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
import { execSync } from 'child_process';
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
 * 自动修正所有 HTML 文件中的资源路径
 *
 * 处理策略：
 * 1. 如果路径已经包含正确前缀（如 /web/ce-dev/assets/...） → 不处理
 * 2. 如果路径是根路径绝对引用（如 /assets/...） → 加上前缀变为 /web/ce-dev/assets/...
 * 3. 如果已有 <base> 标签 → 不处理
 *
 * 不再使用 <base> 标签注入，避免与已有构建配置冲突导致路径翻倍。
 */
function rewriteHtmlFiles(dir: string, accessPath: string): void {
  const htmlFiles = findHtmlFiles(dir);
  const prefix = accessPath.endsWith('/') ? accessPath : accessPath + '/';

  for (const filePath of htmlFiles) {
    let html = fs.readFileSync(filePath, 'utf-8');

    // 已有 <base> 标签，跳过
    if (/<base\s/i.test(html)) continue;

    // 如果路径已经包含正确前缀，说明构建时已配置好 base，无需改写
    if (html.includes(`"${prefix}`) || html.includes(`'${prefix}`)) continue;

    // 将 src="/xxx" href="/xxx" action="/xxx" 中的根路径补上前缀
    // 排除 protocol-relative (//xxx)、完整 URL (http://) 以及已有前缀的路径
    const prefixContent = prefix.slice(1); // "web/ce-dev/"
    const escapedPrefix = prefixContent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `((?:src|href|action)\\s*=\\s*["'])\\/(?!\\/|[a-zA-Z]+:|${escapedPrefix})`,
      'g',
    );
    html = html.replace(re, `$1${prefix}`);

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

/* ── 自定义域名 ── */

const DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}$/;
const isLinux = process.platform === 'linux';

/**
 * 为站点设置自定义域名
 * - 生成 Nginx 配置文件
 * - 重载 Nginx
 */
export function setCustomDomain(
  id: string,
  domain: string | null,
): StaticSite | ErrorResult {
  const store = readStore();
  if (!store.sites) store.sites = [];
  const site = store.sites.find((s) => s.id === id);
  if (!site) return { error: '站点不存在' };

  if (domain) {
    domain = domain.trim().toLowerCase();
    if (!DOMAIN_RE.test(domain)) {
      return { error: '域名格式不正确' };
    }
    // 检查域名是否已被其他站点使用
    const existing = store.sites.find((s) => s.customDomain === domain && s.id !== id);
    if (existing) {
      return { error: `域名 ${domain} 已被站点「${existing.name}」使用` };
    }
  }

  const oldDomain = site.customDomain;
  site.customDomain = domain || undefined;
  site.updatedAt = new Date().toISOString();
  writeStore(store);

  // 生成 / 删除 Nginx 配置
  if (isLinux) {
    try {
      if (domain) {
        writeNginxConfig(site.name, domain, getSiteDir(site.name));
      } else if (oldDomain) {
        removeNginxConfig(site.name);
      }
      // 重载 Nginx
      execSync('nginx -t && nginx -s reload', { stdio: 'pipe', timeout: 10000 });
    } catch (err: any) {
      // Nginx 配置失败不影响域名保存
      console.error('[sites] Nginx 配置刷新失败:', err.message);
    }
  }

  return site;
}

/** 获取 Nginx 配置预览（供前端展示） */
export function getNginxConfigPreview(siteName: string, domain: string): string {
  const siteDir = getSiteDir(siteName);
  return buildNginxServerBlock(siteName, domain, siteDir);
}

/** 生成 Nginx server block 配置 */
function buildNginxServerBlock(siteName: string, domain: string, siteDir: string): string {
  return `# 自动生成 — 静态站点 ${siteName} 自定义域名
# 域名: ${domain}
server {
    listen 80;
    server_name ${domain};

    root ${siteDir};
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # 缓存静态资源
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    access_log /var/log/nginx/site-${siteName}.access.log;
    error_log  /var/log/nginx/site-${siteName}.error.log;
}
`;
}

/** 写入 Nginx 配置文件 */
function writeNginxConfig(siteName: string, domain: string, siteDir: string): void {
  const confDir = '/etc/nginx/conf.d';
  if (!fs.existsSync(confDir)) return;
  const confPath = path.join(confDir, `site-${siteName}.conf`);
  const content = buildNginxServerBlock(siteName, domain, siteDir);
  fs.writeFileSync(confPath, content, 'utf-8');
}

/** 删除 Nginx 配置文件 */
function removeNginxConfig(siteName: string): void {
  const confPath = `/etc/nginx/conf.d/site-${siteName}.conf`;
  if (fs.existsSync(confPath)) fs.unlinkSync(confPath);
}
