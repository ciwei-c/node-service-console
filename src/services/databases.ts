/**
 * 数据库实例管理（MySQL / MariaDB 容器）
 *
 * 托管实例：通过控制台创建，带 nsc.* 标签，元数据持久化在 store.json。
 * 外部实例：服务器上已有的 MySQL 容器（如 duidui-mysql），只读纳管，允许启停/日志，不允许删除。
 */
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { readStore, writeStore } from '../store';
import { addLog } from './logs';
import {
  databaseContainerName,
  databaseVolumeName,
  dockerListDatabaseContainers,
  dockerCreateMysql,
  dockerStartDatabase,
  dockerStopDatabase,
  dockerRestartDatabase,
  dockerRemoveDatabase,
  dockerDatabaseHealth,
  dockerDatabaseStats,
  dockerDatabaseInspect,
  dockerContainerLogs,
  allocateDatabaseHostPort,
  dockerVolumeExists,
  waitForDatabaseHealthy,
} from '../docker';
import type {
  DatabaseRecord,
  DatabaseInstance,
  DatabaseCreatePayload,
  ErrorResult,
} from '../types';

const MASK = '******';
const NAME_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
const DB_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const USER_RE = /^[a-zA-Z0-9][a-zA-Z0-9_]{0,31}$/;
const VOLUME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,80}$/;
const IMAGE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,120}$/;

function normalizeStatus(state: string): DatabaseInstance['status'] {
  if (state === 'running') return 'running';
  if (state === 'restarting') return 'restarting';
  if (state === 'created' || state === 'exited' || state === 'paused') return 'stopped';
  return 'unknown';
}

function parseHostPort(ports: string): number | undefined {
  const m = ports.match(/:(\d+)->3306\/tcp/);
  return m ? parseInt(m[1], 10) : undefined;
}

function volumeFromInspect(inspect: Record<string, any> | null): string | undefined {
  const mounts = Array.isArray(inspect?.Mounts) ? inspect.Mounts : [];
  const mount = mounts.find((m: any) => m?.Destination === '/var/lib/mysql');
  return mount?.Name;
}

function instanceFromRecord(record: DatabaseRecord, containerName: string, maskSecrets: boolean): DatabaseInstance {
  const container = dockerListDatabaseContainers().find((c) => c.name === containerName);
  const instance: DatabaseInstance = {
    id: record.id,
    name: record.name,
    containerName: record.containerName,
    image: record.image,
    hostPort: record.hostPort,
    containerPort: record.containerPort,
    volumeName: record.volumeName,
    databaseName: record.databaseName,
    username: record.username,
    password: maskSecrets ? MASK : record.password,
    rootPassword: maskSecrets ? MASK : record.rootPassword,
    managed: true,
    external: false,
    status: container ? normalizeStatus(container.state) : 'missing',
    health: container ? dockerDatabaseHealth(container.name) : undefined,
    containerId: container?.id,
    ports: container?.ports,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    memoryLimitMB: record.memoryLimitMB,
    note: record.note,
  };
  if (container && !maskSecrets) {
    const stats = dockerDatabaseStats(container.name);
    if (stats) {
      instance.cpuPercent = stats.cpu;
      instance.memUsage = stats.mem;
    }
  }
  return instance;
}

function externalFromContainer(container: ReturnType<typeof dockerListDatabaseContainers>[number]): DatabaseInstance {
  const inspect = dockerDatabaseInspect(container.name);
  return {
    id: container.name,
    name: container.name,
    containerName: container.name,
    image: container.image,
    hostPort: parseHostPort(container.ports),
    containerPort: 3306,
    volumeName: volumeFromInspect(inspect),
    managed: false,
    external: true,
    status: normalizeStatus(container.state),
    health: dockerDatabaseHealth(container.name),
    containerId: container.id,
    ports: container.ports,
    createdAt: container.created,
  };
}

