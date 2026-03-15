/**
 * 服务入口
 */
import app from './app';
import { readLocalSettings } from './store';

const port = process.env.PORT || readLocalSettings().server?.port || 3000;

app.listen(port, () => {
  console.log(`服务管理控制台已启动: http://localhost:${port}`);
});
