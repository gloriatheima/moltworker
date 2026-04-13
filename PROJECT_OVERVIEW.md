# 项目概览（OpenClaw on Cloudflare Workers）

## 这个项目是做什么的

这是一个把 `OpenClaw`（个人 AI 助手网关）运行在 Cloudflare Workers + Cloudflare Sandbox 容器里的项目。

它的核心目标是：
- 让 OpenClaw 网关以托管方式运行（无需自建服务器）
- 对外提供 Web UI / WebSocket 访问
- 提供管理端（`/_admin/`）来做设备配对、重启网关、手动备份
- 提供调试端（`/debug/*`）排障
- 可选接入 R2，实现配置与会话数据持久化

---

## 它是怎么工作的

### 1) 总体架构

- Worker 作为入口（`src/index.ts`）
- Worker 内通过 `@cloudflare/sandbox` 管理容器生命周期
- 容器内运行 OpenClaw gateway（端口 `18789`）
- Worker 将 HTTP / WebSocket 请求代理到容器中的 gateway

### 2) 路由与鉴权分层

`src/index.ts` 中按“先公开、后受保护、最后兜底代理”的顺序组织：

- **公开路由（不走 Cloudflare Access）**
  - 来自 `src/routes/public.ts`
  - 典型路径：`/sandbox-health`、`/logo*.png`、`/api/status`、`/_admin/assets/*`
  - 其中 `/api/status` 还承担“触发 restore + 启动 gateway（非阻塞等待就绪）”职责

- **受保护路由（需要 Cloudflare Access）**
  - `/api/*` -> `src/routes/api.ts`
  - `/_admin/*` -> `src/routes/admin-ui.ts`
  - `/debug/*` -> `src/routes/debug.ts`（且需 `DEBUG_ROUTES=true`）

- **兜底路由（`app.all('*')`）**
  - 将其余请求代理到 OpenClaw gateway
  - 支持 WebSocket 透传与消息拦截
  - 当 gateway 未就绪时，返回 loading 页面
  - 当检测到 gateway 崩溃时，尝试“kill -> restore -> ensureGateway -> retry”恢复链路

### 3) 启动与恢复策略

- 每个请求通过中间件注入 sandbox 句柄
- 非 HTML 的 HTTP 请求会先尝试 `restoreIfNeeded`，再 `ensureGateway`
- HTML 请求优先快速判断 gateway 是否运行，未就绪时直接返回 loading 页避免空白
- 定时任务（`scheduled`）调用 `handleScheduled`，用于周期性持久化相关工作

### 4) 配置与运行前校验

`index.ts` 在生产模式下会校验关键环境变量：
- `MOLTBOT_GATEWAY_TOKEN`
- `CF_ACCESS_TEAM_DOMAIN`
- `CF_ACCESS_AUD`
- Cloudflare AI Gateway 三件套：`CLOUDFLARE_AI_GATEWAY_API_KEY` + `CF_AI_GATEWAY_ACCOUNT_ID` + `CF_AI_GATEWAY_GATEWAY_ID`

模型策略：
- Worker 默认主模型为 `workers-ai/@cf/zai-org/glm-4.7-flash`
- 故障回退（例如 GLM 不可用时回退 `workers-ai/@cf/moonshotai/kimi-k2.5`）在 Cloudflare AI Gateway 控制台的 Dynamic Route 中配置

缺失时：
- 浏览器请求返回友好 HTML 错误页
- API 请求返回 JSON 503

---

## 关键能力（按模块）

### A. 网关代理能力（核心）

- HTTP 代理到容器 gateway
- WebSocket 代理与桥接（`WebSocketPair`）
- 错误信息转换（如 token 缺失、pairing required）
- 崩溃自愈重试

### B. 管理 API（`src/routes/api.ts`）

主要在 `/api/admin/*`：
- 设备管理
  - `GET /api/admin/devices`
  - `POST /api/admin/devices/:requestId/approve`
  - `POST /api/admin/devices/approve-all`
- 存储/备份
  - `GET /api/admin/storage`
  - `POST /api/admin/storage/sync`（创建 snapshot）
- 网关控制
  - `POST /api/admin/gateway/restart`

实现上通过容器内 CLI（`openclaw devices ... --url ws://localhost:18789`）与 gateway 交互。

### C. Admin UI（`src/routes/admin-ui.ts`）

- 统一回落到 `index.html`（SPA）
- 静态资源由公开路由 `/_admin/assets/*` 提供，保证登录重定向链路可用

### D. Debug 能力（`src/routes/debug.ts`）

提供版本、进程、日志、CLI、环境、容器配置、停止网关、销毁容器、触发 cron、R2 写入等调试接口，便于定位容器内状态与网关问题。

### E. 可选扩展能力（README）

- 多渠道机器人：Telegram / Discord / Slack
- CDP 浏览器自动化路由（`/cdp/*`）
- R2 持久化（快照/恢复）
- AI Gateway 路由与模型切换（可在控制台配置 Dynamic Route/Fallback 可视化）

---

## 开发方式（本项目建议流程）

### 1) 本地开发

- 安装依赖：`npm install`
- 复制配置：`cp .dev.vars.example .dev.vars`
- 常用本地变量：
  - `DEV_MODE=true`（跳过 CF Access + 设备配对）
  - `DEBUG_ROUTES=true`（启用调试路由）
- 启动 Worker：`npm run start`

### 2) 常用命令

- `npm run typecheck`：类型检查
- `npm test`：Vitest 单测
- `npm run build`：构建 worker + client
- `npm run deploy`：部署到 Cloudflare

### 3) 代码入口与阅读顺序

建议按下面顺序熟悉项目：
1. `README.md`（部署、鉴权、密钥、运维）
2. `src/index.ts`（主请求链路、鉴权层次、proxy/recovery）
3. `src/routes/public.ts`（公开入口与冷启动状态轮询）
4. `src/routes/api.ts`（管理能力与 CLI 调用模式）
5. `src/routes/admin-ui.ts` + `src/routes/debug.ts`（管理 UI 与排障面）

### 4) 开发注意点

- OpenClaw CLI 调用要带 `--url ws://localhost:18789`
- CLI 耗时常见 10~15s，需等待进程完成（本项目用 `waitForProcess`）
- 成功文案匹配注意大小写（`Approved`，建议 case-insensitive）
- 本地 `wrangler dev` 对 WebSocket 代理有已知限制，完整链路建议以线上环境验证

---

## 一句话总结

这是一个“把 OpenClaw 网关托管到 Cloudflare 容器并由 Worker 统一做代理、鉴权、运维与持久化”的项目：
既能直接对外提供聊天入口，也能通过管理与调试路由完成设备配对、恢复和日常运维。
