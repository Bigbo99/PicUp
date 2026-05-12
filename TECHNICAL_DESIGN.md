# PicUp 技术实现文档

## 1. 文档目标

本文档基于 `PRD.md`，定义 PicUp AI 在线 P 图平台的前后端技术方案、模型 API 适配方案、数据结构、部署架构、容器化方案和后期更新策略。

PicUp 的核心技术目标：

- 支持响应式 Web 工作台。
- 聚合 Gemini 官方图片能力与 GrsAI GPT Image。
- 使用统一任务系统适配同步和异步模型接口。
- API Key 只保存在服务端。
- 支持服务器部署、容器化部署和后期平滑更新。
- 预留多模型、多 Worker、付费额度、批量任务和开放 API 扩展能力。

## 2. 技术选型

### 2.1 总体技术栈

| 层级 | 技术 | 说明 |
|---|---|---|
| 前端 | Next.js 15 + React + TypeScript | 响应式工作台、管理后台、SEO 页面 |
| 样式 | Tailwind CSS + CSS Modules | 快速实现响应式布局和组件样式 |
| 组件 | Radix UI / shadcn/ui 思路自建组件 | 表单、弹窗、抽屉、菜单、Toast |
| 后端 | NestJS + TypeScript | API、鉴权、任务编排、Provider 适配 |
| ORM | Prisma | 数据表管理、迁移、类型安全 |
| 数据库 | PostgreSQL | 用户、任务、图片、额度、配置 |
| 队列 | Redis + BullMQ | 图片生成任务、轮询任务、失败重试 |
| 文件存储 | S3 兼容对象存储 | MinIO、Cloudflare R2、AWS S3、阿里云 OSS 均可 |
| 反向代理 | Nginx / Caddy | HTTPS、静态资源缓存、API 转发 |
| 容器 | Docker + Docker Compose | 单机部署和后期扩展 |
| 监控 | Prometheus 指标 + 结构化日志 | 任务耗时、失败率、成本统计 |

### 2.2 选型理由

选择 TypeScript 全栈，可以复用类型定义，降低前后端接口沟通成本。NestJS 适合做模块化后端和 Provider 抽象，BullMQ 适合处理图片生成这类耗时任务。PostgreSQL 作为主数据库，Redis 负责队列和限流，对后期扩展 Worker 数量比较友好。

## 3. 总体架构

```mermaid
flowchart LR
  U["用户浏览器"] --> FE["Next.js Web"]
  FE --> API["NestJS API"]
  API --> PG["PostgreSQL"]
  API --> Redis["Redis"]
  API --> S3["对象存储 / CDN"]
  API --> Q["BullMQ Queue"]
  Q --> W["Image Worker"]
  W --> Gemini["Gemini API"]
  W --> GrsAI["GrsAI API"]
  W --> S3
  W --> PG
  Admin["管理后台"] --> API
```

## Auth and Account Persistence Addendum

The implemented auth design keeps the user account source of truth in PostgreSQL and follows a Supabase-like split between identity, challenge, session, and profile data.

Core tables:

- `users`: local account, role, status, guest flag, password hash, and `email_verified_at`.
- `email_auth_challenges`: one-time email codes, hashed with the app secret, short TTL, attempt counter, consumed timestamp.
- `external_identities`: provider identities such as WeChat `openId` and optional `unionId`, linked to local users.
- `wechat_login_sessions`: QR login state, QR URL, pending/confirmed/expired/consumed status, linked user after callback.
- `payment_orders`: reserved persistence model for WeChat Pay and other payment providers.

API contract:

```http
POST /api/auth/email/start
POST /api/auth/email/verify
POST /api/auth/wechat/start
GET /api/auth/wechat/status?state={state}
POST /api/auth/wechat/callback
```

Email registration stores the password hash only in the challenge until the email code is verified. WeChat login creates or reuses a local user from `external_identities`, then the browser polling request consumes the confirmed login session and receives the HttpOnly session cookie.

