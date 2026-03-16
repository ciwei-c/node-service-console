import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import ContainerList from './pages/ContainerList';
import LogList from './pages/LogList';
import ServiceList from './pages/ServiceList';
import ServiceDetail from './pages/ServiceDetail';
import Login from './pages/Login';
import { isLoggedIn } from './api';

/** 受保护的路由包装器 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!isLoggedIn()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route path="/" element={<ServiceList />} />
        <Route path="/containers" element={<ContainerList />} />
        <Route path="/logs" element={<LogList />} />
        <Route path="/:serviceName/*" element={<ServiceDetail />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
