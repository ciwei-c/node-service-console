/**
 * 发布 / 回退 / 删除部署记录
 */
import { v4 as uuidv4 } from 'uuid';
import { readStore, writeStore } from '../store';
import { dockerPublish, dockerRebuildFromCommit, dockerRemoveImage } from '../docker';
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
