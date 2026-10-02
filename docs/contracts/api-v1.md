# Phase 2 API v1 契约

## 通用信封

成功：`{ success: true, data, meta: { requestId, pagination? } }`。

失败：`{ success: false, error: { code, message, fieldErrors? }, meta: { requestId } }`。

生产响应不包含堆栈、SQL、表名、连接串、完整联系方式或账户存在性细节。客户端可以传
合法的 `X-Request-Id`，否则服务端生成 `req_<uuid>`。

分页默认 `page=1&pageSize=20`，`pageSize` 范围为 1–100。

## 通用列表查询参数

所有管理端列表都接受同一套查询参数（各端点再叠加自己的筛选字段）：

| 参数                | 说明                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `page` / `pageSize` | 分页，默认 `1` / `20`，`pageSize` 范围 1–100。非法值 → `VALIDATION_FAILED`                                                   |
| `query`             | 关键字模糊匹配。**匹配范围由各端点自己定义**（例如成员列表匹配姓名 / 昵称 / 学号 / 班级 / 脱敏联系方式），不是「全字段搜索」 |
| `sort`              | 排序，格式 `sort=<field>:<asc\|desc>[,<field>:<asc\|desc>]`                                                                  |
| `filter`            | **列级筛选**，格式 `filter=<field>:<op>:<value>`，可重复出现（最多 5 条）                                                    |     |

`sort` 的约定：

- **方向可省略**，省略按 `asc`（`sort=joinedAt` 等价于 `sort=joinedAt:asc`）；
- **每个端点有独立白名单**，不在白名单里的字段 → `VALIDATION_FAILED`，
  字段名绝不透传成列名。各端点白名单见该端点的说明（成员列表见下方 M6 一节）；
- **最多 3 个字段**，超出 → `VALIDATION_FAILED`（拒绝而不是静默截断）；
- 同一字段重复出现只保留第一条；
- **服务端始终给排序补一个稳定的 tiebreaker（`id`）**：主排序键可以重复（同名成员、
  同一秒创建的两条记录），名次不确定时 `skip` / `take` 分页会重复或漏行，
  而列表是「往下滚动接下一页」的连续流，重复行会直接被用户看见；
- **不带 `sort` 时按服务端默认顺序**（不是「不排序」）。默认顺序属于服务端：
  客户端不要把它拼进 URL，否则第一次 GET 与后续 GET 的口径可能不一致。

`filter` 的约定：

- 运算符只有五种：`eq` / `neq`（离散值）、`contains`（文本）、`gte` / `lte`（日期与数字区间）。
  **不做**正则、跨列模糊与跨表条件 —— 它们会把一次误输入变成全表扫描，或让语义取决于关联图；
- 值与排序一样走**每端点独立白名单**（`src/features/*/*-filter.ts`）：字段或运算符不在白名单
  → `VALIDATION_FAILED`；值不许为空；完全相同的条件去重；超过 5 条**拒绝而不是截断**；
- 值的类型解释在该端点的映射层：枚举校验取值，日期按 `Asia/Shanghai` 自然日解释，
  **结束日包含全天**（`lte` 表达为「次日 00:00 排他上界」，见 `lib/api/date-filter.ts`）；
- **列级筛选与 `query` 是两件事**：`query` 是跨列关键字搜索，`filter` 是逐列条件，可同时用。
  关联字段（如成员的角色）不是列，不进列级白名单，仍走固定筛选参数。

排序字段与「表头可点的列」共用同一份白名单定义（`src/features/*/*-sort.ts`），
因此不会出现「界面能点、后端 400」。

## 已接线端点

### `GET /api/v1/health`

执行服务端数据库探测。成功返回 `{ status: "ok", database: "reachable" }`。

### `POST /api/v1/join-applications`

请求字段：`realName`、`qq`、`phone`、可选 `selfIntroduction`、可选
`preferredDirection`、`privacyConsent: true`。招募批次由服务端
`RECRUITMENT_CYCLE` 配置，不接受客户端指定。

首次创建返回 201；同一批次相同规范化 QQ 或手机号的重复有效提交返回原回执和 200，
`data.duplicate=true`。该公开入口保留独立的公开报名限流，并且与其他写接口一样执行
`assertSameOrigin()`（无 `Origin` 或非白名单来源返回 403）。

### 认证与当前用户

- `POST /api/v1/auth/login`：QQ + 密码登录并设置数据库 Session Cookie。可选 `rememberMe`
  必须是布尔值，省略或 `false` 为 1 天有效期，`true` 为 30 天；其他类型返回
  `VALIDATION_FAILED`。登录页默认不勾选「保持登录状态」。
