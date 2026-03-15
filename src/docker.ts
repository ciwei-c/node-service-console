/**
 * Docker 执行器 — 封装所有 Docker / Shell 操作
 */
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import type { Service, ExecResult, DockerOpResult, CleanupResult, ContainerInfo } from './types';
import { readOAuthToken } from './store';

/* ── Shell 执行 ── */

function run(cmd: string, opts: Record<string, unknown> = {}): ExecResult {
  try {
    const output = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 300_000,
      ...opts,
    }) as string;
    return { ok: true, output: output.trim() };
  } catch (err: any) {
    const msg: string = err.stderr || err.stdout || err.message;
    return { ok: false, output: msg };
  }
}

/* ── 命名规范 ── */

function containerName(serviceName: string): string {
  return `svc-${serviceName}`;
}

function imageName(serviceName: string, version: string): string {
  return `svc-${serviceName}:${version}`;
}

/* ── 发布 ── */

export function dockerPublish(service: Service, version: string): DockerOpResult {
  const logs: string[] = [];
  const p = service.pipeline;
  const cn = containerName(service.name);
  const img = imageName(service.name, version);
  const workDir = path.join(__dirname, '..', 'tmp', service.name);

  // 1. 准备工作目录
  if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });

  // 2. 拉取代码
  const authMode = p.authMode || 'ssh';
  // token 优先从 OAuth 获取，降级到 pipeline 中的 gitToken
  const oauth = readOAuthToken();
  const token = oauth?.accessToken || p.gitToken || '';
  let repoUrl: string;

  if (authMode === 'ssh') {
    // SSH 方式：使用服务器 SSH Key 认证，无需 Token
    if (p.codeSource === 'github') {
      repoUrl = `git@github.com:${p.repository}.git`;
    } else {
      repoUrl = `git@gitlab.com:${p.repository}.git`;
    }
  } else {
    // Token 方式：通过 HTTPS + Token 认证
    if (p.codeSource === 'github') {
      repoUrl = token
        ? `https://${token}@github.com/${p.repository}.git`
        : `https://github.com/${p.repository}.git`;
    } else {
      repoUrl = token
        ? `https://oauth2:${token}@gitlab.com/${p.repository}.git`
        : `https://gitlab.com/${p.repository}.git`;
    }
  }
  const safeUrl = repoUrl.replace(/\/\/[^@]+@/, '//***@');
  logs.push(`[clone] ${safeUrl} branch=${p.branch}`);
  const cloneRes = run(`git clone --depth 1 --branch ${p.branch} ${repoUrl} "${workDir}"`);
  if (!cloneRes.ok) {
    logs.push(`[clone] FAILED: ${cloneRes.output}`);
    return { ok: false, logs };
  }
  logs.push('[clone] OK');

  // 3. docker build
  const dockerfilePath = path.join(workDir, p.dockerfile || 'Dockerfile');
  logs.push(`[build] image=${img} dockerfile=${p.dockerfile}`);
  const buildRes = run(`docker build -t ${img} -f "${dockerfilePath}" "${workDir}"`);
  if (!buildRes.ok) {
    logs.push(`[build] FAILED: ${buildRes.output}`);
    return { ok: false, logs };
  }
  logs.push('[build] OK');

  // 4. 停止并移除旧容器
  run(`docker stop ${cn}`);
  run(`docker rm -f ${cn}`);
  logs.push('[stop-old] done');

  // 5. 组装环境变量
  const envArgs = (service.envVars || [])
    .filter((v) => v.key)
    .map((v) => `-e "${v.key}=${v.value}"`)
    .join(' ');

  // 6. docker run
  const runCmd = [
    'docker run -d',
    `--name ${cn}`,
    '--restart unless-stopped',
    `-p ${p.port}:${p.port}`,
    envArgs,
    img,
  ].filter(Boolean).join(' ');

  logs.push(`[run] ${runCmd}`);
  const runRes = run(runCmd);
  if (!runRes.ok) {
    logs.push(`[run] FAILED: ${runRes.output}`);
    return { ok: false, logs };
  }
  logs.push(`[run] container=${cn} started`);

  // 7. 清理 tmp
  fs.rmSync(workDir, { recursive: true, force: true });

  return { ok: true, logs };
}

/* ── 回退 ── */

export function dockerRollback(service: Service, targetVersion: string): DockerOpResult {
  const logs: string[] = [];
  const p = service.pipeline;
  const cn = containerName(service.name);
  const img = imageName(service.name, targetVersion);

  const check = run(`docker image inspect ${img}`);
  if (!check.ok) {
    logs.push(`[rollback] 镜像 ${img} 不存在，无法回退`);
    return { ok: false, logs };
  }

  run(`docker stop ${cn}`);
  run(`docker rm -f ${cn}`);
  logs.push('[rollback] 旧容器已移除');

  const envArgs = (service.envVars || [])
    .filter((v) => v.key)
    .map((v) => `-e "${v.key}=${v.value}"`)
    .join(' ');

  const runCmd = [
    'docker run -d',
    `--name ${cn}`,
    '--restart unless-stopped',
    `-p ${p.port}:${p.port}`,
    envArgs,
    img,
  ].filter(Boolean).join(' ');

  logs.push(`[rollback] ${runCmd}`);
  const runRes = run(runCmd);
  if (!runRes.ok) {
    logs.push(`[rollback] FAILED: ${runRes.output}`);
    return { ok: false, logs };
  }
  logs.push(`[rollback] 已回退到 ${targetVersion}`);
  return { ok: true, logs };
}

/* ── 停止 / 启动 ── */

export function dockerStop(serviceName: string): ExecResult {
  return run(`docker stop ${containerName(serviceName)}`);
}

export function dockerStart(serviceName: string): ExecResult {
  return run(`docker start ${containerName(serviceName)}`);
}

/* ── 镜像清理 ── */

export function dockerCleanupImages(
  serviceName: string,
  allVersions: string[],
  keepCount = 3,
): CleanupResult {
  const kept = allVersions.slice(0, keepCount);
  const toRemove = allVersions.slice(keepCount);
  const removed: string[] = [];

  for (const ver of toRemove) {
    const img = imageName(serviceName, ver);
    const res = run(`docker rmi ${img}`);
    if (res.ok) removed.push(img);
  }

  return { removed, kept: kept.map((v) => imageName(serviceName, v)) };
}

/** 删除服务的所有容器和镜像 */
export function dockerRemoveAll(serviceName: string, allVersions: string[]): void {
  const cn = containerName(serviceName);
  run(`docker stop ${cn}`);
  run(`docker rm -f ${cn}`);
  for (const ver of allVersions) {
    run(`docker rmi ${imageName(serviceName, ver)}`);
  }
}

/* ── 容器查询 ── */

export function dockerListContainers(): ContainerInfo[] {
  const fmt =
    '{"id":"{{.ID}}","name":"{{.Names}}","image":"{{.Image}}","status":"{{.Status}}","ports":"{{.Ports}}","created":"{{.CreatedAt}}","state":"{{.State}}"}';
  const res = run(`docker ps -a --format "${fmt}"`);
  if (!res.ok || !res.output) return [];
  return res.output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean) as ContainerInfo[];
}

export function dockerInspectContainer(containerId: string): Record<string, unknown> | null {
  const res = run(`docker inspect ${containerId}`);
  if (!res.ok) return null;
  try {
    const arr = JSON.parse(res.output);
    return arr[0] || null;
  } catch {
    return null;
  }
}

export function dockerContainerLogs(containerId: string, tail = 100): string {
  const res = run(`docker logs --tail ${tail} ${containerId} 2>&1`);
  return res.output || '';
}
