/**
 * 系统监控 — 采集服务器 & 容器资源指标
 *
 * Linux: 读取 /proc/stat、/proc/meminfo、df、docker stats
 * Windows/Mac: 使用 os 模块提供基础数据（开发用途）
 */
import os from 'os';
import { execSync } from 'child_process';

const isLinux = process.platform === 'linux';

/* ═══════════════════════════════════════════
   类型定义
   ═══════════════════════════════════════════ */

export interface CpuInfo {
  /** 总使用率 0-100 */
  usagePercent: number;
  /** 核心数 */
  cores: number;
  /** 型号 */
  model: string;
}

export interface MemoryInfo {
  totalMB: number;
  usedMB: number;
  freeMB: number;
  usagePercent: number;
}

export interface DiskInfo {
  filesystem: string;
  mountpoint: string;
  totalGB: number;
  usedGB: number;
  availGB: number;
  usagePercent: number;
}

export interface ContainerStats {
  id: string;
  name: string;
  cpuPercent: number;
  memUsageMB: number;
  memLimitMB: number;
  memPercent: number;
  netIO: string;
  blockIO: string;
  pids: number;
}

export interface UptimeInfo {
  /** 系统运行时间（秒） */
  uptimeSeconds: number;
  /** 格式化的运行时间 */
  uptimeFormatted: string;
}

export interface SystemStats {
  timestamp: string;
  hostname: string;
  platform: string;
  uptime: UptimeInfo;
  cpu: CpuInfo;
  memory: MemoryInfo;
  disks: DiskInfo[];
  containers: ContainerStats[];
  loadAvg: number[];
}

/* ═══════════════════════════════════════════
   CPU 采集
   ═══════════════════════════════════════════ */

/** 存储上一次 CPU 时间，用于计算增量使用率 */
let prevCpuTimes: { idle: number; total: number } | null = null;

function readProcStat(): { idle: number; total: number } {
  try {
    const stat = require('fs').readFileSync('/proc/stat', 'utf-8');
    const line = stat.split('\n')[0]; // "cpu  user nice system idle ..."
    const parts = line.split(/\s+/).slice(1).map(Number);
    const idle = parts[3] + (parts[4] || 0); // idle + iowait
    const total = parts.reduce((a: number, b: number) => a + b, 0);
    return { idle, total };
  } catch {
    return { idle: 0, total: 0 };
  }
}

function getCpuUsageLinux(): number {
  const cur = readProcStat();
  if (!prevCpuTimes) {
    prevCpuTimes = cur;
    // 第一次调用没有增量数据，用瞬时 load 估算
    const load1 = os.loadavg()[0];
    const cores = os.cpus().length;
    return Math.min(100, (load1 / cores) * 100);
  }
  const dTotal = cur.total - prevCpuTimes.total;
  const dIdle = cur.idle - prevCpuTimes.idle;
  prevCpuTimes = cur;
  if (dTotal === 0) return 0;
  return Math.round(((dTotal - dIdle) / dTotal) * 1000) / 10;
}

function getCpuInfo(): CpuInfo {
  const cpus = os.cpus();
  let usagePercent: number;

  if (isLinux) {
    usagePercent = getCpuUsageLinux();
  } else {
    // Windows/Mac: 用 os 模块计算瞬时值
    const total = cpus.reduce((acc, c) => {
      const t = Object.values(c.times).reduce((a, b) => a + b, 0);
      return acc + t;
    }, 0);
    const idle = cpus.reduce((acc, c) => acc + c.times.idle, 0);
    usagePercent = Math.round(((total - idle) / total) * 1000) / 10;
  }

  return {
    usagePercent,
    cores: cpus.length,
    model: cpus[0]?.model || 'Unknown',
  };
}

/* ═══════════════════════════════════════════
   内存采集
   ═══════════════════════════════════════════ */

function getMemoryInfoLinux(): MemoryInfo {
  try {
    const meminfo = require('fs').readFileSync('/proc/meminfo', 'utf-8');
    const parse = (key: string): number => {
      const m = meminfo.match(new RegExp(`${key}:\\s+(\\d+)`));
      return m ? parseInt(m[1], 10) : 0;
    };
    const totalKB = parse('MemTotal');
    const freeKB = parse('MemFree');
    const buffersKB = parse('Buffers');
    const cachedKB = parse('Cached');
    const sReclaimKB = parse('SReclaimable');

    const totalMB = Math.round(totalKB / 1024);
    // 实际可用 ≈ free + buffers + cached + SReclaimable
    const availMB = Math.round((freeKB + buffersKB + cachedKB + sReclaimKB) / 1024);
    const usedMB = totalMB - availMB;

    return {
      totalMB,
      usedMB,
      freeMB: availMB,
      usagePercent: totalMB > 0 ? Math.round((usedMB / totalMB) * 1000) / 10 : 0,
    };
  } catch {
    return getMemoryInfoFallback();
  }
}

