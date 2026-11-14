# 可观测性与端到端巡检

本页覆盖两类「上线后才知道」的检查：浏览器侧的前端遥测（issue #380），以及夜间运行的
Playwright 冒烟 + axe 无障碍基线。两者都不引入 Sentry 等第三方服务，也不写业务库：
遥测落到进程 stdout，巡检只写独立 `_test` 库。

## 1. 前端遥测

### 1.1 上报什么

入口在 `src/components/telemetry/ClientTelemetry.tsx`，随根布局挂载：

- **Web Vitals**：`useReportWebVitals` 上报 CLS / FCP / INP / LCP / TTFB，带 `value` 与 `rating`；
- **错误**：路由错误边界（`src/app/error.tsx`）、全局错误边界（`src/app/global-error.tsx`）、
  `window.onerror` 与 `unhandledrejection` 四个来源；
- **公共字段**：`route`（仅 pathname）、`release`（构建 SHA）。

`release` 是完整提交 SHA，会随客户端包公开，即使关闭遥测也存在。本仓库是公开仓库，
SHA 本身不是凭据；保留完整值是为了与服务端日志里的发布版本直接对齐。若未来仓库转为私有，
应改为服务端关联或只发非敏感版本标识。

**不采集**：表单内容、姓名、QQ、手机号、邮箱、Cookie、完整 URL（含查询串与 hash）、
错误 `message` / `stack`、IP、User-Agent。路由里的 UUID 与最长 20 位数字段会被替换成
`[id]`，避免把资源标识写进日志。

### 1.2 限流、采样与去重

| 层级   | 规则                                                                                                |
| ------ | --------------------------------------------------------------------------------------------------- |
| 客户端 | Web Vitals 默认 100% 采样，每个指标每页只报一次，每页最多 10 条                                     |
| 客户端 | 错误按「边界 + 类型名 + digest」去重：60 秒内同一签名最多 3 条                                      |
| 客户端 | 每页错误总数上限 20 条，路由切换后重置                                                              |
| 服务端 | 按 IP 每分钟 120 次；请求体上限 4 KB（流式累计，超限立即取消请求流）；只接受同源 `application/json` |

开关：

- `NEXT_PUBLIC_TELEMETRY_DISABLED=1`：构建期关闭前端上报；
- `NEXT_PUBLIC_TELEMETRY_SAMPLE_RATE=0.1`：构建期只对 Web Vitals 采样（0–1，非法值回落为 1）；
- `TELEMETRY_DISABLED=1`：服务端停止接收，直接返回 `202` 但不读正文、不写日志；
  用于前端包已发出去后的运营止损，改动后重启服务生效。

> 按 IP 限流是 best-effort：校园 NAT 下多个用户共享出口 IP，高峰时可能提前丢弃遥测样本。
> 这个口径只用于观察趋势，不能用来断言「某错误没有发生」。

### 1.3 日志长什么样

成功上报返回 `202`，服务端打印一行结构化 JSON：

```json
{"event":"client_telemetry","time":"2026-11-13T02:10:00.000Z","requestId":"…","kind":"web-vital","route":"/repair-activities/[id]","release":"1c9457b…","metric":"LCP","value":1234.567,"rating":"good"}
{"event":"client_telemetry","time":"2026-11-13T02:11:00.000Z","requestId":"…","kind":"error","route":"/member","release":"1c9457b…","code":"UNHANDLED_REJECTION","boundary":"unhandledrejection","name":"TypeError"}
```

- `release` 是**服务端构建**的 SHA（`next.config.ts` 注入，取不到时为 `unknown`）；
- 只有客户端上报的 SHA 与服务端不同时，才额外出现 `clientRelease`，用于发现「前端缓存了旧包」；
- 错误日志的 `code` 由边界映射：`ROUTE_ERROR` / `GLOBAL_ERROR` / `WINDOW_ERROR` /
  `UNHANDLED_REJECTION`；
- 不含 IP / UA / 错误内容。

查看方式按部署形态取进程 stdout（`journalctl -u <服务名>`、容器日志或本地 `pnpm dev` 终端），
过滤 `event":"client_telemetry` 即可。发布后排查时先看 `release`，再按 `route` 与 `code` 聚合；
`requestId` 可与同一请求的应用日志对齐。

