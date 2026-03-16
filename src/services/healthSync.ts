/**
 * 容器健康状态同步
 *
 * 定期检查所有 status=running 的服务，与 Docker 实际容器状态对比，
 * 自动修正 store 中的状态，避免容器崩溃后显示 "运行中" 的假象。
 */
import { readStore, writeStore } from '../store';
import { getContainerState } from '../docker';

const SYNC_INTERVAL = 30_000; // 30 秒

/** 执行一次状态同步 */
export function syncContainerStatus(): void {
  const store = readStore();
  let changed = false;

  for (const svc of store.services) {
    if (svc.status === 'idle') continue; // 从未部署过的不检查

    const actual = getContainerState(svc.name);

    if (svc.status === 'running' && actual !== 'running') {
      // 容器已崩溃/停止/不存在，但 store 记录为 running
      svc.status = actual ? 'stopped' : 'stopped';
      svc.updatedAt = new Date().toISOString();
      changed = true;
      console.log(`[health-sync] ${svc.name}: running → stopped (actual: ${actual ?? 'not found'})`);
    } else if (svc.status === 'stopped' && actual === 'running') {
      // 容器被外部启动了（如 docker restart 策略），但 store 记录为 stopped
      svc.status = 'running';
      svc.updatedAt = new Date().toISOString();
      changed = true;
      console.log(`[health-sync] ${svc.name}: stopped → running`);
    }
  }

  if (changed) writeStore(store);
}

/** 启动定时同步 */
export function startHealthSync(): void {
  // 启动后立即执行一次
  syncContainerStatus();
  setInterval(syncContainerStatus, SYNC_INTERVAL);
  console.log(`[health-sync] 已启动，每 ${SYNC_INTERVAL / 1000}s 同步一次容器状态`);
}
