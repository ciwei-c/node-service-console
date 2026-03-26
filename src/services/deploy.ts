/**
 * 发布 / 回退 / 删除部署记录
 */
import { v4 as uuidv4 } from 'uuid';
import { readStore, writeStore } from '../store';
import { dockerPublish, dockerRebuildFromCommit, dockerRemoveImage } from '../docker';
import { addLog } from './logs';
import { startPublish, addPublishLog, finishPublish, isPublishing, stopPublish } from './publishTracker';
import { sendAlert } from './notify';
import type { Service, Deployment, PublishResult, RollbackResult, ErrorResult } from '../types';

/** 保存被中止/停止的发布记录到 store */
function saveAbortedRecord(serviceId: string, version: string, note: string, deployStatus: 'aborted' | 'stopped' = 'aborted'): void {
  const store = readStore();
  const target = store.services.find((s) => s.id === serviceId);
  if (!target) return;
  const record: Deployment = {
    id: uuidv4(),
    action: 'publish',
    version,
    commitHash: '',
    commitMessage: '',
    deployStatus,
    note,
    publishedAt: new Date().toISOString(),
    operator: deployStatus === 'stopped' ? 'user' : 'webhook',
  };
  target.deployments.unshift(record);
  target.updatedAt = new Date().toISOString();
  writeStore(store);
  addLog({
    action: 'publish',
    serviceName: target.name,
    success: false,
    version,
    detail: note,
  });
}

/** 手动停止正在进行的发布 */
export function stopServicePublish(serviceId: string): { version: string } | null {
  const stopped = stopPublish(serviceId);
  if (!stopped) return null;
  saveAbortedRecord(serviceId, stopped.version, '手动停止发布', 'stopped');
  return stopped;
}
/**
 * 启动发布（fire-and-forget）
 * 返回版本号后立即返回，实际构建在后台执行。
 * 前端通过 SSE 实时查看进度。
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
  // 从历史记录中提取最大版本号，避免回退删除记录后版本号重复
  const maxVersionNum = target.deployments
    .filter((d) => d.action === 'publish')
    .reduce((max, d) => {
      const match = d.version.match(/-(\d+)$/);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, publishCount);
  const version = `${target.name}-${maxVersionNum + 1}`;

  // 启动追踪器（返回 abort signal）
  const abortSignal = startPublish(serviceId, target.name, version);

  // 后台执行，不阻塞请求
  (async () => {
    try {
      const execResult = await dockerPublish(target, version, (line) => {
        addPublishLog(serviceId, line);
      }, abortSignal);

      // 检查是否已被中止
      if (abortSignal.aborted) return;

      if (!execResult.ok) {
        finishPublish(serviceId, false);
        const failDetail = `发布失败: ${execResult.logs.join(' | ')}`;
        addLog({
          action: 'publish',
          serviceName: target.name,
          success: false,
          version,
          detail: failDetail,
        });
        sendAlert('publish_fail', target.name, failDetail).catch(() => {});
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
          commitHash: execResult.commitHash || '',
          commitMessage: execResult.commitMessage || '',
          note: '',
          publishedAt: now,
          operator: 'system',
        };
        freshTarget.deployments.unshift(record);
        freshTarget.currentVersion = version;
        freshTarget.status = 'running';
        freshTarget.hostPort = execResult.hostPort;
        freshTarget.updatedAt = now;
        writeStore(freshStore);

        // 清理旧版本镜像（只保留当前版本）
        const oldPublishVersions = freshTarget.deployments
          .filter((d) => d.action === 'publish' && d.version !== version)
          .map((d) => d.version);
        let removedCount = 0;
        for (const ver of [...new Set(oldPublishVersions)]) {
          if (dockerRemoveImage(freshTarget.name, ver)) removedCount++;
        }

        addPublishLog(serviceId, `[完成] 发布成功，版本 ${version}，清理 ${removedCount} 个旧镜像`);
        addLog({
          action: 'publish',
          serviceName: freshTarget.name,
          success: true,
          version,
          detail: `发布成功，版本 ${version}，清理 ${removedCount} 个旧镜像`,
        });
        sendAlert('publish_success', freshTarget.name, `发布成功，版本 ${version}`).catch(() => {});
      }

      finishPublish(serviceId, true);
    } catch (err: any) {
      if (abortSignal.aborted) return; // 被中止，不做任何记录
      addPublishLog(serviceId, `[异常] ${err.message}`);
      finishPublish(serviceId, false);
      addLog({
        action: 'publish',
        serviceName: target.name,
        success: false,
        version,
        detail: `发布异常: ${err.message}`,
      });
      sendAlert('publish_fail', target.name, `发布异常: ${err.message}`).catch(() => {});
    }
  })();

  return { version };
}

/**
 * 启动回退（fire-and-forget）
 * 返回版本号后立即返回，实际构建在后台执行。
 * 前端通过 SSE 实时查看进度。
 */
