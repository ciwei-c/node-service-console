import type { Service, EnvVar, Pipeline, ContainerInfo, OperationLog, LogQuery } from './types';

const BASE = '/node-service-console/api';

async function request<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const json = await res.json();
  if (!res.ok) {
    const err: any = new Error(json.message || '请求失败');
    err.logs = json.logs;
    throw err;
  }
  return json.data as T;
}

/* services */
export const fetchServices = () => request<Service[]>('/services');
export const fetchServiceByName = (name: string) => request<Service>(`/services/by-name/${encodeURIComponent(name)}`);
export const createService = (name: string) =>
  request<Service>('/services', { method: 'POST', body: JSON.stringify({ name }) });
export const deleteService = (id: string) =>
  request<Service>(`/services/${id}`, { method: 'DELETE' });

/* deploy */
export const publishService = (id: string) =>
  request<{ status: string; version: string }>(`/services/${id}/publish`, { method: 'POST' });

export interface PublishStatus {
  serviceId: string;
  serviceName: string;
  version: string;
  status: 'publishing' | 'success' | 'failed';
  logs: string[];
  startedAt: string;
  finishedAt?: string;
}

export const fetchPublishStatus = (id: string) =>
  request<PublishStatus | null>(`/services/${id}/publish-status`);

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