Operational settings:

```env
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_AUTH_METHOD=
EMAIL_DELIVERY_WEBHOOK_URL=
EMAIL_DELIVERY_WEBHOOK_SECRET=
WECHAT_SCAN_URL_TEMPLATE=
WECHAT_SCAN_BASE_URL=
WECHAT_AUTH_CALLBACK_SECRET=
```

Production deployments should set strong `JWT_SECRET`, `COOKIE_SECRET`, `WECHAT_AUTH_CALLBACK_SECRET`, and mailer secrets. Local development falls back to a development email code response and a placeholder QR URL when external middleware is not configured.

### 3.1 服务拆分

MVP 阶段建议使用“单一应用镜像，多容器启动”的方式部署。

应用侧只构建和推送一个镜像：

- `picup-app`：同时包含 Next.js Web、NestJS API、NestJS Worker 的构建产物。

部署时使用同一个镜像启动多个容器：

- `web`：通过 `picup-app` 启动 Next.js 前端。
- `api`：通过 `picup-app` 启动 NestJS API 服务。
- `worker`：通过 `picup-app` 启动 NestJS Worker 进程，消费图片任务。

基础设施仍然独立：

- `postgres`：数据库，生产环境可替换为云数据库。
- `redis`：队列、缓存和限流，生产环境可替换为云 Redis。
- `minio`：本地对象存储，生产环境可替换为 S3、R2、OSS 等云存储。

后期扩展时，可以水平扩展 `worker`，不影响前端和 API。

## 4. 前端技术设计

### 4.1 前端应用结构

```text
apps/web
  app
    page.tsx
    history/page.tsx
    admin/page.tsx
    api-proxy-not-used.md
  components
    uploader
    editor
    preview
    model-selector
    job-status
    history
    admin
  lib
    api-client.ts
    upload.ts
    responsive.ts
    constants.ts
  styles
    globals.css
```

### 4.2 页面结构

| 页面 | 路由 | 说明 |
|---|---|---|
| 工作台 | `/` | 上传、输入提示词、选择模型、预览结果 |
| 历史记录 | `/history` | 最近任务列表和继续编辑 |
| 管理后台 | `/admin` | 模型、额度、任务日志、成本配置 |
| 登录页 | `/login` | 登录和游客升级 |

### 4.3 响应式布局

前端必须使用 CSS Grid / Flex 实现响应式工作台。

断点：

```ts
export const breakpoints = {
  mobile: 768,
  tablet: 1200,
  desktop: 1440
};
```

布局策略：

| 设备 | 布局 |
|---|---|
| `< 768px` | 单列任务流，预览优先，生成按钮固定底部 |
| `768px - 1199px` | 上下双区或左右双区，模板横向滚动 |
| `>= 1200px` | 左侧操作面板，右侧画布，底部模板 |
| `>= 1440px` | 画布扩大，操作面板最大宽度限制 |

### 4.4 核心前端组件

| 组件 | 职责 |
|---|---|
| `ImageUploader` | 拖拽上传、点击上传、格式校验、大小校验 |
| `PromptEditor` | 提示词输入、模板填充、字数限制 |
| `TemplatePicker` | 改字、换背景、去除物体、商品图等模板 |
| `ModelSelector` | 自动推荐、Gemini 快速、Gemini 标准、Gemini 专业、GrsAI |
| `AspectRatioSelector` | 1:1、16:9、9:16、3:4、4:5、21:9 |
| `JobStatusPanel` | 排队、生成中、成功、失败 |
| `ImageCompare` | 桌面端对比滑杆，移动端标签切换 |
| `ResultActions` | 下载、继续编辑、重新生成、换模型重试 |
| `QuotaBadge` | 展示剩余额度 |
| `HistoryDrawer` | 移动端历史记录抽屉 |

### 4.5 前端状态管理

