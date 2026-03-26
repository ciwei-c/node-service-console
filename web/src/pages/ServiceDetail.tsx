import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Typography, Button, Tag, Tabs, Table, Space, Modal, Form, Input, Select,
  InputNumber, message, Popconfirm, Descriptions, Card, Alert, Switch, Drawer, Skeleton,
} from 'antd';
import {
  ArrowLeftOutlined, RocketOutlined, RollbackOutlined,
  PlusOutlined, DeleteOutlined, PlayCircleOutlined,
  PauseCircleOutlined, EyeOutlined, SaveOutlined,
  LoadingOutlined, CheckCircleOutlined, CloseCircleOutlined,
  CodeOutlined, StopOutlined, DiffOutlined,
} from '@ant-design/icons';
import {
  fetchServiceByName, publishService, rollbackService, deleteDeployment,
  stopService, startService, updateEnvVars, updatePipeline, deleteService,
  fetchPublishStatus, subscribePublishEvents, stopPublishService,
  fetchPublishDiff,
} from '../api';
import type { Service, Deployment, EnvVar, Pipeline } from '../types';
import type { PublishStatus, PublishDiff } from '../api';
import dayjs from 'dayjs';
import DebugPanel from './DebugPanel';
import { useServiceStore } from '../serviceStore';

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
  const { services, patchService, removeService } = useServiceStore();

  // 从缓存中取摘要信息，用于即时渲染头部
  const decodedName = serviceName ? decodeURIComponent(serviceName) : '';
  const cached = services.find((s) => s.name === decodedName);

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
  const [publishLogs, setPublishLogs] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const publishLogOpenRef = useRef(publishLogOpen);
  publishLogOpenRef.current = publishLogOpen;
  const sseCloseRef = useRef<(() => void) | null>(null);

  /* publish diff state */
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffData, setDiffData] = useState<PublishDiff | null>(null);

  const load = useCallback(async () => {
    if (!serviceName) return;
    const data = await fetchServiceByName(decodeURIComponent(serviceName));
    setSvc(data);
    setEnvVars(data.envVars ?? []);
    pipeForm.setFieldsValue(data.pipeline ?? {});
    // 回写到全局缓存，返回列表时无需重新拉取
    patchService({
      id: data.id,
      name: data.name,
      status: data.status,
      currentVersion: data.currentVersion,
      updatedAt: data.updatedAt,
      codeSource: data.pipeline?.codeSource ?? 'github',
    });
    return data;
  }, [serviceName, pipeForm, patchService]);

  useEffect(() => { load(); }, [load]);

  /* ── SSE 订阅发布事件 ── */

  const closeSse = useCallback(() => {
    sseCloseRef.current?.();
    sseCloseRef.current = null;
  }, []);

  /* ── 始终保持 SSE 连接，实时感知任何发布（包括 Webhook 触发的） ── */
  useEffect(() => {
    if (!svc) return;

    let isFirstEvent = true;

    closeSse();
    sseCloseRef.current = subscribePublishEvents(svc.id, {
      onStatus: (status) => {
        setPublishStatus(status);
        setPublishLogs(status.logs);

        // 首次连接收到的终态（上一次构建的结果），静默处理，不弹消息
        if (isFirstEvent) {
          isFirstEvent = false;
          if (status.status !== 'publishing') {
            // 已结束的状态，仅同步 UI 状态即可
            setPublishing(false);
            return;
          }
        }

        if (status.status === 'publishing') {
          setPublishing(true);
          setPublishLogOpen(true);
        } else if (status.status === 'aborted') {
          // 被新发布中止 → 等待新发布的 status 事件自动推送过来
          message.info('当前构建已被新的 Webhook 发布中止');
          setPublishLogs([]);
          setPublishStatus(null);
        } else if (status.status === 'stopped') {
          setPublishing(false);
          message.info(status.action === 'rollback' ? '回退已手动停止' : '发布已手动停止');
          load();
        } else {
          setPublishing(false);
          if (status.status === 'success') {
            message.success(status.action === 'rollback' ? '回退成功' : '发布成功');
          } else {
            message.error(status.action === 'rollback' ? '回退失败' : '发布失败');
          }
          load();
        }
      },
      onLog: (line) => {
        setPublishLogs((prev) => [...prev, line]);
        if (publishLogOpenRef.current) {
          setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        }
      },
    });

    return () => closeSse();
  }, [svc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!svc) {
    // 数据加载中：使用缓存摘要先渲染头部，其余用骨架屏
    const previewSt = statusMap[cached?.status ?? 'idle'] ?? statusMap.idle;
    return (
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => nav('/')}>返回列表</Button>
          <Title level={4} style={{ margin: 0 }}>{cached?.name || decodedName}</Title>
          <Tag color={previewSt.color}>{previewSt.label}</Tag>
        </div>
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }

  const st = statusMap[svc.status] ?? statusMap.idle;

  /* ── deploy actions ── */

  const handlePublish = async () => {
    try {
      setPublishing(true);
      setPublishStatus(null);
      setPublishLogs([]);
      setPublishLogOpen(true);
      await publishService(svc.id);
      // SSE 连接已始终保持，新发布的 status 事件会自动推送过来
    } catch (err: any) {
      setPublishing(false);
      if (err.message?.includes('正在发布中')) {
        setPublishing(true);
      } else {
        message.error(err.message || '发布失败');
        setPublishLogOpen(false);
      }
    }
  };

  const handleStopPublish = async () => {
    try {
      await stopPublishService(svc.id);
    } catch (err: any) {
      message.error(err.message || '停止失败');
    }
  };

  const handleRollback = async () => {
    const vals = await rbForm.validateFields();
    try {
      setPublishing(true);
      setPublishStatus(null);
      setPublishLogs([]);
      setRbOpen(false);
      rbForm.resetFields();
      setPublishLogOpen(true);
      await rollbackService(svc.id, vals);
      // SSE 连接已始终保持，回退的 status 事件会自动推送过来
    } catch (err: any) {
      setPublishing(false);
      setPublishLogOpen(false);
      message.error(err.message || '回退失败');
    }
  };

  const handleDeleteDep = async (depId: string) => {
    await deleteDeployment(svc.id, depId);
    message.success('已删除');
    load();
  };

  const handleShowDiff = async () => {
    setDiffOpen(true);
    setDiffLoading(true);
    setDiffData(null);
    try {
      const data = await fetchPublishDiff(svc.id);
      setDiffData(data);
    } catch (err: any) {
      message.error(err.message || '获取 Diff 失败');
    } finally {
      setDiffLoading(false);
    }
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

  /* ── pipeline ── */

  const handleSaveAndDeploy = async () => {
    // 1. 校验流水线表单
    const pipeVals = await pipeForm.validateFields() as Pipeline;

    // 2. 收集环境变量
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
        message.error('环境变量 JSON 格式错误，无法保存');
        return;
      }
    }
    const filtered = vars.filter((v) => v.key.trim());

    // 3. 保存环境变量 + 流水线配置
    await updateEnvVars(svc.id, filtered);
    await updatePipeline(svc.id, pipeVals);
    message.success('配置已保存，开始发布...');

    // 4. 刷新数据后自动触发发布
    await load();
    handlePublish();
  };

  /* ── unique versions for rollback (排除当前版本、中止和停止的) ── */
  const hasDeployments = svc.deployments.some((d) => d.action === 'publish');
  const rollbackVersions = svc.deployments
    .filter((d) => d.action === 'publish'
      && d.version !== svc.currentVersion
      && d.deployStatus !== 'aborted'
      && d.deployStatus !== 'stopped')
    .reduce<Deployment[]>((acc, d) => {
      if (!acc.find((x) => x.version === d.version)) acc.push(d);
      return acc;
    }, []);

  /* ── next version number ── */
  const nextVersionNum = svc.deployments
    .filter((d: Deployment) => d.action === 'publish')
    .reduce((max: number, d: Deployment) => {
      const match = d.version.match(/-(\d+)$/);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, svc.deployments.filter((d: Deployment) => d.action === 'publish').length) + 1;

  /* ── table columns ── */
  const columns = [
    {
      title: '动作', dataIndex: 'action', width: 100,
      render: (_: string, rec: Deployment) => {
        if (rec.deployStatus === 'aborted') return <Tag color="orange">已中止</Tag>;
        if (rec.deployStatus === 'stopped') return <Tag color="red">已停止</Tag>;
        return rec.action === 'publish'
          ? <Tag color="blue">发布</Tag>
          : <Tag color="gold">回退</Tag>;
      },
    },
    { title: '版本', dataIndex: 'version', width: 120 },
    {
      title: 'Commit', dataIndex: 'commitHash', width: 200,
      render: (_: unknown, rec: Deployment) => {
        if (!rec.commitHash) return <Text type="secondary">-</Text>;
        return (
          <span title={rec.commitHash}>
            <Text code style={{ fontSize: 12 }}>{rec.commitHash.slice(0, 8)}</Text>
            {rec.commitMessage && (
              <Text type="secondary" style={{ marginLeft: 4, fontSize: 12 }} ellipsis={{ tooltip: rec.commitMessage }}>
                {rec.commitMessage.length > 20 ? rec.commitMessage.slice(0, 20) + '...' : rec.commitMessage}
              </Text>
            )}
          </span>
        );
      },
    },
    { title: '操作人', dataIndex: 'operator', width: 100 },
    { title: '备注', dataIndex: 'note', ellipsis: true, width: 120 },
    {
      title: '发布时间', dataIndex: 'publishedAt', width: 180,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '操作', width: 140, fixed: 'right' as const,
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
      {publishing && (
        <Alert
          type="info"
          showIcon
          icon={<LoadingOutlined />}
          message={
            <Space>
              <span>
                {publishStatus?.action === 'rollback' ? '正在回退到' : '正在发布'}{' '}
                <strong>{publishStatus?.version || '...'}</strong>
              </span>
              <Button type="link" size="small" onClick={() => setPublishLogOpen(true)}>
                查看日志
              </Button>
              <Popconfirm
                title="确定停止当前发布？"
                description={'停止后该版本将标记为「已停止」，不可用于回退'}
                onConfirm={handleStopPublish}
                okText="停止"
                cancelText="取消"
                okButtonProps={{ danger: true }}
              >
                <Button type="link" size="small" danger icon={<StopOutlined />}>
                  {publishStatus?.action === 'rollback' ? '停止回退' : '停止发布'}
                </Button>
              </Popconfirm>
            </Space>
          }
          style={{ marginBottom: 16 }}
          banner
        />
      )}
      <Space style={{ marginBottom: 20 }} wrap>
        <Popconfirm
          title="确认发布新版本？"
          description={<>
            <div>版本号将自动生成：<strong>{svc.name}-{nextVersionNum}</strong></div>
            <div style={{marginTop:4,color:'#8c8c8c',fontSize:12}}>流水线：{svc.pipeline?.codeSource} / {svc.pipeline?.repository || '-'} / {svc.pipeline?.branch}</div>
          </>}
          onConfirm={handlePublish}
          okText="确认发布"
          cancelText="取消"
        >
          <Button type="primary" icon={<RocketOutlined />}
            loading={publishing && publishStatus?.action !== 'rollback'}
            disabled={publishing && publishStatus?.action === 'rollback'}
          >发布</Button>
        </Popconfirm>
        <Button icon={<RollbackOutlined />} onClick={() => setRbOpen(true)}
          loading={publishing && publishStatus?.action === 'rollback'}
          disabled={publishing && publishStatus?.action !== 'rollback'}
        >
          回退
        </Button>
        <Button icon={<DiffOutlined />} onClick={handleShowDiff} disabled={publishing}>
          发布对比
        </Button>
        <Text type="secondary" style={{ marginLeft: 8 }}>
          当前版本：<Text strong>{svc.currentVersion || '尚未发布'}</Text>
        </Text>
        <Text type="secondary" style={{ marginLeft: 8 }}>
          访问路径：<Text code>{svc.pipeline?.accessPath || '/' + svc.name}</Text>
        </Text>
        {svc.hostPort && (
          <Text type="secondary" style={{ marginLeft: 8 }}>
            端口映射：<Text code>{svc.hostPort}→{svc.pipeline?.port}</Text>
          </Text>
        )}
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
        scroll={{ x: 900 }}
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
      </Card>

      {/* 流水线 */}
      <Card title="流水线配置" size="small">
        <Form form={pipeForm} layout="vertical"
          initialValues={{ codeSource: 'github', branch: 'main', targetDir: '/opt/app', port: 3000, dockerfile: 'Dockerfile', accessPath: '/' + svc.name, authMode: 'ssh', gitToken: '' }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
            <Form.Item name="codeSource" label="代码源" rules={[{ required: true }]}
              tooltip={hasDeployments ? '已有部署记录，代码源不可更改' : undefined}
            >
              <Select disabled={hasDeployments} options={[
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
            <Form.Item name="repository" label="代码仓库" rules={[{ required: true, message: '请输入仓库地址' }]}
              tooltip={hasDeployments ? '已有部署记录，仓库地址不可更改（历史版本 commit 与仓库绑定）' : undefined}
            >
              <Input placeholder="owner/repo-name" disabled={hasDeployments} />
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
          </div>
        </Form>
      </Card>

      {/* 统一保存并部署 */}
      <div style={{ marginTop: 20, textAlign: 'right' }}>
        <Popconfirm
          title="保存配置并发布新版本？"
          description="将保存环境变量和流水线配置，然后自动触发部署流程。"
          onConfirm={handleSaveAndDeploy}
          okText="保存并部署"
          cancelText="取消"
        >
          <Button type="primary" size="large" icon={<RocketOutlined />} loading={publishing}>
            保存并部署
          </Button>
        </Popconfirm>
      </div>
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
                removeService(svc.id);
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
          { key: 'debug', label: '云端调试', children: <DebugPanel service={svc} /> },
          { key: 'settings', label: '服务设置', children: settingsTab },
        ]}
      />

      {/* ── 回退弹窗 ── */}
      <Modal title="回退版本" open={rbOpen} onOk={handleRollback}
        onCancel={() => { setRbOpen(false); rbForm.resetFields(); }}
        okText="回退" cancelText="取消"
      >
        <Alert
          type="warning"
          message="回退操作将根据目标版本的 commit 重新构建，并删除该版本之后的所有部署记录。"
          style={{ marginBottom: 12 }}
        />
        <Form form={rbForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="targetVersion" label="选择历史版本" rules={[{ required: true, message: '请选择版本' }]}>
            <Select placeholder="请选择" options={rollbackVersions.map((d) => ({
              value: d.version,
              label: `${d.version}${d.commitHash ? ` (${d.commitHash.slice(0, 8)})` : ''}`,
            }))} />
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
            <Descriptions.Item label="Commit Hash">
              {selectedDep.commitHash ? <Text code>{selectedDep.commitHash}</Text> : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="Commit Message">
              {selectedDep.commitMessage || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="操作人">{selectedDep.operator}</Descriptions.Item>
            <Descriptions.Item label="备注">{selectedDep.note || '-'}</Descriptions.Item>
            <Descriptions.Item label="发布时间">
              {dayjs(selectedDep.publishedAt).format('YYYY-MM-DD HH:mm:ss')}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      {/* ── 构建日志面板 ── */}
      <Drawer
        title={
          <Space>
            <span>{publishStatus?.action === 'rollback' ? '回退日志' : '发布日志'}</span>
            {publishStatus?.status === 'publishing' && <Tag icon={<LoadingOutlined />} color="processing">构建中</Tag>}
            {publishStatus?.status === 'success' && <Tag icon={<CheckCircleOutlined />} color="success">{publishStatus?.action === 'rollback' ? '回退成功' : '发布成功'}</Tag>}
            {publishStatus?.status === 'failed' && <Tag icon={<CloseCircleOutlined />} color="error">{publishStatus?.action === 'rollback' ? '回退失败' : '发布失败'}</Tag>}
            {publishStatus?.status === 'aborted' && <Tag color="orange">已中止</Tag>}
            {publishStatus?.status === 'stopped' && <Tag color="red">已停止</Tag>}
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
          {publishLogs.length ? publishLogs.map((line, i) => (
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

      {/* ── 发布对比弹窗 ── */}
      <Modal
        title="发布对比 (Diff)"
        open={diffOpen}
        onCancel={() => setDiffOpen(false)}
        footer={null}
        width={720}
        destroyOnClose
      >
        {diffLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><LoadingOutlined style={{ fontSize: 24 }} /> 正在获取提交记录...</div>
        ) : diffData ? (
          <div>
            <Descriptions column={2} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="当前部署">
                {diffData.currentCommitHash ? <Text code>{diffData.currentCommitHash.slice(0, 8)}</Text> : <Tag>尚未部署</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label="远程最新">
                <Text code>{diffData.latestCommitHash.slice(0, 8)}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="新增提交">
                <Tag color={diffData.hasChanges ? 'blue' : 'default'}>{diffData.commits.length} 条</Tag>
              </Descriptions.Item>
              {diffData.filesChanged > 0 && (
                <Descriptions.Item label="变更文件">
                  <Tag color="orange">{diffData.filesChanged} 个</Tag>
                </Descriptions.Item>
              )}
            </Descriptions>
            {!diffData.hasChanges ? (
              <Alert type="success" showIcon message="代码已是最新版本，无需发布" />
            ) : (
              <Table
                rowKey="hash"
                size="small"
                pagination={false}
                dataSource={diffData.commits}
                scroll={{ y: 400 }}
                columns={[
                  { title: 'Commit', dataIndex: 'shortHash', width: 80, render: (h: string) => <Text code>{h}</Text> },
                  { title: '提交信息', dataIndex: 'message', ellipsis: true },
                  { title: '作者', dataIndex: 'author', width: 120 },
                  { title: '时间', dataIndex: 'date', width: 170, render: (d: string) => dayjs(d).format('MM-DD HH:mm') },
                ]}
              />
            )}
          </div>
        ) : (
          <Alert type="warning" showIcon message="获取失败，请检查仓库配置" />
        )}
      </Modal>
    </div>
  );
}
