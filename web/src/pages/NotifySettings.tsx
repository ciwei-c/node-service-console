import { useState, useEffect, useCallback } from 'react';
import {
  Card, Switch, Button, Form, Input, Select, Table, Space, Modal,
  message, Typography, Tag, Popconfirm, Divider, Checkbox, Tooltip,
} from 'antd';
import {
  BellOutlined, PlusOutlined, DeleteOutlined, ExperimentOutlined,
  CheckCircleOutlined, CloseCircleOutlined,
} from '@ant-design/icons';
import {
  fetchNotifyConfig, updateNotifyConfig, testNotifyChannel,
  type NotifyConfig, type NotifyChannel,
} from '../api';

const { Title, Text } = Typography;

const defaultConfig: NotifyConfig = {
  enabled: false,
  channels: [],
  events: { containerCrash: true, publishFail: true, publishSuccess: false },
};

export default function NotifySettings() {
  const [config, setConfig] = useState<NotifyConfig>(defaultConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [testingIdx, setTestingIdx] = useState<number | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    try {
      const data = await fetchNotifyConfig();
      setConfig(data);
    } catch (err: any) {
      message.error(`获取通知配置失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (newConfig: NotifyConfig) => {
    setSaving(true);
    try {
      await updateNotifyConfig(newConfig);
      setConfig(newConfig);
      message.success('通知配置已保存');
    } catch (err: any) {
      message.error(`保存失败: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = (checked: boolean) => {
    const next = { ...config, enabled: checked };
    handleSave(next);
  };

  const handleEventChange = (key: keyof NotifyConfig['events'], checked: boolean) => {
    const next = { ...config, events: { ...config.events, [key]: checked } };
    handleSave(next);
  };

  const openAddModal = () => {
    setEditingIndex(null);
    form.resetFields();
    form.setFieldsValue({ type: 'webhook', enabled: true });
    setModalOpen(true);
  };

  const openEditModal = (index: number) => {
    setEditingIndex(index);
    form.resetFields();
    form.setFieldsValue(config.channels[index]);
    setModalOpen(true);
  };

  const handleModalOk = async () => {
    try {
      const values = await form.validateFields();
      const channels = [...config.channels];
      if (editingIndex !== null) {
        channels[editingIndex] = values;
      } else {
        channels.push(values);
      }
      const next = { ...config, channels };
      await handleSave(next);
      setModalOpen(false);
    } catch { /* validation error */ }
  };

  const handleDelete = async (index: number) => {
    const channels = config.channels.filter((_, i) => i !== index);
    await handleSave({ ...config, channels });
  };

  const handleToggleChannel = async (index: number, enabled: boolean) => {
    const channels = [...config.channels];
    channels[index] = { ...channels[index], enabled };
    await handleSave({ ...config, channels });
  };

  const handleTest = async (index: number) => {
    const channel = config.channels[index];
    setTestingIdx(index);
    try {
      const result = await testNotifyChannel(channel);
      if (result.ok) {
        message.success(`测试通知已发送到「${channel.name}」`);
      } else {
        message.error(`发送失败: ${result.error || '未知错误'}`);
      }
    } catch (err: any) {
      message.error(`测试失败: ${err.message}`);
    } finally {
      setTestingIdx(null);
    }
  };

  const channelTypeLabel = (type: string) => {
    if (type === 'webhook') return <Tag color="blue">Webhook</Tag>;
    if (type === 'telegram') return <Tag color="cyan">Telegram</Tag>;
    return <Tag>{type}</Tag>;
  };

  const columns = [
    {
      title: '渠道名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, _: NotifyChannel, index: number) => (
        <Button type="link" onClick={() => openEditModal(index)} style={{ padding: 0 }}>
          {name}
        </Button>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 120,
      render: channelTypeLabel,
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 80,
      render: (enabled: boolean, _: NotifyChannel, index: number) => (
        <Switch checked={enabled} size="small" onChange={(v) => handleToggleChannel(index, v)} />
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_: any, __: NotifyChannel, index: number) => (
        <Space>
          <Tooltip title="发送测试通知">
            <Button
              type="link"
              icon={<ExperimentOutlined />}
              loading={testingIdx === index}
              onClick={() => handleTest(index)}
              size="small"
            >
              测试
            </Button>
          </Tooltip>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(index)}>
            <Button type="link" danger icon={<DeleteOutlined />} size="small" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const channelType = Form.useWatch('type', form);

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          <BellOutlined style={{ marginRight: 8 }} />
          通知告警
        </Title>
        <Space>
          <Text type="secondary">全局开关</Text>
          <Switch
            checked={config.enabled}
            onChange={handleToggleEnabled}
            loading={saving}
            checkedChildren="开"
            unCheckedChildren="关"
          />
        </Space>
      </div>

      {/* 事件配置 */}
      <Card size="small" title="告警事件" style={{ marginBottom: 16 }} loading={loading}>
        <Space direction="vertical">
          <Checkbox
            checked={config.events.containerCrash}
            onChange={(e) => handleEventChange('containerCrash', e.target.checked)}
          >
            <Text>容器崩溃</Text>
            <Text type="secondary" style={{ marginLeft: 8 }}>
              — 当运行中的容器异常停止时发送告警
            </Text>
          </Checkbox>
          <Checkbox
            checked={config.events.publishFail}
            onChange={(e) => handleEventChange('publishFail', e.target.checked)}
          >
            <Text>发布失败</Text>
            <Text type="secondary" style={{ marginLeft: 8 }}>
              — 服务发布/构建失败时发送告警
            </Text>
          </Checkbox>
          <Checkbox
            checked={config.events.publishSuccess}
            onChange={(e) => handleEventChange('publishSuccess', e.target.checked)}
          >
            <Text>发布成功</Text>
            <Text type="secondary" style={{ marginLeft: 8 }}>
              — 服务发布成功时发送通知
            </Text>
          </Checkbox>
        </Space>
      </Card>

      {/* 渠道列表 */}
      <Card
        size="small"
        title="通知渠道"
        loading={loading}
        extra={
          <Button type="primary" icon={<PlusOutlined />} size="small" onClick={openAddModal}>
            添加渠道
          </Button>
        }
      >
        {config.channels.length > 0 ? (
          <Table
            dataSource={config.channels}
            columns={columns}
            rowKey={(_, i) => String(i)}
            size="small"
            pagination={false}
          />
        ) : (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <Text type="secondary">暂无通知渠道，点击上方按钮添加</Text>
          </div>
        )}
      </Card>

      {/* 状态提示 */}
      {!loading && (
        <div style={{ marginTop: 12 }}>
          {config.enabled && config.channels.filter((c) => c.enabled).length > 0 ? (
            <Text type="success">
              <CheckCircleOutlined style={{ marginRight: 4 }} />
              告警已启用，{config.channels.filter((c) => c.enabled).length} 个渠道活跃
            </Text>
          ) : (
            <Text type="secondary">
              <CloseCircleOutlined style={{ marginRight: 4 }} />
              {!config.enabled ? '告警全局开关未开启' : '暂无启用的通知渠道'}
            </Text>
          )}
        </div>
      )}

      {/* 添加/编辑渠道弹窗 */}
      <Modal
        title={editingIndex !== null ? '编辑通知渠道' : '添加通知渠道'}
        open={modalOpen}
        onOk={handleModalOk}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="渠道名称" rules={[{ required: true, message: '请输入渠道名称' }]}>
            <Input placeholder="例如：运维群通知" />
          </Form.Item>
          <Form.Item name="type" label="渠道类型" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'webhook', label: 'Webhook（通用）' },
                { value: 'telegram', label: 'Telegram Bot' },
              ]}
            />
          </Form.Item>
          <Form.Item name="enabled" valuePropName="checked" initialValue={true}>
            <Checkbox>启用该渠道</Checkbox>
          </Form.Item>

          <Divider style={{ margin: '12px 0' }} />

          {channelType === 'webhook' && (
            <Form.Item
              name="webhookUrl"
              label="Webhook URL"
              rules={[{ required: true, message: '请输入 Webhook URL' }]}
              extra="支持企业微信、飞书、Slack、自定义 HTTP 端点等"
            >
              <Input placeholder="https://example.com/webhook" />
            </Form.Item>
          )}

          {channelType === 'telegram' && (
            <>
              <Form.Item
                name="telegramBotToken"
                label="Bot Token"
                rules={[{ required: true, message: '请输入 Bot Token' }]}
                extra="通过 @BotFather 创建 Bot 获取"
              >
                <Input.Password placeholder="123456:ABC-DEF..." />
              </Form.Item>
              <Form.Item
                name="telegramChatId"
                label="Chat ID"
                rules={[{ required: true, message: '请输入 Chat ID' }]}
                extra="个人/群组/频道的 Chat ID，可通过 @userinfobot 获取"
              >
                <Input placeholder="-1001234567890" />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </div>
  );
}