MVP 不引入复杂全局状态库，使用：

- React Query：请求缓存、轮询任务状态。
- React Hook Form：表单状态。
- Zustand：轻量保存当前编辑会话。

任务状态轮询：

- 创建任务后每 2 秒查询一次。
- 超过 60 秒改为每 5 秒查询一次。
- 超过 5 分钟提示用户可稍后在历史记录查看。
- 成功或失败后停止轮询。

### 4.6 上传策略

前端不直接上传到第三方模型接口。

MVP 使用后端中转上传：

```http
POST /api/files
Content-Type: multipart/form-data
```

后期大文件可改为预签名上传：

```http
POST /api/files/presign
PUT {signedUrl}
POST /api/files/complete
```

前端校验：

- MIME：`image/jpeg`、`image/png`、`image/webp`。
- 单图大小：最大 10MB。
- 极速模式最多 3 张图。
- 专业模式最多 14 张图，但 UI 需要提示模型限制。

## 5. 后端技术设计

### 5.1 后端应用结构

```text
apps/api
  src
    main.ts
    app.module.ts
    modules
      auth
      users
      files
      jobs
      providers
      prompts
      quotas
      admin
      safety
      metrics
    workers
      image-job.processor.ts
    common
      config
      errors
      logger
      storage
      rate-limit
```

### 5.2 后端模块

| 模块 | 职责 |
|---|---|
| AuthModule | 游客 ID、登录、管理员权限 |
| UserModule | 用户资料、角色、状态 |
| FileModule | 上传、校验、存储、删除 |
| JobModule | 创建任务、查询任务、任务状态机 |
| ProviderModule | Gemini / GrsAI 统一适配 |
| PromptModule | 场景模板、提示词增强 |
| QuotaModule | 免费额度、扣减、返还、用量统计 |
| SafetyModule | 敏感词、违规任务、风险场景拦截 |
| AdminModule | 模型配置、Key 配置、日志、成本 |
| MetricsModule | 健康检查、指标导出 |

### 5.3 API 设计

#### 文件上传

```http
POST /api/files
```

响应：

```json
{
  "fileId": "file_123",
  "url": "https://cdn.picup.ai/input/file_123.png",
  "mimeType": "image/png",
  "size": 1024000,
  "width": 1024,
  "height": 1024
}
```

#### 创建图片任务

```http
POST /api/image/jobs
```

请求：

```json
{
  "mode": "edit",
  "provider": "auto",
  "model": "auto",
  "template": "replace_text",
  "prompt": "把图片里的文字改成夏日新品，其他不变",
  "imageIds": ["file_123"],
  "aspectRatio": "1:1",
  "quality": "standard"
}
```

响应：

```json
{
  "jobId": "job_123",
  "status": "queued",
  "creditsReserved": 1
}
```

#### 查询任务

```http
GET /api/image/jobs/{jobId}
```

响应：

```json
{
  "jobId": "job_123",
  "status": "succeeded",
  "provider": "gemini",
  "model": "gemini-3.1-flash-image-preview",
  "outputImages": [
    {
      "url": "https://cdn.picup.ai/output/job_123_1.png",
      "mimeType": "image/png",
      "width": 1024,
      "height": 1024
    }
  ],
  "error": null
}
```

#### 历史记录

```http
GET /api/image/jobs?cursor={cursor}&limit=20
```

#### 模型配置

```http
GET /api/models
```

返回启用模型、可选比例、可选清晰度、输入图片数量限制。

### 5.4 任务状态机

```mermaid
stateDiagram-v2
  [*] --> queued
  queued --> running
  running --> succeeded
  running --> failed
  running --> retrying
  retrying --> running
  failed --> refunded
  succeeded --> [*]
  refunded --> [*]
```

状态说明：

