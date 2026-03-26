import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Typography, Progress, Space, Switch, message, Tooltip } from 'antd';
import {
  DashboardOutlined,
  CloudServerOutlined,
  ClockCircleOutlined,
  HddOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from 'recharts';
import { fetchSystemStats, type SystemStats } from '../api';

const { Title, Text } = Typography;

/** 历史数据点（用于折线图） */
interface HistoryPoint {
  time: string;
  cpu: number;
  memory: number;
}

const MAX_HISTORY = 60; // 保留最近 60 个采样点

/** 根据使用率返回颜色 */
function usageColor(pct: number): string {
  if (pct >= 90) return '#ff4d4f';
  if (pct >= 70) return '#faad14';
  return '#52c41a';
}

/** 格式化 MB 显示 */
function formatMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

export default function MonitorDashboard() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchSystemStats();
      setStats(data);
      setHistory((prev) => {
        const time = new Date(data.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const next = [...prev, { time, cpu: data.cpu.usagePercent, memory: data.memory.usagePercent }];
        return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
      });
    } catch (err: any) {
      message.error(`获取监控数据失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(load, 5000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoRefresh, load]);

  if (!stats && loading) {
    return <Card loading style={{ margin: 16 }} />;
  }

  if (!stats) return null;

  const containerColumns = [
    {
      title: '容器名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: 'CPU',
      dataIndex: 'cpuPercent',
      key: 'cpu',
      width: 100,
      render: (v: number) => (
        <Tag color={v > 80 ? 'red' : v > 50 ? 'orange' : 'green'}>{v.toFixed(1)}%</Tag>
      ),
      sorter: (a: any, b: any) => a.cpuPercent - b.cpuPercent,
    },
    {
      title: '内存',
      dataIndex: 'memUsageMB',
      key: 'mem',
      width: 160,
      render: (_: number, r: any) => (
        <Tooltip title={`${formatMB(r.memUsageMB)} / ${formatMB(r.memLimitMB)}`}>
          <Progress
            percent={r.memPercent}
            size="small"
            strokeColor={usageColor(r.memPercent)}
            format={() => `${r.memPercent.toFixed(1)}%`}
          />
        </Tooltip>
      ),
      sorter: (a: any, b: any) => a.memPercent - b.memPercent,
    },
    {
      title: '网络 I/O',
      dataIndex: 'netIO',
      key: 'net',
      width: 160,
    },
    {
      title: '磁盘 I/O',
      dataIndex: 'blockIO',
      key: 'block',
      width: 160,
    },
    {
      title: 'PIDs',
      dataIndex: 'pids',
      key: 'pids',
      width: 70,
    },
  ];

  const diskColumns = [
    { title: '文件系统', dataIndex: 'filesystem', key: 'fs' },
    { title: '挂载点', dataIndex: 'mountpoint', key: 'mount' },
    {
      title: '容量',
      key: 'size',
      width: 120,
      render: (_: any, r: any) => `${r.totalGB} GB`,
    },
    {
      title: '使用率',
      dataIndex: 'usagePercent',
      key: 'usage',
      width: 200,
      render: (v: number) => (
        <Progress percent={v} size="small" strokeColor={usageColor(v)} />
      ),
    },
    {
      title: '可用',
      key: 'avail',
      width: 100,
      render: (_: any, r: any) => `${r.availGB} GB`,
    },
  ];

  return (
    <div>
      {/* 头部 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          <DashboardOutlined style={{ marginRight: 8 }} />
          系统监控
        </Title>
        <Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            自动刷新 (5s)
          </Text>
          <Switch checked={autoRefresh} onChange={setAutoRefresh} size="small" />
          <ReloadOutlined
            style={{ cursor: 'pointer', fontSize: 16, color: '#1677ff' }}
            spin={loading}
            onClick={() => { setLoading(true); load(); }}
          />
        </Space>
      </div>

      {/* 概览卡片 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" hoverable>
            <Statistic
              title={<><CloudServerOutlined /> 主机名</>}
              value={stats.hostname}
              valueStyle={{ fontSize: 16 }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>{stats.platform}</Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" hoverable>
            <Statistic
              title={<><ClockCircleOutlined /> 运行时间</>}
              value={stats.uptime.uptimeFormatted}
              valueStyle={{ fontSize: 16 }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              负载: {stats.loadAvg.join(' / ')}
            </Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" hoverable>
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary">CPU 使用率</Text>
              <Text style={{ float: 'right', fontSize: 12 }}>{stats.cpu.cores} 核</Text>
            </div>
            <Progress
              percent={stats.cpu.usagePercent}
              strokeColor={usageColor(stats.cpu.usagePercent)}
              format={(pct) => `${pct?.toFixed(1)}%`}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>{stats.cpu.model}</Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" hoverable>
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary">内存使用率</Text>
              <Text style={{ float: 'right', fontSize: 12 }}>
                {formatMB(stats.memory.usedMB)} / {formatMB(stats.memory.totalMB)}
              </Text>
            </div>
            <Progress
              percent={stats.memory.usagePercent}
              strokeColor={usageColor(stats.memory.usagePercent)}
              format={(pct) => `${pct?.toFixed(1)}%`}
            />
          </Card>
        </Col>
      </Row>

      {/* CPU & 内存趋势图 */}
      {history.length > 1 && (
        <Card size="small" title="CPU / 内存趋势" style={{ marginTop: 16 }}>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={history} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <defs>
                <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#1677ff" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#1677ff" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#52c41a" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#52c41a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" fontSize={11} />
              <YAxis domain={[0, 100]} unit="%" fontSize={11} />
              <RechartsTooltip formatter={(value) => `${Number(value).toFixed(1)}%`} />
              <Area type="monotone" dataKey="cpu" name="CPU" stroke="#1677ff" fill="url(#cpuGrad)" />
              <Area type="monotone" dataKey="memory" name="内存" stroke="#52c41a" fill="url(#memGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* 磁盘 */}
      <Card
        size="small"
        title={<><HddOutlined style={{ marginRight: 6 }} />磁盘</>}
        style={{ marginTop: 16 }}
      >
        <Table
          dataSource={stats.disks}
          columns={diskColumns}
          rowKey="mountpoint"
          size="small"
          pagination={false}
        />
      </Card>

      {/* Docker 容器 */}
      <Card
        size="small"
        title={
          <>
            <CloudServerOutlined style={{ marginRight: 6 }} />
            容器资源占用
            <Tag style={{ marginLeft: 8 }}>{stats.containers.length} 个运行中</Tag>
          </>
        }
        style={{ marginTop: 16 }}
      >
        {stats.containers.length > 0 ? (
          <Table
            dataSource={stats.containers}
            columns={containerColumns}
            rowKey="id"
            size="small"
            pagination={false}
          />
        ) : (
          <Text type="secondary">无运行中的容器</Text>
        )}
      </Card>
    </div>
  );
}
