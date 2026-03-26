import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import { isLoggedIn } from './api';

const AppLayout = lazy(() => import('./components/AppLayout'));
const ContainerList = lazy(() => import('./pages/ContainerList'));
const LogList = lazy(() => import('./pages/LogList'));
const ServiceList = lazy(() => import('./pages/ServiceList'));
const ServiceDetail = lazy(() => import('./pages/ServiceDetail'));
const SiteList = lazy(() => import('./pages/SiteList'));
const MonitorDashboard = lazy(() => import('./pages/MonitorDashboard'));
const NotifySettings = lazy(() => import('./pages/NotifySettings'));
const TerminalPage = lazy(() => import('./pages/Terminal'));
const BackupRestore = lazy(() => import('./pages/BackupRestore'));
const Login = lazy(() => import('./pages/Login'));

/** 受保护的路由包装器 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!isLoggedIn()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

const Loading = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
    <Spin size="large" />
  </div>
);

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route path="/" element={<ServiceList />} />
          <Route path="/containers" element={<ContainerList />} />
          <Route path="/sites" element={<SiteList />} />
          <Route path="/monitor" element={<MonitorDashboard />} />
          <Route path="/notify" element={<NotifySettings />} />
          <Route path="/terminal" element={<TerminalPage />} />
          <Route path="/backup" element={<BackupRestore />} />
          <Route path="/logs" element={<LogList />} />
          <Route path="/:serviceName/*" element={<ServiceDetail />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
