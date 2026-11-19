/**
 * Docker 执行器 — 封装所有 Docker / Shell 操作
 */
import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import net from 'net';
import path from 'path';
import fs from 'fs';
import type { Service, ExecResult, DockerOpResult, ContainerInfo } from './types';
import type { EnvVar } from './types';

const execAsync = promisify(exec);

/* ── 环境变量 env-file 生成（避免 shell 注入） ── */

function writeEnvFile(envVars: EnvVar[], workDir: string): string | null {
  const vars = (envVars || []).filter((v) => v.key.trim());
  if (vars.length === 0) return null;
  const envFilePath = path.join(workDir, '.env.docker');
  const content = vars.map((v) => `${v.key}=${v.value}`).join('\n');
  fs.mkdirSync(path.dirname(envFilePath), { recursive: true });
  fs.writeFileSync(envFilePath, content, 'utf-8');
  return envFilePath;
}

function cleanupEnvFile(envFilePath: string | null): void {
  if (envFilePath && fs.existsSync(envFilePath)) fs.unlinkSync(envFilePath);
}

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

export async function dockerPublish(service: Service, version: string, onLog?: (line: string) => void, abortSignal?: AbortSignal): Promise<DockerOpResult> {
  const logs: string[] = [];
  const log = (line: string) => { logs.push(line); onLog?.(line); };
  const checkAbort = () => { if (abortSignal?.aborted) throw new Error('ABORTED'); };
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
  checkAbort();

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
  checkAbort();

  // 4. 停止并移除旧容器
  log('[stop-old] 停止旧容器...');
  await runAsync(`docker stop ${cn}`);
  await runAsync(`docker rm -f ${cn}`);
  log('[stop-old] done');
  checkAbort();

  // 5. 组装环境变量（通过 env-file 避免 shell 注入）
  const envFile = writeEnvFile(service.envVars, workDir);

  // 6. 自动分配宿主机端口
  const hostPort = await allocateHostPort(service.hostPort);
  log(`[port] 宿主机端口: ${hostPort} → 容器端口: ${p.port}`);

  // 7. docker run
  const runCmd = [
    'docker run -d',
    `--name ${cn}`,
    '--restart unless-stopped',
    `-p ${hostPort}:${p.port}`,
    envFile ? `--env-file "${envFile}"` : '',
    img,
  ].filter(Boolean).join(' ');

  log(`[run] ${runCmd}`);
  const runRes = await runAsync(runCmd);
  cleanupEnvFile(envFile);
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
  abortSignal?: AbortSignal,
): Promise<DockerOpResult> {
  const logs: string[] = [];
  const log = (line: string) => { logs.push(line); onLog?.(line); };
  const checkAbort = () => { if (abortSignal?.aborted) throw new Error('ABORTED'); };
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
  checkAbort();

  // 3. checkout 到指定 commit
  log(`[checkout] ${commitHash}`);
  const checkoutRes = run(`git -C "${workDir}" checkout ${commitHash}`);
  if (!checkoutRes.ok) {
    log(`[checkout] FAILED: ${checkoutRes.output}`);
    fs.rmSync(workDir, { recursive: true, force: true });
    return { ok: false, logs };
  }
  log('[checkout] OK');
  checkAbort();

  // 获取 commit message
  const commitMsgRes = run(`git -C "${workDir}" log -1 --format=%s`);
  const commitMessage = commitMsgRes.ok ? commitMsgRes.output.trim() : '';

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
  checkAbort();

  // 5. 停止并移除旧容器
  log('[stop-old] 停止旧容器...');
  await runAsync(`docker stop ${cn}`);
  await runAsync(`docker rm -f ${cn}`);
  log('[stop-old] done');

  // 6. 组装环境变量（通过 env-file 避免 shell 注入）
  const tmpEnvDir = path.join(__dirname, '..', 'tmp', `${service.name}-env`);
  fs.mkdirSync(tmpEnvDir, { recursive: true });
  const envFile = writeEnvFile(service.envVars, tmpEnvDir);

  // 7. 自动分配宿主机端口
  const hostPort = await allocateHostPort(service.hostPort);
  log(`[port] 宿主机端口: ${hostPort} → 容器端口: ${p.port}`);

  // 8. docker run
  const runCmd = [
    'docker run -d',
    `--name ${cn}`,
    '--restart unless-stopped',
    `-p ${hostPort}:${p.port}`,
    envFile ? `--env-file "${envFile}"` : '',
    img,
  ].filter(Boolean).join(' ');

  log(`[run] ${runCmd}`);
  const runRes = await runAsync(runCmd);
  cleanupEnvFile(envFile);
  if (fs.existsSync(tmpEnvDir)) fs.rmSync(tmpEnvDir, { recursive: true, force: true });
  if (!runRes.ok) {
    log(`[run] FAILED: ${runRes.output}`);
    fs.rmSync(workDir, { recursive: true, force: true });
    return { ok: false, logs };
  }
  log(`[run] container=${cn} started`);

  // 9. 清理 tmp
  fs.rmSync(workDir, { recursive: true, force: true });

  return { ok: true, logs, hostPort, commitHash, commitMessage };
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

/**
 * 查询指定服务容器的实际状态
 * 返回 'running' | 'exited' | 'restarting' | null(不存在)
 */
export function getContainerState(serviceName: string): string | null {
  const cn = containerName(serviceName);
  const res = run(`docker inspect -f "{{.State.Status}}" ${cn}`);
  if (!res.ok) return null;
  return res.output.trim() || null;
}

/* ── 数据库容器（MySQL / MariaDB） ── */

export interface DatabaseContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  labels: string;
  created: string;
}

