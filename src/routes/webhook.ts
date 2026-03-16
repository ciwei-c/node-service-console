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
  let pusher = '';
  let headCommitMsg = '';
  let commitCount = 0;

  if (payload.repository?.full_name) {
    // GitHub push event
    repoFullName = payload.repository.full_name;
    branch = (payload.ref || '').replace('refs/heads/', '');
    pusher = payload.pusher?.name || payload.sender?.login || '';
    headCommitMsg = payload.head_commit?.message?.split('\n')[0] || '';
    commitCount = payload.commits?.length || 0;
  } else if (payload.project?.path_with_namespace) {
    // GitLab push event
    repoFullName = payload.project.path_with_namespace;
    branch = (payload.ref || '').replace('refs/heads/', '');
    pusher = payload.user_name || payload.user_username || '';
    const commits = payload.commits || [];
    commitCount = commits.length;
    headCommitMsg = commits.length > 0 ? (commits[commits.length - 1].message?.split('\n')[0] || '') : '';
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

  // 构建 Webhook 备注
  const noteParts: string[] = [];
  if (pusher) noteParts.push(pusher);
  if (commitCount > 0) noteParts.push(`${commitCount} commit${commitCount > 1 ? 's' : ''}`);
  if (headCommitMsg) noteParts.push(headCommitMsg);
  const webhookNote = noteParts.length > 0
    ? `Webhook: ${noteParts.join(' · ')}`
    : `Webhook: ${repoFullName}@${branch}`;

  const results = matched.map((svc) => {
    // 强制模式：如果有正在进行的发布，中止它
    const result = publishServiceAsync(svc.id, { force: true });
    const success = result !== null && !('error' in result);
    const ver = result && !('error' in result) ? result.version : undefined;

    addLog({
      action: 'webhook',
      serviceName: svc.name,
      success,
      version: ver,
      detail: `${webhookNote}${success ? ` → ${ver}（构建中）` : ' → 失败'}`,
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