- `POST /api/v1/auth/logout`：撤销当前 Session 并清除 Cookie。
- `POST /api/v1/auth/password/change`：验证当前密码、修改密码、撤销其他 Session 并轮换当前 Session。
- `GET /api/v1/me`：返回当前 User、Role、Permission、MemberProfile 状态、首次改密标记与
  `rememberMe`。只更新最后访问时间，不延长 Session 或 Cookie 到期时间。

管理员初始密码登录后，除 `/me`、改密和登出外均返回 `PASSWORD_CHANGE_REQUIRED`。所有使用
Cookie 的写接口校验 `Origin`：`Origin` 必须等于服务端配置的 `APP_BASE_URL`（含其 `www`
变体）的来源，缺失 `Origin` 或非白名单来源返回 403。**不拿请求自带的 `Host` /
`X-Forwarded-Host` 当比较基准**——那两个头由请求方控制，跟着它们走等于让攻击者自己填写
白名单（2026-09 安全审计 F4）。Cookie 名为 `pc_hospital_session`，使用
HttpOnly、SameSite=Lax、Path=/，生产环境启用 Secure。
Cookie 的 `Expires` 与数据库 Session 的 `expiresAt` 一致。改密轮换 Session 时保留
`rememberMe`；登出、管理员重置密码和成员禁用仍撤销有效 Session。
`/login` 会识别有效 Session，按首次改密 / 管理员 / 成员身份跳转对应页面。
受保护页面在到期时跳转 `/login?reason=expired`，登录页通过浮层显示过期提醒；
浏览器恢复焦点或标签恢复可见时重新校验，网络异常不会被当作过期。

### 招募、邀请码与成员核心 API

- `GET /api/v1/admin/join-applications`
- `GET /api/v1/admin/join-applications/:id`
- `POST /api/v1/admin/join-applications/:id/reviews`
- `POST /api/v1/admin/join-applications/:id/provision`
- `POST /api/v1/admin/join-applications/:id/provision/retry`
- `POST /api/v1/admin/invite-codes`
- `GET /api/v1/admin/invite-codes`
- `PATCH /api/v1/admin/invite-codes/:id`
- `POST /api/v1/admin/invite-codes/:id/revoke`
- `POST /api/v1/member-registrations/invite`
- `GET /api/v1/me`
- `POST /api/v1/admin/members`
- `POST /api/v1/admin/members/:id/disable`
- `POST /api/v1/admin/members/:id/enable`
- `POST /api/v1/admin/members/move`
- `POST /api/v1/admin/members/:id/password-reset`

报名列表接受 `page`、`pageSize`、`status`、`provisionStatus`、`submittedFrom`、
`submittedTo` 与 `query`；列表只返回脱敏 QQ/手机号，完整联系方式、内部备注和审核记录只在
管理员详情接口返回。邀请码注册要求密码确认，并与报名入口一样执行公开写限流。

这些端点的输入/输出 Service 契约位于 `src/types/contracts.ts`。管理员路径不是权限边界；
Route Handler 必须从数据库 Session、账号状态和有效 UserRole 构造 actor，Service 再
调用 `requirePermission`；不得信任客户端传入的角色或权限。

## 稳定错误码

错误码的唯一事实来源是 `src/lib/api/errors.ts`，包括校验、鉴权、状态机、幂等、账号冲突、
发放失败、邀请码状态、限流与内部错误。不得按 Feature 新建另一套错误格式。

## Contract 变更

修改公共 Type、Enum、错误码、API 信封或已记录端点时，必须先搜索所有生产者与消费者并在
PR 中记录影响范围。不强制单独评审；但若影响其他模块，必须在同一变更中同步 Route、Service、
客户端调用、数据迁移（如有）、Contract 测试和文档，不能保留新旧两套不兼容语义。

## M2 维修记录

成员端：

- `GET/POST /api/v1/repairs`
- `GET/PATCH/DELETE /api/v1/repairs/:id`（DELETE 仅管理员）
- `POST /api/v1/repairs/:id/submit`
- `POST /api/v1/repairs/:id/photos`
- `PATCH/DELETE /api/v1/repairs/:id/photos/:photoId`
- `GET /api/v1/repair-photos/:photoId/content`
- `GET /api/v1/repair-categories`
- `GET /api/v1/repair-members`

管理端核心 API（M6 消费，不在 M2 建完整管理页面）：

- `GET /api/v1/admin/repairs`、`GET /api/v1/admin/repairs/:id`
- `POST /api/v1/admin/repairs/:id/reviews`
- `PATCH /api/v1/admin/repairs/:id/flags`
- `POST /api/v1/admin/repair-categories`
- `PATCH /api/v1/admin/repair-categories/:id`
- `POST /api/v1/admin/repair-categories/:id/deactivate`

幂等键的传递方式按端点分两类，两侧不互通：

