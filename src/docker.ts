/**
 * Docker 执行器 — 封装所有 Docker / Shell 操作
 */
import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import net from 'net';
import path from 'path';
import fs from 'fs';
import type { Service, ExecResult, DockerOpResult, ContainerInfo } from './types';

const execAsync = promisify(exec);

/* ── 异步 Shell 执行（用于耗时操作，不阻塞事件循环） ── */

async function runAsync(cmd: string, opts: Record<string, unknown> = {}): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      encoding: 'utf-8',
      timeout: 300_000,
      maxBuffer: 50 * 1024 * 1024,
      ...opts,
    });
    return { ok: true, output: (stdout || '').trim() };
  } catch (err: any) {
    const msg: string = err.stderr || err.stdout || err.message;
    return { ok: false, output: msg };
  }
}

/* ── 同步 Shell 执行（用于轻量级操作） ── */

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

/* ── 自动分配可用宿主机端口 ── */

const PORT_RANGE_START = 10000;
const PORT_RANGE_END = 60000;

/** 检查端口是否可用 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => { srv.close(); resolve(true); });
    srv.listen(port, '0.0.0.0');
  });
}

/** 获取所有已运行容器占用的宿主机端口 */
function getUsedPorts(): Set<number> {
  const used = new Set<number>();
  const res = run('docker ps --format "{{.Ports}}"');
  if (res.ok && res.output) {
    // Ports 格式: "0.0.0.0:10001->8080/tcp, :::10001->8080/tcp"
    const matches = res.output.matchAll(/:(\d+)->/g);
    for (const m of matches) {
      used.add(parseInt(m[1], 10));
    }
  }
  return used;
}

/** 分配一个未使用的宿主机端口 */
async function allocateHostPort(preferredPort?: number): Promise<number> {
  // 优先使用已有的端口（如重新发布时）
  if (preferredPort && await isPortAvailable(preferredPort)) {
    return preferredPort;
  }

  const usedPorts = getUsedPorts();

  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    if (usedPorts.has(port)) continue;
    if (await isPortAvailable(port)) return port;
  }

  throw new Error('没有可用的宿主机端口');
}

/* ── 发布 ── */

