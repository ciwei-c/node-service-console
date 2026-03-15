/**
 * Token 脱敏工具
 */
import type { Service } from './types';

function maskToken(token: string): string {
  if (!token) return '';
  if (token.length <= 4) return '****';
  return '****' + token.slice(-4);
}

export function maskService(svc: Service): Service {
  const copy: Service = JSON.parse(JSON.stringify(svc));
  if (copy.pipeline?.gitToken) {
    copy.pipeline.gitToken = maskToken(copy.pipeline.gitToken);
  }
  return copy;
}

export function maskServices(list: Service[]): Service[] {
  return list.map(maskService);
}