| 传递方式                     | 端点                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Idempotency-Key` **请求头** | 成员端写接口：`POST /api/v1/repairs`、`POST /api/v1/repairs/:id/submit`                                                                                            |
| 请求体字段 `idempotencyKey`  | 管理端与后台写接口：`POST /api/v1/admin/repairs/:id/reviews`、`.../batch-reviews`、`admin/members`、`join-applications/:id/reviews`、`member-registrations/invite` |

单条审核的键上限 128 位；批次键按 `${批次键}:${recordId}` 给每条记录派生一个键，`recordId` 是
`Char(36)`，所以批次键上限是 `128 − 1 − 36 = 91` 位。

> 单条审核曾读**头**而界面发**体**，两边对不上导致管理端审核必然 400（issue #62）。
> 现在两类端点各按上表取值，`tests/integration/m6-admin.test.ts` 从真实路由打进一次以防回归。

更新草稿携带 `version`；过期版本返回
`REPAIR_VERSION_CONFLICT`。列表支持分页、成员、分类、状态、结果、日期、疑难、典型和关键词
筛选；普通成员只能看到本人全部状态与他人的 `APPROVED` 记录。照片内容接口要求有效 Session，
并返回私有缓存、`nosniff`、正确 MIME 与长度。

## M3 成员工作台与个人主页

```text
GET   /api/v1/member/dashboard                     # 工作台聚合视图
GET   /api/v1/member/profile                       # 自我可见资料 + 摘要 + 最近记录
PATCH /api/v1/member/profile                       # 更新昵称（乐观锁）
PUT   /api/v1/member/profile/skills                # 覆盖式保存技能集合（乐观锁）
GET   /api/v1/members/:memberProfileId/profile     # 他人内部主页（字段已裁剪）
GET   /api/v1/skills                               # 启用中的技能标签（供选择器使用）
```

所有端点为 `runtime = "nodejs"` + `dynamic = "force-dynamic"`，响应头固定
`Cache-Control: private, no-store` —— 成员资料与会话上下文不允许被任何共享缓存留存。

写入约束：

- `PATCH /member/profile` 的请求体只接受 `nickname` 与 `version`；出现其他字段
  （如 `realName`、`studentId`、`className`）返回 `VALIDATION_FAILED` 400，
  而不是静默忽略，避免客户端误以为越权字段已被写入。
- `PUT /member/profile/skills` 接受**完整期望集合** `skillIds` + `profileVersion`，
  天然幂等：取消选择走 `UserSkill` 软删除，重新选择恢复同一行；
  数量上限与未知技能分别返回 `SKILL_LIMIT_EXCEEDED` 400 / `SKILL_NOT_FOUND` 404。
- 版本过期统一返回 `MEMBER_PROFILE_VERSION_CONFLICT` 409，客户端应提示刷新而非重试。
- 写接口全部执行 `assertSameOrigin()`（Cookie 认证的 CSRF 防护）。

可见性边界：

- `GET /member/dashboard` 与 `GET /skills` 的响应**不含** QQ、学号、班级与 `userId`；
- QQ 只出现在 `GET /member/profile`（自我）与 `GET /members/:id/profile`（内部）两处，
  页面必须标注「内部可见」；
- 他人主页对不存在、已软删除、非有效成员与无权访问统一返回 `MEMBER_PROFILE_NOT_FOUND` 404，
  避免成员枚举；
- 工作台 `notifications` / `favorites` 为 M4 真实摘要（`available: true` + 计数 + `latest`）；
  `ranking` 仍固定为 `{ available: false, module: "M5" }`，不携带任何业务数字。

局部降级与日期口径：

- `GET /member/dashboard` 额外返回 `degraded: MemberDashboardDegraded[]`，列出加载失败的区块
  （`repairSummary` / `workQueue` / `recentRepairs` / `recentActivity` / `notifications` / `favorites`）。
  维修四路与通知、收藏查询相互独立，任一路失败**不得**让其余区块一并报错，客户端只对失败区块
  渲染错误态；全部成功时该字段为空数组。失败区块回退为空数组 / 空队列，`repairSummary` 回退时
  所有 `MetricValue` 标为 `UNCONFIGURED`，**绝不**伪造 `0`。通知/收藏失败时摘要仍为
  `{ available: true, unreadCount|count: 0, latest: [] }`，由 `degraded` 标明该区块失败。
- 「本月 / 本学期」是日期相对口径。`GET /member/profile`、
  `GET /members/:memberProfileId/profile` 与工作台共用同一套
  `resolveMemberRanges(now)`，三个入口的同名指标必须相等。学期未配置时
  `termApprovedCount` 返回 `{ value: null, status: "UNCONFIGURED" }`。

## M4 内部交流与通知

成员端（均需有效 Session + 有效成员身份；`runtime = "nodejs"` + `dynamic = "force-dynamic"`，
响应头固定 `Cache-Control: private, no-store`；写接口执行 `assertSameOrigin()`）：

```text
GET    /api/v1/repairs/:id/comments
POST   /api/v1/repairs/:id/comments
DELETE /api/v1/repairs/:id/comments/:commentId
GET    /api/v1/member/favorites
POST   /api/v1/member/favorites
DELETE /api/v1/member/favorites/:repairId
GET    /api/v1/member/notifications
POST   /api/v1/member/notifications/:id/read
POST   /api/v1/member/notifications/read-all
DELETE /api/v1/member/notifications/:id
```

评论：

- 列表分页的是**根评论**；每条根评论附带其全部未删除回复。回复深度固定两层：若
  `parentCommentId` 已是回复，服务端拍平到该回复的根。
- `POST` 请求体只接受 `body`、可选 `parentCommentId`、可选 `mentionedMemberProfileIds`；
  出现其他字段返回 `VALIDATION_FAILED` 400。
- 提及取请求 ID 与正文 `@姓名` 的并集，对照有效成员的昵称 / 实名 / 账号展示名做最长匹配；
  未知、停用、自己跳过；未知显式 ID 返回 `VALIDATION_FAILED`；超过 `COMMENT_MENTION_LIMIT`
  （10）返回 `MENTION_LIMIT_EXCEEDED`，**拒绝整条、不截断**。正文上限 2000 码点。
- 作者可删除自己的评论（需 `comment:create`）；删除他人评论需 `comment:delete`（仅管理员）。
  删除走 `deleted_at` 软删除并写审计。
- 评论可见性继承维修记录：他人草稿 / 待审 / 退回统一 `REPAIR_NOT_FOUND`。

收藏：

- 唯一约束 `(memberProfileId, repairRecordId)`。取消写 `deleted_at`；再次收藏恢复同一行，
  并刷新 `createdAt` / `updatedAt` 以反映最近收藏时间。
- 只能收藏当前成员可见的记录。

通知：

- `GET` 的 `data` 为 `{ items, unreadCount }`，分页在 `meta.pagination`。
- 可选 `status=UNREAD|READ`。标已读幂等；全部已读只更新未读行。
- 删除走软删除，**不改** `status` / `readAt`。只能操作本人收件箱，他人 ID 一律
  `NOTIFICATION_NOT_FOUND`。
- 类型：`MENTIONED`、`REPAIR_COMMENTED`、`REPAIR_APPROVED`、`REPAIR_REJECTED`。
  不通知自己；同一评论对记录主人若同时被 @，只发 `MENTIONED`。审核通知在审核事务内写入，
  审核员没有成员档案时 `actorMemberProfileId` 可为 null，仍通知记录主人。

案例标记仍走 M2 的 `PATCH /api/v1/admin/repairs/:id/flags`（需 `repair:flag`）；
成员详情只展示徽章，管理员在详情页可改标记。

## M6 管理后台

新增（全部要求 `ADMIN` 角色对应的权限码，未登录 401、普通成员 403）：

| 端点                                                | 权限                      | 说明                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/admin/members`                         | `member:manage`           | 成员列表：`page`/`pageSize`/`query`/`status`/`role`/`sort`；QQ 与手机号**只返回脱敏值**；含 `skills`（技能标签，非敏感）、`joinedAt` 与 `approvedRepairMinutes`（同口径维修总时长）；`sort` 白名单：`realName`/`nickname`/`studentId`/`className`/`status`/`joinedAt` —— 聚合列与关联列不可排序；`filter` 白名单：`status`(eq/neq)、`realName`/`nickname`/`studentId`/`className`(contains)、`joinedAt`(gte/lte) |
| `GET /api/v1/admin/members/:id`                     | `member:manage`           | 成员详情：唯一返回 QQ / 手机号明文的端点，**每次读取写审计** `member.detail.viewed`                                                                                                                                                                                                                                                                                                                              |
| `PATCH /api/v1/admin/members/:id`                   | `member:manage`           | 编辑实名 / 学号 / 班级 / 昵称；乐观锁 `version`，冲突 409 `MEMBER_PROFILE_VERSION_CONFLICT`；**响应带新的 `version`**（就地编辑要能连续提交同一行）                                                                                                                                                                                                                                                              |
| `PUT /api/v1/admin/members/:id/roles`               | `member:manage`           | 角色**全量集合** `{roles:[...]}`；撤销最后一个在册管理员 409 `MEMBER_LAST_ADMIN`                                                                                                                                                                                                                                                                                                                                 |
| `PUT /api/v1/admin/members/:id/skills`              | `member:manage`           | `{skillIds, profileVersion}`，与成员自助同一实现（上限 12）                                                                                                                                                                                                                                                                                                                                                      |
| `POST /api/v1/admin/members/batch`                  | `member:manage`           | `{memberIds, enabled}`，单次上限 50；**允许部分成功**，`failed` 带稳定错误码                                                                                                                                                                                                                                                                                                                                     |
| `POST /api/v1/admin/members/move`                   | `member:manage`           | `{memberIds: string[], beforeId: string \| null}`：把这几行（1–50，保持内部先后）整体拖到 `beforeId` 之前（`null` = 末尾）；整份重排写成稠密 `sortOrder`，落点没变则幂等（`moved: false`）且不写审计；任一位成员不存在 404 `RESOURCE_NOT_FOUND`                                                                                                                                                                  |
| `GET /api/v1/admin/members/:id/stats`               | `analytics:read_internal` | M5 个人统计口径的管理端入口；**已禁用成员的历史统计也可查**                                                                                                                                                                                                                                                                                                                                                      |
| `GET /api/v1/admin/repairs`                         | `repair:read`             | 管理端维修列表：`page`/`pageSize`/`query`/`memberId`/`categoryId`/`status`/`result`/`repairDateFrom`/`repairDateTo`/`isDifficult`/`isTypical`/`sort`；`sort` 白名单：`repairDate`/`durationMinutes`/`status`/`result`/`memberName`/`categoryName`/`createdAt` —— 关联列按**名字**排（按 UUID 排没有意义）；导出**不读** `sort`，顺序固定                                                                         |
| `PATCH /api/v1/admin/repairs/:id`                   | `repair:review`           | 修改异常数据：草稿字段 + `version` + **必填 `reason`**；**不改审核状态**                                                                                                                                                                                                                                                                                                                                         |
| `DELETE /api/v1/admin/repairs/:id`                  | `repair:delete`           | 软删除违规记录：`{reason}` 必填，复用 M2 `repairService.softDelete`                                                                                                                                                                                                                                                                                                                                              |
| `POST /api/v1/admin/repairs/batch-reviews`          | `repair:review`           | `{recordIds, decision, note?, idempotencyKey}`，单次上限 50；逐条复用单条审核，允许部分成功                                                                                                                                                                                                                                                                                                                      |
| `GET /api/v1/admin/repair-categories`               | `repair:category:manage`  | 管理端分类列表：**含已停用**，并带 `usedByRepairCount` 引用计数                                                                                                                                                                                                                                                                                                                                                  |
| `POST /api/v1/admin/repair-categories/:id/activate` | `repair:category:manage`  | 重新启用被误停用的分类                                                                                                                                                                                                                                                                                                                                                                                           |
| `GET /api/v1/admin/repairs/export`                  | `data:export`             | 导出：`format=csv\|xlsx` + 与列表完全相同的筛选参数；返回附件流                                                                                                                                                                                                                                                                                                                                                  |

