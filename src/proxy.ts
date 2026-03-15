/**
 * 反向代理 — 将 /<service-access-path>/* 的请求转发到容器端口
 *
 * 这样多个服务可以共享 80 端口，通过不同路径前缀区分。
 * 例如：http://server/duidui-dev/swagger → http://127.0.0.1:8080/swagger
 */
import http from 'http';
import net from 'net';
import type { Request, Response, NextFunction } from 'express';
import { listServices } from './services';
import type { Service } from './types';

interface ProxyTarget {
  service: Service;
  targetPath: string;
}

/** 根据请求路径匹配正在运行的服务 */
function findTarget(pathname: string): ProxyTarget | null {
  const services = listServices().filter((s) => s.status === 'running' && (s.hostPort || s.pipeline?.port));
  for (const svc of services) {
    const prefix = svc.pipeline.accessPath || `/${svc.name}`;
    if (pathname === prefix || pathname.startsWith(prefix + '/')) {
      const targetPath = pathname.slice(prefix.length) || '/';
      return { service: svc, targetPath };
    }
  }
  return null;
}

/**
 * Express 中间件 — HTTP 反向代理
 *
 * 必须放在 express.json() 之前，这样请求体 stream 不会被消费。
 */
export function reverseProxy(req: Request, res: Response, next: NextFunction): void {
  const target = findTarget(req.path);
  if (!target) { next(); return; }

  const port = target.service.hostPort || target.service.pipeline.port;
  const qs = req.originalUrl.includes('?')
    ? '?' + req.originalUrl.split('?').slice(1).join('?')
    : '';

  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port,
    path: target.targetPath + qs,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${port}` },
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).json({ message: `代理请求失败: ${err.message}` });
    }
  });

  req.pipe(proxyReq);
}

/**
 * WebSocket 升级代理
 *
 * 在 HTTP server 上监听 upgrade 事件，将匹配的 WebSocket 连接转发到容器端口。
 */
export function setupWsProxy(server: http.Server): void {
  server.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    const pathname = url.split('?')[0];
    const target = findTarget(pathname);
    if (!target) return; // 不匹配的升级请求不处理

    const port = target.service.hostPort || target.service.pipeline.port;
    const qs = url.includes('?') ? '?' + url.split('?').slice(1).join('?') : '';

    const proxySocket = net.connect(port, '127.0.0.1', () => {
      // 重建 HTTP Upgrade 请求发送到目标服务
      const rawHeaders = req.rawHeaders;
      const headerLines: string[] = [];
      for (let i = 0; i < rawHeaders.length; i += 2) {
        if (rawHeaders[i].toLowerCase() === 'host') {
          headerLines.push(`Host: 127.0.0.1:${port}`);
        } else {
          headerLines.push(`${rawHeaders[i]}: ${rawHeaders[i + 1]}`);
        }
      }

      const upgradeReq =
        `GET ${target.targetPath}${qs} HTTP/1.1\r\n` +
        headerLines.join('\r\n') +
        '\r\n\r\n';

      proxySocket.write(upgradeReq);
      if (head.length) proxySocket.write(head);

      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
    });

    proxySocket.on('error', () => socket.destroy());
    socket.on('error', () => proxySocket.destroy());
  });
}