export function listDatabases(): DatabaseInstance[] {
  const store = readStore();
  const records = store.databases || [];
  const containers = dockerListDatabaseContainers();
  const result: DatabaseInstance[] = [];

  for (const record of records) {
    result.push(instanceFromRecord(record, record.containerName, true));
  }

  for (const container of containers) {
    if (records.some((r) => r.containerName === container.name)) continue;
    result.push(externalFromContainer(container));
  }

  return result.sort((a, b) => {
    if (a.managed !== b.managed) return a.managed ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function findRecord(id: string, store = readStore()): DatabaseRecord | undefined {
  return (store.databases || []).find(
    (r) => r.id === id || r.name === id || r.containerName === id,
  );
}

function findContainer(id: string) {
  return dockerListDatabaseContainers().find((c) => c.id === id || c.name === id);
}

export function getDatabase(id: string): DatabaseInstance | null {
  const store = readStore();
  const record = findRecord(id, store);
  if (record) return instanceFromRecord(record, record.containerName, false);

  const container = findContainer(id);
  if (!container) return null;
  const instance = externalFromContainer(container);
  const stats = dockerDatabaseStats(container.name);
  if (stats) {
    instance.cpuPercent = stats.cpu;
    instance.memUsage = stats.mem;
  }
  return instance;
}

export async function createDatabase(payload: DatabaseCreatePayload): Promise<DatabaseInstance | ErrorResult> {
  const name = String(payload.name || '').trim().toLowerCase();
  if (!NAME_RE.test(name)) return { error: 'invalid-name' };

  const image = String(payload.image || 'mysql:8.0').trim();
  if (!IMAGE_RE.test(image)) return { error: 'invalid-image' };

  const databaseName = String(payload.databaseName || 'app').trim();
  if (!DB_RE.test(databaseName)) return { error: 'invalid-database' };

  const username = String(payload.username || 'app').trim();
  if (!USER_RE.test(username)) return { error: 'invalid-username' };

  const volumeName = String(payload.volumeName || databaseVolumeName(name)).trim();
  if (!VOLUME_RE.test(volumeName)) return { error: 'invalid-volume' };

  const store = readStore();
  if ((store.databases || []).some((r) => r.name === name)) return { error: 'name-duplicate' };
  const containerName = databaseContainerName(name);
  if (dockerListDatabaseContainers().some((c) => c.name === containerName)) {
    return { error: 'name-duplicate' };
  }
  if (dockerVolumeExists(volumeName)) return { error: 'volume-exists' };

  let hostPort: number;
  try {
    if (payload.hostPort !== undefined && payload.hostPort !== null) {
      const requested = Number(payload.hostPort);
      if (!Number.isInteger(requested) || requested < 1 || requested > 65535) {
        return { error: 'invalid-port' };
      }
      hostPort = await allocateDatabaseHostPort(requested);
    } else {
      hostPort = await allocateDatabaseHostPort();
    }
  } catch (err: any) {
    return { error: err?.message === 'PORT_IN_USE' ? 'port-in-use' : 'no-port' };
  }

  let memoryLimitMB: number | undefined;
  if (payload.memoryLimitMB !== undefined && payload.memoryLimitMB !== null) {
    const memory = Number(payload.memoryLimitMB);
    if (!Number.isInteger(memory) || memory < 128 || memory > 8192) {
      return { error: 'invalid-memory' };
    }
    memoryLimitMB = memory;
  }

  const rootPassword = payload.rootPassword?.trim() || crypto.randomBytes(18).toString('base64url');
  const password = payload.password?.trim() || crypto.randomBytes(18).toString('base64url');

  const createRes = await dockerCreateMysql({
    name,
    image,
    hostPort,
    containerPort: 3306,
    volumeName,
    rootPassword,
    databaseName,
    username,
    password,
    memoryLimitMB,
  });

  if (!createRes.ok) {
    addLog({
      action: 'database-create',
      serviceName: name,
      success: false,
      detail: `创建数据库实例失败: ${createRes.output}`,
    });
    return { error: 'docker-failed', logs: [createRes.output] };
  }

  const health = await waitForDatabaseHealthy(containerName, 120000);
  const now = new Date().toISOString();
  const record: DatabaseRecord = {
    id: uuidv4(),
    name,
    containerName,
    image,
    hostPort,
    containerPort: 3306,
    volumeName,
    databaseName,
    username,
    password,
    rootPassword,
    managed: true,
    memoryLimitMB,
    note: payload.note,
    createdAt: now,
    updatedAt: now,
  };

  const fresh = readStore();
  fresh.databases = [...(fresh.databases || []), record];
  writeStore(fresh);

  addLog({
    action: 'database-create',
    serviceName: name,
    success: true,
    detail: `创建数据库实例 ${name}，端口 ${hostPort}，库 ${databaseName}，状态 ${health}`,
  });

  return instanceFromRecord(record, containerName, false);
}

export function deleteDatabase(
  id: string,
  options: { confirmName?: string; removeVolume?: boolean },
): { ok: true } | ErrorResult {
  const store = readStore();
  const record = findRecord(id, store);
  if (!record) {
    const container = findContainer(id);
    return { error: container ? 'not-managed' : 'not-found' };
  }
  if (record.name !== options.confirmName) return { error: 'confirm-mismatch' };

  dockerRemoveDatabase(record.containerName, record.volumeName, !!options.removeVolume);
  store.databases = (store.databases || []).filter((r) => r.id !== record.id);
  writeStore(store);

  addLog({
    action: 'database-delete',
    serviceName: record.name,
    success: true,
    detail: `删除数据库实例 ${record.name}${options.removeVolume ? '（含数据卷）' : '（保留数据卷）'}`,
  });

  return { ok: true };
}

export function startDatabase(id: string): { ok: true } | ErrorResult {
  return databaseAction(id, 'start');
}

export function stopDatabase(id: string): { ok: true } | ErrorResult {
  return databaseAction(id, 'stop');
}

export function restartDatabase(id: string): { ok: true } | ErrorResult {
  return databaseAction(id, 'restart');
}

function databaseAction(
  id: string,
  action: 'start' | 'stop' | 'restart',
): { ok: true } | ErrorResult {
  const store = readStore();
  const record = findRecord(id, store);
  const container = findContainer(record?.containerName || id);
  const containerName = record?.containerName || container?.name;
  if (!containerName || !container) return { error: 'not-found' };

  const res =
    action === 'start'
      ? dockerStartDatabase(containerName)
      : action === 'stop'
        ? dockerStopDatabase(containerName)
        : dockerRestartDatabase(containerName);

  if (!res.ok) return { error: 'docker-failed', logs: [res.output] };

  if (record) {
    record.updatedAt = new Date().toISOString();
    writeStore(store);
  }

  addLog({
    action: action === 'start' ? 'database-start' : action === 'stop' ? 'database-stop' : 'database-restart',
    serviceName: record?.name || containerName,
    success: true,
    detail: `${action === 'start' ? '启动' : action === 'stop' ? '停止' : '重启'}数据库实例 ${record?.name || containerName}`,
  });

  return { ok: true };
}

export function getDatabaseLogs(id: string, tail = 200): string | null {
  const record = findRecord(id);
  const container = findContainer(record?.containerName || id);
  if (!container) return null;
  return dockerContainerLogs(container.name, tail);
}

export function getDatabaseStats(id: string): { cpu: string; mem: string } | null {
  const record = findRecord(id);
  const container = findContainer(record?.containerName || id);
  if (!container) return null;
  return dockerDatabaseStats(container.name);
}
