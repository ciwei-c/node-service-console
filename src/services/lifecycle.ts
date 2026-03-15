/**
 * 服务生命周期 (停止/启动) 及配置 (环境变量/流水线)
 */
import { readStore, writeStore } from '../store';
import { dockerStop, dockerStart } from '../docker';
import { addLog } from './logs';
import type { Service, EnvVar, Pipeline } from '../types';

/* ── 停止 / 启动 ── */

export function stopService(serviceId: string): Service | null {
  const store = readStore();
  const target = store.services.find((s) => s.id === serviceId);
  if (!target) return null;

  dockerStop(target.name);

  target.status = 'stopped';
  target.updatedAt = new Date().toISOString();
  writeStore(store);

  addLog({
    action: 'stop',
    serviceName: target.name,
    success: true,
    detail: `停止服务「${target.name}」`,
  });

  return target;
}

export function startService(serviceId: string): Service | null {
  const store = readStore();
  const target = store.services.find((s) => s.id === serviceId);
  if (!target) return null;

  dockerStart(target.name);

  target.status = 'running';
  target.updatedAt = new Date().toISOString();
  writeStore(store);

  addLog({
    action: 'start',
    serviceName: target.name,
    success: true,
    detail: `启动服务「${target.name}」`,
  });

  return target;
}

/* ── 环境变量 ── */

export function updateServiceEnvVars(serviceId: string, envVars: EnvVar[]): EnvVar[] | null {
  const store = readStore();
  const target = store.services.find((s) => s.id === serviceId);
  if (!target) return null;

  target.envVars = Array.isArray(envVars) ? envVars : [];
  target.updatedAt = new Date().toISOString();
  writeStore(store);

  addLog({
    action: 'config-env',
    serviceName: target.name,
    success: true,
    detail: `更新环境变量，共 ${target.envVars.length} 项`,
  });

  return target.envVars;
}

/* ── 流水线配置 ── */

export function updateServicePipeline(serviceId: string, p: Partial<Pipeline>): Pipeline | null {
  const store = readStore();
  const target = store.services.find((s) => s.id === serviceId);
  if (!target) return null;

  target.pipeline = {
    codeSource: p.codeSource || 'github',
    repository: p.repository || '',
    branch: p.branch || 'main',
    targetDir: p.targetDir || '/opt/app',
    port: Number(p.port) || 3000,
    dockerfile: p.dockerfile || 'Dockerfile',
    accessPath: p.accessPath || '/' + target.name,
    keepImageCount: Number(p.keepImageCount) || 3,
    authMode: p.authMode || 'ssh',
    gitToken:
      p.gitToken && !p.gitToken.startsWith('****')
        ? p.gitToken
        : target.pipeline?.gitToken ?? '',
  };
  target.updatedAt = new Date().toISOString();
  writeStore(store);

  addLog({
    action: 'config-pipeline',
    serviceName: target.name,
    success: true,
    detail: `更新流水线配置：${target.pipeline.codeSource}/${target.pipeline.repository || '-'}@${target.pipeline.branch}`,
  });

  return target.pipeline;
}