导出与批量操作的约定：

- 导出筛选条件与 `GET /api/v1/admin/repairs` **同源**（复用同一个 `listWhere`），
  所以「筛选后导出」等于「界面所见即所得」；行数上限 20000，超出返回 409
  `EXPORT_ROW_LIMIT_EXCEEDED` 而**不静默截断**。
- CSV 带 UTF-8 BOM 与 CRLF，并对 `=`/`+`/`-`/`@` 开头的单元格做公式注入防护；
  图片不嵌入表格，只输出记录 ID 与照片 URL。每次导出写审计 `repair.exported`。
- 批量操作逐条调用既有单条 Service（`setEnabled` / `review`），**不绕过状态规则**，
  单条上限 `ADMIN_BATCH_LIMIT`（50），超过返回 400 `MEMBER_BATCH_LIMIT_EXCEEDED` /
  `REPAIR_BATCH_LIMIT_EXCEEDED`。
- 退回类操作的原因在**入口**校验（`REPAIR_REJECTION_NOTE_REQUIRED`），不会让 N 条记录各失败一次。
- 成员列表带 `approvedRepairMinutes`：与 `approvedRepairCount` 完全同口径
  （`APPROVED AND deletedAt IS NULL`）的时长合计，一次 `groupBy` 同时取 `_count` 与 `_sum`，
  界面在同一格里显示「N 次 / X 小时」。时长为空的记录被 `_sum` 忽略，不会算成 0 分钟以外的值。