| 状态 | 说明 |
|---|---|
| `queued` | 已创建，等待 Worker 消费 |
| `running` | Worker 调用模型中 |
| `retrying` | 临时失败，准备重试 |
| `succeeded` | 生成成功 |
| `failed` | 生成失败 |
| `refunded` | 失败任务额度已返还 |

### 5.5 队列设计

队列名称：

- `image.generate`：图片生成和编辑任务。
- `image.poll`：GrsAI 等异步 Provider 的结果轮询。
- `image.cleanup`：过期图片清理。

重试策略：

- Provider 网络错误：最多重试 2 次。
- 限流错误：延迟 30 秒重试。
- 内容安全拦截：不重试，直接失败并返还额度。
- 参数错误：不重试，记录错误。

## 6. Provider 统一适配

### 6.1 Provider 接口

```ts
export interface ImageProvider {
  name: 'gemini' | 'grsai';
  create(input: ProviderImageInput): Promise<ProviderImageResult>;
  poll?(externalJobId: string): Promise<ProviderImageResult>;
  healthCheck(): Promise<ProviderHealth>;
}
```

### 6.2 标准输入

```ts
export interface ProviderImageInput {
  mode: 'generate' | 'edit';
  prompt: string;
  images: Array<{
    buffer: Buffer;
    mimeType: string;
    fileId: string;
  }>;
  model: string;
  aspectRatio: string;
  quality: 'preview' | 'standard' | 'hd' | 'pro';
  userId?: string;
  jobId: string;
}
```

### 6.3 标准输出

```ts
export interface ProviderImageResult {
  status: 'succeeded' | 'processing' | 'failed';
  externalJobId?: string;
  images?: Array<{
    buffer?: Buffer;
    url?: string;
    mimeType: string;
    width?: number;
    height?: number;
  }>;
  textOutputs?: string[];
  groundingSources?: Array<{
    title?: string;
    url: string;
  }>;
  error?: ProviderError;
}
```

### 6.4 GeminiProvider

Gemini 使用官方 `generateContent`。

请求地址：

```http
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
```

职责：

- 根据任务选择 Gemini 模型。
- 将文本转换为 `contents.parts[].text`。
- 将图片转换为 `contents.parts[].inline_data`。
- 写入 `generationConfig.responseModalities`。
- 写入 `generationConfig.imageConfig.aspectRatio` 和 `imageSize`。
- 解析 `candidates[].content.parts[].inlineData`。
- 将 base64 图片上传到对象存储。
- 解析文本说明和 grounding 来源。

环境变量：

```env
GEMINI_API_KEY=
GEMINI_BASE_URL=https://generativelanguage.googleapis.com
```

### 6.5 GrsAiProvider

GrsAI 按异步任务模式设计。

职责：

- 创建 GrsAI 绘图任务。
- 保存第三方 `externalJobId`。
- 将任务放入 `image.poll` 队列。
- 轮询 GrsAI 结果接口。
- 下载结果图并转存到 PicUp 对象存储。

环境变量：

```env
GRSAI_API_KEY=
GRSAI_BASE_URL=
```

### 6.6 自动路由

```ts
function selectProvider(input: ImageJobInput): ProviderSelection {
  if (input.provider !== 'auto') return explicitProvider(input);
  if (input.template === 'replace_text') return geminiStandard();
  if (input.template === 'product') return geminiPro();
  if (input.quality === 'preview') return geminiFast();
  if (input.batchMode) return grsai();
  return geminiStandard();
}
```

Provider 健康检查失败时：

- 自动切换到可用 Provider。
- 记录 `fallbackProvider`。
- 前端展示“已自动切换可用模型”。

## 7. 数据库设计

### 7.1 核心表

#### users

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 用户 ID |
| email | varchar | 邮箱，可为空 |
| role | varchar | `guest`、`user`、`admin` |
| status | varchar | 正常、禁用 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

