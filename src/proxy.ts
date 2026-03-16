/**
 * 反向代理 — 将 /<service-access-path>/* 的请求转发到容器端口
 *
 * 这样多个服务可以共享 80 端口，通过不同路径前缀区分。
 * 例如：http://server/duidui-dev/swagger → http://127.0.0.1:8080/swagger
 *
 * 额外处理：
 * - 注入 X-Forwarded-Prefix 等头，让后端框架感知代理前缀
 * - 对 OpenAPI/Swagger JSON 响应自动改写，注入前缀路径
 * - 对 HTML 响应注入 <base> 标签，确保相对路径请求正确
 */
import http from 'http';
import net from 'net';
import zlib from 'zlib';
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

/** 判断路径是否可能是 OpenAPI/Swagger JSON 端点 */
function isSwaggerJsonPath(p: string): boolean {
  const lower = p.toLowerCase();
  return /\/(swagger|api-docs|openapi)\b/.test(lower)
    || lower.endsWith('.json')
    || lower.endsWith('/swagger-resources');
}

/** 判断 Content-Type 是否为 JSON */
function isJsonContentType(ct: string | undefined): boolean {
  return !!ct && (ct.includes('application/json') || ct.includes('+json'));
}

/** 判断 Content-Type 是否为 HTML */
function isHtmlContentType(ct: string | undefined): boolean {
  return !!ct && ct.includes('text/html');
}

/**
 * 对 OpenAPI 2.x / 3.x JSON 注入前缀路径
 * - OpenAPI 2.x: 设置 basePath = prefix + 原 basePath
 * - OpenAPI 3.x: 在 servers[].url 前添加 prefix
 */
function rewriteOpenApiJson(body: string, prefix: string): string {
  try {
    const doc = JSON.parse(body);

    // OpenAPI 2.x (Swagger)
    if (doc.swagger && typeof doc.swagger === 'string') {
      const origBase = doc.basePath || '/';
      doc.basePath = prefix + (origBase === '/' ? '' : origBase);
      return JSON.stringify(doc);
    }

    // OpenAPI 3.x
    if (doc.openapi && typeof doc.openapi === 'string') {
      if (Array.isArray(doc.servers) && doc.servers.length > 0) {
        for (const server of doc.servers) {
          if (server.url && !server.url.startsWith('http')) {
            // 相对路径，直接拼前缀
            server.url = prefix + (server.url === '/' ? '' : server.url);
          }
        }
      } else {
        // 没有 servers 字段，添加一个
        doc.servers = [{ url: prefix }];
      }
      return JSON.stringify(doc);
    }

    // 不是标准 OpenAPI 文档，不改写
    return body;
  } catch {
    return body;
  }
}

/**
 * 对 HTML 响应注入 <base> 标签，确保 Swagger UI 等前端页面的相对路径正确
 */
function rewriteHtml(body: string, prefix: string): string {
  const baseTag = `<base href="${prefix}/">`;
  // 如果已经有 <base>，替换它
  if (/<base\s[^>]*>/i.test(body)) {
    return body.replace(/<base\s[^>]*>/i, baseTag);
  }
  // 注入到 <head> 之后
  if (/<head[^>]*>/i.test(body)) {
    return body.replace(/(<head[^>]*>)/i, `$1${baseTag}`);
  }
  // 兜底：注入到最前面
  return baseTag + body;
}

/**
 * 解压响应体（支持 gzip / deflate / br）
 */
function decompressBody(buf: Buffer, encoding: string | undefined): Buffer {
  if (!encoding) return buf;
  if (encoding === 'gzip') return zlib.gunzipSync(buf);
  if (encoding === 'deflate') return zlib.inflateSync(buf);
  if (encoding === 'br') return zlib.brotliDecompressSync(buf);
  return buf;
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
  const prefix = target.service.pipeline.accessPath || `/${target.service.name}`;
  const qs = req.originalUrl.includes('?')
    ? '?' + req.originalUrl.split('?').slice(1).join('?')
    : '';

  // 需要改写响应体的情况：Swagger JSON 或 HTML 页面
  const needRewrite = isSwaggerJsonPath(target.targetPath);

  const fwdHeaders: Record<string, string> = {
    ...req.headers as Record<string, string>,
    host: `127.0.0.1:${port}`,
    'x-forwarded-host': req.headers.host || '',
    'x-forwarded-proto': req.protocol,
    'x-forwarded-prefix': prefix,
  };
  // 如果需要改写响应，告诉后端不要压缩（方便我们解析）
  if (needRewrite) {
    delete fwdHeaders['accept-encoding'];
  }

  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port,
    path: target.targetPath + qs,
    method: req.method,
    headers: fwdHeaders,
  }, (proxyRes) => {
    const ct = proxyRes.headers['content-type'];

    // 不需要改写，或非 JSON/HTML 内容，直接透传
    if (!needRewrite && !isHtmlContentType(ct)) {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
      return;
    }

    // 需要检查并可能改写响应体
    const chunks: Buffer[] = [];
    proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
    proxyRes.on('end', () => {
      let raw = Buffer.concat(chunks);

      // 处理压缩
      const encoding = proxyRes.headers['content-encoding'];
      try { raw = decompressBody(raw, encoding); } catch { /* 解压失败，原样返回 */ }

      let body = raw.toString('utf-8');
      let rewritten = false;

      // Swagger/OpenAPI JSON 改写
      if (isJsonContentType(ct)) {
        const newBody = rewriteOpenApiJson(body, prefix);
        if (newBody !== body) {
          body = newBody;
          rewritten = true;
        }
      }

      // HTML 响应注入 <base> 标签
      if (isHtmlContentType(ct)) {
        body = rewriteHtml(body, prefix);
        rewritten = true;
      }

      // 构建响应头（去掉 content-encoding 和 content-length，重新计算）
      const resHeaders = { ...proxyRes.headers };
      if (rewritten || encoding) {
        delete resHeaders['content-encoding'];
        delete resHeaders['transfer-encoding'];
      }
      const buf = Buffer.from(body, 'utf-8');
      resHeaders['content-length'] = String(buf.length);
      res.writeHead(proxyRes.statusCode || 502, resHeaders);
      res.end(buf);
    });
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
