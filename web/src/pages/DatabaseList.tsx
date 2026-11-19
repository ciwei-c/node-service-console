import { useCallback, useEffect, useState } from 'react';
import {
  Typography, Table, Tag, Button, Space, Modal, Form, Input, InputNumber,
  message, Descriptions, Drawer, Tabs, Alert, Card, Row, Col, Statistic,
  Empty, Tooltip, Checkbox, Divider,
} from 'antd';
import {
  ReloadOutlined, DatabaseOutlined, PlusOutlined, PlayCircleOutlined,
  PauseCircleOutlined, SyncOutlined, EyeOutlined, DeleteOutlined,
  CopyOutlined, CloudServerOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  fetchDatabases, fetchDatabase, createDatabase, deleteDatabase,
  startDatabase, stopDatabase, restartDatabase, fetchDatabaseLogs, fetchDatabaseStats,
} from '../api';
import type { DatabaseCreatePayload, DatabaseInstance } from '../types';

const { Title, Text, Paragraph } = Typography;

const statusMap: Record<DatabaseInstance['status'], { label: string; color: string }> = {
  running: { label: '运行中', color: 'green' },
  stopped: { label: '已停止', color: 'default' },
  restarting: { label: '重启中', color: 'blue' },
  missing: { label: '容器不存在', color: 'red' },
  unknown: { label: '未知', color: 'orange' },
};

function formatTime(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  return isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
}

