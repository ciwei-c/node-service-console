/**
 * GitHub / GitLab Webhook 路由
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { listServices, publishServiceAsync } from '../services';
import { addLog } from '../services/logs';

const router = Router();

/**
 * 从仓库配置中提取 owner/repo 短格式
 * 支持：https://github.com/owner/repo、git@github.com:owner/repo.git、owner/repo
 */
function extractRepoShortName(repo: string): string {
  if (!repo) return '';
  // https://github.com/owner/repo 或 https://github.com/owner/repo.git
  const httpsMatch = repo.match(/(?:github\.com|gitlab\.com)[/:]([^/]+\/[^/]+?)(?:\.git)?$/i);
  if (httpsMatch) return httpsMatch[1];
  // git@github.com:owner/repo.git
  const sshMatch = repo.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];
  // 已经是 owner/repo 格式
  return repo;
}

router.post('/', (req: Request, res: Response) => {
  const payload = req.body;

  let repoFullName = '';
  let branch = '';

  if (payload.repository?.full_name) {
    // GitHub push event
    repoFullName = payload.repository.full_name;
    branch = (payload.ref || '').replace('refs/heads/', '');
  } else if (payload.project?.path_with_namespace) {
    // GitLab push event
    repoFullName = payload.project.path_with_namespace;
    branch = (payload.ref || '').replace('refs/heads/', '');
  }

  if (!repoFullName) {
    return res.status(400).json({ message: '无法解析仓库信息' });
  }

  const services = listServices();
  const matched = services.filter(
    (s) => extractRepoShortName(s.pipeline?.repository || '') === repoFullName && s.pipeline?.branch === branch,
  );

  if (matched.length === 0) {
    return res.json({ message: '没有匹配的服务', repo: repoFullName, branch });
  }

  const results = matched.map((svc) => {
    const result = publishServiceAsync(svc.id);
    const success = result !== null && !('error' in result);
    const ver = result && !('error' in result) ? result.version : undefined;

    addLog({
      action: 'webhook',
      serviceName: svc.name,
      success,
      version: ver,
      detail: `Webhook 触发发布 [${repoFullName}@${branch}]${success ? ` → ${ver}（构建中）` : ' → 失败'}`,
    });

    return {
      service: svc.name,
      success,
      version: ver,
      error: result && 'error' in result ? result.error : undefined,
    };
  });

  return res.json({ message: `触发 ${results.length} 个服务发布`, results });
});

export default router;
