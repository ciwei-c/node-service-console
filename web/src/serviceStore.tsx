/**
 * 全局服务列表缓存
 *
 * 在列表页加载后缓存结果，详情页如有更新则回写缓存，
 * 返回列表页时无需重新请求接口。
 */
import { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { ServiceSummary } from './types';
import { fetchServices as apiFetch } from './api';

interface ServiceStoreCtx {
  /** 当前缓存的列表 */
  services: ServiceSummary[];
  /** 是否正在加载 */
  loading: boolean;
  /** 首次 / 强制刷新列表 */
  loadServices: (force?: boolean) => Promise<void>;
  /** 详情页回写：更新单条摘要 */
  patchService: (summary: ServiceSummary) => void;
  /** 新建后追加 */
  addService: (summary: ServiceSummary) => void;
  /** 删除后移除 */
  removeService: (id: string) => void;
}

const Ctx = createContext<ServiceStoreCtx>(null!);

export function ServiceStoreProvider({ children }: { children: ReactNode }) {
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const loadServices = useCallback(async (force = false) => {
    if (loaded && !force) return;
    setLoading(true);
    try {
      setServices(await apiFetch());
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }, [loaded]);

  const patchService = useCallback((summary: ServiceSummary) => {
    setServices((prev) =>
      prev.map((s) => (s.id === summary.id ? summary : s)),
    );
  }, []);

  const addService = useCallback((summary: ServiceSummary) => {
    setServices((prev) => [summary, ...prev]);
  }, []);

  const removeService = useCallback((id: string) => {
    setServices((prev) => prev.filter((s) => s.id !== id));
  }, []);

  return (
    <Ctx.Provider value={{ services, loading, loadServices, patchService, addService, removeService }}>
      {children}
    </Ctx.Provider>
  );
}

export function useServiceStore() {
  return useContext(Ctx);
}
