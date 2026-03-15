/**
 * 发布状态追踪器（内存存储）
 * 
 * 跟踪每个服务的发布进度和日志，供前端轮询查看。
 */

export interface PublishStatus {
  serviceId: string;
  serviceName: string;
  version: string;
  status: 'publishing' | 'success' | 'failed';
  logs: string[];
  startedAt: string;
  finishedAt?: string;
}

/** serviceId -> PublishStatus */
const statusMap = new Map<string, PublishStatus>();

export function startPublish(serviceId: string, serviceName: string, version: string): void {
  statusMap.set(serviceId, {
    serviceId,
    serviceName,
    version,
    status: 'publishing',
    logs: [],
    startedAt: new Date().toISOString(),
  });
}

export function addPublishLog(serviceId: string, line: string): void {
  const s = statusMap.get(serviceId);
  if (s) s.logs.push(line);
}

export function finishPublish(serviceId: string, success: boolean): void {
  const s = statusMap.get(serviceId);
  if (s) {
    s.status = success ? 'success' : 'failed';
    s.finishedAt = new Date().toISOString();
  }
}

export function getPublishStatus(serviceId: string): PublishStatus | null {
  return statusMap.get(serviceId) ?? null;
}

export function isPublishing(serviceId: string): boolean {
  const s = statusMap.get(serviceId);
  return s?.status === 'publishing';
}
