/**
 * 数据备份与恢复 — 前端页面
 */
import { useState, useEffect } from 'react';
import { Card, Table, Button, Space, message, Popconfirm, Upload, Modal, Typography, Alert } from 'antd';
import {
  DownloadOutlined, DeleteOutlined, PlusOutlined,
  UploadOutlined, ReloadOutlined, CloudUploadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  fetchBackups, createBackupApi, deleteBackupApi, getBackupDownloadUrl,
  type BackupInfo,
} from '../api';

const { Text } = Typography;

export default function BackupRestore() {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoring, setRestoring] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setBackups(await fetchBackups());
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await createBackupApi();
      message.success('备份创建成功');
      load();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (filename: string) => {
    try {
      await deleteBackupApi(filename);
      message.success('已删除');
      load();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleDownload = (filename: string) => {
    const url = getBackupDownloadUrl(filename);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  };

  const handleRestore = async () => {
    if (!restoreFile) {
      message.warning('请选择备份文件');
      return;
    }
    setRestoring(true);
    try {
      const token = localStorage.getItem('nsc_token');
      const form = new FormData();
      form.append('file', restoreFile);
      const res = await fetch('/node-service-console/api/backup/restore', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (res.status === 401) {
        window.location.href = '/node-service-console/login';
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || '恢复失败');
      const restored = json.data?.restored || [];
      message.success(`恢复成功，已恢复 ${restored.length} 个文件/目录`);
      setRestoreOpen(false);
      setRestoreFile(null);
      load();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setRestoring(false);
    }
  };

  const columns = [
    {
      title: '文件名',
      dataIndex: 'filename',
      key: 'filename',
      render: (f: string) => <Text code>{f}</Text>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (t: string) => dayjs(t).format('YYYY-MM-DD HH:mm:ss'),
      sorter: (a: BackupInfo, b: BackupInfo) => a.createdAt.localeCompare(b.createdAt),
      defaultSortOrder: 'descend' as const,
    },
    {
      title: '大小',
      dataIndex: 'sizeMB',
      key: 'sizeMB',
      render: (s: number) => `${s} MB`,
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: BackupInfo) => (
        <Space>
          <Button size="small" icon={<DownloadOutlined />} onClick={() => handleDownload(record.filename)}>
            下载
          </Button>
          <Popconfirm
            title="确认删除该备份？"
            onConfirm={() => handleDelete(record.filename)}
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
        title="数据备份与恢复"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
            <Button icon={<CloudUploadOutlined />} onClick={() => { setRestoreFile(null); setRestoreOpen(true); }}>
              上传恢复
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate} loading={creating}>
              创建备份
            </Button>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          message="备份内容包括：服务数据 (store.json)、操作日志 (logs.json)、配置文件、静态站点文件"
          style={{ marginBottom: 16 }}
        />
        <Table
          rowKey="filename"
          columns={columns}
          dataSource={backups}
          loading={loading}
          pagination={false}
          locale={{ emptyText: '暂无备份，点击「创建备份」生成' }}
        />
      </Card>

      {/* 上传恢复弹窗 */}
      <Modal
        title="上传备份文件恢复"
        open={restoreOpen}
        onOk={handleRestore}
        onCancel={() => { setRestoreOpen(false); setRestoreFile(null); }}
        confirmLoading={restoring}
        okText="开始恢复"
        cancelText="取消"
        destroyOnClose
      >
        <Alert
          type="warning"
          showIcon
          message="恢复操作会覆盖现有数据，请确认后再操作！"
          style={{ marginBottom: 16 }}
        />
        <Upload.Dragger
          accept=".zip"
          maxCount={1}
          beforeUpload={(file) => {
            setRestoreFile(file);
            return false;
          }}
          onRemove={() => setRestoreFile(null)}
          fileList={restoreFile ? [restoreFile as any] : []}
        >
          <p className="ant-upload-drag-icon">
            <UploadOutlined style={{ fontSize: 48, color: '#1677ff' }} />
          </p>
          <p className="ant-upload-text">点击或拖拽备份 .zip 文件到此区域</p>
          <p className="ant-upload-hint">仅支持通过本系统创建的备份文件</p>
        </Upload.Dragger>
      </Modal>
    </div>
  );
}