export async function dockerPublish(service: Service, version: string, onLog?: (line: string) => void): Promise<DockerOpResult> {
  const logs: string[] = [];
  const log = (line: string) => { logs.push(line); onLog?.(line); };
  const p = service.pipeline;
  const cn = containerName(service.name);
  const img = imageName(service.name, version);
  const workDir = path.join(__dirname, '..', 'tmp', service.name);

  // 1. 准备工作目录
  if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });

  // 2. 拉取代码
  const authMode = p.authMode || 'ssh';
  const token = p.gitToken || '';
  const repo = p.repository
    .replace(/^https?:\/\/[^/]+\//, '')
    .replace(/^git@[^:]+:/, '')
    .replace(/\.git$/, '');
  let repoUrl: string;

  if (authMode === 'ssh') {
    if (p.codeSource === 'github') {
      repoUrl = `git@github.com:${repo}.git`;
    } else {
      repoUrl = `git@gitlab.com:${repo}.git`;
    }
  } else {
    if (p.codeSource === 'github') {
      repoUrl = token
        ? `https://${token}@github.com/${repo}.git`
        : `https://github.com/${repo}.git`;
    } else {
      repoUrl = token
        ? `https://oauth2:${token}@gitlab.com/${repo}.git`
        : `https://gitlab.com/${repo}.git`;
    }
  }
  const safeUrl = repoUrl.replace(/\/\/[^@]+@/, '//***@');
  log(`[clone] ${safeUrl} branch=${p.branch}`);
  const cloneRes = await runAsync(`git clone --branch ${p.branch} ${repoUrl} "${workDir}"`);
  if (!cloneRes.ok) {
    log(`[clone] FAILED: ${cloneRes.output}`);
    return { ok: false, logs };
  }
  log('[clone] OK');

  // 获取 commit 信息
  const commitHashRes = run(`git -C "${workDir}" log -1 --format=%H`);
  const commitMsgRes = run(`git -C "${workDir}" log -1 --format=%s`);
  const commitHash = commitHashRes.ok ? commitHashRes.output.trim() : '';
  const commitMessage = commitMsgRes.ok ? commitMsgRes.output.trim() : '';
  if (commitHash) log(`[commit] ${commitHash.slice(0, 8)} ${commitMessage}`);

  // 3. docker build
  const buildContext = p.targetDir && p.targetDir !== '/'
    ? path.join(workDir, p.targetDir.replace(/^\/+/, ''))
    : workDir;
  const dockerfilePath = path.join(buildContext, p.dockerfile || 'Dockerfile');
  log(`[build] image=${img} dockerfile=${p.dockerfile} context=${p.targetDir || '/'}`);
  log(`[build] 开始构建镜像...`);
  const buildRes = await runAsync(`docker build -t ${img} -f "${dockerfilePath}" "${buildContext}"`);
  // 输出构建过程的详细日志
  if (buildRes.output) {
    for (const line of buildRes.output.split('\n')) {
      if (line.trim()) log(`[build] ${line}`);
    }
  }
  if (!buildRes.ok) {
    log(`[build] FAILED`);
    return { ok: false, logs };
  }
  log('[build] OK');

  // 4. 停止并移除旧容器
  log('[stop-old] 停止旧容器...');
  await runAsync(`docker stop ${cn}`);
  await runAsync(`docker rm -f ${cn}`);
  log('[stop-old] done');

  // 5. 组装环境变量
  const envArgs = (service.envVars || [])
    .filter((v) => v.key)
    .map((v) => `-e "${v.key}=${v.value}"`)
    .join(' ');

  // 6. 自动分配宿主机端口
  const hostPort = await allocateHostPort(service.hostPort);
  log(`[port] 宿主机端口: ${hostPort} → 容器端口: ${p.port}`);

  // 7. docker run
  const runCmd = [
    'docker run -d',
    `--name ${cn}`,
    '--restart unless-stopped',
    `-p ${hostPort}:${p.port}`,
    envArgs,
    img,
  ].filter(Boolean).join(' ');

  log(`[run] ${runCmd}`);
  const runRes = await runAsync(runCmd);
  if (!runRes.ok) {
    log(`[run] FAILED: ${runRes.output}`);
    return { ok: false, logs };
  }
  log(`[run] container=${cn} started`);

  // 8. 清理 tmp
  fs.rmSync(workDir, { recursive: true, force: true });

  return { ok: true, logs, hostPort, commitHash, commitMessage };
}

/* ── 根据 commit 重新构建（用于回退） ── */

