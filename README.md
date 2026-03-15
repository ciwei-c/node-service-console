# 服务管理控制台

基于 Node.js + React 的 Docker 服务管理平台，支持服务发布、回退、环境变量配置、Webhook 自动部署、容器监控和操作日志。

## 技术栈

- **后端**：Express 4 + TypeScript（`tsx` 运行）
- **前端**：React 18 + TypeScript + Vite 6 + Ant Design 5
- **容器化**：Docker（构建镜像、运行容器、回退、自动清理）
- **数据持久化**：JSON 文件（`data/store.json`、`data/logs.json`）

## 快速启动

```bash
npm install
cd web && npm install && npm run build && cd ..
npm start
```

启动后访问：`http://localhost/node-service-console`

开发模式：

```bash
# 终端 1 — 后端
npm run dev

# 终端 2 — 前端
npm run dev:web
```

## 项目结构

```text
src/
├── server.ts              # 入口：读取端口配置，启动 Express
├── app.ts                 # Express 中间件、路由挂载、SPA fallback
├── types.ts               # 所有 TypeScript 类型定义
├── store.ts               # JSON 文件持久化层
├── docker.ts              # Docker/Shell 操作封装
├── helpers.ts             # Token 脱敏工具
├── services/
│   ├── crud.ts            # 服务 CRUD（创建/删除/查询 + 名称唯一性）
│   ├── deploy.ts          # 发布/回退/删除版本
│   ├── lifecycle.ts       # 启停、环境变量、流水线配置
│   ├── logs.ts            # 操作日志记录与查询
│   └── index.ts           # 统一导出
└── routes/
    ├── services.ts        # /node-service-console/api/services/*
    ├── containers.ts      # /node-service-console/api/containers/*
    ├── webhook.ts         # /node-service-console/api/webhook
    ├── logs.ts            # /node-service-console/api/logs
    └── index.ts           # 统一导出

web/                       # React 前端（Vite 构建）
├── src/
│   ├── pages/
│   │   ├── ServiceList.tsx    # 服务列表（卡片布局）
│   │   ├── ServiceDetail.tsx  # 服务详情（部署/设置 Tab）
│   │   ├── ContainerList.tsx  # Docker 容器列表
│   │   └── LogList.tsx        # 操作日志（多维查询）
│   ├── components/
│   │   └── AppLayout.tsx      # 导航布局
│   ├── api.ts                 # API 请求封装
│   └── types.ts               # 前端类型定义
└── dist/                      # 构建产物（Express 静态服务）
```

### 配置与数据目录

| 平台 | 配置文件 | 数据目录 |
|------|----------|----------|
| Linux | `/etc/node-service-console/config.json` | `/var/lib/node-service-console/` |
| Windows/Mac（开发） | `config/local-settings.json` | `data/` |

数据目录包含 `store.json`（服务数据）和 `logs.json`（操作日志），首次启动自动创建。

## 主要功能

| 功能 | 说明 |
|------|------|
| 服务管理 | 创建/删除服务，名称唯一性校验 |
| Docker 发布 | 自动 clone → build → run，版本自增 |
| 版本回退 | 回退到历史版本，拉取旧镜像重新启动 |
| 容器生命周期 | 启动/停止容器，删除时自动清理 Docker 资源 |
| 环境变量 | 服务级别 KEY=VALUE 配置 |
| 流水线配置 | Git 仓库、分支、Dockerfile 路径、保留镜像数 |
| Git Token | 支持私有仓库 PAT 认证，API 响应自动脱敏 |
| Webhook | GitHub/GitLab push 事件自动触发发布 |
| 容器监控 | 列出所有 Docker 容器，查看详情/环境变量/端口/日志 |
| 操作日志 | 全量操作记录，支持时间/服务/类型/结果/关键词筛选 |

## API 概览

### 服务

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/node-service-console/api/services` | 服务列表 |
| POST | `/node-service-console/api/services` | 创建服务 |
| GET | `/node-service-console/api/services/:id` | 服务详情（ID） |
| GET | `/node-service-console/api/services/by-name/:name` | 服务详情（名称） |
| DELETE | `/node-service-console/api/services/:id` | 删除服务 |
| POST | `/node-service-console/api/services/:id/publish` | 发布 |
| POST | `/node-service-console/api/services/:id/rollback` | 回退 |
| DELETE | `/node-service-console/api/services/:id/deployments/:depId` | 删除版本 |
| POST | `/node-service-console/api/services/:id/stop` | 停止 |
| POST | `/node-service-console/api/services/:id/start` | 启动 |
| PUT | `/node-service-console/api/services/:id/env` | 更新环境变量 |
| PUT | `/node-service-console/api/services/:id/pipeline` | 更新流水线配置 |

### 容器

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/node-service-console/api/containers` | 容器列表 |
| GET | `/node-service-console/api/containers/:id/inspect` | 容器详情 |
| GET | `/node-service-console/api/containers/:id/logs` | 容器日志 |

### Webhook

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/node-service-console/api/webhook` | GitHub/GitLab push 自动发布 |

### 操作日志

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/node-service-console/api/logs` | 日志列表（支持筛选分页） |
| GET | `/node-service-console/api/logs/service-names` | 有日志的服务名称列表 |

## 部署

### 方式一：一键安装（推荐）

将项目上传到云服务器后，执行安装脚本即可自动部署并注册为系统服务，**开机自动启动**：

```bash
# 上传项目到服务器后
chmod +x install.sh
sudo ./install.sh
```

安装脚本会自动完成：
1. 复制项目到 `/opt/node-service-console/`
2. 安装依赖并构建前端
3. 注册 systemd 服务并启用开机自启
4. 立即启动服务

常用管理命令：

```bash
# 查看服务状态
sudo systemctl status node-service-console

# 查看实时日志
sudo journalctl -u node-service-console -f

# 重启服务
sudo systemctl restart node-service-console

# 停止服务
sudo systemctl stop node-service-console

# 禁用开机自启
sudo systemctl disable node-service-console
```

卸载：

```bash
chmod +x uninstall.sh
sudo ./uninstall.sh
```

### 方式二：手动启动

```bash
# 安装依赖
npm install
cd web && npm install && npm run build && cd ..

# 直接启动
npm start

# 或使用 pm2
pm2 start "npx tsx src/server.ts" --name service-console
```

默认端口 `80`，访问路径 `/node-service-console`，可在配置文件中修改端口（Linux: `/etc/node-service-console/config.json`）。
