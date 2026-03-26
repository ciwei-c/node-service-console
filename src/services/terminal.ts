/**
 * WebTerminal — 基于 WebSocket 的浏览器终端
 *
 * 通过 child_process.spawn 创建交互式 shell 进程，
 * 使用 WebSocket 双向传输 stdin/stdout。
 *
 * 安全：
 * - 需要 JWT 认证（通过 URL query 传递 token）
 * - 每个连接一个独立的 shell 进程
 * - 连接断开时自动清理进程
 */
import http from 'http';
import { spawn, type ChildProcess } from 'child_process';
import jwt from 'jsonwebtoken';
import { readLocalSettings } from '../store';

const isLinux = process.platform === 'linux';

interface TerminalSession {
  id: string;
  process: ChildProcess;
  createdAt: Date;
}

const sessions = new Map<string, TerminalSession>();

/** 验证 JWT token */
function verifyToken(token: string): boolean {
  try {
    const settings = readLocalSettings();
    const secret = settings.auth?.jwtSecret || 'fallback-secret';
    jwt.verify(token, secret);
    return true;
  } catch {
    return false;
  }
}

/** 生成简易 session id */
function genSessionId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * 将 WebSocket 终端挂到 HTTP server 的 upgrade 事件上。
 *
 * 使用原生 WebSocket 协议实现，不依赖 ws 库，避免额外安装。
 * 路径: /terminal/ws?token=xxx
 */
export function setupTerminalWs(server: http.Server): void {
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    if (url.pathname !== '/terminal/ws') return; // 不匹配，留给其他 upgrade handler

    const token = url.searchParams.get('token');
    if (!token || !verifyToken(token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // 手动完成 WebSocket 握手
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    const { createHash } = require('crypto');
    const acceptKey = createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-5AB5FC6D97E3')
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
      '\r\n'
    );

    // 启动 shell
    const shell = isLinux ? '/bin/bash' : 'powershell.exe';
    const args = isLinux ? ['--login'] : [];
    const proc = spawn(shell, args, {
      cwd: isLinux ? '/root' : process.env.USERPROFILE || 'C:\\',
      env: { ...process.env, TERM: 'xterm-256color', LANG: 'en_US.UTF-8' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const sessionId = genSessionId();
    sessions.set(sessionId, { id: sessionId, process: proc, createdAt: new Date() });

    // stdout/stderr → WebSocket
    const sendWsFrame = (data: Buffer) => {
      const payload = data;
      const len = payload.length;
      let header: Buffer;

      if (len < 126) {
        header = Buffer.alloc(2);
        header[0] = 0x81; // text frame, FIN
        header[1] = len;
      } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
      } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
      }

      try {
        socket.write(Buffer.concat([header, payload]));
      } catch { /* socket closed */ }
    };

    proc.stdout?.on('data', (data: Buffer) => sendWsFrame(data));
    proc.stderr?.on('data', (data: Buffer) => sendWsFrame(data));

    // WebSocket → stdin (解析 WebSocket 帧)
    let buffer = Buffer.alloc(0);

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= 2) {
        const opcode = buffer[0] & 0x0f;
        const masked = !!(buffer[1] & 0x80);
        let payloadLen = buffer[1] & 0x7f;
        let offset = 2;

        if (payloadLen === 126) {
          if (buffer.length < 4) return;
          payloadLen = buffer.readUInt16BE(2);
          offset = 4;
        } else if (payloadLen === 127) {
          if (buffer.length < 10) return;
          payloadLen = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }

        const maskLen = masked ? 4 : 0;
        const totalLen = offset + maskLen + payloadLen;
        if (buffer.length < totalLen) return;

        let payload = buffer.subarray(offset + maskLen, totalLen);
        if (masked) {
          const mask = buffer.subarray(offset, offset + maskLen);
          payload = Buffer.from(payload); // copy
          for (let i = 0; i < payload.length; i++) {
            payload[i] ^= mask[i % 4];
          }
        }

        buffer = buffer.subarray(totalLen);

        if (opcode === 0x08) {
          // Close frame
          const closeFrame = Buffer.alloc(2);
          closeFrame[0] = 0x88;
          closeFrame[1] = 0;
          try { socket.write(closeFrame); } catch { /* */ }
          cleanup();
          return;
        }

        if (opcode === 0x09) {
          // Ping → Pong
          const pong = Buffer.alloc(2 + payload.length);
          pong[0] = 0x8a;
          pong[1] = payload.length;
          payload.copy(pong, 2);
          try { socket.write(pong); } catch { /* */ }
          continue;
        }

        if (opcode === 0x01 || opcode === 0x02) {
          // Text or Binary: 写入 shell stdin
          const text = payload.toString('utf-8');

          // 特殊消息：resize
          if (text.startsWith('\x01RESIZE:')) {
            // 格式: \x01RESIZE:cols,rows
            // 注意：没有 PTY 时 resize 不生效，但不报错
            continue;
          }

          try {
            proc.stdin?.write(payload);
          } catch { /* process exited */ }
        }
      }
    });

    const cleanup = () => {
      sessions.delete(sessionId);
      try { proc.kill('SIGTERM'); } catch { /* */ }
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* */ }
      }, 1000);
      try { socket.destroy(); } catch { /* */ }
    };

    proc.on('exit', () => {
      sendWsFrame(Buffer.from('\r\n[进程已退出]\r\n'));
      sessions.delete(sessionId);
      setTimeout(() => {
        try { socket.destroy(); } catch { /* */ }
      }, 500);
    });

    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });

  console.log('[terminal] WebSocket 终端已就绪, 路径: /terminal/ws');
}