const DB_CONTAINER_PREFIX = 'nsc-mysql-';

export function databaseContainerName(name: string): string {
  return `${DB_CONTAINER_PREFIX}${name}`;
}

export function databaseVolumeName(name: string): string {
  return `${DB_CONTAINER_PREFIX}${name}-data`;
}

function isDatabaseImage(image: string): boolean {
  const base = image.split('@')[0];
  return /(^|\/)(mysql|mariadb)(:.*)?$/i.test(base);
}

export function dockerListDatabaseContainers(): DatabaseContainerInfo[] {
  const fmt = `{"id":"{{.ID}}","name":"{{.Names}}","image":"{{.Image}}","state":"{{.State}}","status":"{{.Status}}","ports":"{{.Ports}}","labels":"{{.Labels}}","created":"{{.CreatedAt}}"}`;
  const res = run(`docker ps -a --format '${fmt}'`);
  if (!res.ok || !res.output) return [];
  return res.output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line) as DatabaseContainerInfo; } catch { return null; }
    })
    .filter((x): x is DatabaseContainerInfo => !!x)
    .filter((c) => isDatabaseImage(c.image) || (c.labels || '').includes('nsc.type=mysql'));
}

export function dockerDatabaseInspect(containerName: string): Record<string, any> | null {
  const res = run(`docker inspect ${containerName}`);
  if (!res.ok) return null;
  try {
    const arr = JSON.parse(res.output);
    return arr[0] || null;
  } catch {
    return null;
  }
}

export function dockerDatabaseHealth(containerName: string): string | undefined {
  const res = run(`docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' ${containerName}`);
  return res.ok ? res.output.trim() || undefined : undefined;
}

export function dockerDatabaseStats(containerName: string): { cpu: string; mem: string } | null {
  const res = run(`docker stats --no-stream --format '{{.CPUPerc}}|{{.MemUsage}}' ${containerName}`);
  if (!res.ok || !res.output) return null;
  const [cpu, mem] = res.output.split('|');
  return { cpu: cpu || '-', mem: mem || '-' };
}

export function dockerVolumeExists(volumeName: string): boolean {
  return run(`docker volume inspect ${volumeName}`).ok;
}

