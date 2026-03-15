import { useEffect, useState, useCallback } from 'react';
import {
  Typography, Table, Tag, Space, Select, Input, DatePicker, Button, Card, Modal, Descriptions, message,
} from 'antd';
import {
  SearchOutlined, ReloadOutlined, FileTextOutlined,
  CheckCircleOutlined, CloseCircleOutlined, EyeOutlined,
} from '@ant-design/icons';
import { fetchLogs, fetchLogServiceNames } from '../api';
import type { OperationLog, LogAction } from '../types';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const actionLabelMap: Record<LogAction, { label: string; color: string }> = {
  publish:         { label: '发布',       color: 'blue' },
  rollback:        { label: '回退',       color: 'gold' },
  stop:            { label: '停止',       color: 'red' },
  start:           { label: '启动',       color: 'green' },
  create:          { label: '创建',       color: 'cyan' },
  delete:          { label: '删除',       color: 'magenta' },
  webhook:         { label: 'Webhook',    color: 'purple' },
  'config-env':    { label: '环境变量',   color: 'orange' },
  'config-pipeline': { label: '流水线',   color: 'geekblue' },
};

const actionOptions = Object.entries(actionLabelMap).map(([value, { label }]) => ({
  value,
  label,
}));

export default function LogList() {
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [serviceNames, setServiceNames] = useState<string[]>([]);

  /* 筛选项 */
  const [serviceName, setServiceName] = useState<string>();
  const [action, setAction] = useState<LogAction>();
  const [success, setSuccess] = useState<string>();
  const [keyword, setKeyword] = useState('');
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null]>([null, null]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detailLog, setDetailLog] = useState<OperationLog | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchLogs({
        startTime: dateRange[0]?.startOf('day').toISOString(),
        endTime: dateRange[1]?.endOf('day').toISOString(),
        serviceName,
        action,
        success: success !== undefined ? success === 'true' : undefined,
        keyword: keyword || undefined,
        page,
        pageSize,
      });
      setLogs(result.list);
      setTotal(result.total);
    } catch {
      message.error('日志加载失败');
    } finally {
      setLoading(false);
    }
  }, [serviceName, action, success, keyword, dateRange, page, pageSize]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetchLogServiceNames().then(setServiceNames).catch(() => {});
  }, []);

  const handleReset = () => {
    setServiceName(undefined);
    setAction(undefined);
    setSuccess(undefined);
    setKeyword('');
    setDateRange([null, null]);
    setPage(1);
  };

  const columns = [
    {
      title: '时间', dataIndex: 'timestamp', width: 180,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '操作类型', dataIndex: 'action', width: 110,
      render: (v: LogAction) => {
        const info = actionLabelMap[v] ?? { label: v, color: 'default' };
        return <Tag color={info.color}>{info.label}</Tag>;
      },
    },
    {
      title: '服务', dataIndex: 'serviceName', width: 150,
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: '结果', dataIndex: 'success', width: 80, align: 'center' as const,
      render: (v: boolean) =>
        v ? <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 16 }} />
          : <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 16 }} />,
    },
    {
      title: '版本', dataIndex: 'version', width: 140,
      render: (v?: string) => v ? <Text code>{v}</Text> : <Text type="secondary">-</Text>,
    },
    {
      title: '详情', dataIndex: 'detail', ellipsis: true,
      render: (v: string, rec: OperationLog) => (
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => setDetailLog(rec)}
          style={{ padding: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {v || '-'}
        </Button>
      ),
    },
    {
      title: '操作人', dataIndex: 'operator', width: 90,
      render: (v: string) => <Text type="secondary">{v}</Text>,
    },
  ];

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            <FileTextOutlined style={{ marginRight: 8 }} />
            操作日志
          </Title>
          <Text type="secondary">查看所有服务操作记录</Text>
        </div>
      </div>

      {/* 筛选区 */}
      <Card size="small" style={{ marginBottom: 20 }}>
        <Space wrap size={[12, 12]}>
          <RangePicker
            value={dateRange}
            onChange={(vals) => {
              setDateRange(vals ? [vals[0], vals[1]] : [null, null]);
              setPage(1);
            }}
            placeholder={['开始日期', '结束日期']}
            style={{ width: 260 }}
          />
          <Select
            value={serviceName}
            onChange={(v) => { setServiceName(v); setPage(1); }}
            placeholder="服务名称"
            allowClear
            style={{ width: 160 }}
            options={serviceNames.map((n) => ({ value: n, label: n }))}
          />
          <Select
            value={action}
            onChange={(v) => { setAction(v); setPage(1); }}
            placeholder="操作类型"
            allowClear
            style={{ width: 130 }}
            options={actionOptions}
          />
          <Select
            value={success}
            onChange={(v) => { setSuccess(v); setPage(1); }}
            placeholder="执行结果"
            allowClear
            style={{ width: 120 }}
            options={[
              { value: 'true', label: '成功' },
              { value: 'false', label: '失败' },
            ]}
          />
          <Input.Search
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onSearch={() => { setPage(1); load(); }}
            placeholder="搜索详情/版本"
            allowClear
            style={{ width: 200 }}
            enterButton={<SearchOutlined />}
          />
          <Button onClick={handleReset}>重置</Button>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
        </Space>
      </Card>

      {/* 日志表格 */}
      <Table
        rowKey="id"
        columns={columns}
        dataSource={logs}
        loading={loading}
        size="middle"
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条日志`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />

      {/* 日志详情弹窗 */}
      <Modal
        title="日志详情"
        open={!!detailLog}
        onCancel={() => setDetailLog(null)}
        footer={<Button onClick={() => setDetailLog(null)}>关闭</Button>}
        width={640}
      >
        {detailLog && (
          <Descriptions column={1} bordered size="small" style={{ marginTop: 12 }}>
            <Descriptions.Item label="时间">
              {dayjs(detailLog.timestamp).format('YYYY-MM-DD HH:mm:ss')}
            </Descriptions.Item>
            <Descriptions.Item label="操作类型">
              <Tag color={actionLabelMap[detailLog.action]?.color}>
                {actionLabelMap[detailLog.action]?.label ?? detailLog.action}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="服务">{detailLog.serviceName}</Descriptions.Item>
            <Descriptions.Item label="结果">
              {detailLog.success
                ? <Tag color="success">成功</Tag>
                : <Tag color="error">失败</Tag>}
            </Descriptions.Item>
            {detailLog.version && (
              <Descriptions.Item label="版本">
                <Text code>{detailLog.version}</Text>
              </Descriptions.Item>
            )}
            <Descriptions.Item label="操作人">{detailLog.operator || '-'}</Descriptions.Item>
            <Descriptions.Item label="详情">
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, overflow: 'auto' }}>
                {detailLog.detail || '-'}
              </div>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </div>
  );
}
