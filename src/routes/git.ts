/**
 * Git 远程仓库信息查询 + GitHub Device Flow 授权
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { execSync } from 'child_process';
import { readLocalSettings, readOAuthToken, writeOAuthToken, removeOAuthToken } from '../store';

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
   GitHub Device Flow 授权
   ══════════════════════════════════════════ */

/** 获取 OAuth 绑定状态 */
router.get('/oauth/status', (_req: Request, res: Response) => {
  const oauth = readOAuthToken();
  const settings = readLocalSettings();
  const hasConfig = !!settings.github?.clientId;

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

/** 步骤 1：请求 Device Code */
router.post('/oauth/device-code', async (_req: Request, res: Response) => {
  const settings = readLocalSettings();
  const clientId = settings.github?.clientId;
  if (!clientId) {
    return res.status(400).json({ message: '未配置 GitHub App Client ID，请在配置文件中设置 github.clientId' });
  }

  try {
    const response = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        scope: 'repo read:user',
      }),
    });
    const data = await response.json() as any;

    if (!data.device_code) {
      return res.status(400).json({ message: data.error_description || data.error || '无法获取 Device Code' });
    }

    res.json({
      data: {
        deviceCode: data.device_code,
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        expiresIn: data.expires_in,
        interval: data.interval || 5,
      },
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

/** 步骤 2：轮询检查授权状态 */
router.post('/oauth/poll', async (req: Request, res: Response) => {
  const { deviceCode } = req.body;
  if (!deviceCode) {
    return res.status(400).json({ message: '缺少 deviceCode' });
  }

  const settings = readLocalSettings();
  const clientId = settings.github?.clientId;
  if (!clientId) {
    return res.status(400).json({ message: '未配置 GitHub App Client ID' });
  }

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const tokenData = await tokenRes.json() as any;

    // 用户尚未完成授权
    if (tokenData.error === 'authorization_pending') {
      return res.json({ data: { status: 'pending' } });
    }
    // 需要减慢轮询
    if (tokenData.error === 'slow_down') {
      return res.json({ data: { status: 'slow_down' } });
    }
    // Device Code 已过期
    if (tokenData.error === 'expired_token') {
      return res.json({ data: { status: 'expired' } });
    }
    // 其他错误
    if (tokenData.error) {
      return res.status(400).json({ message: tokenData.error_description || tokenData.error });
    }

    // 成功获取 token
    if (tokenData.access_token) {
      // 获取用户信息
      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'node-service-console',
        },
      });
      const userData = await userRes.json() as any;

      writeOAuthToken({
        provider: 'github',
        accessToken: tokenData.access_token,
        username: userData.login || 'unknown',
        avatarUrl: userData.avatar_url || '',
        boundAt: new Date().toISOString(),
      });

      return res.json({
        data: {
          status: 'success',
          username: userData.login,
          avatarUrl: userData.avatar_url,
        },
      });
    }

    res.status(400).json({ message: '未知响应' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

/** 解除 GitHub 绑定 */
router.post('/oauth/unbind', (_req: Request, res: Response) => {
  removeOAuthToken();
  res.json({ data: { ok: true } });
});

export default router;
