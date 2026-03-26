import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, message, Typography } from 'antd';
import { LockOutlined, RocketOutlined } from '@ant-design/icons';
import { login } from '../api';

const { Title, Text } = Typography;

const css = `
@keyframes login-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}
@keyframes login-fade-up {
  from { opacity: 0; transform: translateY(24px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes login-shimmer {
  0%   { background-position: -200% center; }
  100% { background-position: 200% center; }
}
.login-bg {
  min-height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
  overflow: hidden;
  background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%);
}
.login-bg::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 600px 600px at 20% 30%, rgba(99,102,241,0.15), transparent),
    radial-gradient(ellipse 500px 500px at 80% 70%, rgba(139,92,246,0.12), transparent);
  pointer-events: none;
}
.login-card {
  position: relative;
  width: 400px;
  padding: 48px 36px 40px;
  border-radius: 20px;
  background: rgba(255,255,255,0.06);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255,255,255,0.1);
  box-shadow: 0 24px 48px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05) inset;
  animation: login-fade-up 0.6s ease-out;
}
.login-icon-wrap {
  width: 72px; height: 72px;
  margin: 0 auto 20px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 8px 24px rgba(99,102,241,0.35);
  animation: login-float 3s ease-in-out infinite;
}
.login-card .ant-input-affix-wrapper {
  background: rgba(255,255,255,0.08) !important;
  border: 1px solid rgba(255,255,255,0.15) !important;
  border-radius: 10px !important;
  height: 48px;
  color: #fff !important;
  transition: border-color 0.3s, box-shadow 0.3s;
}
.login-card .ant-input-affix-wrapper:hover,
.login-card .ant-input-affix-wrapper-focused {
  border-color: rgba(99,102,241,0.6) !important;
  box-shadow: 0 0 0 2px rgba(99,102,241,0.15) !important;
}
.login-card .ant-input-affix-wrapper .ant-input {
  background: transparent !important;
  color: #fff !important;
}
.login-card .ant-input-affix-wrapper .ant-input::placeholder {
  color: rgba(255,255,255,0.4) !important;
}
.login-card .ant-input-affix-wrapper .anticon {
  color: rgba(255,255,255,0.45) !important;
}
.login-card .ant-input-affix-wrapper .ant-input-suffix .anticon {
  color: rgba(255,255,255,0.35) !important;
}
.login-btn {
  height: 48px !important;
  border-radius: 10px !important;
  font-size: 16px !important;
  font-weight: 600 !important;
  border: none !important;
  background: linear-gradient(135deg, #6366f1, #8b5cf6) !important;
  box-shadow: 0 4px 16px rgba(99,102,241,0.4) !important;
  transition: transform 0.2s, box-shadow 0.2s !important;
}
.login-btn:hover {
  transform: translateY(-1px) !important;
  box-shadow: 0 6px 24px rgba(99,102,241,0.5) !important;
}
.login-btn:active {
  transform: translateY(0) !important;
}
.login-title {
  background: linear-gradient(90deg, #e0e7ff, #c4b5fd, #e0e7ff);
  background-size: 200% auto;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: login-shimmer 4s linear infinite;
}
`;

export default function Login() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(false);

  /* 注入样式 */
  useEffect(() => {
    const id = '__login_style';
    if (!document.getElementById(id)) {
      const style = document.createElement('style');
      style.id = id;
      style.textContent = css;
      document.head.appendChild(style);
    }
    return () => { document.getElementById(id)?.remove(); };
  }, []);

  const handleLogin = async (values: { password: string }) => {
    setLoading(true);
    try {
      await login(values.password);
      message.success('登录成功');
      nav('/', { replace: true });
    } catch (err: any) {
      message.error(err.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-bg">
      <div className="login-card">
        {/* Icon */}
        <div className="login-icon-wrap">
          <RocketOutlined style={{ fontSize: 32, color: '#fff' }} />
        </div>

        {/* 标题 */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <Title level={3} className="login-title" style={{ margin: '0 0 6px' }}>
            服务管理控制台
          </Title>
          <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14 }}>
            请输入管理员密码以继续
          </Text>
        </div>

        {/* 表单 */}
        <Form onFinish={handleLogin}>
          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="管理员密码"
              autoFocus
            />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
            <Button
              className="login-btn"
              type="primary"
              htmlType="submit"
              block
              loading={loading}
            >
              登 录
            </Button>
          </Form.Item>
        </Form>

        {/* 底部 */}
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>
            Node Service Console
          </Text>
          <div style={{ marginTop: 8 }}>
            <a
              href="https://beian.miit.gov.cn/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12 }}
            >
              闽ICP备2024076169号-2
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
