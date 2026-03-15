import { useEffect, useState } from 'react';
import { useLocation, useNavigate, Outlet } from 'react-router-dom';
import { Layout as AntLayout, Menu, Button, Avatar, Dropdown, Tag, message } from 'antd';
import { AppstoreOutlined, ContainerOutlined, FileTextOutlined, GithubOutlined, UserOutlined } from '@ant-design/icons';
import { fetchOAuthStatus, unbindOAuth, getOAuthAuthorizeUrl } from '../api';
import type { OAuthStatus } from '../api';

const { Header, Content } = AntLayout;

const menuItems = [
  { key: '/', icon: <AppstoreOutlined />, label: '服务管理' },
  { key: '/containers', icon: <ContainerOutlined />, label: '容器列表' },
  { key: '/logs', icon: <FileTextOutlined />, label: '操作日志' },
];

export default function AppLayout() {
  const nav = useNavigate();
  const loc = useLocation();
  const [oauth, setOAuth] = useState<OAuthStatus | null>(null);

  useEffect(() => {
    fetchOAuthStatus().then(setOAuth).catch(() => {});
  }, []);

  const handleBind = () => {
    window.location.href = getOAuthAuthorizeUrl();
  };

  const handleUnbind = async () => {
    await unbindOAuth();
    message.success('已解除 GitHub 绑定');
    setOAuth({ bound: false, configured: oauth?.configured ?? false });
  };

  // 高亮当前菜单项
  const selectedKey = loc.pathname.startsWith('/containers') ? '/containers'
    : loc.pathname.startsWith('/logs') ? '/logs'
    : '/';  // 路径已经是相对于 basename 的，无需加前缀

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
        <div style={{ marginLeft: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          {oauth?.bound ? (
            <Dropdown menu={{
              items: [
                { key: 'info', label: `已绑定: ${oauth.username}`, disabled: true },
                { key: 'unbind', label: '解除绑定', danger: true, onClick: handleUnbind },
              ],
            }}>
              <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Avatar size="small" src={oauth.avatarUrl} icon={<UserOutlined />} />
                <Tag color="green" style={{ margin: 0 }}>{oauth.username}</Tag>
              </div>
            </Dropdown>
          ) : oauth?.configured ? (
            <Button
              type="primary"
              size="small"
              icon={<GithubOutlined />}
              onClick={handleBind}
            >
              绑定 GitHub
            </Button>
          ) : (
            <Tag color="default" style={{ margin: 0 }}>GitHub 未配置</Tag>
          )}
        </div>
      </Header>
      <Content style={{ background: '#f5f5f5' }}>
        <Outlet />
      </Content>
    </AntLayout>
  );
}
