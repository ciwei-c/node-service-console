/* ── 数据类型 ── */

export interface Deployment {
  id: string;
  action: 'publish' | 'rollback';
  version: string;
  commitHash: string;
  commitMessage: string;
  /** 发布结果：成功 / 被Webhook中止 / 手动停止 */
  deployStatus?: 'success' | 'aborted' | 'stopped';
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

/** 服务列表摘要（轻量） */
export interface ServiceSummary {
  id: string;
  name: string;
  status: 'idle' | 'running' | 'stopped';
  currentVersion: string;
  updatedAt: string;
  codeSource: string;
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

/* ── 静态站点 ── */

export interface StaticSite {
  id: string;
  name: string;
  accessPath: string;
  currentVersion: string;
  deployedAt?: string;
  createdAt: string;
  updatedAt: string;
}
