# PicUp

PicUp 鏄竴涓搷搴斿紡鍦ㄧ嚎 AI P 鍥惧伐浣滃彴锛屽綋鍓?MVP 宸插寘鍚細

- Next.js 鍓嶇宸ヤ綔鍙?- NestJS API
- Worker 浠诲姟澶勭悊
- 鏈湴鍥剧墖涓婁紶涓庣粨鏋滃瓨鍌?- Gemini Provider 瀹樻柟鎺ュ彛棰勭暀
- Mock Provider 鏈湴婕旂ず
- 鍗曚竴搴旂敤闀滃儚 Docker 閮ㄧ讲

## 鏈湴寮€鍙?
```bash
cp .env.example .env
pnpm install
pnpm dev
```

璁块棶锛?
- Web: http://localhost:3000
- API: http://localhost:4000/api/health

榛樿 `PROVIDER_MOCK_ENABLED=true`锛屾棤闇€ API Key 鍗冲彲璺戦€氫笂浼犮€佸垱寤轰换鍔°€佽疆璇㈠拰缁撴灉棰勮銆?
## 浣跨敤 Gemini

鍦?`.env` 涓厤缃細

```env
PROVIDER_MOCK_ENABLED=false
GEMINI_API_KEY=your_key
```

鐒跺悗閲嶅惎 API 鍜?Worker銆?
濡傛灉浣犳墍鍦ㄧ綉缁滈渶瑕佷唬鐞嗚闂?Google API锛岄渶瑕佸湪 `.env` 涓厤缃?Node 鍙鍙栫殑浠ｇ悊锛?
```env
HTTPS_PROXY=http://127.0.0.1:7890
HTTP_PROXY=http://127.0.0.1:7890
```

绔彛璇锋敼鎴愪綘鏈満浠ｇ悊杞欢瀹為檯鐩戝惉绔彛銆?
濡傛灉鏄湪 Docker 瀹瑰櫒閲岃闂涓绘満浠ｇ悊锛屼笉鑳戒娇鐢?`127.0.0.1`锛屽洜涓哄鍣ㄥ唴鐨?`127.0.0.1` 鎸囧悜瀹瑰櫒鑷繁銆侱ocker Desktop 鎺ㄨ崘浣跨敤锛?
```env
HTTPS_PROXY=http://host.docker.internal:7890
HTTP_PROXY=http://host.docker.internal:7890
```

鏈湴鐩存帴 `pnpm dev` 鐢?`127.0.0.1`锛孌ocker Compose 鐢?`host.docker.internal`銆?
## Docker

鏋勫缓鍗曚竴搴旂敤闀滃儚锛?
```bash
docker build -t picup-app:local .
```

鍚姩锛?
```bash
cp .env.example .env
docker compose up -d --build
```

鍚屼竴涓暅鍍忎細鍒嗗埆鍚姩 `web`銆乣api`銆乣worker` 涓変釜瀹瑰櫒銆?
### Docker Hub 鎷夊彇澶辫触

濡傛灉鏋勫缓鏃舵姤閿欑被浼硷細

```text
failed to fetch oauth token: Post "https://auth.docker.io/token": connect timeout
```

杩欒〃绀?Docker 鏃犳硶杩炴帴 Docker Hub 閴存潈鏈嶅姟锛屼笉鏄」鐩唬鐮侀敊璇€傚父瑙佸鐞嗘柟寮忥細

1. 鍦?Docker Desktop 鐨勪唬鐞嗚缃腑閰嶇疆鍙闂?Docker Hub 鐨?HTTP/HTTPS 浠ｇ悊銆?2. 鍦?Docker Engine 涓厤缃彲鐢ㄧ殑 registry mirror銆?3. 鍏堟墜鍔ㄦ媺鍙栧熀纭€闀滃儚锛?
```bash
docker pull node:20-alpine
```

鐒跺悗閲嶆柊鏋勫缓锛?
```bash
docker build -t picup-app:local .
```

濡傛灉浣犵殑缃戠粶鐜鏃犳硶璁块棶 Docker Hub锛屽彲浠ユ妸 `Dockerfile` 閲岀殑鍩虹闀滃儚鏇挎崲涓轰綘绉佹湁浠撳簱鎴栭暅鍍忔簮涓殑 Node 20 Alpine 闀滃儚銆?
涔熷彲浠ヤ笉鏀?Dockerfile锛岀洿鎺ラ€氳繃鏋勫缓鍙傛暟鎸囧畾鍩虹闀滃儚锛?
```bash
docker build --build-arg NODE_IMAGE=your-registry.example.com/library/node:20-alpine -t picup-app:local .
```

濡傛灉浣犲凡缁忓湪鏈満瀵煎叆浜嗘煇涓?Node 20 闀滃儚锛屼篃鍙互鐩存帴浣跨敤鏈湴闀滃儚鍚嶏細

```bash
docker images
docker build --build-arg NODE_IMAGE=node:20-alpine -t picup-app:local .
```

Docker Compose 涔熸敮鎸佷紶鍏ヨ鍙傛暟锛?
```bash
docker compose build --build-arg NODE_IMAGE=your-registry.example.com/library/node:20-alpine
```

## Auth

褰撳墠 MVP 宸插寘鍚交閲忛壌鏉冪郴缁燂細