接口契约见 [API v1 · 前端遥测](contracts/api-v1.md#前端遥测issue-380)。

## 2. 端到端巡检（Playwright）

### 2.1 覆盖范围

`tests/e2e/` 只保留**关键路径**，不做全站 E2E：

| 文件              | 场景                                                                         |
| ----------------- | ---------------------------------------------------------------------------- |
| `flows.spec.ts`   | 成员登录 → 公开报名（含免责声明）→ 标记出勤 → 管理员签到入队 → 成员接待      |
| `members.spec.ts` | 管理员成员列表按姓名筛选；分页加载至全部 21 条（自动续页 / 「加载更多」）    |
| `axe.spec.ts`     | 首页、登录、活动列表、活动详情、管理员成员列表的 axe 基线（明 / 暗两套主题） |

流程测试同时断言浏览器遥测真的到达 `/api/v1/telemetry`（`202`、路由不含查询串、
`release` 为合法 SHA），把「前端上报 → 端点」这段串起来。CI 失败重试时按
`testInfo.retry` 生成独立手机号与姓名，避免与首次尝试的报名记录冲突；定位看板行时
使用精确名称，旧记录留在看板里也不影响。

### 2.2 本地运行

前提：

1. 独立测试库（库名必须以 `_test` 结尾）；
2. 已部署 Migration；
3. 已安装 Chromium：`pnpm exec playwright install chromium`。

```bash
# 建库后只跑一次 Migration
DATABASE_URL="mysql://app_user:change-me@127.0.0.1:3307/zafu_pchospital_test?allowPublicKeyRetrieval=true" \
  pnpm db:migrate:deploy

# 构建 + 起生产服务 + 跑全部 E2E；webServer 内部执行 pnpm build:site
DATABASE_URL="mysql://app_user:change-me@127.0.0.1:3307/zafu_pchospital_test?allowPublicKeyRetrieval=true" \
  pnpm test:e2e
```

`playwright.config.ts` 在加载时调用 `assertTestDatabase()`：`DATABASE_URL` 未指向 `_test` 库
会直接拒绝运行（与 `pnpm test:db` 同一道闸门）。未显式设置时依次读取 `.env.local`、`.env`
（前者没有提供 `DATABASE_URL` 时才继续读后者），因此**本地务必用上面的方式覆盖**。
夹具由 `tests/e2e/e2e-db.ts` 在独立 tsx 进程写入 / 清理，全部带随机前缀；
角色按 code upsert，不依赖 `pnpm db:seed`。

`reuseExistingServer` 固定为 `false`：3311 端口被占用时直接报错，不会复用无法验证
数据库指向与构建版本的旧 server。先停掉占端口的进程再跑。

### 2.3 CI：夜间 + 手动

`.github/workflows/e2e.yml`：

- 计划任务每天 19:00 UTC（北京时间 03:00）运行一次，也可在 Actions 页手动触发；
- 起 `mysql:8.0.32` service，部署 Migration 后执行 `pnpm test:e2e`；
- 失败时上传 HTML 报告与 trace / 截图（保留 7 天）。

**不在每个 PR 跑**：这套流程要构建生产包并启动真实浏览器，单轮成本明显高于 `ci.yml`；
PR 仍由 `ci.yml` 拦截 lint、类型、构建与文档产物。需要临时验证某次改动时手动触发即可。

### 2.4 axe 基线

`tests/e2e/axe-baseline.json` 按「路由 + 主题」记录当前存在的 **critical / serious** 问题，
每条指纹包含规则 id 与命中节点的 selector（按 `wcag2a` / `wcag2aa` / `wcag21a` / `wcag21aa`
扫描）。`normal` 与 `dark` 分别扫描、分别对比，同一规则在某个主题下新增节点也会失败；
已修复的指纹可以暂时留在基线里，重录时清除。

重录基线（会就地改写 JSON，提交前检查 diff）：

```bash
DATABASE_URL="mysql://…_test" AXE_UPDATE_BASELINE=1 pnpm test:e2e
```

当前基线（录制日期 2026-11-14；Playwright 1.65.0 / axe-core 4.13.0）：

| 路由                      | normal               | dark                 |
| ------------------------- | -------------------- | -------------------- |
| `/`                       | `color-contrast` × 1 | `color-contrast` × 1 |
| `/login`                  | 无                   | 无                   |
| `/repair-activities`      | `color-contrast` × 1 | `color-contrast` × 1 |
| `/repair-activities/[id]` | 无                   | 无                   |
| `/admin/members`          | 无                   | 无                   |

扫描时固定 `prefers-reduced-motion: reduce`，避免入场动画的半透明中间态让基线随扫描时机漂移。

> 指纹里的 selector 由 axe 生成，页面结构或列表内容变化可能让 selector 改变。
> 如果 diff 只是节点位置变化、没有新增问题，重录并在 PR 说明；出现新规则或新区域时先修，
> 不要为了让测试变绿而删除整个路由的条目。

### 2.5 已知边界

- 不覆盖照片上传、邮件发送、支付类外部依赖；
- 活动时间窗口由夹具固定在「开始前 20 分钟」，跑完整套约 5–10 分钟，不需要系统时间篡改；
- 两个上下文（成员 / 管理员）共用同一测试库，worker 固定为 1，避免夹具互相清理。
