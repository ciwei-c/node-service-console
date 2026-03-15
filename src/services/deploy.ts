/**
 * 发布 / 回退 / 删除部署记录
 */
import { v4 as uuidv4 } from 'uuid';
import { readStore, writeStore } from '../store';
import { dockerPublish, dockerRollback, dockerCleanupImages } from '../docker';
import { addLog } from './logs';
import type { Service, Deployment, PublishResult, RollbackResult, ErrorResult } from '../types';

export function publishService(
  serviceId: string,
): PublishResult | ErrorResult | null {
  const store = readStore();
  const target = store.services.find((s) => s.id === serviceId);
  if (!target) return null;

  // 自动生成版本号
  const publishCount = target.deployments.filter((d) => d.action === 'publish').length;
  const version = `${target.name}-${publishCount + 1}`;

  // Docker 构建 & 启动
  const execResult = dockerPublish(target, version);
  if (!execResult.ok) {
    addLog({
      action: 'publish',
      serviceName: target.name,
      success: false,
      version,
      detail: `发布失败: ${execResult.logs.join(' | ')}`,
    });
    return { error: 'docker-failed', logs: execResult.logs };
  }

  const now = new Date().toISOString();
  const record: Deployment = {
    id: uuidv4(),
    action: 'publish',
    version,
    note: '',
    publishedAt: now,
    operator: 'system',
  };
  target.deployments.unshift(record);
  target.currentVersion = version;
  target.status = 'running';
  target.updatedAt = now;
  writeStore(store);

  // 自动清理旧镜像
  const keepCount = target.pipeline?.keepImageCount ?? 3;
  const publishVersions = target.deployments
    .filter((d) => d.action === 'publish')
    .map((d) => d.version);
  const cleanup = dockerCleanupImages(target.name, publishVersions, keepCount);

  addLog({
    action: 'publish',
    serviceName: target.name,
    success: true,
    version,
    detail: `发布成功，版本 ${version}，清理 ${cleanup.removed.length} 个旧镜像`,
  });

  return { service: target, record, logs: execResult.logs, cleanup };
}

export function rollbackService(
  serviceId: string,
  payload: { targetVersion: string; note?: string; operator?: string },
): RollbackResult | ErrorResult | null {
  const store = readStore();
  const target = store.services.find((s) => s.id === serviceId);
  if (!target) return null;

  const targetVersion = payload.targetVersion?.trim();
  const historical = target.deployments.find((d) => d.version === targetVersion);
  if (!historical) return { error: 'target-version-not-found' };

  // Docker 回退
  const execResult = dockerRollback(target, targetVersion);
  if (!execResult.ok) {
    addLog({
      action: 'rollback',
      serviceName: target.name,
      success: false,
      version: targetVersion,
      detail: `回退失败: ${execResult.logs.join(' | ')}`,
    });
    return { error: 'docker-failed', logs: execResult.logs };
  }

  const now = new Date().toISOString();
  const record: Deployment = {
    id: uuidv4(),
    action: 'rollback',
    version: targetVersion,
    note: payload.note || '',
    publishedAt: now,
    operator: payload.operator || 'system',
  };
  target.deployments.unshift(record);
  target.currentVersion = targetVersion;
  target.status = 'running';
  target.updatedAt = now;
  writeStore(store);

  addLog({
    action: 'rollback',
    serviceName: target.name,
    success: true,
    version: targetVersion,
    detail: `回退成功，目标版本 ${targetVersion}`,
  });

  return { service: target, record, logs: execResult.logs };
}

export function deleteDeployment(
  serviceId: string,
  deploymentId: string,
): Deployment | ErrorResult | null {
  const store = readStore();
  const target = store.services.find((s) => s.id === serviceId);
  if (!target) return null;

  const idx = target.deployments.findIndex((d) => d.id === deploymentId);
  if (idx === -1) return { error: 'deployment-not-found' };

  const removed = target.deployments.splice(idx, 1)[0];
  target.updatedAt = new Date().toISOString();
  writeStore(store);
  return removed;
}
