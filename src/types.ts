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
  authMode: 'ssh' | 'token';
  gitToken: string;
}

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

export interface Service {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  currentVersion: string;
  status: 'idle' | 'running' | 'stopped';
  /** 实际映射到宿主机的端口（自动分配，避免冲突） */
  hostPort?: number;
  deployments: Deployment[];
  envVars: EnvVar[];
  pipeline: Pipeline;
}

/* ── 静态站点 ── */

export interface StaticSite {
  id: string;
  name: string;
  /** 访问路径前缀: /web/{name} */
  accessPath: string;
  currentVersion: string;
  deployedAt?: string;
  /** 自定义域名（可选） */
  customDomain?: string;
  createdAt: string;
  updatedAt: string;
}

/* ── 数据库实例 ── */

/** 持久化的数据库实例元数据（含敏感信息，仅服务端使用） */
export interface DatabaseRecord {
  id: string;
  /** 实例名（全局唯一，用于容器名/数据卷名） */
  name: string;
  containerName: string;
  image: string;
  hostPort: number;
  containerPort: number;
  volumeName: string;
  databaseName: string;
  username: string;
  password: string;
  rootPassword: string;
  managed: boolean;
  memoryLimitMB?: number;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

/** API 返回的数据库实例（列表中的密码会被掩码） */
export interface DatabaseInstance {
  id: string;
  name: string;
  containerName: string;
  image: string;
  hostPort?: number;
  containerPort: number;
  volumeName?: string;
  databaseName?: string;
  username?: string;
  password?: string;
  rootPassword?: string;
  managed: boolean;
  external: boolean;
  status: 'running' | 'stopped' | 'restarting' | 'missing' | 'unknown';
  health?: string;
  containerId?: string;
  ports?: string;
  createdAt?: string;
  updatedAt?: string;
  memoryLimitMB?: number;
  note?: string;
  cpuPercent?: string;
  memUsage?: string;
}

export interface DatabaseCreatePayload {
  name: string;
  image?: string;
  hostPort?: number;
  databaseName?: string;
  username?: string;
  password?: string;
  rootPassword?: string;
  volumeName?: string;
  memoryLimitMB?: number;
  note?: string;
}

export interface Store {
  services: Service[];
  sites: StaticSite[];
  databases?: DatabaseRecord[];
}

export interface LocalSettings {
  server: { port: number };
  auth?: {
    /** scrypt 哈希后的密码（首次启动自动生成） */
    passwordHash?: string;
    /** JWT 签名密钥（首次启动自动生成） */
    jwtSecret?: string;
    /** Token 有效期（天），默认 7 */
    tokenExpireDays?: number;
  };
  github?: { clientId: string };
  logs?: { maxCount?: number; maxAgeDays?: number };
  /** 通知告警配置 */
  notify?: NotifyConfig;
}

/* ── 通知告警 ── */

export interface NotifyChannel {
  /** 渠道类型 */
  type: 'webhook' | 'telegram';
  /** 是否启用 */
  enabled: boolean;
  /** 渠道名称（用户自定义） */
  name: string;
  /** Webhook URL（type=webhook 时使用） */
  webhookUrl?: string;
  /** Telegram Bot Token（type=telegram 时使用） */
  telegramBotToken?: string;
  /** Telegram Chat ID（type=telegram 时使用） */
  telegramChatId?: string;
}

export interface NotifyConfig {
  /** 是否全局启用通知 */
  enabled: boolean;
  /** 通知渠道列表 */
  channels: NotifyChannel[];
  /** 触发事件配置 */
  events: {
    /** 容器崩溃 */
    containerCrash: boolean;
    /** 发布失败 */
    publishFail: boolean;
    /** 发布成功 */
    publishSuccess: boolean;
  };
}

export interface OAuthToken {
  provider: string;
  accessToken: string;
  username: string;
  avatarUrl: string;
  boundAt: string;
}

export interface ExecResult {
  ok: boolean;
  output: string;
}

export interface DockerOpResult {
  ok: boolean;
  logs: string[];
  /** 实际分配的宿主机端口 */
  hostPort?: number;
  /** 本次构建对应的 Git commit hash */
  commitHash?: string;
  /** 本次构建对应的 Git commit message */
  commitMessage?: string;
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
  | 'config-pipeline'
  | 'database-create'
  | 'database-delete'
  | 'database-start'
  | 'database-stop'
  | 'database-restart';

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
