# PicUp

PicUp 是一个响应式在线 AI 图片处理工作台。当前 MVP 包含：

- Next.js 前端工作台
- NestJS API
- Worker 异步任务处理
- 本地图片上传与结果存储
- PostgreSQL + Prisma 数据持久化
- Redis 图片任务队列
- GrsAI、Gemini Official 和 OpenAI Images 兼容 Provider
- JSON 驱动的 AI Provider 与模型配置
- Mock Provider 本地演示
- 单应用镜像 Docker 部署
- GitHub Actions 自动检查与部署

## 本地开发

```bash
cp .env.example .env
cp config/ai-config.example.json config/ai-config.json
pnpm install
pnpm dev
```

访问：

- Web: http://localhost:3000
- API: http://localhost:4000/api/health

默认 `config/ai-config.json` 中的 `mockEnabled=true`，不需要 API Key 就可以跑通上传、创建任务、轮询和结果预览。

## AI Provider 配置

AI Provider 不再分别占用大量环境变量。`.env` 只保留配置文件位置：

```env
AI_CONFIG_PATH=./config/ai-config.json
```

`config/ai-config.json` 统一保存：

- Provider ID、类型和启用状态
- API Key 与 Base URL
- 生成、查询、编辑等请求路径
- 模型列表、别名、积分和输入限制
- 默认路由与专业任务路由
- 超时、重试和 Provider 代理

默认路由使用 GrsAI。Google Gemini 官方 Provider 作为独立的 `gemini-official` 保留，默认禁用，可在管理后台单独配置和启用。TokenRun 使用 `openai-images` 兼容适配器。

真实调用前，将 `mockEnabled` 改为 `false`，并为启用的 Provider 填写 `apiKey`。运行中的 API 和 Worker 会在配置文件变化后自动重新读取。

如果当前网络需要代理访问 Google API，需要在 `.env` 中配置 Node 可以读取的代理：

```env
HTTPS_PROXY=http://127.0.0.1:7890
HTTP_PROXY=http://127.0.0.1:7890
```

端口请改成你本机代理软件实际监听端口。

如果是在 Docker 容器里访问宿主机代理，不能使用 `127.0.0.1`，因为容器内的 `127.0.0.1` 指向容器自身。Docker Desktop 推荐使用：

```env
HTTPS_PROXY=http://host.docker.internal:7890
HTTP_PROXY=http://host.docker.internal:7890
```

本地直接 `pnpm dev` 用 `127.0.0.1`，Docker Compose 用 `host.docker.internal`。

## Docker

构建单一应用镜像：

```bash
docker build -t picup-app:local .
```

启动完整服务：

```bash
cp .env.example .env
cp config/ai-config.example.json config/ai-config.json
docker compose build api
docker compose up -d --no-build
```

Compose 只通过 `api` 构建一次应用镜像。同一个精简镜像会分别启动 `web`、`api`、`worker` 三个容器，并配套启动 `postgres`、`redis` 和一次性 `migrate` 服务。

## Docker Hub 拉取失败

如果构建时报错类似：

```text
failed to fetch oauth token: Post "https://auth.docker.io/token": connect timeout
```

这表示 Docker 无法连接 Docker Hub 鉴权服务，不是项目代码错误。常见处理方式：

1. 在 Docker Desktop 的代理设置中配置可以访问 Docker Hub 的 HTTP/HTTPS 代理。
2. 在 Docker Engine 中配置可用的 registry mirror。
3. 先手动拉取基础镜像：

```bash
docker pull node:20-alpine
```

然后重新构建：

```bash
docker build -t picup-app:local .
```

如果你的网络环境无法访问 Docker Hub，可以把 `Dockerfile` 里的基础镜像替换为私有仓库或镜像源中的 Node 20 Alpine 镜像。

也可以不改 `Dockerfile`，直接通过构建参数指定基础镜像：

```bash
docker build --build-arg NODE_IMAGE=your-registry.example.com/library/node:20-alpine -t picup-app:local .
```

Docker Compose 也支持传入该参数：

```bash
docker compose build api --build-arg NODE_IMAGE=your-registry.example.com/library/node:20-alpine
```

## Auth

当前 MVP 已包含轻量鉴权系统：

- 访客首次访问 `/api/auth/me` 时自动创建访客账号，访客每天 3 次免费额度。
- `/login` 支持邮箱密码注册和登录，登录用户每天 10 次免费额度。
- 会话使用 HttpOnly Cookie 保存，前端不会直接接触 token。
- 上传文件、创建任务、查询历史会按 `userId` 隔离。
- 管理员邮箱通过 `.env` 的 `ADMIN_EMAILS` 配置，多个邮箱用英文逗号分隔。
- 管理接口位于 `/api/admin/*`，仅 `admin` 角色可访问。

