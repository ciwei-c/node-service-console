/**
 * 发布 / 回退 / 删除部署记录
 */
import { v4 as uuidv4 } from 'uuid';
import { readStore, writeStore } from '../store';
import { dockerPublish, dockerRollback, dockerCleanupImages } from '../docker';
import { addLog } from './logs';
import { startPublish, addPublishLog, finishPublish, isPublishing } from './publishTracker';
import type { Service, Deployment, PublishResult, RollbackResult, ErrorResult } from '../types';

/**
 * 启动发布（fire-and-forget）
 * 返回版本号后立即返回，实际构建在后台执行。
 * 前端通过 publish-status API 轮询查看进度。
 */
export function publishServiceAsync(
  serviceId: string,
): { version: string } | ErrorResult | null {
  const store = readStore();
  const target = store.services.find((s) => s.id === serviceId);
  if (!target) return null;

  if (isPublishing(serviceId)) {
    return { error: 'already-publishing' };
  }

  const publishCount = target.deployments.filter((d) => d.action === 'publish').length;
  const version = `${target.name}-${publishCount + 1}`;

  // 启动追踪器
  startPublish(serviceId, target.name, version);

  // 后台执行，不阻塞请求
  (async () => {
    try {
      const execResult = await dockerPublish(target, version, (line) => {
        addPublishLog(serviceId, line);
      });

      if (!execResult.ok) {
        finishPublish(serviceId, false);
        addLog({
          action: 'publish',
          serviceName: target.name,
          success: false,
          version,
          detail: `发布失败: ${execResult.logs.join(' | ')}`,
        });
        return;
      }

      // 成功：更新 store
      const freshStore = readStore();
      const freshTarget = freshStore.services.find((s) => s.id === serviceId);
      if (freshTarget) {
        const now = new Date().toISOString();
        const record: Deployment = {
          id: uuidv4(),
          action: 'publish',
          version,
          note: '',
          publishedAt: now,
          operator: 'system',
        };
        freshTarget.deployments.unshift(record);
        freshTarget.currentVersion = version;
        freshTarget.status = 'running';
        freshTarget.updatedAt = now;
        writeStore(freshStore);

        const keepCount = freshTarget.pipeline?.keepImageCount ?? 3;
        const publishVersions = freshTarget.deployments
          .filter((d) => d.action === 'publish')
          .map((d) => d.version);
        const cleanup = dockerCleanupImages(freshTarget.name, publishVersions, keepCount);

        addPublishLog(serviceId, `[完成] 发布成功，版本 ${version}，清理 ${cleanup.removed.length} 个旧镜像`);
        addLog({
          action: 'publish',
          serviceName: freshTarget.name,
          success: true,
          version,
          detail: `发布成功，版本 ${version}，清理 ${cleanup.removed.length} 个旧镜像`,
        });
      }

      finishPublish(serviceId, true);
    } catch (err: any) {
      addPublishLog(serviceId, `[异常] ${err.message}`);
      finishPublish(serviceId, false);
      addLog({
        action: 'publish',
        serviceName: target.name,
        success: false,
        version,
        detail: `发布异常: ${err.message}`,
      });
    }
  })();

  return { version };
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