/** 包含已停止容器占用的端口，避免重新启动时冲突 */
function getReservedPorts(): Set<number> {
  const used = new Set<number>();
  const res = run('docker ps -a --format "{{.Ports}}"');
  if (res.ok && res.output) {
    for (const m of res.output.matchAll(/:(\d+)->/g)) used.add(parseInt(m[1], 10));
  }
  return used;
}

export async function isDatabasePortUsable(port: number): Promise<boolean> {
  if (getReservedPorts().has(port)) return false;
  return isPortAvailable(port);
}

/** 优先使用指定端口，否则在 3306-3399 自动分配 */
export async function allocateDatabaseHostPort(preferred?: number): Promise<number> {
  if (preferred) {
    if (await isDatabasePortUsable(preferred)) return preferred;
    throw new Error('PORT_IN_USE');
  }
  const reserved = getReservedPorts();
  for (let port = 3306; port <= 3399; port++) {
    if (reserved.has(port)) continue;
    if (await isPortAvailable(port)) return port;
  }
  throw new Error('NO_PORT');
}

export async function dockerCreateMysql(opts: {
  name: string;
  image: string;
  hostPort: number;
  containerPort: number;
  volumeName: string;
  rootPassword: string;
  databaseName: string;
  username: string;
  password: string;
  memoryLimitMB?: number;
}): Promise<ExecResult> {
  const cn = databaseContainerName(opts.name);
  const envDir = path.join(__dirname, '..', 'tmp');
  fs.mkdirSync(envDir, { recursive: true });
  const envFile = path.join(envDir, `${cn}.env`);
  fs.writeFileSync(
    envFile,
    [
      `MYSQL_ROOT_PASSWORD=${opts.rootPassword}`,
      `MYSQL_DATABASE=${opts.databaseName}`,
      `MYSQL_USER=${opts.username}`,
      `MYSQL_PASSWORD=${opts.password}`,
      'TZ=Asia/Shanghai',
    ].join('\n'),
    'utf-8',
  );

  const memory = opts.memoryLimitMB ? `--memory ${opts.memoryLimitMB}m` : '';
  const cmd = [
    'docker run -d',
    `--name ${cn}`,
    '--restart unless-stopped',
    `-p ${opts.hostPort}:${opts.containerPort}`,
    `--env-file "${envFile}"`,
    `-v ${opts.volumeName}:/var/lib/mysql`,
    '--label nsc.managed=true',
    '--label nsc.type=mysql',
    `--label nsc.instance=${opts.name}`,
    `--health-cmd 'mysqladmin ping -h 127.0.0.1 -uroot -p"$MYSQL_ROOT_PASSWORD" --silent'`,
    '--health-interval=5s',
    '--health-timeout=5s',
    '--health-retries=30',
    '--health-start-period=30s',
    memory,
    `${opts.image} --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci --default-time-zone=+08:00`,
  ].filter(Boolean).join(' ');

  try {
    return await runAsync(cmd);
  } finally {
    try { if (fs.existsSync(envFile)) fs.unlinkSync(envFile); } catch { /* ignore */ }
  }
}

/** 等待容器健康，返回最终健康状态（healthy / unhealthy / running / unknown） */
export async function waitForDatabaseHealthy(containerName: string, timeoutMs = 120000): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const health = dockerDatabaseHealth(containerName);
    if (health === 'healthy' || health === 'running' || health === 'unhealthy' || health === 'exited' || health === 'dead') {
      return health;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return dockerDatabaseHealth(containerName) || 'unknown';
}

export function dockerStartDatabase(containerName: string): ExecResult {
  return run(`docker start ${containerName}`);
}

export function dockerStopDatabase(containerName: string): ExecResult {
  return run(`docker stop ${containerName}`);
}

export function dockerRestartDatabase(containerName: string): ExecResult {
  return run(`docker restart ${containerName}`);
}

export function dockerRemoveDatabase(containerName: string, volumeName?: string, removeVolume = false): void {
  run(`docker rm -f ${containerName}`);
  if (removeVolume && volumeName) run(`docker volume rm ${volumeName}`);
}
