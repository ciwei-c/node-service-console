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

启动后访问：`http://localhost:3000`

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
    ├── services.ts        # /api/services/*
    ├── containers.ts      # /api/containers/*
    ├── webhook.ts         # /api/webhook
    ├── logs.ts            # /api/logs
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
| GET | `/api/services` | 服务列表 |
| POST | `/api/services` | 创建服务 |
| GET | `/api/services/:id` | 服务详情（ID） |
| GET | `/api/services/by-name/:name` | 服务详情（名称） |
| DELETE | `/api/services/:id` | 删除服务 |
| POST | `/api/services/:id/publish` | 发布 |
| POST | `/api/services/:id/rollback` | 回退 |
| DELETE | `/api/services/:id/deployments/:depId` | 删除版本 |
| POST | `/api/services/:id/stop` | 停止 |
| POST | `/api/services/:id/start` | 启动 |
| PUT | `/api/services/:id/env` | 更新环境变量 |
| PUT | `/api/services/:id/pipeline` | 更新流水线配置 |

### 容器

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/containers` | 容器列表 |
| GET | `/api/containers/:id/inspect` | 容器详情 |
| GET | `/api/containers/:id/logs` | 容器日志 |

### Webhook

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/webhook` | GitHub/GitLab push 自动发布 |

### 操作日志

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/logs` | 日志列表（支持筛选分页） |
| GET | `/api/logs/service-names` | 有日志的服务名称列表 |

## 部署

```bash
# 安装依赖
npm install
cd web && npm install && npm run build && cd ..

# 直接启动
npm start

# 或使用 pm2
pm2 start "npx tsx src/server.ts" --name service-console
```

默认端口 `3000`，可在配置文件中修改（Linux: `/etc/node-service-console/config.json`）。
