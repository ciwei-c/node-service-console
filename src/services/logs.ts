/**
 * 操作日志——结构化存储与查询
 */
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { LogAction, OperationLog, LogStore } from '../types';
import { getDataDir, readLocalSettings } from '../store';

const logDataPath = path.join(getDataDir(), 'logs.json');

/** 默认日志保留策略 */
const DEFAULT_MAX_COUNT = 5000;
const DEFAULT_MAX_AGE_DAYS = 90;

function readLogStore(): LogStore {
  if (!fs.existsSync(logDataPath)) {
    fs.writeFileSync(logDataPath, JSON.stringify({ logs: [] }, null, 2), 'utf-8');
  }
  return JSON.parse(fs.readFileSync(logDataPath, 'utf-8'));
}

function writeLogStore(store: LogStore): void {
  fs.writeFileSync(logDataPath, JSON.stringify(store, null, 2), 'utf-8');
}

/** 写入一条操作日志 */
export function addLog(params: {
  action: LogAction;
  serviceName: string;
  success: boolean;
  version?: string;
  detail: string;
  operator?: string;
}): OperationLog {
  const store = readLogStore();
  const log: OperationLog = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    action: params.action,
    serviceName: params.serviceName,
    success: params.success,
    version: params.version,
    detail: params.detail,
    operator: params.operator || 'system',
  };
  store.logs.unshift(log); // 最新在前

  // 自动清理过期/超量日志
  cleanupLogs(store);

  writeLogStore(store);
  return log;
}

/** 清理日志：按数量上限 + 过期天数 */
function cleanupLogs(store: LogStore): void {
  const settings = readLocalSettings();
  const maxCount = settings.logs?.maxCount ?? DEFAULT_MAX_COUNT;
  const maxAgeDays = settings.logs?.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;

  // 按数量截断
  if (store.logs.length > maxCount) {
    store.logs = store.logs.slice(0, maxCount);
  }

  // 按时间过滤
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  store.logs = store.logs.filter((l) => new Date(l.timestamp).getTime() >= cutoff);
}

/** 查询日志 (支持多维度筛选 + 分页) */
export function queryLogs(query: {
  startTime?: string;
  endTime?: string;
  serviceName?: string;
  action?: LogAction;
  success?: string | boolean;
  keyword?: string;
  page?: number;
  pageSize?: number;
}): { total: number; page: number; pageSize: number; list: OperationLog[] } {
  const store = readLogStore();
  let result = store.logs;

  // 时间范围
  if (query.startTime) {
    const start = new Date(query.startTime).getTime();
    result = result.filter((l) => new Date(l.timestamp).getTime() >= start);
  }
  if (query.endTime) {
    const end = new Date(query.endTime).getTime();
    result = result.filter((l) => new Date(l.timestamp).getTime() <= end);
  }

  // 服务名称
  if (query.serviceName) {
    result = result.filter((l) => l.serviceName === query.serviceName);
  }

  // 操作类型
  if (query.action) {
    result = result.filter((l) => l.action === query.action);
  }

  // 执行结果
  if (query.success !== undefined && query.success !== '') {
    const val = String(query.success) === 'true';
    result = result.filter((l) => l.success === val);
  }

  // 关键字
  if (query.keyword) {
    const kw = query.keyword.toLowerCase();
    result = result.filter(
      (l) =>
        l.detail.toLowerCase().includes(kw) ||
        l.serviceName.toLowerCase().includes(kw) ||
        (l.version || '').toLowerCase().includes(kw),
    );
  }

  const total = result.length;
  const page = Math.max(query.page || 1, 1);
  const pageSize = Math.min(Math.max(query.pageSize || 20, 1), 100);
  const start = (page - 1) * pageSize;
  const list = result.slice(start, start + pageSize);

  return { total, page, pageSize, list };
}

/** 获取所有出现过的服务名 (用于筛选下拉) */
export function getLogServiceNames(): string[] {
  const store = readLogStore();
  return [...new Set(store.logs.map((l) => l.serviceName))].sort();
}
