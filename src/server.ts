/**
 * 服务入口
 */
import os from 'os';
import app from './app';
import { BASE_PATH } from './app';
import { readLocalSettings } from './store';

function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  for (const devName of Object.keys(interfaces)) {
    for (const iface of interfaces[devName] || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

const port = process.env.PORT || readLocalSettings().server?.port || 80;

app.listen(port, () => {
  const host = getLocalIP();
  const portSuffix = Number(port) === 80 ? '' : `:${port}`;
  console.log(`服务管理控制台已启动: http://${host}${portSuffix}${BASE_PATH}`);
});
