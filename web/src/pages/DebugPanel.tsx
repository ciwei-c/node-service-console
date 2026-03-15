/**
 * 云端调试面板 — 支持 HTTP 请求和 WebSocket
 */
import { useState, useRef, useCallback } from 'react';
import {
  Card, Radio, Input, Select, Button, Space, Table, Tag, Collapse,
  message, Empty, Tooltip,
} from 'antd';
import {
  SendOutlined, LinkOutlined, DisconnectOutlined,
  PlusOutlined, DeleteOutlined, ClearOutlined,
} from '@ant-design/icons';
import { debugHttp } from '../api';
import type { DebugHttpResponse } from '../api';
import type { Service } from '../types';

const { TextArea } = Input;

interface KV { key: string; value: string }

/* ── HTTP 状态码颜色 ── */
function statusColor(code: number): string {
  if (code >= 200 && code < 300) return 'green';
  if (code >= 300 && code < 400) return 'blue';
  if (code >= 400 && code < 500) return 'orange';
  return 'red';
}

/* ── 格式化 JSON ── */
function tryFormatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

interface Props {
  service: Service;
}

export default function DebugPanel({ service }: Props) {
  const [mode, setMode] = useState<'http' | 'ws'>('http');

  /* ── HTTP 状态 ── */
  const [httpMethod, setHttpMethod] = useState('GET');
  const [httpPath, setHttpPath] = useState('/');
  const [httpHeaders, setHttpHeaders] = useState<KV[]>([]);
  const [httpQuery, setHttpQuery] = useState<KV[]>([]);
  const [httpBody, setHttpBody] = useState('');
  const [httpLoading, setHttpLoading] = useState(false);
  const [httpResponse, setHttpResponse] = useState<DebugHttpResponse | null>(null);

  /* ── WebSocket 状态 ── */
  const [wsPath, setWsPath] = useState('/');
  const [wsConnected, setWsConnected] = useState(false);
  const [wsMsg, setWsMsg] = useState('');
  const [wsLog, setWsLog] = useState<{ dir: 'send' | 'recv' | 'sys'; text: string; time: string }[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const wsLogEndRef = useRef<HTMLDivElement>(null);

  const accessPath = service.pipeline?.accessPath || `/${service.name}`;

  /* ── HTTP 发送 ── */
  const handleSendHttp = async () => {
    setHttpLoading(true);
    setHttpResponse(null);
    try {
      const headers: Record<string, string> = {};
      httpHeaders.filter(h => h.key.trim()).forEach(h => { headers[h.key] = h.value; });
      const query: Record<string, string> = {};
      httpQuery.filter(q => q.key.trim()).forEach(q => { query[q.key] = q.value; });

      const res = await debugHttp(service.id, {
        method: httpMethod,
        path: httpPath,
        headers: Object.keys(headers).length ? headers : undefined,
        query: Object.keys(query).length ? query : undefined,
        body: ['POST', 'PUT', 'PATCH'].includes(httpMethod) ? httpBody : undefined,
      });
      setHttpResponse(res);
    } catch (err: any) {
      message.error(err.message || '请求失败');
    } finally {
      setHttpLoading(false);
    }
  };

  /* ── WebSocket 连接 ── */
  const addWsLog = useCallback((dir: 'send' | 'recv' | 'sys', text: string) => {
    setWsLog(prev => [...prev, { dir, text, time: new Date().toLocaleTimeString() }]);
    setTimeout(() => wsLogEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  const handleWsConnect = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}${accessPath}${wsPath === '/' ? '' : wsPath}`;
    addWsLog('sys', `连接 ${wsUrl} ...`);

    try {
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        setWsConnected(true);
        addWsLog('sys', '✅ 连接成功');
      };
      ws.onmessage = (e) => {
        addWsLog('recv', typeof e.data === 'string' ? e.data : '[Binary Data]');
      };
      ws.onclose = (e) => {
        setWsConnected(false);
        addWsLog('sys', `🔌 连接关闭 (code=${e.code})`);
        wsRef.current = null;
      };
      ws.onerror = () => {
        addWsLog('sys', '❌ 连接异常');
      };
      wsRef.current = ws;
    } catch (err: any) {
      addWsLog('sys', `❌ ${err.message}`);
    }
  };

  const handleWsDisconnect = () => {
    wsRef.current?.close();
    wsRef.current = null;
  };

  const handleWsSend = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      message.warning('WebSocket 未连接');
      return;
    }
    if (!wsMsg.trim()) return;
    wsRef.current.send(wsMsg);
    addWsLog('send', wsMsg);
    setWsMsg('');
  };

  /* ── KV 编辑器 ── */
  const KVEditor = ({ items, onChange, label }: { items: KV[]; onChange: (v: KV[]) => void; label: string }) => (
    <div>
      {items.map((item, i) => (
        <Space key={i} style={{ display: 'flex', marginBottom: 4 }} align="center">
          <Input
            placeholder="Key"
            value={item.key}
            style={{ width: 160 }}
            onChange={e => {
              const next = [...items];
              next[i] = { ...next[i], key: e.target.value };
              onChange(next);
            }}
          />
          <Input
            placeholder="Value"
            value={item.value}
            style={{ width: 240 }}
            onChange={e => {
              const next = [...items];
              next[i] = { ...next[i], value: e.target.value };
              onChange(next);
            }}
          />
          <Button
            danger type="text" icon={<DeleteOutlined />} size="small"
            onClick={() => onChange(items.filter((_, idx) => idx !== i))}
          />
        </Space>
      ))}
      <Button
        type="dashed" size="small" icon={<PlusOutlined />}
        onClick={() => onChange([...items, { key: '', value: '' }])}
      >
        添加{label}
      </Button>
    </div>
  );

  /* ── 响应头表格列 ── */
  const headerColumns = [
    { title: 'Header', dataIndex: 'key', width: 200, ellipsis: true },
    { title: 'Value', dataIndex: 'value', ellipsis: true },
  ];

  return (
    <div>
      <Radio.Group
        value={mode}
        onChange={e => setMode(e.target.value)}
        buttonStyle="solid"
        style={{ marginBottom: 16 }}
      >
        <Radio.Button value="http">HTTP 请求</Radio.Button>
        <Radio.Button value="ws">WebSocket</Radio.Button>
      </Radio.Group>

      {/* ────── HTTP 模式 ────── */}
      {mode === 'http' && (
        <div>
          {/* 请求行 */}
          <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
            <Select
              value={httpMethod}
              onChange={setHttpMethod}
              style={{ width: 120 }}
              options={[
                { value: 'GET', label: 'GET' },
                { value: 'POST', label: 'POST' },
                { value: 'PUT', label: 'PUT' },
                { value: 'PATCH', label: 'PATCH' },
                { value: 'DELETE', label: 'DELETE' },
                { value: 'HEAD', label: 'HEAD' },
                { value: 'OPTIONS', label: 'OPTIONS' },
              ]}
            />
            <Input
              value={httpPath}
              onChange={e => setHttpPath(e.target.value)}
              placeholder="/api/users"
              addonBefore={
                <Tooltip title="服务代理地址">
                  <span style={{ color: '#8c8c8c', fontSize: 12 }}>{accessPath}</span>
                </Tooltip>
              }
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              loading={httpLoading}
              onClick={handleSendHttp}
            >
              发送
            </Button>
          </Space.Compact>

          {/* 参数折叠面板 */}
          <Collapse
            size="small"
            style={{ marginBottom: 12 }}
            items={[
              {
                key: 'headers',
                label: `Headers${httpHeaders.length ? ` (${httpHeaders.filter(h => h.key).length})` : ''}`,
                children: <KVEditor items={httpHeaders} onChange={setHttpHeaders} label="Header" />,
              },
              {
                key: 'query',
                label: `Query Params${httpQuery.length ? ` (${httpQuery.filter(q => q.key).length})` : ''}`,
                children: <KVEditor items={httpQuery} onChange={setHttpQuery} label="参数" />,
              },
              ...(['POST', 'PUT', 'PATCH'].includes(httpMethod) ? [{
                key: 'body',
                label: 'Request Body',
                children: (
                  <TextArea
                    value={httpBody}
                    onChange={e => setHttpBody(e.target.value)}
                    rows={6}
                    placeholder='{ "key": "value" }'
                    style={{ fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace", fontSize: 13 }}
                  />
                ),
              }] : []),
            ]}
          />

          {/* 响应结果 */}
          {httpResponse ? (
            <Card
              size="small"
              title={
                <Space>
                  <span>响应</span>
                  <Tag color={statusColor(httpResponse.status)}>
                    {httpResponse.status} {httpResponse.statusText}
                  </Tag>
                  <span style={{ color: '#8c8c8c', fontSize: 12 }}>
                    {httpResponse.duration}ms
                  </span>
                </Space>
              }
            >
              <Collapse
                size="small"
                defaultActiveKey={['body']}
                items={[
                  {
                    key: 'headers',
                    label: `Response Headers (${Object.keys(httpResponse.headers).length})`,
                    children: (
                      <Table
                        size="small"
                        pagination={false}
                        columns={headerColumns}
                        dataSource={Object.entries(httpResponse.headers).map(([key, value]) => ({ key, value }))}
                        rowKey="key"
                      />
                    ),
                  },
                  {
                    key: 'body',
                    label: 'Response Body',
                    children: (
                      <pre style={{
                        background: '#1e1e1e',
                        color: '#d4d4d4',
                        padding: 12,
                        borderRadius: 6,
                        maxHeight: 400,
                        overflow: 'auto',
                        fontSize: 13,
                        fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        margin: 0,
                      }}>
                        {tryFormatJson(httpResponse.body)}
                      </pre>
                    ),
                  },
                ]}
              />
            </Card>
          ) : (
            !httpLoading && <Empty description="发送请求后在此查看响应" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </div>
      )}

      {/* ────── WebSocket 模式 ────── */}
      {mode === 'ws' && (
        <div>
          {/* 连接行 */}
          <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
            <Input
              value={wsPath}
              onChange={e => setWsPath(e.target.value)}
              placeholder="/ws"
              disabled={wsConnected}
              addonBefore={
                <Tooltip title="WebSocket 代理地址">
                  <span style={{ color: '#8c8c8c', fontSize: 12 }}>
                    {window.location.protocol === 'https:' ? 'wss://' : 'ws://'}
                    {window.location.host}{accessPath}
                  </span>
                </Tooltip>
              }
            />
            {wsConnected ? (
              <Button danger icon={<DisconnectOutlined />} onClick={handleWsDisconnect}>
                断开
              </Button>
            ) : (
              <Button type="primary" icon={<LinkOutlined />} onClick={handleWsConnect}>
                连接
              </Button>
            )}
          </Space.Compact>

          {/* 状态 */}
          <div style={{ marginBottom: 8 }}>
            <Tag color={wsConnected ? 'green' : 'default'}>
              {wsConnected ? '已连接' : '未连接'}
            </Tag>
          </div>

          {/* 发送消息 */}
          {wsConnected && (
            <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
              <TextArea
                value={wsMsg}
                onChange={e => setWsMsg(e.target.value)}
                placeholder='输入消息（支持纯文本或 JSON）'
                autoSize={{ minRows: 1, maxRows: 4 }}
                onPressEnter={e => {
                  if (!e.shiftKey) { e.preventDefault(); handleWsSend(); }
                }}
                style={{ fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace", fontSize: 13 }}
              />
              <Button type="primary" icon={<SendOutlined />} onClick={handleWsSend}>
                发送
              </Button>
            </Space.Compact>
          )}

          {/* 消息日志 */}
          <Card
            size="small"
            title="消息日志"
            extra={
              <Button
                type="text" size="small" icon={<ClearOutlined />}
                onClick={() => setWsLog([])}
              >
                清空
              </Button>
            }
          >
            <div style={{
              background: '#1e1e1e',
              color: '#d4d4d4',
              fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
              fontSize: 13,
              lineHeight: 1.6,
              padding: 12,
              borderRadius: 6,
              maxHeight: 400,
              minHeight: 150,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}>
              {wsLog.length === 0 ? (
                <span style={{ color: '#808080' }}>连接后在此查看消息</span>
              ) : (
                wsLog.map((entry, i) => (
                  <div key={i} style={{
                    color: entry.dir === 'send' ? '#89d185'
                      : entry.dir === 'recv' ? '#569cd6'
                        : '#808080',
                    borderBottom: '1px solid #333',
                    padding: '2px 0',
                  }}>
                    <span style={{ color: '#808080', marginRight: 8, fontSize: 11 }}>{entry.time}</span>
                    <span style={{ marginRight: 6 }}>
                      {entry.dir === 'send' ? '⬆ 发送' : entry.dir === 'recv' ? '⬇ 接收' : '⚙ 系统'}
                    </span>
                    {tryFormatJson(entry.text)}
                  </div>
                ))
              )}
              <div ref={wsLogEndRef} />
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