生产环境请务必替换 `.env` 中的 `JWT_SECRET` 和 `COOKIE_SECRET`。

## Auth Integration

PicUp 支持类 Supabase 的认证入口，同时实现仍保留在 NestJS API 和 PostgreSQL 内：

- 密码登录：`POST /api/auth/login`
- 邮箱注册验证码流程：`POST /api/auth/email/start`，然后 `POST /api/auth/email/verify`
- 微信扫码登录流程：`POST /api/auth/wechat/start`，中间件扫码后调用 `POST /api/auth/wechat/callback`，浏览器轮询 `GET /api/auth/wechat/status?state=...`
- Session 由 API 签发为 HttpOnly Cookie

邮箱验证码优先支持 SMTP。参考 163 邮箱配置如下，`SMTP_PASS` 需要填写邮箱服务商提供的 SMTP 授权码，不是登录密码：

```env
SMTP_HOST=smtp.163.com
SMTP_PORT=587
SMTP_USER=Almendao@163.com
SMTP_PASS=your_smtp_authorization_code
SMTP_FROM=Almendao@163.com
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_AUTH_METHOD=
```

如果使用 465 端口，通常应设置 `SMTP_SECURE=true`；如果服务商明确要求 AUTH LOGIN，再设置 `SMTP_AUTH_METHOD=LOGIN`。

也可以改用邮件投递 Webhook：

```env
EMAIL_DELIVERY_WEBHOOK_URL=https://your-mailer.example.com/send-code
EMAIL_DELIVERY_WEBHOOK_SECRET=replace_me
```

邮件 Webhook 会收到：

```json
{
  "to": "user@example.com",
  "code": "123456",
  "mode": "register",
  "expiresInSeconds": 600
}
```

微信扫码中间件可配置：

```env
WECHAT_SCAN_URL_TEMPLATE=https://your-wechat-middleware.example.com/scan?state={state}&callbackUrl={callbackUrl}
WECHAT_AUTH_CALLBACK_SECRET=replace_me
```

用户扫码并确认后，中间件应调用：

```http
POST /api/auth/wechat/callback
x-picup-wechat-secret: replace_me
Content-Type: application/json
```

```json
{
  "state": "state_from_start",
  "openId": "wechat_openid",
  "unionId": "optional_unionid",
  "nickname": "optional nickname",
  "avatarUrl": "https://example.com/avatar.png",
  "email": "optional@example.com"
}
```

数据库包含 `email_auth_challenges`、`external_identities`、`wechat_login_sessions`，并预留 `payment_orders` 表用于未来微信支付订单持久化。

## Database

当前服务使用 PostgreSQL + Prisma 保存核心数据：

- `users`：访客、注册用户、管理员、密码哈希和状态
- `files`：上传文件元数据和用户归属
- `image_jobs`：图片任务、输入输出、状态、错误和额度预占
- `model_configs`：旧版模型配置表，保留用于兼容历史部署；运行时模型来源已迁移到 `config/ai-config.json`
- `app_settings`：后台应用设置，保存为 JSON
- `audit_logs`：管理员操作与设置变更记录

本地和 Docker Compose 使用：

```bash
docker compose build api
docker compose up -d --no-build
```

Compose 会启动 `postgres`，然后运行一次 `migrate` 服务执行：

```bash
pnpm --filter @picup/api db:deploy
```

如果只需要手动应用新迁移：

```bash
docker compose run --rm migrate
```

开发新迁移时：

```bash
pnpm --filter @picup/api db:migrate
pnpm --filter @picup/api db:generate
```

数据库连接通过 `.env` 中的 `DATABASE_URL` 配置。生产环境建议使用强随机密钥替换 `POSTGRES_PASSWORD`、`DATABASE_URL`、`JWT_SECRET`、`COOKIE_SECRET`。

管理员设置接口：

```http
GET /api/admin/models
PATCH /api/admin/models/{id}
GET /api/admin/ai-config
POST /api/admin/ai-config/providers
PATCH /api/admin/ai-config/providers/{providerId}
DELETE /api/admin/ai-config/providers/{providerId}
POST /api/admin/ai-config/providers/{providerId}/models
PATCH /api/admin/ai-config/providers/{providerId}/models/{modelId}
DELETE /api/admin/ai-config/providers/{providerId}/models/{modelId}
PATCH /api/admin/ai-config/routing
PATCH /api/admin/ai-config/mock
GET /api/admin/settings
PUT /api/admin/settings/{key}
GET /api/admin/audit-logs
```