- 成员列表带 `skills`（`{id,name,isActive}[]`，按标签库 `sortOrder` 排序）：
  界面要在表格里直接显示「这个人会什么」，不必为此打开详情。技能标签**不是敏感信息**，
  与 QQ / 手机号（仍然只在详情接口给明文，且读取写审计）区分开。
- 成员列表的顺序是**管理员拖出来的顺序**（`member_profiles.sort_order`，第九轮验收）：
  默认值由迁移按「加入时间倒序」逐行回填，所以升级后看到的位置与升级前完全一致；
  新建成员的 `sort_order` 默认 0，与队首并列时用 `created_at desc` 兜底 ——
  也就是「新成员出现在最前面」这条老行为没有丢。
  `POST /move` 一次拖动只写一次库、一条审计（`member.moved`，`after` 里带 `memberIds`），
  服务端把整份顺序重排成 `0..n-1`：历史数据里可能有重复序号（新建成员默认 0），
  只交换两行的序号在重复值下会「看起来没反应」。**勾选多行后拖其中任意一行 = 整块移动**
  （块内保持原有先后）；界面是**乐观更新** —— 松手先按 `src/lib/list-order.ts` 的同一套规则
  改本地顺序，再发这个请求，所以落点没变时返回 `moved: false` 而不是报错。