export function rollbackServiceAsync(
  serviceId: string,
  payload: { targetVersion: string; note?: string; operator?: string },
): { version: string } | ErrorResult | null {
  const store = readStore();
  const target = store.services.find((s) => s.id === serviceId);
  if (!target) return null;

  if (isPublishing(serviceId)) {
    return { error: 'already-publishing' };
  }

  const targetVersion = payload.targetVersion?.trim();
  const historical = target.deployments.find((d) => d.version === targetVersion && d.action === 'publish');
  if (!historical) return { error: 'target-version-not-found' };

  if (!historical.commitHash) {
    return { error: 'commit-hash-missing', logs: ['该版本没有记录 commit hash，无法回退'] };
  }

  const commitHash = historical.commitHash;
  const historicalId = historical.id;

  // 启动追踪器（返回 abort signal）
  const abortSignal = startPublish(serviceId, target.name, targetVersion, 'rollback');

  // 后台执行，不阻塞请求
  (async () => {
    try {
      const execResult = await dockerRebuildFromCommit(target, targetVersion, commitHash, (line) => {
        addPublishLog(serviceId, line);
      }, abortSignal);

      if (abortSignal.aborted) return;

      if (!execResult.ok) {
        finishPublish(serviceId, false);
        addLog({
          action: 'rollback',
          serviceName: target.name,
          success: false,
          version: targetVersion,
          detail: `回退失败: ${execResult.logs.join(' | ')}`,
        });
        return;
      }

      // 成功：更新 store
      const freshStore = readStore();
      const freshTarget = freshStore.services.find((s) => s.id === serviceId);
      if (!freshTarget) return;

      const targetIdx = freshTarget.deployments.findIndex((d) => d.id === historicalId);
      if (targetIdx > 0) {
        const removedDeps = freshTarget.deployments.slice(0, targetIdx);
        const removedPublishVersions = removedDeps
          .filter((d) => d.action === 'publish')
          .map((d) => d.version);
        freshTarget.deployments.splice(0, targetIdx);
        for (const ver of removedPublishVersions) {
          if (ver !== targetVersion) {
            dockerRemoveImage(freshTarget.name, ver);
          }
        }
      }

      const now = new Date().toISOString();
      freshTarget.currentVersion = targetVersion;
      freshTarget.status = 'running';
      freshTarget.hostPort = execResult.hostPort;
      freshTarget.updatedAt = now;
      writeStore(freshStore);

      addPublishLog(serviceId, `[完成] 回退成功，版本 ${targetVersion}`);
      addLog({
        action: 'rollback',
        serviceName: freshTarget.name,
        success: true,
        version: targetVersion,
        detail: `回退成功，目标版本 ${targetVersion}（commit ${commitHash.slice(0, 8)}），已清理后续版本`,
      });

      finishPublish(serviceId, true);
    } catch (err: any) {
      if (abortSignal.aborted) return;
      addPublishLog(serviceId, `[异常] ${err.message}`);
      finishPublish(serviceId, false);
      addLog({
        action: 'rollback',
        serviceName: target.name,
        success: false,
        version: targetVersion,
        detail: `回退异常: ${err.message}`,
      });
    }
  })();

  return { version: targetVersion };
}

export async function rollbackService(
  serviceId: string,
  payload: { targetVersion: string; note?: string; operator?: string },
): Promise<RollbackResult | ErrorResult | null> {
  const store = readStore();
  const target = store.services.find((s) => s.id === serviceId);
  if (!target) return null;

  const targetVersion = payload.targetVersion?.trim();
  const historical = target.deployments.find((d) => d.version === targetVersion && d.action === 'publish');
  if (!historical) return { error: 'target-version-not-found' };

  if (!historical.commitHash) {
    return { error: 'commit-hash-missing', logs: ['该版本没有记录 commit hash，无法回退'] };
  }

  // 使用 commit hash 重新克隆代码并构建
  const execResult = await dockerRebuildFromCommit(target, targetVersion, historical.commitHash);
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

  // 找到目标版本在部署记录中的位置，删除其后的所有记录
  // deployments 按时间倒序排列（index 0 = 最新），所以目标版本之前的 index 都是"更新"的记录
  const freshStore = readStore();
  const freshTarget = freshStore.services.find((s) => s.id === serviceId);
  if (!freshTarget) return null;

  const targetIdx = freshTarget.deployments.findIndex((d) => d.id === historical.id);
  if (targetIdx > 0) {
    // 收集要删除的版本（用于清理 docker 镜像）
    const removedDeps = freshTarget.deployments.slice(0, targetIdx);
    const removedPublishVersions = removedDeps
      .filter((d) => d.action === 'publish')
      .map((d) => d.version);

    // 删除目标版本之后的所有记录
    freshTarget.deployments.splice(0, targetIdx);

    // 清理已删除版本的 docker 镜像
    for (const ver of removedPublishVersions) {
      if (ver !== targetVersion) {
        dockerRemoveImage(freshTarget.name, ver);
      }
    }
  }

  const now = new Date().toISOString();
  freshTarget.currentVersion = targetVersion;
  freshTarget.status = 'running';
  freshTarget.hostPort = execResult.hostPort;
  freshTarget.updatedAt = now;
  writeStore(freshStore);

  addLog({
    action: 'rollback',
    serviceName: freshTarget.name,
    success: true,
    version: targetVersion,
    detail: `回退成功，目标版本 ${targetVersion}（commit ${historical.commitHash.slice(0, 8)}），已清理后续版本`,
  });

  return { service: freshTarget, record: historical, logs: execResult.logs };
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