- 璁垮棣栨璁块棶 `/api/auth/me` 鏃惰嚜鍔ㄥ垱寤鸿瀹㈣处鍙凤紝璁垮姣忔棩 3 娆″厤璐归搴︺€?- `/login` 鏀寔閭瀵嗙爜娉ㄥ唽鍜岀櫥褰曪紝鐧诲綍鐢ㄦ埛姣忔棩 10 娆″厤璐归搴︺€?- 浼氳瘽浣跨敤 HttpOnly Cookie 淇濆瓨锛屽墠绔笉浼氭帴瑙?token銆?- 涓婁紶鏂囦欢銆佸垱寤轰换鍔°€佹煡璇㈠巻鍙蹭細鎸?`userId` 闅旂銆?- 绠＄悊鍛橀偖绠遍€氳繃 `.env` 鐨?`ADMIN_EMAILS` 閰嶇疆锛屽涓偖绠辩敤鑻辨枃閫楀彿鍒嗛殧銆?- 绠＄悊鎺ュ彛浣嶄簬 `/api/admin/*`锛屼粎 `admin` 瑙掕壊鍙闂€?
鐢熶骇鐜璇峰姟蹇呮浛鎹?`.env` 涓殑 `JWT_SECRET` 鍜?`COOKIE_SECRET`銆?
## Database

褰撳墠鏈嶅姟浣跨敤 PostgreSQL + Prisma 淇濆瓨鏍稿績鏁版嵁锛?
- `users`锛氳瀹€佹敞鍐岀敤鎴枫€佺鐞嗗憳銆佸瘑鐮佸搱甯屽拰鐘舵€併€?- `files`锛氫笂浼犳枃浠跺厓鏁版嵁鍜岀敤鎴峰綊灞炪€?- `image_jobs`锛氬浘鐗囦换鍔°€佽緭鍏ヨ緭鍑恒€佺姸鎬併€侀敊璇拰棰濆害棰勫崰銆?- `model_configs`锛氬彲鐑洿鏂扮殑妯″瀷寮€鍏炽€佷紭鍏堢骇銆佹敮鎸佹瘮渚嬨€佸垎杈ㄧ巼鍜屽崟娆￠搴︽秷鑰椼€?- `app_settings`锛氬悗鍙板簲鐢ㄨ缃紝淇濆瓨涓?JSON銆?- `audit_logs`锛氱鐞嗗憳淇敼妯″瀷閰嶇疆鍜岃缃椂鐨勫璁¤褰曘€?
鏈湴鍜?Docker Compose 浣跨敤锛?
```bash
docker compose build
docker compose up -d
```

Compose 浼氬惎鍔?`postgres`锛岀劧鍚庤繍琛屼竴娆?`migrate` 鏈嶅姟鎵ц锛?
```bash
pnpm --filter @picup/api db:deploy
```

濡傛灉鍙渶瑕佹墜鍔ㄥ簲鐢ㄦ柊杩佺Щ锛?
```bash
docker compose run --rm migrate
```

寮€鍙戞柊杩佺Щ鏃讹細

```bash
pnpm --filter @picup/api db:migrate
pnpm --filter @picup/api db:generate
```

鏁版嵁搴撹繛鎺ラ€氳繃 `.env` 涓殑 `DATABASE_URL` 閰嶇疆銆傜敓浜х幆澧冨缓璁娇鐢ㄧ嫭绔嬫墭绠?PostgreSQL锛屽苟涓?`POSTGRES_PASSWORD`銆乣DATABASE_URL`銆乣JWT_SECRET`銆乣COOKIE_SECRET` 浣跨敤寮洪殢鏈哄瘑閽ャ€?
绠＄悊鍛樿缃帴鍙ｏ細

```http
GET /api/admin/models
PATCH /api/admin/models/{id}
GET /api/admin/settings
PUT /api/admin/settings/{key}
GET /api/admin/audit-logs
```

杩欎簺鎺ュ彛鍧囬渶瑕?`admin` 瑙掕壊锛岀鐞嗗憳閭閫氳繃 `ADMIN_EMAILS` 閰嶇疆銆?

## Redis Queue

PicUp now uses Redis as the image job queue and keeps PostgreSQL as the durable source of truth for job records.

- API writes job metadata to Postgres, then enqueues the job id into Redis.
- Worker blocks on the Redis queue instead of polling the database every 2 seconds.
- Any job id left in the Redis processing list is moved back to the ready queue when the worker starts.

Default settings:

```env
REDIS_PORT=6379
REDIS_URL=redis://redis:6379
REDIS_QUEUE_PREFIX=picup:image-jobs
```

If you run the API locally outside Docker while Redis is exposed on your host machine, use:

```env
REDIS_URL=redis://localhost:6379
```

## Auth Integration

PicUp now supports a Supabase-like auth entry flow while keeping the implementation inside the NestJS API and PostgreSQL:

- Password login remains available through `POST /api/auth/login`.
- Email registration is a two-step code flow: `POST /api/auth/email/start` then `POST /api/auth/email/verify`.
- WeChat scan login is a three-step flow: `POST /api/auth/wechat/start`, middleware scans and calls `POST /api/auth/wechat/callback`, the browser polls `GET /api/auth/wechat/status?state=...`.
- Sessions are issued as HttpOnly cookies by the API.

Email delivery can be connected with:

```env
EMAIL_DELIVERY_WEBHOOK_URL=https://your-mailer.example.com/send-code
EMAIL_DELIVERY_WEBHOOK_SECRET=replace_me
```

The email webhook receives:

```json
{
  "to": "user@example.com",
  "code": "123456",
  "mode": "register",
  "expiresInSeconds": 600
}
```

WeChat scan middleware can be connected with:

```env
WECHAT_SCAN_URL_TEMPLATE=https://your-wechat-middleware.example.com/scan?state={state}&callbackUrl={callbackUrl}
WECHAT_AUTH_CALLBACK_SECRET=replace_me
```

After the user scans and confirms, the middleware should call:

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

The database includes `email_auth_challenges`, `external_identities`, `wechat_login_sessions`, and a reserved `payment_orders` table for future WeChat Pay order persistence.
