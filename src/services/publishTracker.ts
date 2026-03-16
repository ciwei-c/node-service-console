/**
 * 发布状态追踪器（内存存储 + SSE 推送）
 * 
 * 跟踪每个服务的发布进度和日志，通过 SSE 实时推送给前端。
 * 支持中止正在进行的发布。
 */
import type { Response } from 'express';

export interface PublishStatus {
  serviceId: string;
  serviceName: string;
  version: string;
  status: 'publishing' | 'success' | 'failed' | 'aborted' | 'stopped';
  action: 'publish' | 'rollback';
  logs: string[];
  startedAt: string;
  finishedAt?: string;
}

/** 去除 ANSI 转义码（终端颜色等） */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
}

/** serviceId -> PublishStatus */
const statusMap = new Map<string, PublishStatus>();

/** serviceId -> AbortController（用于中止发布） */
const abortMap = new Map<string, AbortController>();

/** serviceId -> Set<SSE Response> */
const sseClients = new Map<string, Set<Response>>();

/* ── SSE 客户端管理 ── */

export function addSseClient(serviceId: string, res: Response): void {
  if (!sseClients.has(serviceId)) {
    sseClients.set(serviceId, new Set());
  }
  sseClients.get(serviceId)!.add(res);
  res.on('close', () => {
    sseClients.get(serviceId)?.delete(res);
  });
}

function broadcast(serviceId: string, event: string, data: unknown): void {
  const clients = sseClients.get(serviceId);
  if (!clients || clients.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try { client.write(payload); } catch { /* client gone */ }
  }
}

/* ── 发布追踪 ── */

/** 开始追踪发布，返回 AbortSignal 供发布流程检测中止 */
export function startPublish(serviceId: string, serviceName: string, version: string, action: 'publish' | 'rollback' = 'publish'): AbortSignal {
  // 中止之前的发布（如果有的话）
  const prevAc = abortMap.get(serviceId);
  if (prevAc) prevAc.abort();

  const ac = new AbortController();
  abortMap.set(serviceId, ac);

  const status: PublishStatus = {
    serviceId,
    serviceName,
    version,
    status: 'publishing',
    action,
    logs: [],
    startedAt: new Date().toISOString(),
  };
  statusMap.set(serviceId, status);
  broadcast(serviceId, 'status', status);

  return ac.signal;
}

export function addPublishLog(serviceId: string, line: string): void {
  const s = statusMap.get(serviceId);
  if (s) {
    const cleaned = stripAnsi(line);
    s.logs.push(cleaned);
    broadcast(serviceId, 'log', { line: cleaned });
  }
}

export function finishPublish(serviceId: string, success: boolean): void {
  const s = statusMap.get(serviceId);
  if (s) {
    s.status = success ? 'success' : 'failed';
    s.finishedAt = new Date().toISOString();
    broadcast(serviceId, 'status', s);
  }
  abortMap.delete(serviceId);
}

/** 中止发布（被 Webhook 新发布中止），返回被中止的版本号 */
export function abortPublish(serviceId: string): { version: string } | null {
  const ac = abortMap.get(serviceId);
  if (!ac) return null;
  ac.abort();
  abortMap.delete(serviceId);
  const s = statusMap.get(serviceId);
  if (s && s.status === 'publishing') {
    s.status = 'aborted';
    s.finishedAt = new Date().toISOString();
    s.logs.push('[中止] 新的 Webhook 发布已触发，当前构建被中止');
    broadcast(serviceId, 'status', s);
    return { version: s.version };
  }
  return null;
}

/** 手动停止发布，返回被停止的版本号 */
export function stopPublish(serviceId: string): { version: string } | null {
  const ac = abortMap.get(serviceId);
  if (!ac) return null;
  ac.abort();
  abortMap.delete(serviceId);
  const s = statusMap.get(serviceId);
  if (s && s.status === 'publishing') {
    s.status = 'stopped';
    s.finishedAt = new Date().toISOString();
    s.logs.push('[停止] 用户手动停止了当前发布');
    broadcast(serviceId, 'status', s);
    return { version: s.version };
  }
  return null;
}

export function getPublishStatus(serviceId: string): PublishStatus | null {
  return statusMap.get(serviceId) ?? null;
}

export function isPublishing(serviceId: string): boolean {
  const s = statusMap.get(serviceId);
  return s?.status === 'publishing';
}
