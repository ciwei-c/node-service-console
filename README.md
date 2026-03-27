# 堆堆岛服务管理控制台

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
| SSH Key 认证 | 使用服务器 SSH 密钥拉取私有仓库，永不过期，无需 Token |
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

## 部署操作手册

> 以下操作均在云服务器上以 **root** 用户执行（适用于 OpenCloudOS 9 等默认 root 登录的系统）。

### 前置条件

服务器需要已安装以下软件：

```bash
# 确认是否已安装
node -v        # Node.js（建议 18+）
npm -v         # npm
docker -v      # Docker
git --version  # Git
```

如未安装，请先安装对应软件后再继续。

---

### 第一步：首次部署

只需在服务器上执行一次，完成后服务会随系统开机自动启动。

```bash
# 1. 克隆代码到服务器
git clone https://github.com/ciwei-c/node-service-console.git /opt/node-service-console

# 2. 进入项目目录
cd /opt/node-service-console

# 3. 给脚本添加执行权限（只需一次）
chmod +x install.sh update.sh uninstall.sh

# 4. 执行安装
./install.sh
```

安装脚本会自动完成：
1. 安装后端依赖
2. 安装前端依赖并构建
3. 将 `node-service-console.service` 注册到 systemd
4. 启用开机自启（`systemctl enable`）
5. 立即启动服务（`systemctl start`）

安装完成后，浏览器访问：`http://你的服务器IP/node-service-console`

---

### 第二步：日常更新代码

当你在本地修改了代码并 push 到 Git 之后，SSH 登录服务器执行：

```bash
cd /opt/node-service-console
./update.sh
```

更新脚本会自动完成：`git pull` → 安装依赖 → 构建前端 → 重启服务。

> **注意**：必须先执行过 `install.sh` 注册 systemd 服务后，`update.sh` 才能正常工作。  
> 如果报 `Unit node-service-console.service not found`，说明还没执行过 `install.sh`。

---

### 服务管理命令

```bash
# 查看服务运行状态
systemctl status node-service-console

# 查看实时日志输出
journalctl -u node-service-console -f

# 重启服务
systemctl restart node-service-console

# 停止服务
systemctl stop node-service-console

# 启动服务
systemctl start node-service-console

# 禁用开机自启
systemctl disable node-service-console

# 重新启用开机自启
systemctl enable node-service-console
```

---

### 卸载

```bash
cd /opt/node-service-console
./uninstall.sh
```

卸载后配置和数据文件会保留，如需彻底清除：

```bash
rm -rf /etc/node-service-console /var/lib/node-service-console
```

---

### 端口与访问路径

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| 端口 | `80` | HTTP 默认端口，浏览器无需输入端口号 |
| 访问路径 | `/node-service-console` | 浏览器输入 `http://IP/node-service-console` 即可访问 |
| 配置文件 | `/etc/node-service-console/config.json` | 可修改端口等配置，修改后执行 `systemctl restart node-service-console` |

### 本地开发

```bash
# 安装依赖
npm install
cd web && npm install && cd ..

# 终端 1 — 启动后端（默认 80 端口）
npm run dev

# 终端 2 — 启动前端（Vite 开发服务器，5173 端口，自动代理 API）
npm run dev:web
```

---

### 绑定 GitHub（查看私有仓库）

绑定 GitHub 账号后，可在控制台中浏览和选择你的所有仓库（包括私有仓库），无需手动填写。

**1. 注册 GitHub App（一次性）**

1. 打开 https://github.com/settings/apps/new
2. 填写：
   - **GitHub App name**：`Service Console`（随意取名）
   - **Homepage URL**：`http://你的服务器IP/node-service-console`
   - 取消勾选 **Webhook → Active**
   - **Device Flow**：✅ 勾选 **Enable Device Flow**
3. 点击 **Create GitHub App**
4. 记录页面上显示的 **Client ID**

**2. 在服务器配置 Client ID**

```bash
cat > /etc/node-service-console/config.json << 'EOF'
{
  "server": { "port": 80 },
  "github": {
    "clientId": "你的Client ID"
  }
}
EOF

systemctl restart node-service-console
```

**3. 绑定账号**

1. 刷新控制台页面，右上角出现 **「绑定 GitHub」** 按钮
2. 点击后弹出验证码，同时自动打开 GitHub 验证页面
3. 在 GitHub 页面输入验证码，点击授权
4. 控制台自动完成绑定，右上角显示你的 GitHub 头像和用户名

绑定后即可在流水线配置中查看和选择所有仓库及分支。Token **永不过期**。

---

### SSH Key 配置（克隆私有仓库代码）

使用 SSH Key 认证拉取私有仓库代码，密钥永不过期。

**1. 在服务器生成 SSH 密钥**

```bash
# 一路回车即可（不设密码）
ssh-keygen -t ed25519 -C "node-service-console"

# 查看公钥
cat ~/.ssh/id_ed25519.pub
```

**2. 将公钥添加到 GitHub / GitLab**

- **GitHub**：Settings → SSH and GPG keys → New SSH key → 粘贴公钥
- **GitLab**：Preferences → SSH Keys → Add new key → 粘贴公钥

**3. 验证连接**

```bash
ssh -T git@github.com
```

看到 `Hi xxx! You've successfully authenticated` 即表示配置成功。

之后在控制台创建服务时，认证方式选择 **SSH Key** 即可自动通过 SSH 拉取私有仓库代码。
