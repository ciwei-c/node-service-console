/**
 * Git 远程仓库信息查询 + GitHub OAuth 授权
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { execSync } from 'child_process';
import { readLocalSettings, readOAuthToken, writeOAuthToken, removeOAuthToken } from '../store';
import { BASE_PATH } from '../app';

const router = Router();

/* ── 工具函数 ── */

async function githubAPI(path: string, token?: string): Promise<any> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'node-service-console',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function gitlabAPI(path: string, token?: string): Promise<any> {
  const headers: Record<string, string> = { 'User-Agent': 'node-service-console' };
  if (token) headers['PRIVATE-TOKEN'] = token;
  const res = await fetch(`https://gitlab.com/api/v4${path}`, { headers });
  if (!res.ok) throw new Error(`GitLab API ${res.status}: ${await res.text()}`);
  return res.json();
}

function gitLsRemoteBranches(repoUrl: string): string[] {
  try {
    const output = execSync(`git ls-remote --heads ${repoUrl}`, {
      encoding: 'utf-8',
      timeout: 15_000,
      env: { ...process.env, GIT_SSH_COMMAND: 'ssh -o StrictHostKeyChecking=no' },
    });
    return output
      .split('\n')
      .filter(Boolean)
      .map((line) => line.replace(/.*refs\/heads\//, ''));
  } catch {
    return [];
  }
}

/* ── 获取有效 token（优先 OAuth，降级到 query 参数） ── */

function resolveToken(query: Record<string, string>): string | undefined {
  const oauth = readOAuthToken();
  if (oauth?.accessToken) return oauth.accessToken;
  return query.token || undefined;
}

/* ── 获取仓库列表 ── */

router.get('/repos', async (req: Request, res: Response) => {
  const { source, owner } = req.query as Record<string, string>;
  if (!source || !owner) {
    return res.status(400).json({ message: '缺少 source 或 owner 参数' });
  }

  const token = resolveToken(req.query as Record<string, string>);

  try {
    let repos: { name: string; fullName: string; private: boolean; updatedAt: string }[];

    if (source === 'github') {
      // 尝试先当 org 查，失败则当 user 查
      let items: any[];
      try {
        items = await githubAPI(`/orgs/${owner}/repos?per_page=100&sort=updated`, token);
      } catch {
        items = await githubAPI(`/users/${owner}/repos?per_page=100&sort=updated`, token);
      }
      repos = items.map((r: any) => ({
        name: r.name,
        fullName: r.full_name,
        private: r.private,
        updatedAt: r.updated_at,
      }));
    } else {
      // GitLab: 按 username 查
      const users = await gitlabAPI(`/users?username=${encodeURIComponent(owner)}`, token);
      if (!users.length) return res.json({ data: [] });
      const userId = users[0].id;
      const items = await gitlabAPI(`/users/${userId}/projects?per_page=100&order_by=updated_at`, token);
      repos = items.map((r: any) => ({
        name: r.name,
        fullName: r.path_with_namespace,
        private: r.visibility === 'private',
        updatedAt: r.last_activity_at,
      }));
    }

    res.json({ data: repos });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

/* ── 获取分支列表 ── */

router.get('/branches', async (req: Request, res: Response) => {
  const { source, repository, authMode } = req.query as Record<string, string>;
  if (!source || !repository) {
    return res.status(400).json({ message: '缺少 source 或 repository 参数' });
  }

  const token = resolveToken(req.query as Record<string, string>);

  try {
    let branches: string[];

    if (token) {
      // 有 Token 时优先使用 API（能获取私有仓库分支）
      try {
        if (source === 'github') {
          const items = await githubAPI(`/repos/${repository}/branches?per_page=100`, token);
          branches = items.map((b: any) => b.name);
        } else {
          const encoded = encodeURIComponent(repository);
          const items = await gitlabAPI(`/projects/${encoded}/repository/branches?per_page=100`, token);
          branches = items.map((b: any) => b.name);
        }
      } catch {
        // API 失败时降级到 git ls-remote
        const host = source === 'github' ? 'github.com' : 'gitlab.com';
        branches = gitLsRemoteBranches(`git@${host}:${repository}.git`);
      }
    } else if (authMode === 'ssh') {
      // 无 Token + SSH 模式：git ls-remote
      const host = source === 'github' ? 'github.com' : 'gitlab.com';
      branches = gitLsRemoteBranches(`git@${host}:${repository}.git`);
      if (!branches.length) {
        // 降级到 HTTPS（公开仓库）
        branches = gitLsRemoteBranches(`https://${host}/${repository}.git`);
      }
    } else {
      // 无 Token + Token 模式：只能访问公开仓库
      if (source === 'github') {
        const items = await githubAPI(`/repos/${repository}/branches?per_page=100`);
        branches = items.map((b: any) => b.name);
      } else {
        const encoded = encodeURIComponent(repository);
        const items = await gitlabAPI(`/projects/${encoded}/repository/branches?per_page=100`);
        branches = items.map((b: any) => b.name);
      }
    }

    res.json({ data: branches });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

/* ══════════════════════════════════════════
   GitHub OAuth 授权
   ══════════════════════════════════════════ */

/** 获取 OAuth 绑定状态 */
router.get('/oauth/status', (_req: Request, res: Response) => {
  const oauth = readOAuthToken();
  const settings = readLocalSettings();
  const hasConfig = !!(settings.github?.clientId && settings.github?.clientSecret);

  if (oauth) {
    res.json({
      data: {
        bound: true,
        configured: hasConfig,
        provider: oauth.provider,
        username: oauth.username,
        avatarUrl: oauth.avatarUrl,
        boundAt: oauth.boundAt,
      },
    });
  } else {
    res.json({
      data: {
        bound: false,
        configured: hasConfig,
      },
    });
  }
});

/** 发起 GitHub OAuth 授权（重定向到 GitHub） */
router.get('/oauth/authorize', (_req: Request, res: Response) => {
  const settings = readLocalSettings();
  const clientId = settings.github?.clientId;
  if (!clientId) {
    return res.status(400).json({ message: '未配置 GitHub OAuth App，请在配置文件中设置 github.clientId 和 github.clientSecret' });
  }

  const scope = 'repo read:user';
  const redirectUri = `${_req.protocol}://${_req.get('host')}${BASE_PATH}/api/git/oauth/callback`;
  const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=${encodeURIComponent(scope)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  res.redirect(url);
});

/** GitHub OAuth 回调 */
router.get('/oauth/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  if (!code) {
    return res.status(400).send('缺少 code 参数');
  }

  const settings = readLocalSettings();
  const clientId = settings.github?.clientId;
  const clientSecret = settings.github?.clientSecret;
  if (!clientId || !clientSecret) {
    return res.status(400).send('未配置 GitHub OAuth App');
  }

  try {
    // 用 code 换 access_token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });
    const tokenData = await tokenRes.json() as any;
    if (!tokenData.access_token) {
      return res.status(400).send(`GitHub 授权失败: ${tokenData.error_description || tokenData.error || '未知错误'}`);
    }

    // 获取用户信息
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'node-service-console',
      },
    });
    const userData = await userRes.json() as any;

    // 保存 token
    writeOAuthToken({
      provider: 'github',
      accessToken: tokenData.access_token,
      username: userData.login || 'unknown',
      avatarUrl: userData.avatar_url || '',
      boundAt: new Date().toISOString(),
    });

    // 重定向回控制台首页
    res.redirect(BASE_PATH);
  } catch (err: any) {
    res.status(500).send(`OAuth 授权失败: ${err.message}`);
  }
});

/** 解除 GitHub 绑定 */
router.post('/oauth/unbind', (_req: Request, res: Response) => {
  removeOAuthToken();
  res.json({ data: { ok: true } });
});

export default router;