这些接口均需要 `admin` 角色，管理员邮箱通过 `ADMIN_EMAILS` 配置。

## Redis Queue

PicUp 使用 Redis 作为图片任务队列，PostgreSQL 作为任务记录的持久化数据源。

- API 将任务元数据写入 Postgres，然后把任务 id 入队到 Redis。
- Worker 通过 Redis 原子转移读取任务，空队列时只在 Redis 内短暂等待，不需要轮询数据库。
- Worker 启动时会把遗留在 processing 列表中的任务移回 ready 队列。

默认配置：

```env
REDIS_PORT=6379
REDIS_URL=redis://redis:6379
REDIS_QUEUE_PREFIX=picup:image-jobs
IMAGE_WORKER_CONCURRENCY=4
```

Worker 会并发消费任务；`IMAGE_WORKER_CONCURRENCY` 是单个 Worker 进程的消费上限。每个 Provider 的 `concurrency` 和 `rpm` 可以在管理后台配置，RPM 为每分钟启动的生成请求数，设置为 `0` 表示不限。

如果 API 在 Docker 外本地运行，而 Redis 暴露在宿主机上，使用：

```env
REDIS_URL=redis://localhost:6379
```

## GitHub Actions 部署

仓库包含 `.github/workflows/deploy.yml`。当代码推送到 `main` 分支时，会自动执行：

1. 安装依赖
2. 类型检查
3. 在 GitHub Runner 构建一次精简镜像并推送到阿里云 ACR
4. SSH 到服务器更新代码并调用 `deploy/deploy.sh`
5. 拉取 SHA 镜像、执行迁移，只更新 `api`、`worker` 和 `web`
6. API 和 Web 健康检查通过后持久化本次 SHA 镜像

需要在 GitHub 仓库中配置 Actions Secrets：

```text
SERVER_HOST
SERVER_USER
SERVER_SSH_KEY
SERVER_APP_DIR
SERVER_PORT
ACR_REGISTRY
ACR_USERNAME
ACR_PASSWORD
ACR_IMAGE
```

其中 `SERVER_PORT` 可选，默认使用 `22`。
`ACR_REGISTRY` 示例：`YOUR_REGISTRY`  
`ACR_IMAGE` 示例：`YOUR_REGISTRY/YOUR_NAMESPACE/picup`

服务器首次部署：

```bash
git clone git@github.com:Bigbo99/PicUp.git YOUR_SERVER_APP_DIR
cd YOUR_SERVER_APP_DIR
cp .env.example .env
cp config/ai-config.example.json config/ai-config.json
nano .env
nano config/ai-config.json
export APP_IMAGE=YOUR_REGISTRY/YOUR_NAMESPACE/picup:latest
export ACR_REGISTRY=YOUR_REGISTRY
export ACR_USERNAME=your_user
export ACR_PASSWORD=your_password
bash deploy/deploy.sh
```

## 宝塔面板部署（Docker + Nginx 反代）

项目 `deploy/` 目录包含部署所需的配置文件：

- `deploy/nginx.conf` — Nginx 反代配置模板
- `deploy/deploy.sh` — 一键部署脚本

### 快速步骤

1. **配置 `.env`**：复制 `.env.production.example` 为 `.env`，修改域名、密码等。

   > **关键**：`NEXT_PUBLIC_API_BASE_URL` 必须留空！它是编译时变量，留空 = 前端用相对路径。

2. **执行部署脚本**：

   ```bash
   bash deploy/deploy.sh
   ```

3. **配置宝塔 Nginx**：在宝塔面板添加站点、申请 SSL，然后把 `deploy/nginx.conf` 中的 location 规则粘贴到站点配置中。核心规则：

   - `/api/*` → `127.0.0.1:4000`（API 容器）
   - `/media/*` → `127.0.0.1:4000`（媒体文件）
   - `/*` → `127.0.0.1:3000`（Web 前端）

4. **重载 Nginx**：

   ```bash
   nginx -t && nginx -s reload
   ```

### 常见问题

- **前端请求指向 localhost**：重新构建镜像 `docker compose build --no-cache api && docker compose up -d --no-build`，确保 `NEXT_PUBLIC_API_BASE_URL` 为空。
- **Cookie 不生效**：确认 `APP_ENV=production`（Cookie 需要 HTTPS）且 Nginx 有 `proxy_set_header X-Forwarded-Proto $scheme`。
- **CORS 报错**：确认 `WEB_PUBLIC_URL` 设为实际域名（含 https://）。
