import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Row, Col, Button, Modal, Input, Form, Tag, Empty, message, Typography, Space,
} from 'antd';
import {
  PlusOutlined, CloudServerOutlined, ClockCircleOutlined, TagOutlined,
} from '@ant-design/icons';
import { fetchServices, createService } from '../api';
import type { Service } from '../types';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const statusMap: Record<string, { color: string; label: string }> = {
  running: { color: 'green', label: '运行中' },
  idle:    { color: 'orange', label: '待部署' },
  stopped: { color: 'red', label: '已关闭' },
};

export default function ServiceList() {
  const nav = useNavigate();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      setServices(await fetchServices());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    try {
      const { name } = await form.validateFields();
      await createService(name.trim());
      message.success('服务创建成功');
      form.resetFields();
      setOpen(false);
      load();
    } catch {
      /* validation error */
    }
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>服务列表</Title>
          <Text type="secondary">管理你的所有应用服务</Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} size="large" onClick={() => setOpen(true)}>
          新建服务
        </Button>
      </div>

      {!loading && services.length === 0 && (
        <Empty description="暂无服务，点击右上角新建" style={{ marginTop: 80 }} />
      )}

      <Row gutter={[20, 20]}>
        {services.map((svc) => {
          const st = statusMap[svc.status] ?? statusMap.idle;
          return (
            <Col xs={24} sm={12} md={8} lg={6} key={svc.id}>
              <Card
                hoverable
                onClick={() => nav(`/${encodeURIComponent(svc.name)}`)}
                styles={{ body: { padding: 20 } }}
              >
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text strong style={{ fontSize: 16 }}>{svc.name}</Text>
                    <Tag color={st.color}>{st.label}</Tag>
                  </div>
                  <Space size={4}>
                    <TagOutlined style={{ color: '#8c8c8c' }} />
                    <Text type="secondary">{svc.currentVersion || '尚未发布'}</Text>
                  </Space>
                  <Space size={4}>
                    <CloudServerOutlined style={{ color: '#8c8c8c' }} />
                    <Text type="secondary">{svc.pipeline?.codeSource ?? 'github'}</Text>
                  </Space>
                  <Space size={4}>
                    <ClockCircleOutlined style={{ color: '#8c8c8c' }} />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {dayjs(svc.updatedAt).format('YYYY-MM-DD HH:mm')}
                    </Text>
                  </Space>
                </Space>
              </Card>
            </Col>
          );
        })}
      </Row>

      <Modal
        title="新建服务"
        open={open}
        onOk={handleCreate}
        onCancel={() => { setOpen(false); form.resetFields(); }}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="服务名称" rules={[{ required: true, message: '请输入服务名称' }]}>
            <Input placeholder="例如: order-api" autoFocus />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
