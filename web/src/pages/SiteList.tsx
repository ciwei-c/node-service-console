import { useState, useEffect, useRef } from 'react';
import {
  Card, Table, Button, Modal, Input, Form, Upload, message, Popconfirm, Tag, Space, Typography, Tooltip,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, UploadOutlined, GlobalOutlined, CopyOutlined, ReloadOutlined,
} from '@ant-design/icons';
import type { StaticSite } from '../types';
import { fetchSites, createSiteApi, deleteSiteApi, deploySiteApi } from '../api';
import dayjs from 'dayjs';

const { Text } = Typography;

export default function SiteList() {
  const [sites, setSites] = useState<StaticSite[]>([]);
  const [loading, setLoading] = useState(false);

  /* 创建弹窗 */
  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [form] = Form.useForm();

  /* 部署弹窗 */
  const [deployOpen, setDeployOpen] = useState(false);
  const [deployLoading, setDeployLoading] = useState(false);
  const [deploySite, setDeploySite] = useState<StaticSite | null>(null);
  const [deployFile, setDeployFile] = useState<File | null>(null);
  const [deployVersion, setDeployVersion] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchSites();
      setSites(data);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  /* 创建 */
  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setCreateLoading(true);
      await createSiteApi(values.name.trim());
      message.success('站点已创建');
      setCreateOpen(false);
      form.resetFields();
      load();
    } catch (e: any) {
      if (e.message) message.error(e.message);
    } finally {
      setCreateLoading(false);
    }
  };

  /* 删除 */
  const handleDelete = async (id: string) => {
    try {
      await deleteSiteApi(id);
      message.success('已删除');
      load();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  /* 部署 */
  const openDeploy = (site: StaticSite) => {
    setDeploySite(site);
    setDeployFile(null);
    setDeployVersion('');
    setDeployOpen(true);
  };

  const handleDeploy = async () => {
    if (!deploySite || !deployFile) {
      message.warning('请选择 zip 文件');
      return;
    }
    setDeployLoading(true);
    try {
      await deploySiteApi(deploySite.id, deployFile, deployVersion || undefined);
      message.success('部署成功');
      setDeployOpen(false);
      load();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setDeployLoading(false);
    }
  };

  /* 复制链接 */
  const copyUrl = (site: StaticSite) => {
    const url = `${window.location.origin}${site.accessPath}/`;
    navigator.clipboard.writeText(url);
    message.success('已复制访问链接');
  };

  const columns = [
    {
      title: '站点名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: '访问路径',
      dataIndex: 'accessPath',
      key: 'accessPath',
      render: (p: string, record: StaticSite) => (
        <Space>
          <a href={`${p}/`} target="_blank" rel="noreferrer">{p}/</a>
          <Tooltip title="复制链接">
            <CopyOutlined style={{ cursor: 'pointer', color: '#1677ff' }} onClick={() => copyUrl(record)} />
          </Tooltip>
        </Space>
      ),
    },
    {
      title: '当前版本',
      dataIndex: 'currentVersion',
      key: 'currentVersion',
      render: (v: string) => v ? <Tag color="blue">{v}</Tag> : <Tag>未部署</Tag>,
    },
    {
      title: '最后部署',
      dataIndex: 'deployedAt',
      key: 'deployedAt',
      render: (t: string) => t ? dayjs(t).format('YYYY-MM-DD HH:mm:ss') : '-',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (t: string) => dayjs(t).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: StaticSite) => (
        <Space>
          <Button
            type="primary"
            size="small"
            icon={<UploadOutlined />}
            onClick={() => openDeploy(record)}
          >
            部署
          </Button>
          {record.currentVersion && (
            <Button
              size="small"
              icon={<GlobalOutlined />}
              onClick={() => window.open(`${record.accessPath}/`, '_blank')}
            >
              访问
            </Button>
          )}
          <Popconfirm
            title="确认删除该站点？所有文件将被清除。"
            onConfirm={() => handleDelete(record.id)}
            okText="删除"
            cancelText="取消"
          >
            <Button danger size="small" icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card
        title="静态站点管理"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              创建站点
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={sites}
          loading={loading}
          pagination={false}
          locale={{ emptyText: '暂无站点，点击「创建站点」开始' }}
        />
      </Card>

      {/* 创建弹窗 */}
      <Modal
        title="创建静态站点"
        open={createOpen}
        onOk={handleCreate}
        onCancel={() => { setCreateOpen(false); form.resetFields(); }}
        confirmLoading={createLoading}
        okText="创建"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="站点名称"
            extra="将作为访问路径: /web/{名称}/"
            rules={[
              { required: true, message: '请输入站点名称' },
              { pattern: /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,49}$/, message: '仅允许字母、数字、连字符、下划线，2-50 字符' },
            ]}
          >
            <Input placeholder="例如：my-blog" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 部署弹窗 */}
      <Modal
        title={`部署 — ${deploySite?.name || ''}`}
        open={deployOpen}
        onOk={handleDeploy}
        onCancel={() => setDeployOpen(false)}
        confirmLoading={deployLoading}
        okText="开始部署"
        cancelText="取消"
        destroyOnClose
      >
        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 16 }}>
            <Text type="secondary">上传前端构建产物（.zip 格式），将自动解压并覆盖旧文件。</Text>
          </div>
          <div style={{ marginBottom: 16 }}>
            <Text strong>版本号（可选）</Text>
            <Input
              placeholder="例如：v1.0.0"
              value={deployVersion}
              onChange={(e) => setDeployVersion(e.target.value)}
              style={{ marginTop: 8 }}
            />
          </div>
          <Upload.Dragger
            accept=".zip"
            maxCount={1}
            beforeUpload={(file) => {
              setDeployFile(file);
              return false; // 阻止自动上传
            }}
            onRemove={() => setDeployFile(null)}
            fileList={deployFile ? [deployFile as any] : []}
          >
            <p className="ant-upload-drag-icon">
              <UploadOutlined style={{ fontSize: 48, color: '#1677ff' }} />
            </p>
            <p className="ant-upload-text">点击或拖拽 .zip 文件到此区域</p>
            <p className="ant-upload-hint">支持前端构建产物 zip 包，最大 200MB</p>
          </Upload.Dragger>
        </div>
      </Modal>
    </div>
  );
}
