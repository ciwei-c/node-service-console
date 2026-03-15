import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import ContainerList from './pages/ContainerList';
import LogList from './pages/LogList';
import ServiceList from './pages/ServiceList';
import ServiceDetail from './pages/ServiceDetail';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<ServiceList />} />
        <Route path="/containers" element={<ContainerList />} />
        <Route path="/logs" element={<LogList />} />
        <Route path="/:serviceName/*" element={<ServiceDetail />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