- `POST /api/v1/admin/members` 在 **QQ / 手机号已属于某位成员**时返回 409
  `ACCOUNT_IDENTITY_CONFLICT`，不会复用既有档案。原先会走 `ensureMemberProfile` 的更新分支，
  把那位成员的 `realName` / `studentId` / `className` 覆盖掉，而 `setInitialPassword` 因为已有
  密码不再发放初始密码 —— 管理员看到「创建成功」，实际改的是别人的资料（实测踩到）。

新增权限码：`data:export`（仅 `ADMIN`，导出等于把站内数据带出系统）。

新增错误码：`MEMBER_BATCH_LIMIT_EXCEEDED`、`MEMBER_ROLE_INVALID`、`MEMBER_LAST_ADMIN`、
`MEMBER_SELF_LOCKOUT`、`REPAIR_ADMIN_REASON_REQUIRED`、`REPAIR_BATCH_LIMIT_EXCEEDED`、
`REPAIR_CATEGORY_CODE_CONFLICT`、`EXPORT_FORMAT_INVALID`、`EXPORT_ROW_LIMIT_EXCEEDED`。

## M6 管理后台（批次 2）

同样要求 `ADMIN` 角色对应的权限码，未登录 401、普通成员 403。列表型端点一律返回标准分页信封
（条目在 `data`，分页在 `meta.pagination`）。

