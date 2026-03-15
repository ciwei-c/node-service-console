/* ── 后端数据类型定义 ── */

export interface EnvVar {
  key: string;
  value: string;
}

export interface Pipeline {
  codeSource: 'github' | 'gitlab';
  repository: string;
  branch: string;
  targetDir: string;
  port: number;
  dockerfile: string;
  accessPath: string;
  keepImageCount: number;
  authMode: 'ssh' | 'token';
  gitToken: string;
}

export interface Deployment {
  id: string;
  action: 'publish' | 'rollback';
  version: string;
  note: string;
  publishedAt: string;
  operator: string;
}

export interface Service {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  currentVersion: string;
  status: 'idle' | 'running' | 'stopped';
  deployments: Deployment[];
  envVars: EnvVar[];
  pipeline: Pipeline;
}

export interface Store {
  services: Service[];
}

export interface LocalSettings {
  server: { port: number };
}

export interface ExecResult {
  ok: boolean;
  output: string;
}

export interface DockerOpResult {
  ok: boolean;
  logs: string[];
}

export interface CleanupResult {
  removed: string[];
  kept: string[];
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
  created: string;
  state: string;
}

export interface PublishResult {
  service: Service;
  record: Deployment;
  logs: string[];
  cleanup: CleanupResult;
}

export interface RollbackResult {
  service: Service;
  record: Deployment;
  logs: string[];
}

export interface ErrorResult {
  error: string;
  logs?: string[];
}

/* ── 操作日志 ── */

export type LogAction =
  | 'publish'
  | 'rollback'
  | 'stop'
  | 'start'
  | 'create'
  | 'delete'
  | 'webhook'
  | 'config-env'
  | 'config-pipeline';

export interface OperationLog {
  id: string;
  timestamp: string;
  action: LogAction;
  serviceName: string;
  success: boolean;
  version?: string;
  detail: string;
  operator: string;
}

export interface LogStore {
  logs: OperationLog[];
}
