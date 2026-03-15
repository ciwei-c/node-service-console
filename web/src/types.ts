/* ── 数据类型 ── */

export interface Deployment {
  id: string;
  action: 'publish' | 'rollback';
  version: string;
  note: string;
  publishedAt: string;
  operator: string;
}

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

export interface Service {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  currentVersion: string;
  status: 'idle' | 'running' | 'stopped';
  /** 实际映射到宿主机的端口 */
  hostPort?: number;
  deployments: Deployment[];
  envVars: EnvVar[];
  pipeline: Pipeline;
}

/* ── Docker 容器 ── */

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
  created: string;
  state: string;
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

export interface LogQuery {
  startTime?: string;
  endTime?: string;
  serviceName?: string;
  action?: LogAction;
  success?: boolean;
  keyword?: string;
  page?: number;
  pageSize?: number;
}