| 端点                                                        | 权限                     | 说明                                                                                                       |
| ----------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/admin/skills`                                  | `skill:manage`           | 技能标签列表：**含已停用**，并带当前生效的成员关联计数 `usedByMemberCount`                                 |
| `POST /api/v1/admin/skills`                                 | `skill:manage`           | 新增：`{code,name,description?,sortOrder?}`；重复 code 409 `SKILL_CODE_CONFLICT`                           |
| `PATCH /api/v1/admin/skills/:id`                            | `skill:manage`           | 修改 `name` / `description` / `sortOrder`；`code` 不可改                                                   |
| `POST /api/v1/admin/skills/:id/deactivate`（或 `activate`） | `skill:manage`           | 停用 / 重新启用。**不提供删除**：标签被 `user_skills` 引用                                                 |
| `POST /api/v1/admin/skills/:id/reorder`                     | `skill:manage`           | 上移 / 下移一格：`{direction:"UP"\|"DOWN"}`；已在首末位时**幂等成功**，不报错、不写审计                    |
| `POST /api/v1/admin/skills/:id/move`                        | `skill:manage`           | 拖动排序：`{beforeId: string\|null}`（`null` = 拖到末尾）；落点没变时幂等成功                              |
| `POST /api/v1/admin/repair-categories/:id/reorder`          | `repair:category:manage` | 同上，上移 / 下移一格                                                                                      |
| `POST /api/v1/admin/repair-categories/:id/move`             | `repair:category:manage` | 同上，拖动排序（`{beforeId}`）                                                                             |
| `GET /api/v1/admin/comments`                                | `comment:moderate`       | 跨记录评论列表：`query`（正文 / 作者 / 记录 ID）、`recordId`、`authorMemberProfileId`、`deleted`、日期区间 |
| `DELETE /api/v1/admin/comments/:id`                         | `comment:moderate`       | 删除违规评论（软删除，写 `repair.comment.moderated`）；不存在或已删除 404 `COMMENT_NOT_FOUND`              |
| `GET /api/v1/admin/invite-codes`                            | `invite:read`            | 分页 + `status`（**生效状态**）+ `query`（明文前缀 / 绑定 QQ / 手机号，精确匹配）；绑定信息只给脱敏值      |
| `GET /api/v1/admin/audit-logs`                              | `audit:read`             | 审计查询：`action`、`result`、`actorUserId`、`targetType`、`targetId`、`requestId`、日期区间               |
| `GET /api/v1/admin/audit-logs/actions`                      | `audit:read`             | 动作清单（带出现次数，降序），供筛选下拉使用                                                               |
| `GET /api/v1/admin/settings/public-content`                 | `settings:manage`        | 读取公开内容与展示策略（单行配置，缺行时返回契约默认值）                                                   |
| `PUT /api/v1/admin/settings/public-content`                 | `settings:manage`        | 整体替换四个字段；缺字段 400 `VALIDATION_FAILED`，非法展示名 400 `PUBLIC_SETTINGS_INVALID`                 |
| `GET /api/v1/admin/join-applications/export`                | `data:export`            | 报名导出：`format=csv\|xlsx` + 与报名列表同源的筛选参数；返回附件流                                        |

批次 2 的约定：

- **审计只读**：`/admin/audit-logs` 只有 `GET`，没有 `PATCH` / `DELETE`。
  **查看审计不写审计** —— 摘要写入时已脱敏，读取不产生新的 PII 暴露，
  而「读一次写一行」会让审计表自我增殖。
- **技能标签不删除**：与故障分类同一策略，只停用 / 启用。
- **评论管理**跨记录，使用独立的 `comment:moderate`；不复用成员也持有的 `comment:read`。
  软删除复用成员端同一张表与同一套语义；同时 `repairCommentService.softDelete` 的成员档案
  解析改为可空，**纯管理员（无成员档案）删除违规评论不再被 `MEMBER_REQUIRED` 挡住**。
- **邀请码**：`status` 是生效状态（派生值），筛选下推到 SQL；完整明文邀请码只在
  `POST` 的响应里出现一次。
- **报名导出**带 QQ 与手机号**明文**（需求 §4.4），与维修导出的口径不同，
  因此使用独立审计动作 `join.applications.exported`；两条导出都走 `data:export`，
  都把实际生效的筛选条件与行数写进审计 `after`；超限返回 409 `EXPORT_ROW_LIMIT_EXCEEDED`。
- **日期区间**按 `Asia/Shanghai` 自然日解释，结束日包含全天。
- **排序**（技能标签 / 故障分类）有两个入口，语义相同、结果等价：`reorder` 挪一格，
  `move` 一次拖到位（拖动会跨越任意格数，用 `reorder` 模拟要发 N 次请求、写 N 条审计）。
  两者都写**稠密序号** `0..n-1`（历史数据里的重复序号或 `10/20/30` 间隙会被压平），
  都在首末位 / 落点未变时幂等成功，审计动作分别是 `skill.reordered` / `skill.moved`
  与 `repair.category.reordered` / `repair.category.moved`。
  落点用 `beforeId`（放到谁的前面）而不是序号：序号是系统的内部表示，
  让界面传序号等于把「插一个中间项要改后面所有数字」推给调用方。

新增权限码：`comment:moderate`、`skill:manage`、`settings:manage`（均只授予 `ADMIN`）。

新增错误码：`SKILL_CODE_CONFLICT`(409)、`AUDIT_FILTER_INVALID`(400)、
`PUBLIC_SETTINGS_INVALID`(400)。

同一变更内修正的既有路径：

- `GET /api/v1/admin/join-applications/:id` 现在写审计 `join.application.detail.viewed`
  —— 它是唯一返回报名 QQ / 手机号明文的入口，需求 §45 要求「查看完整报名敏感信息」留痕。
- 报名列表的 `submittedFrom` / `submittedTo` 改为按上海自然日解释且**结束日包含全天**：
  原先的 `lte: new Date("2026-09-22")` 会把当天 08:00 之后的报名全部排除，
  界面上表现为「筛同一天得到 0 条」。

## 活动报名免责声明（issue #62）

- `POST /api/v1/repair-activities/[id]/registrations` 的 body 增加 `consentAccepted`：
  必须**恰好为 `true`**（缺省、`"true"`、`1` 都算没同意），否则 400
  `ACTIVITY_CONSENT_REQUIRED`。这是唯一的报名入口，因此界面弹层之外没有第二条路可走。
- 同意后写入 `repair_activity_registrations.consent_version` + `consent_accepted_at`，
  版本值来自 `src/config/repair-activities.ts` 的 `repairActivityConsentVersion`；
  **改声明正文必须同时改这个版本号**，已签署的旧记录保留当时那一版。
- 两列均可空：迁移之前的历史报名没有签署动作，不用默认值伪造同意记录。
- 校验顺序是「先字段、后同意」：手机号填错的人先看到格式问题，而不是先被要求同意声明。

新增错误码：`ACTIVITY_CONSENT_REQUIRED`(400)。

## 成员侧与维修收尾（issue #68）

### 成员自建技能标签

`POST /api/v1/skills`（原先只有 `GET`）：成员在个人资料编辑器里输入一个库里没有的名字即可
新建并立即选中它，业务确认**无需审核** —— 标签库不可能预先覆盖所有人的技能。鉴权要求
`member.skill.assign_self`（成员默认持有），并执行 `assertSameOrigin()`。

- 请求体只接受 `{ name }`：描述、排序、`code` 仍由管理员或系统决定。名称上限与 M6 管理端
  同一条规则（`SKILL_NAME_MAX_LENGTH` = 80，列宽 `VarChar(80)`）；空白或超限 400
  `VALIDATION_FAILED`（带 `fieldErrors.name`）。
- **同名即复用**：已有同名且启用中的标签直接返回该行 —— 不新建、不写审计，
  重复提交因此天然幂等，也不会攒出一堆同名标签。
- 同名但**已停用**返回 409 `SKILL_INACTIVE`：停用是管理员的决定，成员不能靠重新输入
  同一个名字把它复活。
- `code` 由 `stableCodeFromName` 生成；名称不同却折叠出同一 code（如 `A/B` 与 `A B`）
  返回 409 `SKILL_CODE_CONFLICT`，不悄悄返回另一个名字的标签；并发撞唯一键时回查同名行复用。
- 标签库是**全体成员共享**的资源，因此按账号限流 **10 次 / 分钟**（键 `skill:create:<userId>`）。
- 新建**只写标签库、不自动保存关联**：关联仍由「保存」按钮走带乐观锁的
  `PUT /member/profile/skills`，两个动作不合并，避免一次点击里连做两次带版本号的写。

### 活动报名选填机型

- `POST /api/v1/repair-activities/[id]/registrations` 的 body 增加可选字段 `deviceModel`：
  非字符串 400 `VALIDATION_FAILED`（`fieldErrors.deviceModel`）；缺省 / `null` / 空白一律
  落库 `null`；上限 `REPAIR_ACTIVITY_DEVICE_MODEL_MAX_LENGTH` = 60（与列宽一致）。
  **选填**，不参与任何必填校验。
- 机型出现在三处读模型：公开报名回执 `RegistrationPublicView.deviceModel`、管理端报名列表
  `RegistrationAdminView.deviceModel`、接待台 `StaffRegistrationView.deviceModel`（没填就不显示，
  不占位）。
- 接待落单（`POST /api/v1/member/repair-activities/:id/serve`）把报名上的机型**复制**进新建的
  维修记录，两边看到的是同一个值；之后各自独立 —— 用 `editToken` 修改报名只改 `issueType`，
  不回写已有记录。
- 两列都可空（Migration `20260928120000_repair_activity_device_model`）：历史报名与手工建单
  没有这个信息，不用默认值伪造。

### 维修详情下发照片上限

- `GET /api/v1/repairs/:id` 的 `RepairDetailView` 增加 `photoLimits` `{ maxBytes, maxFiles }`，
  取值来自服务端 `.env` 的 `UPLOAD_MAX_BYTES` / `UPLOAD_MAX_FILES_PER_REPAIR`
  （`repair-photo-storage` 的 `uploadLimits()`）。
- 随详情下发而不是前端各写一份常量：两处各写会出现「界面提示 10 MB、服务端按 5 MB 拒绝」。
  客户端据此在**选文件时**先拦超限项；服务端仍逐张复检，超限返回 413
  `REPAIR_PHOTO_TOO_LARGE`，消息带文件名与实际体积（`「xx.jpg」12.4 MB，超过单张 10 MB 的上限`）。
  `maxBytes` 是**单张**上限，不是本次合计。

### 成员案例库（前端页面，无新接口）

`/member/cases` 取数复用 `GET /api/v1/repairs` 的既有筛选
（`status=APPROVED` + `isTypical` / `isDifficult` / `categoryId` / `query` + 分页），
不单开接口 —— 普通成员本来就能看到他人的 `APPROVED` 记录，案例库只是换一种读法：
只读、无状态动作、每页 12 条。分页沿用 `.repair-pagination` 的上一页 / 下一页。

### 只在客户端表达、不改接口的两项

- **报名队列位次**：队列本就按签到时间升序（服务端顺序即口径），位次取渲染顺序（从 1 起），
  没有新增字段或接口。
- **首页近场活动「报名开放中优先」**：`pickNonEndedRepairActivitiesForHomePreview`
  按 OPEN → UPCOMING → FULL / CLOSED 分档，同档内 `activityAt` 升序，`ENDED` 不进预览；
  公开列表仍按方案 B 的 `activityAt` 排序（口径见 `docs/specs/ux-r3-tech-plan.md`）。

新增错误码：无（`SKILL_INACTIVE` 与 `SKILL_CODE_CONFLICT` 已分别在 M3、M6 批次 2 登记）。