function getMemoryInfoFallback(): MemoryInfo {
  const totalMB = Math.round(os.totalmem() / 1024 / 1024);
  const freeMB = Math.round(os.freemem() / 1024 / 1024);
  const usedMB = totalMB - freeMB;
  return {
    totalMB,
    usedMB,
    freeMB,
    usagePercent: totalMB > 0 ? Math.round((usedMB / totalMB) * 1000) / 10 : 0,
  };
}

function getMemoryInfo(): MemoryInfo {
  return isLinux ? getMemoryInfoLinux() : getMemoryInfoFallback();
}

/* ═══════════════════════════════════════════
   磁盘采集
   ═══════════════════════════════════════════ */

function getDisks(): DiskInfo[] {
  try {
    if (isLinux) {
      const output = execSync("df -BG --output=source,target,size,used,avail,pcent -x tmpfs -x devtmpfs -x overlay 2>/dev/null || df -h", {
        encoding: 'utf-8',
        timeout: 5000,
      });
      const lines = output.trim().split('\n').slice(1);
      return lines
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 6) return null;
          return {
            filesystem: parts[0],
            mountpoint: parts[1],
            totalGB: parseFloat(parts[2]) || 0,
            usedGB: parseFloat(parts[3]) || 0,
            availGB: parseFloat(parts[4]) || 0,
            usagePercent: parseFloat(parts[5]) || 0,
          };
        })
        .filter(Boolean) as DiskInfo[];
    } else {
      // Windows: 用 wmic 或 PowerShell
      const output = execSync(
        'powershell -Command "Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{N=\'UsedGB\';E={[math]::Round($_.Used/1GB,1)}}, @{N=\'FreeGB\';E={[math]::Round($_.Free/1GB,1)}} | ConvertTo-Json"',
        { encoding: 'utf-8', timeout: 10000 },
      );
      const drives = JSON.parse(output);
      const list = Array.isArray(drives) ? drives : [drives];
      return list
        .filter((d: any) => (d.UsedGB || 0) + (d.FreeGB || 0) > 0)
        .map((d: any) => {
          const totalGB = (d.UsedGB || 0) + (d.FreeGB || 0);
          return {
            filesystem: `${d.Name}:`,
            mountpoint: `${d.Name}:\\`,
            totalGB: Math.round(totalGB * 10) / 10,
            usedGB: d.UsedGB || 0,
            availGB: d.FreeGB || 0,
            usagePercent: totalGB > 0 ? Math.round((d.UsedGB / totalGB) * 1000) / 10 : 0,
          };
        });
    }
  } catch {
    return [];
  }
}

/* ═══════════════════════════════════════════
   Docker 容器资源采集
   ═══════════════════════════════════════════ */

function getContainerStats(): ContainerStats[] {
  try {
    const output = execSync(
      'docker stats --no-stream --format "{{.ID}}|{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.NetIO}}|{{.BlockIO}}|{{.PIDs}}"',
      { encoding: 'utf-8', timeout: 15000 },
    );
    return output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [id, name, cpuStr, memUsage, memPercStr, netIO, blockIO, pidsStr] = line.split('|');

        // 解析内存用量 "123.4MiB / 1.94GiB"
        const memParts = (memUsage || '').split('/').map((s) => s.trim());
        const parseMemMB = (s: string): number => {
          const num = parseFloat(s) || 0;
          if (s.includes('GiB')) return num * 1024;
          if (s.includes('KiB')) return num / 1024;
          return num; // MiB
        };

        return {
          id: (id || '').slice(0, 12),
          name: (name || '').replace(/^\//, ''),
          cpuPercent: parseFloat(cpuStr) || 0,
          memUsageMB: Math.round(parseMemMB(memParts[0] || '0') * 10) / 10,
          memLimitMB: Math.round(parseMemMB(memParts[1] || '0') * 10) / 10,
          memPercent: parseFloat(memPercStr) || 0,
          netIO: netIO || '0B / 0B',
          blockIO: blockIO || '0B / 0B',
          pids: parseInt(pidsStr, 10) || 0,
        };
      });
  } catch {
    return [];
  }
}

/* ═══════════════════════════════════════════
   运行时间
   ═══════════════════════════════════════════ */

function getUptime(): UptimeInfo {
  const seconds = os.uptime();
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  let formatted = '';
  if (days > 0) formatted += `${days}天`;
  if (hours > 0) formatted += `${hours}小时`;
  formatted += `${mins}分钟`;

  return { uptimeSeconds: seconds, uptimeFormatted: formatted };
}

/* ═══════════════════════════════════════════
   对外接口
   ═══════════════════════════════════════════ */

/** 获取一次完整的系统状态快照 */
export function getSystemStats(): SystemStats {
  return {
    timestamp: new Date().toISOString(),
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    uptime: getUptime(),
    cpu: getCpuInfo(),
    memory: getMemoryInfo(),
    disks: getDisks(),
    containers: getContainerStats(),
    loadAvg: os.loadavg().map((v) => Math.round(v * 100) / 100),
  };
}