export async function dockerRebuildFromCommit(
  service: Service,
  targetVersion: string,
  commitHash: string,
  onLog?: (line: string) => void,
): Promise<DockerOpResult> {
  const logs: string[] = [];
  const log = (line: string) => { logs.push(line); onLog?.(line); };
  const p = service.pipeline;
  const cn = containerName(service.name);
  const img = imageName(service.name, targetVersion);
  const workDir = path.join(__dirname, '..', 'tmp', service.name);

  // 1. 准备工作目录
  if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });

  // 2. 拉取代码（完整历史以便 checkout 指定 commit）
  const authMode = p.authMode || 'ssh';
  const token = p.gitToken || '';
  const repo = p.repository
    .replace(/^https?:\/\/[^/]+\//, '')
    .replace(/^git@[^:]+:/, '')
    .replace(/\.git$/, '');
  let repoUrl: string;

  if (authMode === 'ssh') {
    repoUrl = p.codeSource === 'github'
      ? `git@github.com:${repo}.git`
      : `git@gitlab.com:${repo}.git`;
  } else {
    if (p.codeSource === 'github') {
      repoUrl = token ? `https://${token}@github.com/${repo}.git` : `https://github.com/${repo}.git`;
    } else {
      repoUrl = token ? `https://oauth2:${token}@gitlab.com/${repo}.git` : `https://gitlab.com/${repo}.git`;
    }
  }

  const safeUrl = repoUrl.replace(/\/\/[^@]+@/, '//***@');
  log(`[clone] ${safeUrl} (回退到 commit ${commitHash.slice(0, 8)})`);
  const cloneRes = await runAsync(`git clone ${repoUrl} "${workDir}"`);
  if (!cloneRes.ok) {
    log(`[clone] FAILED: ${cloneRes.output}`);
    return { ok: false, logs };
  }
  log('[clone] OK');

  // 3. checkout 到指定 commit
  log(`[checkout] ${commitHash}`);
  const checkoutRes = run(`git -C "${workDir}" checkout ${commitHash}`);
  if (!checkoutRes.ok) {
    log(`[checkout] FAILED: ${checkoutRes.output}`);
    fs.rmSync(workDir, { recursive: true, force: true });
    return { ok: false, logs };
  }
  log('[checkout] OK');

  // 4. docker build
  const buildContext = p.targetDir && p.targetDir !== '/'
    ? path.join(workDir, p.targetDir.replace(/^\/+/, ''))
    : workDir;
  const dockerfilePath = path.join(buildContext, p.dockerfile || 'Dockerfile');
  log(`[build] image=${img} dockerfile=${p.dockerfile} context=${p.targetDir || '/'}`);
  log(`[build] 开始构建镜像...`);
  const buildRes = await runAsync(`docker build -t ${img} -f "${dockerfilePath}" "${buildContext}"`);
  if (buildRes.output) {
    for (const line of buildRes.output.split('\n')) {
      if (line.trim()) log(`[build] ${line}`);
    }
  }
  if (!buildRes.ok) {
    log('[build] FAILED');
    fs.rmSync(workDir, { recursive: true, force: true });
    return { ok: false, logs };
  }
  log('[build] OK');

  // 5. 停止并移除旧容器
  log('[stop-old] 停止旧容器...');
  await runAsync(`docker stop ${cn}`);
  await runAsync(`docker rm -f ${cn}`);
  log('[stop-old] done');

  // 6. 组装环境变量
  const envArgs = (service.envVars || [])
    .filter((v) => v.key)
    .map((v) => `-e "${v.key}=${v.value}"`)
    .join(' ');

  // 7. 自动分配宿主机端口
  const hostPort = await allocateHostPort(service.hostPort);
  log(`[port] 宿主机端口: ${hostPort} → 容器端口: ${p.port}`);

  // 8. docker run
  const runCmd = [
    'docker run -d',
    `--name ${cn}`,
    '--restart unless-stopped',
    `-p ${hostPort}:${p.port}`,
    envArgs,
    img,
  ].filter(Boolean).join(' ');

  log(`[run] ${runCmd}`);
  const runRes = await runAsync(runCmd);
  if (!runRes.ok) {
    log(`[run] FAILED: ${runRes.output}`);
    fs.rmSync(workDir, { recursive: true, force: true });
    return { ok: false, logs };
  }
  log(`[run] container=${cn} started`);

  // 9. 清理 tmp
  fs.rmSync(workDir, { recursive: true, force: true });

  return { ok: true, logs, hostPort, commitHash, commitMessage: '' };
}

/* ── 停止 / 启动 ── */

export function dockerStop(serviceName: string): ExecResult {
  return run(`docker stop ${containerName(serviceName)}`);
}

export function dockerStart(serviceName: string): ExecResult {
  return run(`docker start ${containerName(serviceName)}`);
}

/* ── 镜像清理 ── */

/** 删除指定版本的镜像，返回是否成功 */
export function dockerRemoveImage(serviceName: string, version: string): boolean {
  const img = imageName(serviceName, version);
  return run(`docker rmi ${img}`).ok;
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
  const fmt = `{"id":"{{.ID}}","name":"{{.Names}}","image":"{{.Image}}","status":"{{.Status}}","ports":"{{.Ports}}","created":"{{.CreatedAt}}","state":"{{.State}}"}`;
  const res = run(`docker ps -a --format '${fmt}'`);
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

/** 去除 ANSI 转义码 */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
}

export function dockerContainerLogs(containerId: string, tail = 100): string {
  const res = run(`docker logs --tail ${tail} ${containerId} 2>&1`);
  return stripAnsi(res.output || '');
}
