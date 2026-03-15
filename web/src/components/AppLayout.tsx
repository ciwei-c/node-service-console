import { useLocation, useNavigate, Outlet } from 'react-router-dom';
import { Layout as AntLayout, Menu } from 'antd';
import { AppstoreOutlined, ContainerOutlined, FileTextOutlined } from '@ant-design/icons';

const { Header, Content } = AntLayout;

const menuItems = [
  { key: '/', icon: <AppstoreOutlined />, label: '服务管理' },
  { key: '/containers', icon: <ContainerOutlined />, label: '容器列表' },
  { key: '/logs', icon: <FileTextOutlined />, label: '操作日志' },
];

export default function AppLayout() {
  const nav = useNavigate();
  const loc = useLocation();

  // 高亮当前菜单项
  const selectedKey = loc.pathname.startsWith('/containers') ? '/containers'
    : loc.pathname.startsWith('/logs') ? '/logs'
    : '/';

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Header style={{
        display: 'flex', alignItems: 'center', padding: '0 24px',
        background: '#001529',
      }}>
        <div style={{
          color: '#fff', fontSize: 18, fontWeight: 600,
          marginRight: 40, whiteSpace: 'nowrap',
        }}>
          🚀 服务管理控制台
        </div>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => nav(key)}
          style={{ flex: 1, minWidth: 0 }}
        />
      </Header>
      <Content style={{ background: '#f5f5f5' }}>
        <Outlet />
      </Content>
    </AntLayout>
  );
}