#### files

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 文件 ID |
| user_id | uuid | 上传用户 |
| storage_key | varchar | 对象存储 Key |
| url | text | CDN URL |
| mime_type | varchar | MIME |
| size | int | 文件大小 |
| width | int | 宽度 |
| height | int | 高度 |
| created_at | timestamp | 创建时间 |
| expires_at | timestamp | 过期时间 |

#### image_jobs

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 任务 ID |
| user_id | uuid | 用户 |
| mode | varchar | `generate`、`edit` |
| provider | varchar | `gemini`、`grsai` |
| model | varchar | 模型名 |
| template | varchar | 场景模板 |
| prompt | text | 用户提示词 |
| final_prompt | text | 增强后提示词 |
| status | varchar | 任务状态 |
| aspect_ratio | varchar | 比例 |
| quality | varchar | 清晰度 |
| credits_reserved | int | 预扣额度 |
| error_code | varchar | 错误码 |
| error_message | text | 错误信息 |
| external_job_id | varchar | 第三方任务 ID |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |
| completed_at | timestamp | 完成时间 |

#### image_job_files

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 关联 ID |
| job_id | uuid | 任务 ID |
| file_id | uuid | 文件 ID |
| role | varchar | `input`、`output` |
| sort_order | int | 排序 |

#### quotas

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 记录 ID |
| user_id | uuid | 用户 |
| date | date | 日期 |
| free_total | int | 免费额度 |
| free_used | int | 已使用 |
| paid_balance | int | 付费余额 |

#### model_configs

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 配置 ID |
| provider | varchar | Provider |
| model | varchar | 第三方模型名 |
| display_name | varchar | 前端展示名 |
| enabled | boolean | 是否启用 |
| priority | int | 自动路由优先级 |
| max_input_images | int | 最大输入图数量 |
| supported_ratios | jsonb | 支持比例 |
| supported_qualities | jsonb | 支持清晰度 |
| cost_credits | int | 单次消耗额度 |

### 7.2 索引

- `image_jobs(user_id, created_at desc)`
- `image_jobs(status, created_at)`
- `files(user_id, created_at desc)`
- `quotas(user_id, date)`
- `model_configs(provider, enabled)`

## 8. 额度与限流

### 8.1 额度扣减

创建任务时预扣额度：

1. 校验用户额度。
2. 创建 `image_jobs`。
3. 预扣 `credits_reserved`。
4. Worker 成功则确认消耗。
5. Worker 失败且不是用户参数错误时返还额度。

### 8.2 限流

限流维度：

- IP 每分钟请求次数。
- 用户每分钟创建任务数。
- 游客每日额度。
- 单 Provider 并发数。

Redis Key 示例：

```text
rate:ip:{ip}:minute
rate:user:{userId}:minute
quota:user:{userId}:{date}
provider:gemini:concurrency
```

## 9. 安全设计

### 9.1 密钥安全

- `GEMINI_API_KEY`、`GRSAI_API_KEY` 只存放在服务器环境变量或密钥管理系统。
- 禁止输出完整密钥到日志。
- 管理后台只显示密钥后 4 位。
- 已泄露密钥必须立即轮换。

### 9.2 上传安全

- 校验 MIME 和文件头。
- 限制单文件大小。
- 图片重新编码或读取元信息，避免伪装文件。
- 删除 EXIF 中的敏感定位信息。
- 对象存储使用私有 Bucket，通过后端签名或 CDN 策略访问。

### 9.3 内容安全

- 对提示词做敏感词和风险分类。
- 对高风险功能做二次确认或直接拦截。
- 拦截伪造证件、色情、仇恨、欺骗、侵犯肖像等用途。
- 对“去水印”类任务做合规限制。

### 9.4 管理后台安全

- 仅 `admin` 角色可访问。
- 所有配置变更写入审计日志。
- 管理接口增加 CSRF 防护和二次确认。

## 10. 部署与容器化

### 10.1 推荐部署拓扑

单机 MVP：

