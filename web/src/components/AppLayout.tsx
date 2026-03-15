import { useEffect, useState, useRef, useCallback } from 'react';
import { useLocation, useNavigate, Outlet } from 'react-router-dom';
import { Layout as AntLayout, Menu, Button, Avatar, Dropdown, Tag, Modal, Typography, message } from 'antd';
import { AppstoreOutlined, ContainerOutlined, FileTextOutlined, GithubOutlined, UserOutlined, CopyOutlined } from '@ant-design/icons';
import { fetchOAuthStatus, requestDeviceCode, pollDeviceAuth, unbindOAuth } from '../api';
import type { OAuthStatus } from '../api';

const { Header, Content } = AntLayout;
const { Text, Title } = Typography;

const menuItems = [
  { key: '/', icon: <AppstoreOutlined />, label: '服务管理' },
  { key: '/containers', icon: <ContainerOutlined />, label: '容器列表' },
  { key: '/logs', icon: <FileTextOutlined />, label: '操作日志' },
];

export default function AppLayout() {
  const nav = useNavigate();
  const loc = useLocation();
  const [oauth, setOAuth] = useState<OAuthStatus | null>(null);
  const [bindOpen, setBindOpen] = useState(false);
  const [userCode, setUserCode] = useState('');
  const [verificationUri, setVerificationUri] = useState('');
  const [polling, setPolling] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchOAuthStatus().then(setOAuth).catch(() => {});
  }, []);

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPolling(false);
  }, []);

  const handleBind = async () => {
    try {
      const data = await requestDeviceCode();
      setUserCode(data.userCode);
      setVerificationUri(data.verificationUri);
      setBindOpen(true);
      setPolling(true);

      // 自动打开 GitHub 验证页面
      window.open(data.verificationUri, '_blank');

      // 开始轮询
      const interval = (data.interval || 5) * 1000;
      timerRef.current = setInterval(async () => {
        try {
          const result = await pollDeviceAuth(data.deviceCode);
          if (result.status === 'success') {
            stopPolling();
            setBindOpen(false);
            message.success(`已绑定 GitHub 账号: ${result.username}`);
            setOAuth({
              bound: true,
              configured: true,
              provider: 'github',
              username: result.username,
              avatarUrl: result.avatarUrl,
            });
          } else if (result.status === 'expired') {
            stopPolling();
            message.error('验证码已过期，请重新绑定');
            setBindOpen(false);
          }
        } catch {
          // 继续轮询
        }
      }, interval);
    } catch (err: any) {
      message.error(err.message || '获取验证码失败');
    }
  };

  const handleCancelBind = () => {
    stopPolling();
    setBindOpen(false);
  };

  const handleUnbind = async () => {
    await unbindOAuth();
    message.success('已解除 GitHub 绑定');
    setOAuth({ bound: false, configured: oauth?.configured ?? false });
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(userCode).then(() => {
      message.success('验证码已复制');
    });
  };

  // 组件卸载时清理定时器
  useEffect(() => () => stopPolling(), [stopPolling]);

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

      {/* Device Flow 绑定弹窗 */}
      <Modal
        title="绑定 GitHub 账号"
        open={bindOpen}
        onCancel={handleCancelBind}
        footer={[
          <Button key="cancel" onClick={handleCancelBind}>取消</Button>,
          <Button key="open" type="primary" icon={<GithubOutlined />}
            onClick={() => window.open(verificationUri, '_blank')}
          >
            打开 GitHub 验证页面
          </Button>,
        ]}
      >
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <Text type="secondary">请在 GitHub 页面中输入以下验证码：</Text>
          <div style={{ margin: '16px 0' }}>
            <Title level={2} style={{ margin: 0, letterSpacing: 8, fontFamily: 'monospace' }} copyable={{ text: userCode }}>
              {userCode}
            </Title>
          </div>
          <Button icon={<CopyOutlined />} onClick={handleCopyCode} style={{ marginBottom: 16 }}>
            复制验证码
          </Button>
          <div>
            {polling && (
              <Text type="secondary">
                ⏳ 等待授权中... 完成后将自动绑定
              </Text>
            )}
          </div>
        </div>
      </Modal>
    </AntLayout>
  );
}
