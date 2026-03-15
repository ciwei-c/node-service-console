import { useEffect, useState, useCallback } from 'react';
import {
  Typography, Table, Tag, Button, Space, Modal, Tabs, Descriptions, Empty, message,
} from 'antd';
import {
  ReloadOutlined, EyeOutlined, FileTextOutlined, ContainerOutlined,
} from '@ant-design/icons';
import { fetchContainers, fetchContainerInspect, fetchContainerLogs } from '../api';
import type { ContainerInfo } from '../types';

const { Title, Text } = Typography;

const stateColorMap: Record<string, string> = {
  running: 'green',
  exited: 'red',
  paused: 'orange',
  restarting: 'blue',
  created: 'default',
  dead: 'red',
};

export default function ContainerList() {
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [loading, setLoading] = useState(true);

  /* detail modal */
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [inspectData, setInspectData] = useState<Record<string, unknown> | null>(null);
  const [logsData, setLogsData] = useState('');
  const [selectedContainer, setSelectedContainer] = useState<ContainerInfo | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setContainers(await fetchContainers());
    } catch {
      message.error('获取容器列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (c: ContainerInfo) => {
    setSelectedContainer(c);
    setDetailOpen(true);
    setDetailLoading(true);
    setInspectData(null);
    setLogsData('');
    try {
      const [inspect, logs] = await Promise.all([
        fetchContainerInspect(c.id),
        fetchContainerLogs(c.id, 200),
      ]);
      setInspectData(inspect);
      setLogsData(logs);
    } catch {
      message.error('获取容器详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  /* 从 inspect 数据中提取关键信息 */
  const getInspectSummary = () => {
    if (!inspectData) return null;
    const config = inspectData.Config as Record<string, unknown> | undefined;
    const hostConfig = inspectData.HostConfig as Record<string, unknown> | undefined;
    const networkSettings = inspectData.NetworkSettings as Record<string, unknown> | undefined;
    const state = inspectData.State as Record<string, unknown> | undefined;

    return {
      id: inspectData.Id as string ?? '-',
      name: (inspectData.Name as string ?? '').replace(/^\//, ''),
      image: config?.Image as string ?? '-',
      created: inspectData.Created as string ?? '-',
      // State
      status: state?.Status as string ?? '-',
      pid: state?.Pid ?? '-',
      startedAt: state?.StartedAt as string ?? '-',
      finishedAt: state?.FinishedAt as string ?? '-',
      restartCount: (inspectData.RestartCount as number) ?? 0,
      // Config
      cmd: Array.isArray(config?.Cmd) ? (config.Cmd as string[]).join(' ') : '-',
      workDir: config?.WorkingDir as string || '/',
      env: Array.isArray(config?.Env) ? config.Env as string[] : [],
      exposedPorts: config?.ExposedPorts ? Object.keys(config.ExposedPorts as object).join(', ') : '-',
      // Host
      restartPolicy: (hostConfig?.RestartPolicy as Record<string, unknown>)?.Name as string ?? '-',
      memory: hostConfig?.Memory as number ?? 0,
      cpus: hostConfig?.NanoCpus as number ?? 0,
      // Network
      ipAddress: (networkSettings?.IPAddress as string) || '-',
      ports: networkSettings?.Ports ? JSON.stringify(networkSettings.Ports, null, 2) : '-',
      networks: networkSettings?.Networks
        ? Object.entries(networkSettings.Networks as Record<string, unknown>).map(([name, conf]) => ({
          name,
          ip: (conf as Record<string, unknown>)?.IPAddress as string ?? '-',
          gateway: (conf as Record<string, unknown>)?.Gateway as string ?? '-',
        }))
        : [],
    };
  };

  const columns = [
    {
      title: '容器 ID', dataIndex: 'id', width: 120,
      render: (v: string) => <Text code copyable={{ text: v }}>{v.slice(0, 12)}</Text>,
    },
    {
      title: '容器名称', dataIndex: 'name', width: 200,
      render: (v: string) => <Text strong>{v}</Text>,
    },
    { title: '镜像', dataIndex: 'image', ellipsis: true },
    {
      title: '状态', dataIndex: 'state', width: 100,
      render: (v: string) => <Tag color={stateColorMap[v] ?? 'default'}>{v}</Tag>,
    },
    {
      title: '运行状态', dataIndex: 'status', width: 180,
      render: (v: string) => <Text type="secondary">{v}</Text>,
    },
    {
      title: '端口映射', dataIndex: 'ports', ellipsis: true, width: 220,
      render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{v || '-'}</Text>,
    },
    {
      title: '操作', width: 100, fixed: 'right' as const,
      render: (_: unknown, rec: ContainerInfo) => (
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openDetail(rec)}>
          详情
        </Button>
      ),
    },
  ];

  /* 从 inspect 中提取宿主机端口映射，生成访问地址 */
  const getAccessAddresses = (): string[] => {
    if (!inspectData) return [];
    const networkSettings = inspectData.NetworkSettings as Record<string, unknown> | undefined;
    const portsObj = networkSettings?.Ports as Record<string, Array<{HostIp: string; HostPort: string}>> | undefined;
    if (!portsObj) return [];
    const host = window.location.hostname;
    const addrs: string[] = [];
    for (const [containerPort, bindings] of Object.entries(portsObj)) {
      if (!bindings) continue;
      for (const b of bindings) {
        const hp = b.HostPort;
        if (hp) {
          addrs.push(`${host}:${hp} → ${containerPort}`);
        }
      }
    }
    return addrs;
  };

  const summary = getInspectSummary();
  const accessAddrs = getAccessAddresses();

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            <ContainerOutlined style={{ marginRight: 8 }} />
            容器列表
          </Title>
          <Text type="secondary">查看服务器上所有 Docker 容器的运行状态</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
          刷新
        </Button>
      </div>

      {!loading && containers.length === 0 ? (
        <Empty description="暂无运行中的容器" style={{ marginTop: 80 }} />
      ) : (
        <Table
          rowKey="id"
          columns={columns}
          dataSource={containers}
          loading={loading}
          pagination={{ pageSize: 15, showSizeChanger: true, showTotal: (t) => `共 ${t} 个容器` }}
          size="middle"
          scroll={{ x: 1100 }}
        />
      )}

      {/* ── 容器详情弹窗 ── */}
      <Modal
        title={
          <Space>
            <ContainerOutlined />
            <span>容器详情 — {selectedContainer?.name}</span>
          </Space>
        }
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={800}
        loading={detailLoading}
      >
        {summary && (
          <Tabs
            defaultActiveKey="info"
            items={[
              {
                key: 'info',
                label: '基本信息',
                icon: <EyeOutlined />,
                children: (
                  <Descriptions bordered size="small" column={2} style={{ marginTop: 8 }}>
                    <Descriptions.Item label="容器 ID" span={2}>
                      <Text code copyable>{summary.id}</Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="容器名称">{summary.name}</Descriptions.Item>
                    <Descriptions.Item label="镜像">{summary.image}</Descriptions.Item>
                    <Descriptions.Item label="状态">
                      <Tag color={stateColorMap[summary.status] ?? 'default'}>{summary.status}</Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="PID">{String(summary.pid)}</Descriptions.Item>
                    <Descriptions.Item label="启动时间">{summary.startedAt}</Descriptions.Item>
                    <Descriptions.Item label="停止时间">{summary.finishedAt}</Descriptions.Item>
                    <Descriptions.Item label="重启次数">{summary.restartCount}</Descriptions.Item>
                    <Descriptions.Item label="重启策略">{summary.restartPolicy}</Descriptions.Item>
                    <Descriptions.Item label="执行命令" span={2}>
                      <Text code>{summary.cmd}</Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="工作目录">{summary.workDir}</Descriptions.Item>
                    <Descriptions.Item label="暴露端口">{summary.exposedPorts}</Descriptions.Item>
                    {accessAddrs.length > 0 && (
                      <Descriptions.Item label="服务访问地址" span={2}>
                        {accessAddrs.map((addr, i) => {
                          const hostPort = addr.split(' ')[0];
                          return (
                            <div key={i} style={{ marginBottom: 4 }}>
                              <Text code copyable={{ text: `http://${hostPort}` }}>
                                http://{hostPort}
                              </Text>
                              <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                                ({addr.split(' → ')[1]})
                              </Text>
                            </div>
                          );
                        })}
                      </Descriptions.Item>
                    )}
                    <Descriptions.Item label="IP 地址">{summary.ipAddress}</Descriptions.Item>
                    <Descriptions.Item label="内存限制">
                      {summary.memory ? `${(summary.memory / 1024 / 1024).toFixed(0)} MB` : '无限制'}
                    </Descriptions.Item>
                    {summary.networks.length > 0 && (
                      <Descriptions.Item label="网络" span={2}>
                        {summary.networks.map((n) => (
                          <div key={n.name}>
                            <Tag>{n.name}</Tag> IP: {n.ip} / Gateway: {n.gateway}
                          </div>
                        ))}
                      </Descriptions.Item>
                    )}
                  </Descriptions>
                ),
              },
              {
                key: 'env',
                label: '环境变量',
                children: (
                  <div style={{ marginTop: 8, maxHeight: 400, overflow: 'auto' }}>
                    <Table
                      rowKey={(_, i) => String(i)}
                      dataSource={summary.env.map((e) => {
                        const idx = e.indexOf('=');
                        return { key: e.substring(0, idx), value: e.substring(idx + 1) };
                      })}
                      columns={[
                        { title: 'KEY', dataIndex: 'key', width: 220, render: (v: string) => <Text code>{v}</Text> },
                        { title: 'VALUE', dataIndex: 'value', ellipsis: true },
                      ]}
                      pagination={false}
                      size="small"
                    />
                  </div>
                ),
              },
              {
                key: 'ports',
                label: '端口映射',
                children: (
                  <pre style={{
                    marginTop: 8, padding: 12, background: '#f5f5f5',
                    borderRadius: 6, maxHeight: 400, overflow: 'auto', fontSize: 12,
                  }}>
                    {summary.ports}
                  </pre>
                ),
              },
              {
                key: 'logs',
                label: '运行日志',
                icon: <FileTextOutlined />,
                children: (
                  <pre style={{
                    marginTop: 8, padding: 12, background: '#1e1e1e', color: '#d4d4d4',
                    borderRadius: 6, maxHeight: 500, overflow: 'auto', fontSize: 12,
                    fontFamily: 'Consolas, Monaco, monospace', whiteSpace: 'pre-wrap',
                  }}>
                    {logsData || '暂无日志'}
                  </pre>
                ),
              },
            ]}
          />
        )}
      </Modal>
    </div>
  );
}