```text
Nginx
  ├── web:3000
  └── api:4000

api / worker
  ├── postgres
  ├── redis
  └── minio or cloud object storage
```

生产增强版：

- Web 与 API 使用独立容器。
- Worker 可按队列压力横向扩容。
- PostgreSQL 使用云数据库或独立磁盘备份。
- Redis 使用云 Redis 或持久化配置。
- 对象存储使用云厂商 S3 兼容服务。

### 10.2 Docker 镜像

MVP 建议构建 1 个应用镜像：

- `picup-app`

该镜像同时包含 Web、API、Worker 的构建产物。镜像推送到仓库后，服务器只需要拉取一个镜像版本。

镜像命名示例：

```text
registry.example.com/picup-app:1.0.0
```

部署时通过不同启动命令区分运行角色：

```bash
pnpm start:web
pnpm start:api
pnpm start:worker
```

优势：

- 镜像仓库只维护一个应用镜像。
- 服务器只需要拉取一个应用镜像。
- Web、API、Worker 版本天然一致。
- 回滚时只需要切换一个镜像版本。
- 后期扩容 Worker 时，只需要用同一镜像启动更多 Worker 容器。

注意：

- PostgreSQL、Redis、MinIO 不应打进应用镜像，仍然使用独立容器或云服务。
- 后期如果出现构建体积过大、Web 与 API 需要完全独立扩容、或安全隔离要求，再拆分为多个应用镜像。

### 10.3 docker-compose 服务

```yaml
services:
  web:
    image: ${APP_IMAGE}
    restart: unless-stopped
    command: ["pnpm", "start:web"]
    env_file: .env
    depends_on:
      - api

  api:
    image: ${APP_IMAGE}
    restart: unless-stopped
    command: ["pnpm", "start:api"]
    env_file: .env
    depends_on:
      - postgres
      - redis

  worker:
    image: ${APP_IMAGE}
    restart: unless-stopped
    command: ["pnpm", "start:worker"]
    env_file: .env
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:16
    restart: unless-stopped
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redis_data:/data

  minio:
    image: minio/minio
    restart: unless-stopped
    command: ["server", "/data", "--console-address", ":9001"]
    volumes:
      - minio_data:/data

volumes:
  postgres_data:
  redis_data:
  minio_data:
```

### 10.4 环境变量

```env
APP_ENV=production
APP_VERSION=latest
APP_IMAGE=registry.example.com/picup-app:${APP_VERSION}
WEB_PUBLIC_URL=https://picup.example.com
API_PUBLIC_URL=https://picup.example.com/api

DATABASE_URL=postgresql://picup:password@postgres:5432/picup
REDIS_URL=redis://redis:6379

S3_ENDPOINT=http://minio:9000
S3_REGION=auto
S3_BUCKET=picup
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_PUBLIC_BASE_URL=https://cdn.picup.example.com

GEMINI_API_KEY=
GEMINI_BASE_URL=https://generativelanguage.googleapis.com

GRSAI_API_KEY=
GRSAI_BASE_URL=

JWT_SECRET=
COOKIE_SECRET=
ADMIN_EMAILS=
```

### 10.5 数据库迁移

部署流程：

1. 拉取新镜像。
2. 运行数据库迁移。
3. 启动新 API。
4. 启动新 Worker。
5. 启动新 Web。
6. 健康检查通过后切换流量。

迁移命令：

```bash
npx prisma migrate deploy
```

## 11. 更新与发布策略

### 11.1 版本策略

镜像使用语义化版本：

```text
picup-app:1.0.0
picup-app:1.0.1
picup-app:1.1.0
```

生产环境不建议长期使用 `latest`，正式发布使用固定版本标签。

### 11.2 平滑更新

更新步骤：

1. 构建并推送新镜像。
2. 备份数据库。
3. 执行迁移。
4. 服务器拉取新的 `picup-app` 镜像。
5. 暂停 Worker 消费新任务。
6. 等当前任务完成或超时。
7. 使用同一镜像版本依次更新 API、Worker、Web 容器。
8. 健康检查通过后继续开放 Worker 消费。
9. 观察错误率和任务成功率。

