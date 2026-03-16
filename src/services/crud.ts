/**
 * 服务 CRUD 操作
 */
import { v4 as uuidv4 } from 'uuid';
import { readStore, writeStore } from '../store';
import { dockerRemoveAll } from '../docker';
import { addLog } from './logs';
import type { Service, ErrorResult } from '../types';

/** 校验服务名称：仅允许字母、数字、连字符、下划线，2-50 字符 */
const SERVICE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,49}$/;

export function listServices(): Service[] {
  return readStore().services;
}

export function createService(payload: { name: string }): Service | ErrorResult {
  const store = readStore();
  const name = payload.name?.trim();
  if (!name || !SERVICE_NAME_RE.test(name)) {
    return { error: 'invalid-name' };
  }
  const exists = store.services.find((s) => s.name === name);
  if (exists) return { error: 'name-duplicate' };

  const now = new Date().toISOString();
  const svc: Service = {
    id: uuidv4(),
    name: payload.name,
    createdAt: now,
    updatedAt: now,
    currentVersion: '',
    status: 'idle',
    deployments: [],
    envVars: [],
    pipeline: {
      codeSource: 'github',
      repository: '',
      branch: 'main',
      targetDir: '/opt/app',
      port: 3000,
      dockerfile: 'Dockerfile',
      accessPath: '/' + payload.name,
      authMode: 'ssh',
      gitToken: '',
    },
  };
  store.services.push(svc);
  writeStore(store);

  addLog({
    action: 'create',
    serviceName: svc.name,
    success: true,
    detail: `创建服务「${svc.name}」`,
  });

  return svc;
}

export function getServiceById(id: string): Service | null {
  return readStore().services.find((s) => s.id === id) || null;
}

export function getServiceByName(name: string): Service | null {
  return readStore().services.find((s) => s.name === name) || null;
}

export function deleteService(id: string): Service | null {
  const store = readStore();
  const idx = store.services.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  const removed = store.services.splice(idx, 1)[0];

  // 清理所有容器和镜像
  const allVersions = removed.deployments
    .filter((d) => d.action === 'publish')
    .map((d) => d.version);
  dockerRemoveAll(removed.name, allVersions);

  writeStore(store);

  addLog({
    action: 'delete',
    serviceName: removed.name,
    success: true,
    detail: `删除服务「${removed.name}」，清理 ${allVersions.length} 个镜像`,
  });

  return removed;
}
