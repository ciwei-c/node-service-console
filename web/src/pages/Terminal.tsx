/**
 * WebTerminal — 浏览器终端页面
 *
 * 使用 @xterm/xterm 连接后端 WebSocket 终端 (/terminal/ws)
 */
import { useEffect, useRef, useState } from 'react';
import { Card, Button, Space, message, Tag } from 'antd';
import { ReloadOutlined, DisconnectOutlined } from '@ant-design/icons';
// @ts-ignore — @xterm/xterm has no bundled types
import { Terminal as XTerm } from '@xterm/xterm';
// @ts-ignore
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { getToken } from '../api';

type ConnStatus = 'connecting' | 'connected' | 'disconnected';

export default function TerminalPage() {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<ConnStatus>('disconnected');

  const connect = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // 清空旧终端
    const container = termRef.current;
    if (!container) return;

    if (xtermRef.current) {
      xtermRef.current.dispose();
    }

    const xterm = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", Menlo, Monaco, monospace',
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#585b7066',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#f5c2e7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#f5c2e7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8',
      },
    });

    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(container);
    fit.fit();

    xtermRef.current = xterm;
    fitRef.current = fit;

    // 建立 WebSocket 连接
    const token = getToken();
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/terminal/ws?token=${encodeURIComponent(token || '')}`;

    setStatus('connecting');
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      xterm.focus();
      // 发送初始 resize
      const dims = fit.proposeDimensions();
      if (dims) {
        ws.send(`\x01RESIZE:${dims.cols},${dims.rows}`);
      }
    };

    ws.onmessage = (e) => {
      xterm.write(e.data);
    };

    ws.onclose = () => {
      setStatus('disconnected');
      xterm.write('\r\n\x1b[33m[连接已断开]\x1b[0m\r\n');
    };

    ws.onerror = () => {
      message.error('WebSocket 连接失败');
    };

    // xterm → WebSocket
    xterm.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // 窗口 resize
    const handleResize = () => {
      fit.fit();
      const dims = fit.proposeDimensions();
      if (dims && ws.readyState === WebSocket.OPEN) {
        ws.send(`\x01RESIZE:${dims.cols},${dims.rows}`);
      }
    };
    window.addEventListener('resize', handleResize);

    // 存到闭包中用于后续 cleanup
    (ws as any)._resizeHandler = handleResize;
  };

  const disconnect = () => {
    if (wsRef.current) {
      const handler = (wsRef.current as any)._resizeHandler;
      if (handler) window.removeEventListener('resize', handler);
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus('disconnected');
  };

  useEffect(() => {
    connect();
    return () => {
      disconnect();
      if (xtermRef.current) {
        xtermRef.current.dispose();
        xtermRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const statusTag = {
    connecting: <Tag color="processing">连接中...</Tag>,
    connected: <Tag color="success">已连接</Tag>,
    disconnected: <Tag color="default">未连接</Tag>,
  }[status];

  return (
    <div style={{ padding: 24, height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column' }}>
      <Card
        title={<Space>WebTerminal {statusTag}</Space>}
        extra={
          <Space>
            {status === 'connected' ? (
              <Button icon={<DisconnectOutlined />} onClick={disconnect}>断开</Button>
            ) : (
              <Button type="primary" icon={<ReloadOutlined />} onClick={connect}>
                {status === 'disconnected' ? '连接' : '重连'}
              </Button>
            )}
          </Space>
        }
        bodyStyle={{ flex: 1, padding: 0, overflow: 'hidden' }}
        style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
      >
        <div
          ref={termRef}
          style={{
            flex: 1,
            height: '100%',
            minHeight: 400,
            background: '#1e1e2e',
            padding: 4,
          }}
        />
      </Card>
    </div>
  );
}