### 11.3 回滚策略

- 保留最近 3 个稳定镜像版本。
- 数据库迁移必须向后兼容。
- Provider 配置放在数据库中，可通过后台热更新。
- 前端模型列表从 `/api/models` 获取，不硬编码模型名。

### 11.4 可热更新配置

以下配置不需要重新部署：

- 模型启用 / 禁用。
- 模型优先级。
- 单模型额度消耗。
- 免费额度。
- Prompt 模板。
- Provider 限流参数。
- Gemini 和 GrsAI 的模型名称。

## 12. 监控与日志

### 12.1 健康检查

```http
GET /api/health
GET /api/health/providers
```

检查项：

- PostgreSQL 连接。
- Redis 连接。
- 对象存储连接。
- Gemini API 可用性。
- GrsAI API 可用性。

### 12.2 指标

核心指标：

- `image_jobs_created_total`
- `image_jobs_succeeded_total`
- `image_jobs_failed_total`
- `image_job_duration_seconds`
- `provider_request_duration_seconds`
- `provider_error_total`
- `quota_used_total`
- `storage_upload_failed_total`

### 12.3 日志

日志要求：

- 使用 JSON 结构化日志。
- 每个任务带 `jobId`。
- 每次第三方调用带 `provider`、`model`、`duration`、`status`。
- 不记录完整 API Key。
- 不记录图片 base64。

## 13. 测试策略

### 13.1 单元测试

- Provider 请求构造。
- Gemini 输出解析。
- GrsAI 轮询解析。
- Prompt 模板增强。
- 额度扣减和返还。
- 路由选择逻辑。

### 13.2 集成测试

- 上传文件到对象存储。
- 创建任务并进入队列。
- Worker 消费任务。
- 失败重试。
- 任务成功后生成输出文件。

### 13.3 E2E 测试

使用 Playwright 覆盖：

- 桌面端上传、生成、下载。
- 移动端上传、生成、下载。
- 任务失败提示。
- 模型切换。
- 历史记录继续编辑。

### 13.4 Provider Mock

本地开发默认使用 Mock Provider，避免消耗真实 API 额度。

```env
PROVIDER_MOCK_ENABLED=true
```

Mock 行为：

- 延迟 2 秒返回固定测试图。
- 可模拟限流、失败、安全拦截。
- 可模拟 GrsAI 异步轮询。

## 14. 开发里程碑

### 阶段 1：基础骨架

- Monorepo 初始化。
- Next.js 前端骨架。
- NestJS API 骨架。
- PostgreSQL、Redis、对象存储接入。
- Docker Compose 本地环境。

### 阶段 2：核心任务链路

- 图片上传。
- 创建任务。
- BullMQ Worker。
- 任务状态轮询。
- 结果图存储和展示。

### 阶段 3：Gemini 接入

- GeminiProvider。
- 文生图。
- 图生图编辑。
- 输出解析。
- 错误码映射。

### 阶段 4：GrsAI 接入

- GrsAiProvider。
- 异步任务创建。
- 结果轮询。
- Provider 自动路由和回退。

### 阶段 5：产品完善

- 响应式工作台。
- 历史记录。
- 免费额度。
- 管理后台。
- 监控和日志。
- 生产部署文档。

## 15. 验收标准

技术验收：

- 前端在移动端、平板、桌面端均可完成完整 P 图流程。
- API Key 不进入前端包。
- Gemini 和 GrsAI 均通过统一 Provider 接口调用。
- 任务成功、失败、重试、返还额度流程完整。
- Worker 可独立扩容。
- Docker Compose 可以一键启动完整环境。
- 新模型可通过后台配置启用，不需要前端发版。
- 生产环境可以通过固定镜像版本部署和回滚。
