import { useState } from 'react';
import { useLocation, useNavigate, Outlet } from 'react-router-dom';
import { Layout as AntLayout, Menu, Button, Popconfirm, Modal, Form, Input, message, Dropdown } from 'antd';
import { AppstoreOutlined, ContainerOutlined, FileTextOutlined, LogoutOutlined, KeyOutlined, UserOutlined, GlobalOutlined, DashboardOutlined } from '@ant-design/icons';
import { logout, changePassword } from '../api';

const { Header, Content } = AntLayout;

const menuItems = [
  { key: '/', icon: <AppstoreOutlined />, label: '服务管理' },
  { key: '/containers', icon: <ContainerOutlined />, label: '容器列表' },
  { key: '/sites', icon: <GlobalOutlined />, label: '静态站点' },
  { key: '/monitor', icon: <DashboardOutlined />, label: '系统监控' },
  { key: '/logs', icon: <FileTextOutlined />, label: '操作日志' },
];

export default function AppLayout() {
  const nav = useNavigate();
  const loc = useLocation();
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);
  const [form] = Form.useForm();

  const selectedKey = loc.pathname.startsWith('/containers') ? '/containers'
    : loc.pathname.startsWith('/sites') ? '/sites'
    : loc.pathname.startsWith('/monitor') ? '/monitor'
    : loc.pathname.startsWith('/logs') ? '/logs'
    : '/';

  const handleChangePassword = async () => {
    try {
      const values = await form.validateFields();
      setPwdLoading(true);
      await changePassword(values.oldPassword, values.newPassword);
      message.success('密码修改成功');
      setPwdOpen(false);
      form.resetFields();
    } catch (err: any) {
      if (err.message) message.error(err.message);
    } finally {
      setPwdLoading(false);
    }
  };

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
        <Dropdown
          menu={{
            items: [
              {
                key: 'change-password',
                icon: <KeyOutlined />,
                label: '修改密码',
                onClick: () => setPwdOpen(true),
              },
              { type: 'divider' },
              {
                key: 'logout',
                icon: <LogoutOutlined />,
                label: '退出登录',
                danger: true,
                onClick: logout,
              },
            ],
          }}
          placement="bottomRight"
        >
          <Button type="text" icon={<UserOutlined />} style={{ color: 'rgba(255,255,255,0.65)' }}>
            管理员
          </Button>
        </Dropdown>
      </Header>
      <Content style={{ background: '#f5f5f5' }}>
        <Outlet />
      </Content>

      {/* 修改密码弹窗 */}
      <Modal
        title="修改密码"
        open={pwdOpen}
        onOk={handleChangePassword}
        onCancel={() => { setPwdOpen(false); form.resetFields(); }}
        confirmLoading={pwdLoading}
        okText="确认修改"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="oldPassword"
            label="当前密码"
            rules={[{ required: true, message: '请输入当前密码' }]}
          >
            <Input.Password placeholder="请输入当前密码" />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, message: '密码长度至少 6 位' },
            ]}
          >
            <Input.Password placeholder="请输入新密码" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="确认新密码"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="请再次输入新密码" />
          </Form.Item>
        </Form>
      </Modal>
    </AntLayout>
  );
}
