/**
 * Git 远程仓库信息查询（仓库列表、分支列表）
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { execSync } from 'child_process';

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

/* ── 获取仓库列表 ── */

router.get('/repos', async (req: Request, res: Response) => {
  const { source, owner, token } = req.query as Record<string, string>;
  if (!source || !owner) {
    return res.status(400).json({ message: '缺少 source 或 owner 参数' });
  }

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
  const { source, repository, authMode, token } = req.query as Record<string, string>;
  if (!source || !repository) {
    return res.status(400).json({ message: '缺少 source 或 repository 参数' });
  }

  try {
    let branches: string[];

    if (authMode === 'ssh') {
      // 通过 git ls-remote 使用 SSH Key 获取分支
      const host = source === 'github' ? 'github.com' : 'gitlab.com';
      const repoUrl = `git@${host}:${repository}.git`;
      branches = gitLsRemoteBranches(repoUrl);
      if (!branches.length) {
        // 降级到 HTTPS 尝试（公开仓库）
        branches = gitLsRemoteBranches(`https://${host}/${repository}.git`);
      }
    } else {
      // 通过 API 获取（需 token 访问私有仓库）
      if (source === 'github') {
        const items = await githubAPI(`/repos/${repository}/branches?per_page=100`, token);
        branches = items.map((b: any) => b.name);
      } else {
        const encoded = encodeURIComponent(repository);
        const items = await gitlabAPI(`/projects/${encoded}/repository/branches?per_page=100`, token);
        branches = items.map((b: any) => b.name);
      }
    }

    res.json({ data: branches });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
