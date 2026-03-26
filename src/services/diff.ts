/**
 * 发布对比 (Publish Diff)
 *
 * 获取当前已部署 commit 到远程最新 commit 之间的提交列表，
 * 帮助用户在发布前了解即将上线的变更。
 */
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import type { Service } from '../types';

const execAsync = promisify(exec);

export interface DiffCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}

export interface PublishDiff {
  /** 当前已部署的 commit hash */
  currentCommitHash: string;
  /** 远程最新 commit hash */
  latestCommitHash: string;
  /** 两者之间的提交列表（新→旧） */
  commits: DiffCommit[];
  /** 总变更文件数 */
  filesChanged: number;
  /** 是否有新的提交 */
  hasChanges: boolean;
}

/**
 * 获取当前部署版本与远程最新版本之间的提交差异
 */
export async function getPublishDiff(service: Service): Promise<PublishDiff> {
  const p = service.pipeline;
  if (!p?.repository || !p?.branch) {
    throw new Error('服务未配置代码仓库');
  }

  // 获取当前已部署的 commit hash
  const currentDeployment = service.deployments.find(
    (d) => d.action === 'publish' && d.commitHash && d.version === service.currentVersion,
  );
  const currentCommitHash = currentDeployment?.commitHash || '';

  // 构建 repo URL
  const authMode = p.authMode || 'ssh';
  const token = p.gitToken || '';
  const repo = p.repository
    .replace(/^https?:\/\/[^/]+\//, '')
    .replace(/^git@[^:]+:/, '')
    .replace(/\.git$/, '');

  let repoUrl: string;
  if (authMode === 'ssh') {
    repoUrl = p.codeSource === 'github'
      ? `git@github.com:${repo}.git`
      : `git@gitlab.com:${repo}.git`;
  } else {
    if (p.codeSource === 'github') {
      repoUrl = token
        ? `https://${token}@github.com/${repo}.git`
        : `https://github.com/${repo}.git`;
    } else {
      repoUrl = token
        ? `https://oauth2:${token}@gitlab.com/${repo}.git`
        : `https://gitlab.com/${repo}.git`;
    }
  }

  const workDir = path.join(__dirname, '..', '..', 'tmp', `_diff_${service.name}_${Date.now()}`);

  try {
    fs.mkdirSync(workDir, { recursive: true });

    // 浅克隆（depth 限制为 200 条提交）
    await execAsync(
      `git clone --depth 200 --branch ${p.branch} --single-branch "${repoUrl}" "${workDir}"`,
      { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
    );

    // 获取远程最新 commit hash
    const { stdout: latestHash } = await execAsync(
      `git -C "${workDir}" log -1 --format=%H`,
      { encoding: 'utf-8' },
    );
    const latestCommitHash = latestHash.trim();

    // 如果没有当前部署，返回最近 20 条提交
    if (!currentCommitHash) {
      const { stdout } = await execAsync(
        `git -C "${workDir}" log -20 --format="%H||%h||%s||%an||%aI"`,
        { encoding: 'utf-8' },
      );
      return {
        currentCommitHash: '',
        latestCommitHash,
        commits: parseCommitLog(stdout),
        filesChanged: 0,
        hasChanges: true,
      };
    }

    // 如果 commit hash 相同，无变更
    if (currentCommitHash === latestCommitHash) {
      return {
        currentCommitHash,
        latestCommitHash,
        commits: [],
        filesChanged: 0,
        hasChanges: false,
      };
    }

    // 获取两个 commit 之间的提交列表
    let commits: DiffCommit[] = [];
    let filesChanged = 0;

    try {
      const { stdout } = await execAsync(
        `git -C "${workDir}" log --format="%H||%h||%s||%an||%aI" ${currentCommitHash}..HEAD`,
        { encoding: 'utf-8' },
      );
      commits = parseCommitLog(stdout);
    } catch {
      // 当前 commit 不在浅克隆范围内，取最近 50 条
      const { stdout } = await execAsync(
        `git -C "${workDir}" log -50 --format="%H||%h||%s||%an||%aI"`,
        { encoding: 'utf-8' },
      );
      commits = parseCommitLog(stdout);
    }

    try {
      const { stdout } = await execAsync(
        `git -C "${workDir}" diff --stat ${currentCommitHash}..HEAD`,
        { encoding: 'utf-8' },
      );
      // 最后一行是总结: X files changed, Y insertions(+), Z deletions(-)
      const lastLine = stdout.trim().split('\n').pop() || '';
      const m = lastLine.match(/(\d+) files? changed/);
      if (m) filesChanged = parseInt(m[1], 10);
    } catch {
      // 忽略
    }

    return {
      currentCommitHash,
      latestCommitHash,
      commits,
      filesChanged,
      hasChanges: commits.length > 0,
    };
  } finally {
    // 清理临时目录
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

function parseCommitLog(stdout: string): DiffCommit[] {
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('||');
      return {
        hash: parts[0] || '',
        shortHash: parts[1] || '',
        message: parts[2] || '',
        author: parts[3] || '',
        date: parts[4] || '',
      };
    });
}