export default function DatabaseList() {
  const [items, setItems] = useState<DatabaseInstance[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();

  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<DatabaseInstance | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState('info');
  const [logs, setLogs] = useState('');
  const [stats, setStats] = useState<{ cpu: string; mem: string } | null>(null);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DatabaseInstance | null>(null);
  const [deleteName, setDeleteName] = useState('');
  const [removeVolume, setRemoveVolume] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchDatabases());
    } catch (err: any) {
      message.error(err?.message || '获取数据库列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (item: DatabaseInstance, tab = 'info') => {
    setDetailOpen(true);
    setDetail(item);
    setDetailLoading(true);
    setDetailTab(tab);
    setLogs('');
    setStats(null);
    setReveal({});
    try {
      const [fresh, logText, stat] = await Promise.all([
        fetchDatabase(item.id),
        fetchDatabaseLogs(item.id, 200).catch(() => ''),
        fetchDatabaseStats(item.id).catch(() => null),
      ]);
      setDetail(fresh);
      setLogs(logText);
      setStats(stat);
    } catch (err: any) {
      message.error(err?.message || '获取数据库详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const runAction = async (
    item: DatabaseInstance,
    action: (id: string) => Promise<{ ok: true }>,
    label: string,
  ) => {
    try {
      await action(item.id);
      message.success(`${label}成功`);
      await load();
    } catch (err: any) {
      message.error(err?.message || `${label}失败`);
    }
  };

  const handleCreate = async () => {
    let values: DatabaseCreatePayload;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setCreating(true);
    try {
      const created = await createDatabase(values);
      message.success('数据库实例创建成功，请保存好账号密码');
      setCreateOpen(false);
      form.resetFields();
      await load();
      setDetail(created);
      setDetailTab('info');
      setDetailOpen(true);
      setLogs('');
      setStats(null);
      setReveal({});
      fetchDatabaseLogs(created.id, 200).catch(() => '').then(setLogs);
      fetchDatabaseStats(created.id).catch(() => null).then(setStats);
    } catch (err: any) {
      message.error(err?.message || '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const openDelete = (item: DatabaseInstance) => {
    setDeleteTarget(item);
    setDeleteName('');
    setRemoveVolume(false);
    setDeleteOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDatabase(deleteTarget.id, deleteName, removeVolume);
      message.success('数据库实例已删除');
      setDeleteOpen(false);
      setDeleteTarget(null);
      setDeleteName('');
      setRemoveVolume(false);
      if (detail?.id === deleteTarget.id) setDetailOpen(false);
      await load();
    } catch (err: any) {
      message.error(err?.message || '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const copyText = async (text?: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      message.success('已复制');
    } catch {
      message.error('复制失败，请手动选择');
    }
  };

  const copyEnv = async () => {
    if (!detail) return;
    const env = [
      'MYSQL_ADDRESS=172.17.0.1',
      `MYSQL_PORT=${detail.hostPort || 3306}`,
      `MYSQL_DATABASE=${detail.databaseName || '<数据库名>'}`,
      `MYSQL_USERNAME=${detail.username || '<账号>'}`,
      `MYSQL_PASSWORD=${detail.password || '<密码>'}`,
    ].join('\n');
    await copyText(env);
  };

  const renderSecret = (value: string | undefined, key: string) => {
    if (!value) return <Text type="secondary">未纳管</Text>;
    const shown = !!reveal[key];
    return (
      <Space size={4}>
        <Text code>{shown ? value : '••••••••'}</Text>
        <Button size="small" type="link" onClick={() => setReveal((prev) => ({ ...prev, [key]: !prev[key] }))}>
          {shown ? '隐藏' : '显示'}
        </Button>
        <Button size="small" type="link" icon={<CopyOutlined />} onClick={() => copyText(value)}>
          复制
        </Button>
      </Space>
    );
  };

  const columns: ColumnsType<DatabaseInstance> = [
    {
      title: '实例',
      dataIndex: 'name',
      width: 240,
      render: (_: unknown, record) => (
        <Space>
          <DatabaseOutlined />
          <Text strong>{record.name}</Text>
          {record.managed ? <Tag color="blue">托管</Tag> : <Tag>外部</Tag>}
        </Space>
      ),
    },
    { title: '镜像', dataIndex: 'image', width: 170, ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 160,
      render: (_: unknown, record) => {
        const info = statusMap[record.status] || statusMap.unknown;
        return (
          <Space size={4}>
            <Tag color={info.color}>{info.label}</Tag>
            {record.health && <Text type="secondary" style={{ fontSize: 12 }}>{record.health}</Text>}
          </Space>
        );
      },
    },
    {
      title: '端口',
      dataIndex: 'hostPort',
      width: 130,
      render: (value: number | undefined, record) => (
        value ? <Text code>{value} → {record.containerPort}</Text> : <Text type="secondary">-</Text>
      ),
    },
    {
      title: '数据库',
      dataIndex: 'databaseName',
      width: 150,
      render: (value?: string) => value || <Text type="secondary">-</Text>,
    },
    {
      title: '数据卷',
      dataIndex: 'volumeName',
      ellipsis: true,
      render: (value?: string) => value || <Text type="secondary">-</Text>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (value?: string) => <Text type="secondary" style={{ fontSize: 12 }}>{formatTime(value)}</Text>,
    },
    {
      title: '操作',
      width: 190,
      fixed: 'right',
      render: (_: unknown, record) => (
        <Space size={0}>
          {record.status === 'running' ? (
            <Tooltip title="停止">
              <Button size="small" type="text" icon={<PauseCircleOutlined />}
                onClick={() => runAction(record, stopDatabase, '停止')} />
            </Tooltip>
          ) : (
            <Tooltip title="启动">
              <Button size="small" type="text" icon={<PlayCircleOutlined />}
                disabled={record.status === 'missing'}
                onClick={() => runAction(record, startDatabase, '启动')} />
            </Tooltip>
          )}
          <Tooltip title="重启">
            <Button size="small" type="text" icon={<SyncOutlined />}
              disabled={record.status === 'missing'}
              onClick={() => runAction(record, restartDatabase, '重启')} />
          </Tooltip>
          <Tooltip title="详情 / 日志">
            <Button size="small" type="text" icon={<EyeOutlined />} onClick={() => openDetail(record)} />
          </Tooltip>
          {record.managed && (
            <Tooltip title="删除">
              <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => openDelete(record)} />
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  const running = items.filter((item) => item.status === 'running').length;
  const managed = items.filter((item) => item.managed).length;
  const external = items.filter((item) => item.external).length;

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            <DatabaseOutlined style={{ marginRight: 8 }} />
            数据库
          </Title>
          <Text type="secondary">管理 MySQL 容器和数据库连接信息</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新建数据库实例
          </Button>
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small"><Statistic title="实例总数" value={items.length} prefix={<DatabaseOutlined />} /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small"><Statistic title="运行中" value={running} valueStyle={{ color: '#3f8600' }} /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small"><Statistic title="托管实例" value={managed} prefix={<CloudServerOutlined />} /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small"><Statistic title="外部实例" value={external} /></Card>
        </Col>
      </Row>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="托管实例由控制台创建和管理；外部实例（如 duidui-mysql）只提供启停、重启和日志，不允许删除。"
      />

      {!loading && items.length === 0 ? (
        <Empty description="暂无数据库实例" style={{ marginTop: 80 }} />
      ) : (
        <Table
          rowKey="id"
          columns={columns}
          dataSource={items}
          loading={loading}
          pagination={false}
          size="middle"
          scroll={{ x: 1200 }}
        />
      )}

      {/* 新建实例 */}
      <Modal
        title="新建数据库实例"
        open={createOpen}
        onCancel={() => { setCreateOpen(false); form.resetFields(); }}
        onOk={handleCreate}
        confirmLoading={creating}
        okText="创建"
        cancelText="取消"
        width={680}
        destroyOnClose
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="创建后会立即启动 MySQL 容器，请保存好 root 密码和应用密码。"
        />
        <Form
          form={form}
          layout="vertical"
          initialValues={{ image: 'mysql:8.0', databaseName: 'app', username: 'app' }}
        >
          <Form.Item
            name="name"
            label="实例名称"
            rules={[
              { required: true, message: '请输入实例名称' },
              { pattern: /^[a-z0-9][a-z0-9-]{1,30}$/, message: '只能包含小写字母、数字和连字符，2-31 位' },
            ]}
          >
            <Input placeholder="例如 shared-mysql、duidui-db" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="image" label="镜像" rules={[{ required: true, message: '请输入镜像' }]}>
                <Input placeholder="mysql:8.0" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="hostPort" label="宿主机端口（留空自动分配）">
                <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder="3306-3399" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="databaseName" label="初始数据库">
                <Input placeholder="app" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="username" label="应用账号">
                <Input placeholder="app" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="rootPassword" label="root 密码（留空自动生成）">
                <Input.Password placeholder="留空自动生成强密码" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="password" label="应用密码（留空自动生成）">
                <Input.Password placeholder="留空自动生成强密码" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="volumeName" label="数据卷（留空自动生成）">
                <Input placeholder="nsc-mysql-<name>-data" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="memoryLimitMB" label="内存限制 MB（可选）">
                <InputNumber min={128} max={8192} style={{ width: '100%' }} placeholder="例如 256" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 详情 */}
      <Drawer
        title={detail ? `数据库实例 — ${detail.name}` : '数据库实例'}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={760}
        loading={detailLoading}
      >
        {detail && (
          <>
            {detail.external && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                message="这是外部容器（例如由 compose 管理），控制台只提供启停、重启和日志，不允许删除；账号密码未纳管，请手动填写。"
              />
            )}
            <Tabs
              activeKey={detailTab}
              onChange={setDetailTab}
              items={[
                {
                  key: 'info',
                  label: '基本信息',
                  children: (
                    <>
                      <Descriptions bordered size="small" column={2}>
                        <Descriptions.Item label="实例名">{detail.name}</Descriptions.Item>
                        <Descriptions.Item label="类型">
                          {detail.managed ? <Tag color="blue">托管</Tag> : <Tag>外部</Tag>}
                        </Descriptions.Item>
                        <Descriptions.Item label="容器名">{detail.containerName}</Descriptions.Item>
                        <Descriptions.Item label="镜像">{detail.image}</Descriptions.Item>
                        <Descriptions.Item label="状态">
                          <Tag color={(statusMap[detail.status] || statusMap.unknown).color}>
                            {(statusMap[detail.status] || statusMap.unknown).label}
                          </Tag>
                          {detail.health && <Text type="secondary" style={{ marginLeft: 8 }}>{detail.health}</Text>}
                        </Descriptions.Item>
                        <Descriptions.Item label="端口">
                          {detail.hostPort ? <Text code>{detail.hostPort} → {detail.containerPort}</Text> : '-'}
                        </Descriptions.Item>
                        <Descriptions.Item label="数据卷">{detail.volumeName || '-'}</Descriptions.Item>
                        <Descriptions.Item label="数据库">{detail.databaseName || '未纳管'}</Descriptions.Item>
                        <Descriptions.Item label="应用账号">{detail.username || '未纳管'}</Descriptions.Item>
                        <Descriptions.Item label="创建时间">{formatTime(detail.createdAt)}</Descriptions.Item>
                        <Descriptions.Item label="root 密码" span={2}>
                          {renderSecret(detail.rootPassword, 'rootPassword')}
                        </Descriptions.Item>
                        <Descriptions.Item label="应用密码" span={2}>
                          {renderSecret(detail.password, 'password')}
                        </Descriptions.Item>
                        {detail.note && (
                          <Descriptions.Item label="备注" span={2}>{detail.note}</Descriptions.Item>
                        )}
                      </Descriptions>

                      <Divider />
                      <Title level={5}>连接配置</Title>
                      <Paragraph type="secondary">
                        应用容器（默认 bridge）通过宿主机网关访问；下面的配置可直接复制到「服务管理」的环境变量。
                      </Paragraph>
                      <Descriptions bordered size="small" column={1}>
                        <Descriptions.Item label="宿主机地址">
                          <Text code copyable>127.0.0.1:{detail.hostPort || 3306}</Text>
                        </Descriptions.Item>
                        <Descriptions.Item label="容器网络地址">
                          <Text code copyable>172.17.0.1:{detail.hostPort || 3306}</Text>
                        </Descriptions.Item>
                      </Descriptions>
                      <Button icon={<CopyOutlined />} onClick={copyEnv} style={{ marginTop: 12 }}>
                        复制 MYSQL_* 环境变量
                      </Button>

                      <Divider />
                      <Space wrap>
                        {detail.status === 'running' ? (
                          <Button icon={<PauseCircleOutlined />}
                            onClick={() => runAction(detail, stopDatabase, '停止')}>停止</Button>
                        ) : (
                          <Button icon={<PlayCircleOutlined />} disabled={detail.status === 'missing'}
                            onClick={() => runAction(detail, startDatabase, '启动')}>启动</Button>
                        )}
                        <Button icon={<SyncOutlined />} disabled={detail.status === 'missing'}
                          onClick={() => runAction(detail, restartDatabase, '重启')}>重启</Button>
                        {detail.managed && (
                          <Button danger icon={<DeleteOutlined />} onClick={() => openDelete(detail)}>删除</Button>
                        )}
                      </Space>
                    </>
                  ),
                },
                {
                  key: 'logs',
                  label: '容器日志',
                  children: (
                    <pre style={{
                      marginTop: 8, padding: 12, background: '#1e1e1e', color: '#d4d4d4',
                      borderRadius: 6, maxHeight: 520, overflow: 'auto', fontSize: 12,
                      fontFamily: 'Consolas, Monaco, monospace', whiteSpace: 'pre-wrap',
                    }}>
                      {logs || '暂无日志'}
                    </pre>
                  ),
                },
                {
                  key: 'stats',
                  label: '运行状态',
                  children: stats ? (
                    <Descriptions bordered size="small" column={2} style={{ marginTop: 8 }}>
                      <Descriptions.Item label="CPU">{stats.cpu}</Descriptions.Item>
                      <Descriptions.Item label="内存">{stats.mem}</Descriptions.Item>
                    </Descriptions>
                  ) : (
                    <Empty description="暂无统计数据" style={{ marginTop: 40 }} />
                  ),
                },
              ]}
            />
          </>
        )}
      </Drawer>

      {/* 删除 */}
      <Modal
        title="删除数据库实例"
        open={deleteOpen}
        onCancel={() => { setDeleteOpen(false); setDeleteTarget(null); }}
        onOk={handleDelete}
        confirmLoading={deleting}
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true, disabled: deleteName !== deleteTarget?.name }}
      >
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="删除容器不会自动删除数据卷；如果勾选删除数据卷，数据将不可恢复。"
        />
        <Paragraph>
          请输入实例名称 <Text code>{deleteTarget?.name}</Text> 以确认：
        </Paragraph>
        <Input
          value={deleteName}
          onChange={(e) => setDeleteName(e.target.value)}
          placeholder={deleteTarget?.name}
          style={{ marginBottom: 12 }}
        />
        <Checkbox checked={removeVolume} onChange={(e) => setRemoveVolume(e.target.checked)}>
          同时删除数据卷 <Text code>{deleteTarget?.volumeName}</Text>（不可恢复）
        </Checkbox>
      </Modal>
    </div>
  );
}
