import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Typography, Button, Tag, Tabs, Table, Space, Modal, Form, Input, Select,
  InputNumber, message, Popconfirm, Descriptions, Card, Alert, Switch, Drawer,
} from 'antd';
import {
  ArrowLeftOutlined, RocketOutlined, RollbackOutlined,
  PlusOutlined, DeleteOutlined, PlayCircleOutlined,
  PauseCircleOutlined, EyeOutlined, SaveOutlined,
  LoadingOutlined, CheckCircleOutlined, CloseCircleOutlined,
} from '@ant-design/icons';
import {
  fetchServiceByName, publishService, rollbackService, deleteDeployment,
  stopService, startService, updateEnvVars, updatePipeline, deleteService,
  fetchPublishStatus,
} from '../api';
import type { Service, Deployment, EnvVar, Pipeline } from '../types';
import type { PublishStatus } from '../api';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const statusMap: Record<string, { color: string; label: string }> = {
  running: { color: 'green', label: '运行中' },
  idle:    { color: 'orange', label: '待部署' },
  stopped: { color: 'red', label: '已关闭' },
};

export default function ServiceDetail() {
  const { serviceName } = useParams<{ serviceName: string }>();
  const nav = useNavigate();
  const [svc, setSvc] = useState<Service | null>(null);

  /* modals */
  const [rbOpen, setRbOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedDep, setSelectedDep] = useState<Deployment | null>(null);

  /* forms */
  const [rbForm] = Form.useForm();
  const [pipeForm] = Form.useForm();

  /* env vars local state */
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [envJsonMode, setEnvJsonMode] = useState(false);
  const [envJsonText, setEnvJsonText] = useState('');
  const [envJsonError, setEnvJsonError] = useState('');

  /* publish log modal state */
  const [publishLogOpen, setPublishLogOpen] = useState(false);
  const [publishStatus, setPublishStatus] = useState<PublishStatus | null>(null);
  const [publishing, setPublishing] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!serviceName) return;
    const data = await fetchServiceByName(decodeURIComponent(serviceName));
    setSvc(data);
    setEnvVars(data.envVars ?? []);
    pipeForm.setFieldsValue(data.pipeline ?? {});
  }, [serviceName, pipeForm]);

  useEffect(() => { load(); }, [load]);

  /* ── hooks that must be before early return ── */

  const stopPollPublish = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPollPublish(), [stopPollPublish]);

  const startPollPublish = useCallback((serviceId: string) => {
    pollTimerRef.current = setInterval(async () => {
      try {
        const status = await fetchPublishStatus(serviceId);
        if (status) {
          setPublishStatus(status);
          setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
          if (status.status !== 'publishing') {
            stopPollPublish();
            setPublishing(false);
            if (status.status === 'success') {
              message.success('发布成功');
            } else {
              message.error('发布失败');
            }
            load();
          }
        }
      } catch {
        // ignore
      }
    }, 1500);
  }, [stopPollPublish, load]);

  if (!svc) return null;

  const st = statusMap[svc.status] ?? statusMap.idle;

  /* ── deploy actions ── */

  const handlePublish = async () => {
    try {
      setPublishing(true);
      setPublishStatus(null);
      setPublishLogOpen(true);
      await publishService(svc.id);
      startPollPublish(svc.id);
    } catch (err: any) {
      setPublishing(false);
      if (err.message?.includes('正在发布中')) {
        setPublishing(true);
        startPollPublish(svc.id);
      } else {
        message.error(err.message || '发布失败');
        setPublishLogOpen(false);
      }
    }
  };

  const handleRollback = async () => {
    const vals = await rbForm.validateFields();
    try {
      await rollbackService(svc.id, vals);
      message.success('回退成功');
      rbForm.resetFields();
      setRbOpen(false);
    } catch (err: any) {
      Modal.error({
        title: '回退失败',
        content: (
          <div>
            <p>{err.message}</p>
            <Alert type="error" message="执行日志" description={
              <pre style={{ maxHeight: 300, overflow: 'auto', fontSize: 12 }}>
                {err.logs?.join('\n') || '无日志'}
              </pre>
            } />
          </div>
        ),
        width: 600,
      });
    }
    load();
  };

  const handleDeleteDep = async (depId: string) => {
    await deleteDeployment(svc.id, depId);
    message.success('已删除');
    load();
  };

  const handleToggle = async () => {
    if (svc.status !== 'stopped') {
      await stopService(svc.id);
      message.success('服务已关闭');
    } else {
      await startService(svc.id);
      message.success('服务已启动');
    }
    load();
  };

  /* ── env vars ── */

  const switchToJsonMode = () => {
    const obj: Record<string, string> = {};
    envVars.filter((v) => v.key.trim()).forEach((v) => { obj[v.key] = v.value; });
    setEnvJsonText(JSON.stringify(obj, null, 2));
    setEnvJsonError('');
    setEnvJsonMode(true);
  };

  const switchToKvMode = () => {
    try {
      const obj = JSON.parse(envJsonText);
      if (typeof obj !== 'object' || Array.isArray(obj)) {
        message.error('JSON 必须是对象格式，例如 { "KEY": "VALUE" }');
        return;
      }
      const newVars: EnvVar[] = Object.entries(obj).map(([key, value]) => ({
        key,
        value: String(value),
      }));
      setEnvVars(newVars);
      setEnvJsonMode(false);
    } catch {
      message.error('JSON 格式错误，请修正后再切换');
    }
  };

  const handleEnvModeSwitch = (jsonMode: boolean) => {
    if (jsonMode) {
      switchToJsonMode();
    } else {
      switchToKvMode();
    }
  };

  const handleSaveEnv = async () => {
    let vars = envVars;
    if (envJsonMode) {
      try {
        const obj = JSON.parse(envJsonText);
        if (typeof obj !== 'object' || Array.isArray(obj)) {
          message.error('JSON 必须是对象格式');
          return;
        }
        vars = Object.entries(obj).map(([key, value]) => ({ key, value: String(value) }));
      } catch {
        message.error('JSON 格式错误，无法保存');
        return;
      }
    }
    const filtered = vars.filter((v) => v.key.trim());
    await updateEnvVars(svc.id, filtered);
    message.success('环境变量已保存');
    load();
  };

  /* ── pipeline ── */

  const handleSavePipeline = async () => {
    const vals = await pipeForm.validateFields() as Pipeline;
    await updatePipeline(svc.id, vals);
    message.success('流水线配置已保存');
    load();
  };

  /* ── unique versions for rollback ── */
  const versions = [...new Set(svc.deployments.map((d) => d.version))];

  /* ── table columns ── */
  const columns = [
    {
      title: '动作', dataIndex: 'action', width: 80,
      render: (v: string) => v === 'publish'
        ? <Tag color="blue">发布</Tag>
        : <Tag color="gold">回退</Tag>,
    },
    { title: '版本', dataIndex: 'version', width: 120 },
    { title: '操作人', dataIndex: 'operator', width: 100 },
    { title: '备注', dataIndex: 'note', ellipsis: true },
    {
      title: '发布时间', dataIndex: 'publishedAt', width: 180,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '操作', width: 140,
      render: (_: unknown, rec: Deployment) => {
        const isCurrentVersion = rec.version === svc.currentVersion;
        return (
          <Space>
            <Button
              type="link"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => { setSelectedDep(rec); setDetailOpen(true); }}
            >
              详情
            </Button>
            {isCurrentVersion ? (
              <Button type="link" size="small" disabled>当前版本</Button>
            ) : (
              <Popconfirm title="确定删除该记录？" onConfirm={() => handleDeleteDep(rec.id)}>
                <Button type="link" danger size="small" icon={<DeleteOutlined />}>删除</Button>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  /* ── Tab: 部署发布 ── */
  const deployTab = (
    <div>
      <Space style={{ marginBottom: 20 }} wrap>
        <Popconfirm
          title="确认发布新版本？"
          description={<>
            <div>版本号将自动生成：<strong>{svc.name}-{(svc.deployments.filter((d: Deployment) => d.action === 'publish').length) + 1}</strong></div>
            <div style={{marginTop:4,color:'#8c8c8c',fontSize:12}}>流水线：{svc.pipeline?.codeSource} / {svc.pipeline?.repository || '-'} / {svc.pipeline?.branch}</div>
          </>}
          onConfirm={handlePublish}
          okText="确认发布"
          cancelText="取消"
        >
          <Button type="primary" icon={<RocketOutlined />} loading={publishing}>发布</Button>
        </Popconfirm>
        <Button icon={<RollbackOutlined />} onClick={() => setRbOpen(true)}>
          回退
        </Button>
        <Text type="secondary" style={{ marginLeft: 8 }}>
          当前版本：<Text strong>{svc.currentVersion || '尚未发布'}</Text>
        </Text>
        <Text type="secondary" style={{ marginLeft: 8 }}>
          访问路径：<Text code>{svc.pipeline?.accessPath || '/' + svc.name}</Text>
        </Text>
      </Space>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={svc.deployments}
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 个版本`,
          pageSizeOptions: [10, 20, 50],
        }}
        size="middle"
        locale={{ emptyText: '暂无部署记录' }}
      />
    </div>
  );

  /* ── Tab: 服务设置 ── */
  const settingsTab = (
    <div>
      {/* 环境变量 */}
      <Card
        title="基础信息 — 环境变量"
        size="small"
        style={{ marginBottom: 20 }}
        extra={
          <Space>
            <span style={{ fontSize: 12, color: '#8c8c8c' }}>键值对</span>
            <Switch
              checked={envJsonMode}
              onChange={handleEnvModeSwitch}
              checkedChildren="JSON"
              unCheckedChildren="KV"
              size="small"
            />
            <span style={{ fontSize: 12, color: '#8c8c8c' }}>JSON</span>
          </Space>
        }
      >
        {envJsonMode ? (
          <div>
            <Input.TextArea
              value={envJsonText}
              onChange={(e) => {
                setEnvJsonText(e.target.value);
                try {
                  JSON.parse(e.target.value);
                  setEnvJsonError('');
                } catch (err: any) {
                  setEnvJsonError(err.message);
                }
              }}
              rows={10}
              style={{ fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace", fontSize: 13 }}
              placeholder='{&#10;  "KEY": "VALUE",&#10;  "DB_HOST": "localhost"&#10;}'
            />
            {envJsonError && (
              <div style={{ color: '#ff4d4f', fontSize: 12, marginTop: 4 }}>
                JSON 语法错误：{envJsonError}
              </div>
            )}
          </div>
        ) : (
          <div>
            {envVars.map((v, i) => (
              <Space key={i} style={{ display: 'flex', marginBottom: 8 }} align="center">
                <Input
                  placeholder="KEY"
                  value={v.key}
                  style={{ width: 200 }}
                  onChange={(e) => {
                    const next = [...envVars];
                    next[i] = { ...next[i], key: e.target.value };
                    setEnvVars(next);
                  }}
                />
                <Input
                  placeholder="VALUE"
                  value={v.value}
                  style={{ width: 320 }}
                  onChange={(e) => {
                    const next = [...envVars];
                    next[i] = { ...next[i], value: e.target.value };
                    setEnvVars(next);
                  }}
                />
                <Button
                  danger
                  type="text"
                  icon={<DeleteOutlined />}
                  onClick={() => setEnvVars(envVars.filter((_, idx) => idx !== i))}
                />
              </Space>
            ))}
            <Button
              icon={<PlusOutlined />}
              onClick={() => setEnvVars([...envVars, { key: '', value: '' }])}
            >
              新增变量
            </Button>
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSaveEnv}>
            保存环境变量
          </Button>
        </div>
      </Card>

      {/* 流水线 */}
      <Card title="流水线配置" size="small">
        <Form form={pipeForm} layout="vertical" onFinish={handleSavePipeline}
          initialValues={{ codeSource: 'github', branch: 'main', targetDir: '/opt/app', port: 3000, dockerfile: 'Dockerfile', accessPath: '/' + svc.name, keepImageCount: 3, authMode: 'ssh', gitToken: '' }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
            <Form.Item name="codeSource" label="代码源" rules={[{ required: true }]}>
              <Select options={[
                { value: 'github', label: 'GitHub' },
                { value: 'gitlab', label: 'GitLab' },
              ]} />
            </Form.Item>
            <Form.Item name="authMode" label="克隆认证方式" tooltip="SSH Key：使用服务器 SSH 密钥克隆代码，永不过期。Git Token：使用个人访问令牌通过 HTTPS 克隆。">
              <Select options={[
                { value: 'ssh', label: 'SSH Key（推荐）' },
                { value: 'token', label: 'Git Token' },
              ]} />
            </Form.Item>
            <Form.Item name="repository" label="代码仓库" rules={[{ required: true, message: '请输入仓库地址' }]}>
              <Input placeholder="owner/repo-name" />
            </Form.Item>
            <Form.Item name="branch" label="分支" rules={[{ required: true, message: '请输入分支名' }]}>
              <Input placeholder="main" />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(prev, cur) => prev.authMode !== cur.authMode}>
              {({ getFieldValue }) => getFieldValue('authMode') === 'token' ? (
                <Form.Item name="gitToken" label="Git Token" tooltip="GitHub / GitLab 个人访问令牌，用于 HTTPS 克隆私有仓库">
                  <Input.Password placeholder="ghp_xxxx 或 glpat-xxxx" />
                </Form.Item>
              ) : null}
            </Form.Item>
            <Form.Item name="targetDir" label="目标目录">
              <Input placeholder="/opt/app" />
            </Form.Item>
            <Form.Item name="port" label="启动端口">
              <InputNumber placeholder="3000" style={{ width: '100%' }} min={1} max={65535} />
            </Form.Item>
            <Form.Item name="dockerfile" label="Dockerfile 名称">
              <Input placeholder="Dockerfile" />
            </Form.Item>
            <Form.Item name="accessPath" label="访问路径" tooltip="部署后的反向代理前缀，用于区分不同服务">
              <Input placeholder="/order-api" />
            </Form.Item>
            <Form.Item name="keepImageCount" label="保留镜像数" tooltip="发布时自动清理旧镜像，只保留最近 N 个版本的镜像">
              <InputNumber placeholder="3" style={{ width: '100%' }} min={1} max={100} />
            </Form.Item>
          </div>
          <Form.Item>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />}>
              保存流水线配置
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => nav('/')}>返回列表</Button>
        <Title level={4} style={{ margin: 0 }}>{svc.name}</Title>
        <Tag color={st.color}>{st.label}</Tag>
        <div style={{ flex: 1 }} />
        {svc.status !== 'stopped' ? (
          <Popconfirm
            title={`确定要关闭服务「${svc.name}」吗？`}
            description="关闭后该服务将停止运行。"
            onConfirm={handleToggle}
            okText="确定关闭"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button danger icon={<PauseCircleOutlined />}>关闭服务</Button>
          </Popconfirm>
        ) : (
          <Space>
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleToggle}>
              启动服务
            </Button>
            <Popconfirm
              title={`确定要删除服务「${svc.name}」吗？`}
              description="删除后数据将无法恢复。"
              onConfirm={async () => {
                await deleteService(svc.id);
                message.success('服务已删除');
                nav('/');
              }}
              okText="确定删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button danger icon={<DeleteOutlined />}>删除服务</Button>
            </Popconfirm>
          </Space>
        )}
      </div>

      <Tabs
        defaultActiveKey="deploy"
        items={[
          { key: 'deploy', label: '部署发布', children: deployTab },
          { key: 'settings', label: '服务设置', children: settingsTab },
        ]}
      />

      {/* ── 回退弹窗 ── */}
      <Modal title="回退版本" open={rbOpen} onOk={handleRollback}
        onCancel={() => { setRbOpen(false); rbForm.resetFields(); }}
        okText="回退" cancelText="取消"
      >
        <Form form={rbForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="targetVersion" label="选择历史版本" rules={[{ required: true, message: '请选择版本' }]}>
            <Select placeholder="请选择" options={versions.map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="operator" label="操作人">
            <Input placeholder="devops" />
          </Form.Item>
          <Form.Item name="note" label="说明">
            <Input placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── 部署详情弹窗 ── */}
      <Modal title="部署详情" open={detailOpen} footer={null}
        onCancel={() => setDetailOpen(false)}
      >
        {selectedDep && (
          <Descriptions column={1} bordered size="small" style={{ marginTop: 12 }}>
            <Descriptions.Item label="动作">
              {selectedDep.action === 'publish' ? <Tag color="blue">发布</Tag> : <Tag color="gold">回退</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="版本">{selectedDep.version}</Descriptions.Item>
            <Descriptions.Item label="操作人">{selectedDep.operator}</Descriptions.Item>
            <Descriptions.Item label="备注">{selectedDep.note || '-'}</Descriptions.Item>
            <Descriptions.Item label="发布时间">
              {dayjs(selectedDep.publishedAt).format('YYYY-MM-DD HH:mm:ss')}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      {/* ── 发布日志面板 ── */}
      <Drawer
        title={
          <Space>
            <span>发布日志</span>
            {publishStatus?.status === 'publishing' && <Tag icon={<LoadingOutlined />} color="processing">构建中</Tag>}
            {publishStatus?.status === 'success' && <Tag icon={<CheckCircleOutlined />} color="success">发布成功</Tag>}
            {publishStatus?.status === 'failed' && <Tag icon={<CloseCircleOutlined />} color="error">发布失败</Tag>}
          </Space>
        }
        placement="right"
        width={600}
        open={publishLogOpen}
        onClose={() => setPublishLogOpen(false)}
        styles={{ body: { padding: 0 } }}
      >
        <div style={{
          background: '#1e1e1e',
          color: '#d4d4d4',
          fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
          fontSize: 13,
          lineHeight: 1.6,
          padding: '16px',
          minHeight: '100%',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}>
          {publishStatus?.logs.length ? publishStatus.logs.map((line, i) => (
            <div key={i} style={{
              color: line.includes('FAILED') || line.includes('异常')
                ? '#f48771'
                : line.includes('OK') || line.includes('完成') || line.includes('成功')
                  ? '#89d185'
                  : line.startsWith('[')
                    ? '#569cd6'
                    : '#d4d4d4',
            }}>
              {line}
            </div>
          )) : (
            <div style={{ color: '#808080' }}>
              {publishing ? '⏳ 正在启动构建...' : '暂无日志'}
            </div>
          )}
          <div ref={logEndRef} />
        </div>
      </Drawer>
    </div>
  );
}
