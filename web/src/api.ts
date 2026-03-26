import type { Service, ServiceSummary, EnvVar, Pipeline, ContainerInfo, OperationLog, LogQuery } from './types';

const BASE = '/node-service-console/api';

/* ── Token 管理 ── */

const TOKEN_KEY = 'nsc_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

/* ── 通用请求 ── */

async function request<T>(url: string, opts?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(BASE + url, {
    headers,
    ...opts,
  });

  // 401 未登录/过期 → 清除 token，跳转登录页
  if (res.status === 401) {
    clearToken();
    window.location.href = '/node-service-console/login';
    throw new Error('未登录或登录已过期');
  }

  const json = await res.json();
  if (!res.ok) {
    const err: any = new Error(json.message || '请求失败');
    err.logs = json.logs;
    throw err;
  }
  return json.data as T;
}

/* ── 登录 ── */

export const login = async (password: string): Promise<{ token: string; expiresIn: number }> => {
  const res = await fetch(BASE + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || '登录失败');
  const data = json.data as { token: string; expiresIn: number };
  setToken(data.token);
  return data;
};

export const changePassword = (oldPassword: string, newPassword: string) =>
  request<{ ok: boolean }>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ oldPassword, newPassword }),
  });

export const logout = () => {
  clearToken();
  window.location.href = '/node-service-console/login';
};

/* services */
export const fetchServices = () => request<ServiceSummary[]>('/services');
export const fetchServiceByName = (name: string) => request<Service>(`/services/by-name/${encodeURIComponent(name)}`);
export const createService = (name: string) =>
  request<Service>('/services', { method: 'POST', body: JSON.stringify({ name }) });
export const deleteService = (id: string) =>
  request<Service>(`/services/${id}`, { method: 'DELETE' });

/* deploy */
export const publishService = (id: string) =>
  request<{ status: string; version: string }>(`/services/${id}/publish`, { method: 'POST' });

export const stopPublishService = (id: string) =>
  request<{ version: string; message: string }>(`/services/${id}/stop-publish`, { method: 'POST' });

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

export const fetchPublishStatus = (id: string) =>
  request<PublishStatus | null>(`/services/${id}/publish-status`);

/** 订阅发布事件 SSE 流 */
export function subscribePublishEvents(
  serviceId: string,
  handlers: {
    onStatus: (status: PublishStatus) => void;
    onLog: (line: string) => void;
    onError?: () => void;
  },
): () => void {
  const token = getToken();
  const url = `${BASE}/services/${serviceId}/publish-events${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  const es = new EventSource(url);

  es.addEventListener('status', (e) => {
    try { handlers.onStatus(JSON.parse(e.data)); } catch { /* ignore */ }
  });
  es.addEventListener('log', (e) => {
    try {
      const d = JSON.parse(e.data);
      handlers.onLog(d.line);
    } catch { /* ignore */ }
  });
  es.onerror = () => {
    handlers.onError?.();
  };

  return () => es.close();
}

export const rollbackService = (id: string, body: { targetVersion: string; operator?: string; note?: string }) =>
  request(`/services/${id}/rollback`, { method: 'POST', body: JSON.stringify(body) });
export const deleteDeployment = (serviceId: string, depId: string) =>
  request(`/services/${serviceId}/deployments/${depId}`, { method: 'DELETE' });

/* status */
export const stopService = (id: string) =>
  request<Service>(`/services/${id}/stop`, { method: 'POST' });
export const startService = (id: string) =>
  request<Service>(`/services/${id}/start`, { method: 'POST' });

/* env vars */
export const updateEnvVars = (id: string, envVars: EnvVar[]) =>
  request<EnvVar[]>(`/services/${id}/env`, { method: 'PUT', body: JSON.stringify({ envVars }) });

/* pipeline */
export const updatePipeline = (id: string, pipeline: Pipeline) =>
  request<Pipeline>(`/services/${id}/pipeline`, { method: 'PUT', body: JSON.stringify(pipeline) });

/* containers */
export const fetchContainers = () => request<ContainerInfo[]>('/containers');
export const fetchContainerInspect = (id: string) => request<Record<string, unknown>>(`/containers/${id}/inspect`);
export const fetchContainerLogs = (id: string, tail = 100) => request<string>(`/containers/${id}/logs?tail=${tail}`);

/* logs */
export const fetchLogs = (query: LogQuery = {}) => {
  const params = new URLSearchParams();
  if (query.startTime) params.set('startTime', query.startTime);
  if (query.endTime) params.set('endTime', query.endTime);
  if (query.serviceName) params.set('serviceName', query.serviceName);
  if (query.action) params.set('action', query.action);
  if (query.success !== undefined) params.set('success', String(query.success));
  if (query.keyword) params.set('keyword', query.keyword);
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  return request<{ total: number; page: number; pageSize: number; list: OperationLog[] }>(`/logs?${params.toString()}`);
};
export const fetchLogServiceNames = () => request<string[]>('/logs/service-names');

/* debug */
export interface DebugHttpRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: string;
}

export interface DebugHttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  duration: number;
}

export const debugHttp = (serviceId: string, payload: DebugHttpRequest) =>
  request<DebugHttpResponse>(`/services/${serviceId}/debug/http`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

/* sites (静态站点) */
import type { StaticSite } from './types';

export const fetchSites = () => request<StaticSite[]>('/sites');

export const createSiteApi = (name: string) =>
  request<StaticSite>('/sites', { method: 'POST', body: JSON.stringify({ name }) });

export const deleteSiteApi = (id: string) =>
  request<StaticSite>(`/sites/${id}`, { method: 'DELETE' });

/** 上传 zip 部署站点（不用 request 工具，因为是 FormData） */
export async function deploySiteApi(id: string, file: File, version?: string): Promise<StaticSite> {
  const token = getToken();
  const form = new FormData();
  form.append('file', file);
  if (version) form.append('version', version);

  const res = await fetch(BASE + `/sites/${id}/deploy`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });

  if (res.status === 401) {
    clearToken();
    window.location.href = '/node-service-console/login';
    throw new Error('未登录或登录已过期');
  }

  const json = await res.json();
  if (!res.ok) throw new Error(json.message || '部署失败');
  return json.data as StaticSite;
}

/* ── 系统监控 ── */

export interface SystemStats {
  timestamp: string;
  hostname: string;
  platform: string;
  uptime: { uptimeSeconds: number; uptimeFormatted: string };
  cpu: { usagePercent: number; cores: number; model: string };
  memory: { totalMB: number; usedMB: number; freeMB: number; usagePercent: number };
  disks: { filesystem: string; mountpoint: string; totalGB: number; usedGB: number; availGB: number; usagePercent: number }[];
  containers: { id: string; name: string; cpuPercent: number; memUsageMB: number; memLimitMB: number; memPercent: number; netIO: string; blockIO: string; pids: number }[];
  loadAvg: number[];
}

export async function fetchSystemStats(): Promise<SystemStats> {
  return request<SystemStats>('/monitor');
}