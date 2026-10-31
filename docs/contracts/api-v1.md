# Phase 2 API v1 契约

管理群的独立机器接口见 [管理机器人契约](management-bot.md)。只有该文档列出的
`/api/v1/bot/` 路由接受独立Bearer凭证；既有浏览器管理接口继续使用Session，不接受机器凭证。

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

请求字段：`realName`、`qq`、`phone`、必填 `email`、`studentId`、`className`、可选 `selfIntroduction`、
可选 `preferredDirection`、`privacyConsent: true`。招募批次由服务端
`RECRUITMENT_CYCLE` 配置，不接受客户端指定。学号与班级为必填（issue #147，见下方
「学号与班级」一节）。

首次创建返回 201；同一批次相同规范化 QQ 或手机号的重复有效提交返回原回执和 200，
`data.duplicate=true`；重复提交不更新原记录的通知邮箱，仍不按邮箱去重。该公开入口保留独立的公开报名限流，并且与其他写接口一样执行
`assertSameOrigin()`（无 `Origin` 或非白名单来源返回 403）。

### 认证与当前用户

- `POST /api/v1/auth/login`：QQ + 密码登录并设置数据库 Session Cookie。可选 `rememberMe`
  必须是布尔值，省略或 `false` 为 1 天有效期，`true` 为 30 天；其他类型返回
  `VALIDATION_FAILED`。登录页默认不勾选「保持登录状态」。响应带 `accountAccess` 与
  `destination`（服务端统一落点编排，见下方「统一账号门禁」）；可选 `returnTo` 只作候选目标，
  服务端按白名单与**当次角色**复查，非法或无权目标回落到默认页。
- `POST /api/v1/auth/logout`：同源校验后撤销当前 Session；撤销与 `auth.logout` /
  `auth.session.revoked` 审计在同一事务内提交，成功返回 **200**、
  `{ success: true, data: { loggedOut: true }, meta: { requestId } }` 并清除 Session Cookie。
  无 Cookie、Session 不存在或已撤销时同样返回成功并清 Cookie；顺序或并发重复退出均不重复写撤销审计。
  受限 Session（待改密 / 待验证邮箱）也可退出，不经过业务门禁。
  来源校验或服务端处理失败返回失败信封，**保留 Cookie**；事务失败回滚撤销和审计，
  允许使用原 Cookie 重试。客户端只有同时确认 HTTP 成功、`success === true` 与
  `data.loggedOut === true` 才跳转登录页；网络异常、非成功 HTTP、失败信封及无法解析 / 不合
  契约的响应均保持当前页，持续提示“无法确认是否退出”并恢复重试入口，不把跳转或清 Cookie
  当成撤销确认。共享设备提示恢复连接后重试；仍失败时清除该站点浏览器数据，并在安全设备
  修改密码以撤销其他 Session。
- `POST /api/v1/auth/password/change`：验证当前密码、修改密码、撤销其他 Session 并轮换当前 Session。
  管理员签发的临时密码完成恢复也走这条入口（当前密码填临时密码，见下方「管理员手动重置与
  临时密码恢复」）。响应带 `destination`：由服务端统一落点编排给出（见下方「统一账号门禁」），
  开启门禁时先引导到邮箱步骤并带上已校验的 `returnTo`，客户端不自行按角色判断。
- `GET /api/v1/me`：返回当前 User、Role、Permission、MemberProfile 状态、首次改密标记与
  `rememberMe`，并新增 `accountAccess`（`state` / 服务端 `destination` / `exemptionExpiresAt`）。
  受限状态仍返回 **200**（会话有效，只是当前档位不让访问业务），只更新最后访问时间，
  不延长 Session 或 Cookie 到期时间，也不发送 `Set-Cookie`，避免迟到复查覆盖轮换后的令牌。

管理员初始密码登录后，除 `/me`、改密和登出外均返回 `PASSWORD_CHANGE_REQUIRED`。统一账号门禁
启用后（见下方「统一账号门禁」），未验证邮箱且无有效豁免的账号在业务接口上返回
`EMAIL_VERIFICATION_REQUIRED`（403，与 `PASSWORD_CHANGE_REQUIRED` 同一档：会话有效但当前
资格不足，前端不得当作登录过期）。所有使用
Cookie 的写接口校验 `Origin`：`Origin` 必须等于服务端配置的 `APP_BASE_URL`（含其 `www`
变体）的来源，缺失 `Origin` 或非白名单来源返回 403。**不拿请求自带的 `Host` /
`X-Forwarded-Host` 当比较基准**——那两个头由请求方控制，跟着它们走等于让攻击者自己填写
白名单（2026-09 安全审计 F4）。Cookie 名为 `pc_hospital_session`，使用
HttpOnly、SameSite=Lax、Path=/，生产环境启用 Secure。
Cookie 的 `Expires` 与数据库 Session 的 `expiresAt` 一致。改密轮换 Session 时保留
`rememberMe`（恢复态改为普通 1 天）；登出、管理员手动重置（改为签发 1 小时临时密码，
见下方「管理员手动重置与临时密码恢复」）和成员禁用仍撤销有效 Session。
`/login` 会识别有效 Session，按统一落点编排跳转（未走完的步骤优先，其次原目标 / 角色默认页）。
受保护页面在到期时跳转 `/login?reason=expired`，登录页通过浮层显示过期提醒；
浏览器恢复焦点或标签恢复可见时重新校验，网络异常不会被当作过期；门禁拒绝与业务错误
同样**不**当作过期，受限状态由服务端 `/me` 的 `accountAccess` 驱动跳转，已在对应步骤页时
不重复跳转。豁免早于 Session 到期时，客户端把下一次复查提前到豁免到期点（不新增高频轮询）。

### 招募、邀请码与成员核心 API

- `GET /api/v1/admin/join-applications`
- `GET /api/v1/admin/join-applications/:id`
- `DELETE /api/v1/admin/join-applications/:id`（`join:review`，软删除）
- `POST /api/v1/admin/join-applications/:id/reviews`
- `POST /api/v1/admin/join-applications/:id/provision`
- `POST /api/v1/admin/join-applications/:id/provision/retry`
- `PATCH /api/v1/admin/join-applications/:id/notification/email`（`join:review`，更正通知邮箱）
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
- `POST /api/v1/admin/accounts/lookup`
- `POST /api/v1/admin/accounts/:userId/password-reset`

报名列表接受 `page`、`pageSize`、`recruitmentCycle`、`status`、`provisionStatus`、`submittedFrom`、
`submittedTo` 与 `query`；列表只返回脱敏 QQ/手机号，完整联系方式、内部备注和审核记录只在
管理员详情接口返回。邀请码注册要求密码确认，并与报名入口一样执行公开写限流。

Issue #176 的报名管理约定：

- `recruitmentCycle` 去首尾空白后精确匹配，最长 32 字符，空白不筛选；支持任意历史批次，
  不受当前 `RECRUITMENT_CYCLE` 配置限制。列表和 CSV / XLSX 导出共用同一筛选谓词。
- `DELETE` 要求登录、同源与 `join:review`，所有报名状态均可软删除；不存在或已删除返回
  404 `RESOURCE_NOT_FOUND`。写 `join.application.deleted` 审计，不删除成员、账号、面试历史、
  发放或通知任务。删除后默认列表、详情与导出不可见，审核、发放和通知重试不可操作。
- 同批次已删除报名仍占用 QQ / 手机号唯一键，再次提交返回 409 `JOIN_APPLICATION_DUPLICATE`，
  提示联系管理员，不返回已删除的回执；其他批次仍可提交。
- 首次通过前核对 QQ、手机号、学号、邮箱。已有成员必须同时具备有效 User、未删除且 ACTIVE
  的档案和未撤销 MEMBER 角色；QQ / 手机号 / 邮箱只匹配其未删除的身份，邮箱不要求已验证。
  报名通知邮箱本身不构成成员邮箱身份。历史 NULL / 空白忽略；学号 trim 后按字符串比较，保留前导零。
- 任一重复返回 409 `ACCOUNT_IDENTITY_CONFLICT`，只指出冲突字段并提示管理员联系处理，不能强行通过。
  查重、首次审核、录取部门、发放和通知入队在同一 Serializable 事务；失败全部回滚。
  已成功通过的幂等重放不再次查重；历史已通过的失败任务继续沿用原发放冲突保护及重试流程。

通知邮箱更正（issue #161）：报名邮箱是**未验证**的通知地址，更正不改变账号邮箱 / 邮箱身份、
门禁或找回资格。`PATCH /api/v1/admin/join-applications/:id/notification/email` 请求体
`{ email }`，要求登录、同源与 `join:review`；按 `normalizeEmail` 归一，非法值 400
`VALIDATION_FAILED`。按通知任务状态分级：

| 任务状态                 | 报名记录 | 任务收件地址 | 保存后                                 |
| ------------------------ | -------- | ------------ | -------------------------------------- |
| 无任务                   | 更新     | —            | 后续建档入队自然使用新地址             |
| `PENDING`                | 更新     | 同步更新     | 待发送任务按新地址发出                 |
| `FAILED`                 | 更新     | 同步更新     | 保持失败，由管理员手动「重试通知」     |
| `SENDING`                | 不变     | 不变         | 409 `STATE_TRANSITION_INVALID`，等结果 |
| `ACCEPTED` / `UNCERTAIN` | 更新     | 不变         | 只更新报名记录，不重发；核查后人工恢复 |

成功写 `join.application.notification_email.updated` 审计（摘要中邮箱键按既有规则脱敏）；
同一地址重复保存为幂等空操作，不追加审计。不存在或已删除报名返回 404 `RESOURCE_NOT_FOUND`。

这些端点的输入/输出 Service 契约位于 `src/types/contracts.ts`。管理员路径不是权限边界；
Route Handler 必须从数据库 Session、账号状态和有效 UserRole 构造 actor，Service 再
调用 `requirePermission`；不得信任客户端传入的角色或权限。

#### 管理员手动重置与临时密码恢复（issue #113）

两条入口都要求 `member:manage` + 同源校验，响应 `Cache-Control: private, no-store`，
只返回管理操作所需的最小信息：

- `POST /api/v1/admin/accounts/lookup`：请求体 `{ qq }`（QQ 只在请求体，不进 URL / 日志），
  按规范化 QQ 精确匹配（不做模糊搜索），返回 `userId`、`displayName`、`roles`、
  `canReset` 与 `blockedReason`；`blockedReason` 取值 `SELF` / `DISABLED` /
  `MEMBER_INACTIVE` / `null`，与登录资格判定同义。管理员可以没有成员档案，因此不经过
  成员列表。
- `POST /api/v1/admin/members/:id/password-reset` 与
  `POST /api/v1/admin/accounts/:userId/password-reset` 共用签发核心：6 位安全随机数字
  （保留前导零）、1 小时有效、强制改密、撤销该账号全部有效 Session。响应复用
  `initializationSecret` 字段承载明文（仅本次响应，关闭后无法再次读取），并附
  `temporaryExpiresAt`；成员详情入口另带 `member`。服务端拒绝自助恢复
  （`actor.userId` 即目标 → `FORBIDDEN`）、禁用 / 软删账号（`ACCOUNT_DISABLED`）
  与成员身份失效（`MEMBER_PROFILE_INACTIVE`），不顺手改动状态 / 角色 / 档案。
- 是否临时凭据**只由 `temporary_expires_at` 非空判定**，先判定期限与消费状态再验密：
  过期 / 已消费的凭据即使密码正确也统一返回 `AUTH_INVALID_CREDENTIALS`，不落回普通密码
  分支。首次成功登录在 Serializable 事务内原子消费，并发登录最多一次成功，只建立一个
  最长 10 分钟、不晚于口令原到期时间、`rememberMe` 强制 `false`、不滑动续期的受限
  Session。失败尝试沿用既有 `(QQ, IP)` 节流，另加账号维度的持久化节流（15 分钟 5 次
  失败阻断 15 分钟）；过期 / 已消费只有 `(QQ, IP)` 桶计数。
- 恢复态改密复用 `POST /api/v1/auth/password/change`：当前密码填本次临时密码，必须同时
  持有该受限 Session；新密码不得与本次临时密码相同（`VALIDATION_FAILED`）。改密事务内
  重查 Session 与凭据代次（`credential_version`），管理员再次签发在先时旧代次改密返回
  `AUTH_SESSION_INVALID`，不得覆盖新凭据；成功后清除临时状态并轮换为普通 1 天 Session。
  所有登录建立 Session 前都复核验密对应的凭据代次，重置与普通登录竞争时不会用旧校验
  结果建立有效会话。

## 稳定错误码

错误码的唯一事实来源是 `src/lib/api/errors.ts`，包括校验、鉴权、状态机、幂等、账号冲突、
发放失败、邀请码状态、限流与内部错误。不得按 Feature 新建另一套错误格式。

## Contract 变更

### 成员部门（issue #171）

- 部门代码为 `REPAIR` / `PUBLICITY` / `OFFICE`，中文标签分别为维修部 / 宣传部 / 办公室。
- `POST /api/v1/admin/members` 可传 `department`，缺省 `REPAIR`；
  `PATCH /api/v1/admin/members/:id` 可传 `department`（省略不改），仍须 `version`，权限为
  `member:manage`，冲突返回 `MEMBER_PROFILE_VERSION_CONFLICT`，成功递增版本并审计前后部门。
  成员列表、详情、创建与修改响应的成员视图均包含 `department`，修改响应包含新 `version`。
- `POST /api/v1/admin/join-applications/:id/reviews` 首次 `result=PASSED` 必须传有效
  `admittedDepartment`；`REJECTED` 不传该字段。非法代码、NULL、空串或首次通过缺失字段返回
  `VALIDATION_FAILED`，`fieldErrors.admittedDepartment` 给出纠正提示。
  已通过再次提交通过可省略部门；合法的新值被忽略，补记备注与发放重试沿用首次保存值。
- 报名管理列表、详情与审核响应追加 `admittedDepartment`（历史与未录取为 NULL），不修改公开回执。
  已成功发放的重放不覆盖成员当前部门；历史 NULL 任务新建默认维修部、复用保留当前归属。
- 成员自助 `PATCH /api/v1/member/profile` 不接受 `department`，未知字段继续拒绝。
  部门不改变登录、角色、权限或导出列。无新增权限、依赖或外部数据传输。

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

`POST /api/v1/repairs` 为「提交即建单」（issue #222）：请求体是完整草稿字段 + `Idempotency-Key`
请求头，服务端按成员自助提交同一套校验直接创建 **`PENDING`** 记录，不再先建草稿；同一幂等键
重试返回原记录（并发同键也只落一条）。原记录若已被管理员删除，重试返回 **409
`REPAIR_STATE_INVALID`** 并提示刷新后重新提交，不会把已删除记录当作成功结果下发。新建页在
提交前不落库（非图片字段暂存本机 sessionStorage）；提交前没有记录可挂照片，提交后由记录本人在
审核前到详情页补充（issue #226）。
编辑既有记录（`DRAFT` / `REJECTED`）携带 `version`；过期版本返回
`REPAIR_VERSION_CONFLICT`。列表支持分页、成员、分类、状态、结果、日期、疑难、典型和关键词
筛选；普通成员只能看到本人全部状态与他人的 `APPROVED` 记录。照片内容接口要求有效 Session，
并返回私有缓存、`nosniff`、正确 MIME 与长度。

撤回审核已下线（issue #222）：`PENDING → DRAFT` 不再允许，`POST /api/v1/repairs/:id/withdraw`
不存在。提交后如需修改，请联系管理员退回（`REJECTED`，成员可编辑后重提）或由管理员直接修正
数据（`PATCH /api/v1/admin/repairs/:id`，原因 + 版本锁 + 审计）。历史 `WITHDRAWN` 时间线与旧
`DRAFT` 行仍可读取（旧草稿在 #223 清理前仍可编辑 / 提交）；存量处置见 #223。

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
  所有 `MetricValue` 标为 `UNAVAILABLE`，**绝不**伪造 `0`。通知/收藏失败时摘要仍为
  `{ available: true, unreadCount|count: 0, latest: [] }`，由 `degraded` 标明该区块失败。
- 「本月 / 本学年」是日期相对口径。`GET /member/profile`、
  `GET /members/:memberProfileId/profile` 与工作台共用同一套
  `resolveMemberRanges(now)`，三个入口的同名指标必须相等。
- **学年固定**（issue #178）：`[当年 9 月 1 日 00:00, 次年 9 月 1 日 00:00)`（Asia/Shanghai，
  9/1 当天属新学年），由服务端按请求时刻推导，不读任何环境变量；`yearApprovedCount` 因此
  恒为真实数字，不再有「未配置」态。排行范围取值 `MONTH | ACADEMIC_YEAR | ALL_TIME`，
  缺省 `ACADEMIC_YEAR`。

## M4 收藏与审核通知（评论已退役，issue #198）

以下成员入口继续要求有效 Session / 有效成员身份，使用统一信封、requestId 与 `private, no-store`，写请求检查同源：

```text
GET    /api/v1/member/favorites
POST   /api/v1/member/favorites
DELETE /api/v1/member/favorites/:repairId
GET    /api/v1/member/notifications
POST   /api/v1/member/notifications/:id/read
POST   /api/v1/member/notifications/read-all
DELETE /api/v1/member/notifications/:id
```

收藏唯一约束、取消后恢复同一行及维修记录可见性不变。通知 `data` 为 `{items, unreadCount}`，分页位于 `meta.pagination`，可选 `status=UNREAD|READ`。

通知只开放 `REPAIR_APPROVED` / `REPAIR_REJECTED`。列表、分页 total、未读数、工作台摘要在数据库查询前使用同一类型条件；历史评论 / 提及消息保留但不可达。单条已读 / 删除对隐藏类型与他人消息一律 `NOTIFICATION_NOT_FOUND`，全读不修改隐藏历史行。删除仍不改变状态 / readAt。`NotificationView.commentId` 保留为废弃字段，始终返回 null；维修记录不可读时的空引用 / 空摘要规则不变。

审核通知仍在原审核事务内创建，向全部参与者去重发送、跳过审核人自己，兼容无成员档案的管理员。案例标记、收藏、维修备注、照片、审核意见和时间线继续开放；`/api/v1/repair-members` 仍供维修编辑 / 筛选使用。

下列五个旧 HTTP 方法已退役：

```text
GET / POST /api/v1/repairs/:id/comments
DELETE     /api/v1/repairs/:id/comments/:commentId
GET        /api/v1/admin/comments
DELETE     /api/v1/admin/comments/:id
```

最小 Handler 保留认证 / 统一账号访问检查，写方法保留同源检查；正常可访问请求返回统一 `404 RESOURCE_NOT_FOUND`、requestId、`private, no-store`。不解析正文、不查询评论或目标维修、不写评论和访问审计；认证 / 门禁 / 同源先行拒绝仍沿用既有错误。不提供 410 或成功空数组。旧 `/admin/comments` 页面返回 404，成员与后台不再有评论入口。

## M6 管理后台

新增（全部要求 `ADMIN` 角色对应的权限码，未登录 401、普通成员 403）：

| 端点                                                | 权限                      | 说明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/admin/members`                         | `member:manage`           | 成员列表：`page`/`pageSize`/`query`/`status`/`role`/`sort`；QQ 与手机号**只返回脱敏值**；含 `skills`（技能标签，非敏感）、`joinedAt` 与 `approvedRepairMinutes`（同口径维修总时长）；`sort` 白名单：`realName`/`nickname`/`studentId`/`className`/`status`/`joinedAt` —— 聚合列与关联列不可排序；`filter` 白名单：`status`(eq/neq)、`department`(eq/neq)、`realName`/`nickname`/`studentId`/`className`(contains)、`joinedAt`(gte/lte)                                                                           |
| `GET /api/v1/admin/members/:id`                     | `member:manage`           | 成员详情：唯一返回 QQ / 手机号明文的端点，**每次读取写审计** `member.detail.viewed`                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `PATCH /api/v1/admin/members/:id`                   | `member:manage`           | 编辑实名 / 学号 / 班级 / 昵称；乐观锁 `version`，冲突 409 `MEMBER_PROFILE_VERSION_CONFLICT`；**响应带新的 `version`**（就地编辑要能连续提交同一行）                                                                                                                                                                                                                                                                                                                                                              |
| `PUT /api/v1/admin/members/:id/roles`               | `member:manage`           | 角色**全量集合** `{roles:[...]}`；撤销最后一个在册管理员 409 `MEMBER_LAST_ADMIN`                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `PUT /api/v1/admin/members/:id/skills`              | `member:manage`           | `{skillIds, profileVersion}`，与成员自助同一实现（上限 12）                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `POST /api/v1/admin/members/batch`                  | `member:manage`           | `{memberIds, enabled}`，单次上限 50；**允许部分成功**，`failed` 带稳定错误码                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `POST /api/v1/admin/members/move`                   | `member:manage`           | `{memberIds: string[], beforeId: string \| null}`：把这几行（1–50，保持内部先后）整体拖到 `beforeId` 之前（`null` = 末尾）；整份重排写成稠密 `sortOrder`，落点没变则幂等（`moved: false`）且不写审计；任一位成员不存在 404 `RESOURCE_NOT_FOUND`                                                                                                                                                                                                                                                                  |
| `GET /api/v1/admin/members/:id/stats`               | `analytics:read_internal` | M5 个人统计口径的管理端入口；**已禁用成员的历史统计也可查**                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `GET /api/v1/admin/repairs`                         | `repair:read`             | 管理端维修列表：`page`/`pageSize`/`query`/`memberId`/`categoryId`/`status`/`result`/`repairDateFrom`/`repairDateTo`/`isDifficult`/`isTypical`/`flagged`/`sort`；`sort` 白名单：`repairDate`/`durationMinutes`/`status`/`result`/`memberName`/`categoryName`/`createdAt` —— 关联列按**名字**排（按 UUID 排没有意义）；`flagged=any`（典型案例 ∪ 疑难案例，issue #134）由成员案例库传入，管理端不传；未传 `status` 时默认排除 `DRAFT`（issue #220），显式 `status=DRAFT` 可查看草稿；导出**不读** `sort`，顺序固定 |
| `PATCH /api/v1/admin/repairs/:id`                   | `repair:review`           | 修改异常数据：草稿字段 + `version` + **必填 `reason`**；**不改审核状态**                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `DELETE /api/v1/admin/repairs/:id`                  | `repair:delete`           | 软删除违规记录：`{reason}` 必填，复用 M2 `repairService.softDelete`                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `POST /api/v1/admin/repairs/batch-reviews`          | `repair:review`           | `{recordIds, decision, note?, idempotencyKey}`，单次上限 50；逐条复用单条审核，允许部分成功                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `GET /api/v1/admin/repair-categories`               | `repair:category:manage`  | 管理端分类列表：**含已停用**，并带 `usedByRepairCount` 引用计数                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `POST /api/v1/admin/repair-categories/:id/activate` | `repair:category:manage`  | 重新启用被误停用的分类                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `GET /api/v1/admin/repairs/export`                  | `data:export`             | 导出：`format=csv\|xlsx` + 与列表完全相同的筛选参数；未传 `status` 时默认不导出草稿（issue #220），显式 `status=DRAFT` 可导出草稿；返回附件流                                                                                                                                                                                                                                                                                                                                                                    |

导出与批量操作的约定：

- 导出筛选条件与 `GET /api/v1/admin/repairs` **同源**（复用同一个 `listWhere`），
  所以「筛选后导出」等于「界面所见即所得」；行数上限 20000，超出返回 409
  `EXPORT_ROW_LIMIT_EXCEEDED` 而**不静默截断**。
- 管理端列表与导出默认**不含草稿**（issue #220）：`status` 缺省时「全部」=
  `PENDING`/`APPROVED`/`REJECTED`；显式 `status=DRAFT` 仍可查看与导出草稿（客服 / 异常处理用）。
  成员列表不受影响（成员必须看到自己的草稿）；该默认只对持有 `repair:review` 的视图生效。
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

首页公开统计（issue #115）由服务端直接消费 `publicHomeService.get()`，不新增匿名 HTTP API，
也不开放内部统计接口。`PUT /api/v1/admin/settings/public-content` 保存后刷新首页即可生效，
首页按请求动态渲染，维修汇总与排行展示在首屏之后、跑马灯之前的独立第二屏；
各公开开关独立控制内容，两者均关闭时不渲染区块，详细统计关闭时仅显示累计总量。
公开 DTO 与姓名裁剪规则见数据契约的「公开内容与展示策略」。

同样要求 `ADMIN` 角色对应的权限码，未登录 401、普通成员 403。列表型端点一律返回标准分页信封
（条目在 `data`，分页在 `meta.pagination`）。

| 端点                                                        | 权限                     | 说明                                                                                                  |
| ----------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `GET /api/v1/admin/skills`                                  | `skill:manage`           | 技能标签列表：**含已停用**，并带当前生效的成员关联计数 `usedByMemberCount`                            |
| `POST /api/v1/admin/skills`                                 | `skill:manage`           | 新增：`{code,name,description?,sortOrder?}`；重复 code 409 `SKILL_CODE_CONFLICT`                      |
| `PATCH /api/v1/admin/skills/:id`                            | `skill:manage`           | 修改 `name` / `description` / `sortOrder`；`code` 不可改                                              |
| `POST /api/v1/admin/skills/:id/deactivate`（或 `activate`） | `skill:manage`           | 停用 / 重新启用。**不提供删除**：标签被 `user_skills` 引用                                            |
| `POST /api/v1/admin/skills/:id/reorder`                     | `skill:manage`           | 上移 / 下移一格：`{direction:"UP"\|"DOWN"}`；已在首末位时**幂等成功**，不报错、不写审计               |
| `POST /api/v1/admin/skills/:id/move`                        | `skill:manage`           | 拖动排序：`{beforeId: string\|null}`（`null` = 拖到末尾）；落点没变时幂等成功                         |
| `POST /api/v1/admin/repair-categories/:id/reorder`          | `repair:category:manage` | 同上，上移 / 下移一格                                                                                 |
| `POST /api/v1/admin/repair-categories/:id/move`             | `repair:category:manage` | 同上，拖动排序（`{beforeId}`）                                                                        |
| `GET /api/v1/admin/comments`                                | —（已退役）              | 认证 / 账号访问检查后统一 404 `RESOURCE_NOT_FOUND`，不查询评论。                                      |
| `DELETE /api/v1/admin/comments/:id`                         | —（已退役）              | 同源 / 认证 / 账号访问检查后统一 404，不删除历史行。                                                  |
| `GET /api/v1/admin/invite-codes`                            | `invite:read`            | 分页 + `status`（**生效状态**）+ `query`（明文前缀 / 绑定 QQ / 手机号，精确匹配）；绑定信息只给脱敏值 |
| `GET /api/v1/admin/audit-logs`                              | `audit:read`             | 审计查询：`action`、`result`、`actorUserId`、`targetType`、`targetId`、`requestId`、日期区间          |
| `GET /api/v1/admin/audit-logs/actions`                      | `audit:read`             | 动作清单（带出现次数，降序），供筛选下拉使用                                                          |
| `GET /api/v1/admin/settings/public-content`                 | `settings:manage`        | 读取公开内容与展示策略（单行配置，缺行时返回契约默认值）                                              |
| `PUT /api/v1/admin/settings/public-content`                 | `settings:manage`        | 整体替换四个字段；缺字段 400 `VALIDATION_FAILED`，非法展示名 400 `PUBLIC_SETTINGS_INVALID`            |
| `GET /api/v1/admin/join-applications/export`                | `data:export`            | 报名导出：`format=csv\|xlsx` + 与报名列表同源的筛选参数；返回附件流                                   |

批次 2 的约定：

- **审计只读**：`/admin/audit-logs` 只有 `GET`，没有 `PATCH` / `DELETE`。
  **查看审计不写审计** —— 摘要写入时已脱敏，读取不产生新的 PII 暴露，
  而「读一次写一行」会让审计表自我增殖。
- **技能标签不删除**：与故障分类同一策略，只停用 / 启用。
- **评论管理**已统一退役；历史评论审计保留可读展示，旧接口按上节返回 404。
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

当前权限码：`skill:manage`、`settings:manage`（均只授予 `ADMIN`）。

新增错误码：`SKILL_CODE_CONFLICT`(409)、`AUDIT_FILTER_INVALID`(400)、
`PUBLIC_SETTINGS_INVALID`(400)。

同一变更内修正的既有路径：

- `GET /api/v1/admin/join-applications/:id` 现在写审计 `join.application.detail.viewed`
  —— 它是唯一返回报名 QQ / 手机号 / 通知邮箱明文的入口，需求 §45 要求「查看完整报名敏感信息」留痕。
- 报名列表的 `submittedFrom` / `submittedTo` 改为按上海自然日解释且**结束日包含全天**：
  原先的 `lte: new Date("2026-09-22")` 会把当天 08:00 之后的报名全部排除，
  界面上表现为「筛同一天得到 0 条」。

## 公开活动排队汇总（issue #244）

`GET /api/v1/repair-activities/:id/queue` 为匿名可读接口；沿用统一信封与 requestId，成功与失败响应均为 `Cache-Control: private, no-store`，不受登录邮箱门禁影响。

成功 `data` 仅包含 `{ waitingCount: number | null, observedAt: string }`。`observedAt` 为服务端查询时间（UTC ISO 字符串），不是最后一次排队变化时间。`waitingCount` 只计本活动 `deletedAt IS NULL AND status = CHECKED_IN` 的报名；未到场、已接待、软删及其他活动不计入。不返回客户/成员明细、个人队号、维修进度或预计等待时间，也不修改容量、签到或接待规则。

- 报名截止前（既有现场操作窗口尚未开放），`waitingCount=null`，页面显示“签到尚未开放”；真实查询成功且无待接待报名才返回 `0`。
- 活动软删/不存在返回既有 404 `ACTIVITY_NOT_FOUND`；上海活动日次日零点起返回 404 `ACTIVITY_ENDED`。没有新增服务截止字段或“停止接待”控制，0 人不代表仍可接待或无需等待。
- 公开活动详情独立刷新该汇总，约每 30 秒一次、聚焦/重新可见及手动刷新时重取，隐藏/卸载时取消；不重置报名和查询表单。请求失败不伪装为 0：首次显示暂不可用，后续保留上次成功值/时间并标明更新失败；明确结束/不存在后隐藏旧值并停止轮询。
- 活动列表不增加排队数字；小鲸鱼可以链接活动详情，不需要管理凭据或客户资料。客服配置交接见 [交接说明](../customer-whale-queue-handoff.md)。

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
- 接待补单（serve → 继续填写 → 提交）把报名上的机型**带入预填与新建的维修记录**
  （issue #221），两边看到的是同一个值；之后各自独立 —— 用 `editToken` 修改报名只改 `issueType`，
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

### 审核前补充照片（issue #226）

- 照片上传 / 排序 / 删除的权限从 `DRAFT` / `REJECTED` 扩展到：**记录本人**且
  （`DRAFT` / `REJECTED`，或 `PENDING` 且 `reviewedAt` 为空）。
- 仍要求 `repair:update`，仅记录本人；管理员不代传。审核通过后写入返回 `REPAIR_STATE_INVALID`；
  退回后按现有 `REJECTED` 可编辑规则继续补充。
- 写接口在事务内 `SELECT ... FOR UPDATE` 锁定记录并复核状态与照片数；审核先完成时补传失败，
  不会出现「已审核通过但照片后到」。照片上限仍按 `photoLimits`。
- `RepairDetailView` 增加 `canAttachPhotos: boolean`，只控制详情页入口，服务端仍独立复核。

### 照片顺序与维修列表读取（issue #235）

- 有效照片的 `sortOrder` 始终为连续的 `0..n-1`：新上传接在末尾；删除后压缩剩余照片；
  换序按目标位置移动后整体重排。三者都在既有记录行锁事务内完成，历史数据里的空洞 /
  重复序号会在下一次写操作后收敛。
- `PATCH /api/v1/repairs/:id/photos/:photoId` 请求体的 `sortOrder` 仍是**目标位置**
  （`0..n-1` 的数组下标），不是直接写入的存储序号；权限、审核窗口、数量 / 体积限制与
  现有文件均不变。详情附件组件在写操作成功后按展示顺序收敛本地序号；编辑页仍以服务端刷新为准。
- 维修列表改用只包含 `memberProfile` / `category` / `photos` / `participants` 的
  `repairListInclude`，不再读取列表 DTO 不返回的审核记录与时间线及其关联用户；
  详情继续使用 `repairDetailInclude`。列表 DTO、照片元数据、参与人、排序筛选、机主电话
  权限与导出均不变；无 Schema / Migration / 索引变更。

### 成员案例库准入规则（issue #134，前端页面，无新接口）

`/member/cases` 取数复用 `GET /api/v1/repairs` 的既有筛选
（`status=APPROVED` + `categoryId` / `query` + 分页），不单开接口 —— 普通成员本来就能看到他人的 `APPROVED` 记录，案例库只是换一种读法：只读、无状态动作、每页 12 条。分页沿用 `.repair-pagination` 的上一页 / 下一页。

准入口径（issue #134）：案例库只收录**被标记**的已通过记录。「全部已标记」档传 `flagged=any` —— 列表新增参数，白名单仅 `any` 一个取值（空值不过滤、非法值 400 `VALIDATION_FAILED`），语义为「`isTypical` 或 `isDifficult` 之一」的**并集**，单条记录维度过滤（双标不重复）。`isTypical` / `isDifficult` 两个既有参数保持平铺 AND 语义不变（都传 = 要求两条都标），「典型案例」「疑难案例」两个单标记档继续沿用。管理端列表与导出不传 `flagged`，行为零变化。

### 仍由应用层表达的展示顺序

- **报名队列位次**：队列本就按签到时间升序（服务端顺序即口径），位次取渲染顺序（从 1 起），
  没有新增字段或接口。
- **首页近场活动「报名开放中优先」**：`pickNonEndedRepairActivitiesForHomePreview`
  按 OPEN → UPCOMING → FULL / CLOSED 分档，同档内 `activityAt` 升序，`ENDED` 不进预览；
  公开列表的未结束 / 已结束分段排序已下推到数据库（见下方「公开活动列表分页」），
  首页预览仍复用 `pickNonEndedRepairActivitiesForHomePreview`；同时间按 `createdAt` 升序、
  `id` 升序的 tie-break 与 `src/features/repair-activities/repair-activity-sort.ts` 保持一致。

### 公开活动列表分页（issue #286）

`GET /api/v1/repair-activities` 改为服务端 offset 分页。`data` 语义从「全部未删除活动」变为
「当前页」，属于行为变更；响应形状仍为统一信封，新增 `meta.pagination`，不保留
「不传参返回全量」的旧路径。

- 查询参数复用通用分页规则：`page` 默认 `1`，`pageSize` 默认 `20`、范围 `1–100`；
  非法值 400 `VALIDATION_FAILED`；合法但越界页返回 200、空 `data` 与正确的
  `total/totalPages`。
- `meta.pagination = { page, pageSize, total, totalPages }`；`total` 只计未软删活动。
- 排序在数据库完成：未结束段 `activity_at ASC, created_at ASC, id ASC`，已结束段
  `activity_at DESC, created_at ASC, id ASC`；两段以请求内唯一的
  `todayStart = startOfShanghaiDay(now)` 分界：`activity_at >= todayStart` 为未结束，
  `activity_at < todayStart` 为已结束。`registeredCount` 只对当前页活动聚合，有效报名口径
  不变（`deleted_at IS NULL` 且 `status ∈ REGISTERED|CHECKED_IN|SERVED`）；状态派生使用
  同一个 `now`。
- 已知调用方：公开列表页（#287 前仍取默认第一页）；首页预览已改为
  `listPublicForHomePreview` 独立查询（只取未结束活动，不再走公开列表）。无 Schema /
  Migration / 权限变更。

### 活动「已结束」的判定口径（issue #79）

- `ENDED`（已结束）= 活动当天（`activityAt` 所在的 Asia/Shanghai 自然日）**结束之后**，
  即次日 00:00（上海）起；活动当天（含 23:59）仍按报名窗口判定 —— 通常为 `CLOSED`，
  当天仍可改故障类型。此前「`now >= activityAt` 即结束」的口径会让活动当天显示「已结束」。
- 判定只由 `activityEndExclusive()` / `deriveRepairActivityStatus()` 一处实现
  （`src/features/repair-activities/repair-activity-validation.ts`）；
  管理端改报名与手机号查询（lookup）用同一助手直接比较，公开详情 `getPublic` 的
  `ACTIVITY_ENDED` 拦截走派生状态自动跟随。

新增错误码：无（`SKILL_INACTIVE` 与 `SKILL_CODE_CONFLICT` 已分别在 M3、M6 批次 2 登记）。

### 管理端成员详情按需读取

- 成员表格悬停不预取详情、统计或技能；显式打开详情才沿用原加载入口（issue #209）。
- `GET /api/v1/admin/members/:id` 的资料、维修统计、联系方式和技能读取与
  `member.detail.viewed` 审计共用同一事务客户端，不在已占用事务连接时从全局池额外取连接。
  审计失败整笔回滚，不返回敏感详情；原权限、响应字段和脱敏规则不变。

### 查询请求收敛（issue #209 后续）

- 维修审核列表同样不在整行悬停时预取维修详情，保留原显式打开入口。
- 公开活动详情倒计时归零后仍按原 30 秒节拍复查；已有请求时不叠加，隐藏页暂停并中止
  后台请求，重新可见时复查。旧请求、换活动或卸载后的响应不更新当前目标；后台失败保留
  已显示内容。报名写入成功后的主动刷新可替换旧轮询，状态以服务端响应为准。
- 工作台将排队/已接待报名合并读取；管理员复用完整有效报名计数、出勤名单中的本人状态，
  成员仍在库层排除待签到人员资料、只保留排队与**本人接待**的已接待记录（issue #207），
  保留独立总数和本人出勤查询。管理员每轮独立取数分支
  由 6 项减为 3 项、成员由 5 项减为 4 项（不含鉴权及前置活动/资格读取，不等同 SQL 条数）。
  此处记录缺省完整视图的读取基线；#236 新前端使用下方增量视图，低频明细不再每轮读取。

### 成员出勤、签到与接待的操作窗口

- `attendance`、`check-in`、`serve` 仅在 `signupClosesAt <= now < activityEndExclusive(activityAt)`
  时开放（issue #194）；下界仍是报名截止，不改成活动开始。报名未开始、报名中、提前报满
  均不可操作，返回 409 `ACTIVITY_NOT_OPEN`；上海活动日的次日 00:00 起返回既有
  404 `ACTIVITY_ENDED`。已有出勤或排队记录的幂等重放也不能绕过结束上限。
- 服务端在每次事务尝试中锁定活动、读取最新窗口后取当前服务端时间，同一快照用于判断和
  本次出勤/签到/接待时间；重试重新取时。此检查在幂等返回与任何业务写入之前，失败无成功审计。
- 看板禁用三项操作及签到勾选，确认弹层也按当前窗口复核；保留已有出勤状态、历史列表和
  历史看板查看。结束提示区分“报名尚未截止”，服务端结束响应不卸载已渲染看板、不自动重试。
- 撤回排队仍沿用原有权限、出勤与报名状态校验，允许修正历史误签到。
- 撤销接待仍按原接待者/管理员与「已接待、未建单」资格校验（issue #221）；已建单的接待走审核
  流程。不冻结已创建维修记录的后续填写/提交，不清理历史误补签数据。不新增权限或 Migration。

### 签到时核对与修改故障类型

`POST /api/v1/member/repair-activities/:id/check-in` 接受
`{ registrationIds: string[], issueTypeUpdates?: { registrationId: string, issueType: RepairActivityIssueType }[] }`。
响应保持 `{ checkedIn: StaffRegistrationView[] }`，返回保存后的 `issueType` 和 `issueTypeLabel`，
使用统一 API 信封与 requestId。缺省或空 updates 兼容原来的只签到请求。

- 仍需同源 Cookie 请求、有效账号 / 成员、`activity:admin`（仅 ADMIN）及本场出勤，
  报名截止闸门不变；普通成员不再有签到入口，也没有调用权限（issue #108）。
- registrationIds 去空、去重后为 1–100 条。updates 必须是数组，每项 ID 为有效非空字符串、
  属于本批且不能重复；数量不能超过本批客户数，类型必须是现有四种枚举。
  null / 错误形状 / 非本批 ID / 重复 / 无效类型 / 超限均为 400 `VALIDATION_FAILED`。
- 锁定活动的 Serializable 事务同时更新 REGISTERED 客户的明确类型修改、CHECKED_IN 状态、
  checkedInAt 和审计。未附更新的客户保留事务读取的当前类型；一条不存在、跨活动、软删除
  （404 `ACTIVITY_REGISTRATION_NOT_FOUND`）或不可签到（409 `ACTIVITY_REGISTRATION_STATE_INVALID`）
  时整批回滚，包含已经处理的类型、状态与审计。
- CHECKED_IN 重试没有更新或更新与当前类型相同时幂等返回，不重置时间或队列位置；
  更新不同类型则 409 `ACTIVITY_REGISTRATION_STATE_INVALID`，SERVED 始终拒绝。
- 保留 `repair_activity.registrations_checked_in` 摘要；真正的类型变更逐条写 USER 审计
  `repair_activity.registration_issue_type_updated`，actorUserId 为当前成员账号，before / after
  只记 issueType；无实际变更及幂等重试不重复写类型审计，不记录姓名、完整电话或凭证。
- 成员看板在确认弹窗中按待签到列表顺序核对姓名、脱敏电话、已填机型与类型，只在最终确认时
  一次提交快照 ID 及实际编辑项。取消丢弃草稿，失败保留草稿。成功后刷新失败保留已渲染看板，
  明确提示签到成功与刷新失败，成功反馈使用不占布局的浮层。

影响范围：成员看板 → check-in Route → Staff Service；原三参数 Service 调用
（设备 / 草稿集成测试）与旧请求（看板集成测试）保持兼容。公开查询、后台报名、board 与 serve
共用保存后的报名 issueType；不新增 Schema、Migration 或公共枚举。

### 接待台按需查看客户电话（issue #112）

`GET /api/v1/member/repair-activities/:id/registrations/:registrationId/phone`
返回标准信封 `{ phone: string }`，响应为 `Cache-Control: private, no-store`。

- 沿用 board 的有效 Session、ACTIVE 成员档案与 `activity:staff` 权限（MEMBER / ADMIN）；
  查看不要求本场出勤或报名截止，不影响签到 / 接待的操作闸门。
- 只读取本场未软删除的有效报名（REGISTERED / CHECKED_IN / SERVED）；活动不存在或已软删除
  返回 `ACTIVITY_NOT_FOUND`，报名不存在、跨活动、已软删除或无效状态返回
  `ACTIVITY_REGISTRATION_NOT_FOUND`。不新增权限、错误码、Schema 或 Migration。
- 明文响应前同事务写 `repair_activity.registration_phone.viewed` 审计，记录成员、报名、
  活动与 requestId，不记录完整号码；审计失败不返回明文。
- board、check-in、withdraw、serve 与公开报名回执继续只返回 `phoneMasked`。待签到 / 已接待
  共用按需读取组件，初始只展示脱敏值，隐藏即丢弃明文，下次查看重新鉴权并留痕；
  加载与失败保留脱敏值，错误进入常驻反馈区，显隐不影响布局或待签到勾选。

影响范围：成员看板两个列表 → 单条 phone Route → Staff Service → 查看审计与集成测试；
原 `StaffRegistrationView`、维修单 `ownerPhone` 权限与其余调用方保持兼容。

### 接待补单（不落草稿）与机主字段（issue #79 第 6 项 / issue #221）

**serve 行为**：

- `POST /api/v1/member/repair-activities/:id/serve` 只把登记行置为 `SERVED` 并记录接待人
  （`servedByMemberProfileId` / `servedAt`），**不再创建维修单或草稿**（`repair_record_id` 保持空）。
  权限、出勤与操作窗口同「成员出勤、签到与接待的操作窗口」一节。
- **全局拦截**：本成员存在「`SERVED` 且 `repair_record_id` 为空」的登记时，**任何活动**的 serve
  都返回 409 `ACTIVITY_SERVE_PENDING`（消息含客户姓名）；撤销或提交后解除。
- **继续填写**：
  - `GET /api/v1/member/repair-activities/:id/registrations/:registrationId/prefill`：仅接待者本人可读，
    返回客户姓名、完整电话、机型、故障类型映射后的启用分类、活动日，以及本场出勤的
    参与人候选；完整电话读取写 `repair_activity.registration_phone.viewed` 审计。管理员不代填（403）。
  - 预填响应自 issue #238 起增加 `participantOptions: { id, name, realName, nickname }[]`：
    仅包含**本场出勤且 `ACTIVE`、未软删除**的成员，按 `checkedInAt` 升序；`name` 走展示名回退链
    `nickname → realName → displayName → "成员"`，`realName` / `nickname` 供编辑器按姓名或昵称
    做大小写不敏感的包含匹配。不含 QQ、手机号、学号等身份字段；非活动接待的维修表单仍使用
    `GET /api/v1/repair-members` 的全局活跃成员候选。
    影响范围：`ServePrefillView` / `getServePrefill` → 接待建单的
    `RepairParticipantPicker`；集成测试 `repair-serve-record.test.ts` 钉住候选范围与字段。
  - `POST /api/v1/member/repair-activities/:id/registrations/:registrationId/record`：接待者本人提交，
    `Idempotency-Key` 必填；在一个事务里创建 **`PENDING`** 维修记录（与成员自助提交同一套校验，
    含机型必填）、写参与人 / `SUBMITTED` 时间线 / 审计，并回写 `repair_record_id`。
    服务端按 `activityId` 复核最终参与人（含创建人）均在本场出勤，未出勤返回 400
    `VALIDATION_FAILED` 且不占用登记。同一幂等键重试返回原记录；登记已被其他会话建单返回
    409 `ACTIVITY_REGISTRATION_STATE_INVALID`。
- 看板 `GET /api/v1/member/repair-activities/:id/board`：
  - `served: StaffServedRow[]` —— `SERVED` 报名（按 `servedAt` 倒序）：管理员为本场全部，
    普通成员仅**本人接待**（issue #207）；每行新增 `canFill`（本人接待且未建单）与
    `canRevert`（本人或管理员且未建单）；`recordStatus` 为 `null` 且没有 `repairRecordId` 表示
    「待补建」，前端显示「待补建 / 继续填写」。
  - `pendingServeRegistration: { registrationId, name, activityId, activityTitle } | null` ——
    全局拦截的客户端先行判据（客户端据此弹层且**不发 serve 请求**；服务端 409 为并发兜底）。
- `POST /api/v1/member/repair-activities/:id/revert-serve` 只允许撤销「已接待、未建单」的接待：
  登记恢复到接待前状态（签过到回 `CHECKED_IN`，否则回 `REGISTERED`）；已建单 / 已提交 / 已审核
  的接待返回 409（属于审核流程）。审计 `repair_activity.registration_serve_reverted` 记录恢复状态。
- **旧数据过渡**（PR #221 之前的接待草稿）：登记仍关联 `DRAFT` 且未提交时保留原撤销能力——
  撤销会删除该草稿及照片，并清理评论 / 收藏 / 通知（#195），审计额外记录 `deletedRecordId`；
  已提交 / 已审核仍返回 409。存量处置见 #223。

新增错误码：`ACTIVITY_SERVE_PENDING`(409)（取代 `ACTIVITY_SERVE_DRAFT_PENDING`）。

**机主字段与新列**：

- `PATCH /api/v1/repairs/:id` 与管理端 `PATCH /api/v1/admin/repairs/:id` 的字段集增加
  `ownerName` / `ownerPhone`（`ownerName` ≤ 40 字；`ownerPhone` 非空时必须是 11 位大陆手机号，
  存储口径为剔除非数字字符后的 11 位）。提交审核（`POST /api/v1/repairs/:id/submit`）必填
  机主姓名与电话；**维修内容与照片不再是提交门槛**（照片降级为选填附件），
  `content` 的长度上限校验仍保留（管理员修正历史正文）。
- 可见性：`RepairView.ownerName` 在成员区全站可见；`RepairView.ownerPhone` **仅**记录归属人
  本人与持有 `repair:review` 权限者能拿到完整号，其他情形一律为 `null`（不下发掩码值）。
  实现为 `toRepairView(record, { canViewOwnerPhone })`，默认 `false`（fail-closed）；
  `toRepairDetail` 按「归属人 || `repair:review`」传参。
- 列表搜索（`query`）增加机主姓名匹配；**机主电话不参与搜索**。
- 导出列新增「机主姓名 / 机主电话」，位置在「维修成员」之后；导出限 `data:export` 且已有审计，
  不做掩码。
- 摘要取值链（列表 / 案例库 / 通知 / 成员摘要）：`remark` 优先 → 老记录的 `content` 回退 →
  占位「未填写备注」。

### 维修表单的机型字段（issue #218）

- `POST /api/v1/repairs` 与 `PATCH /api/v1/repairs/:id` 的字段集增加
  `deviceModel?: string | null`：去首尾空白、空串落 `null`，上限 60 字（与 `device_model VARCHAR(60)`
  对齐）；非字符串超限 400 `VALIDATION_FAILED`，`fieldErrors.deviceModel`。缺省表示「不动」。
- **提交审核必填**（`POST /api/v1/repairs/:id/submit`，含退回后重提）：缺机型返回 400
  `REPAIR_SUBMISSION_INCOMPLETE` 并定位 `fieldErrors.deviceModel`；草稿仍可暂时为空
  （活动落单可能还没有带出报名机型），填写后即受上限校验。
- 历史记录**不回填**，`RepairView.deviceModel` 可为 `null`（详情显示「—」）；活动接待补单会把
  报名时填写的机型经预填带入维修记录（issue #221），成员可在表单里修改，保存以修改值为准。

### 维修参与人员（issue #114）

**Migration `20261012000000_repair_record_participants`（纯增量）+ 契约扩展：**

- `RepairView` / `RepairDetailView` 新增 `participants: { id, name }[]` —— 按 `sort_order` 升序、
  创建人恒在首位（服务端防御性重排）；`member` 字段语义不变（创建人 / 主维修人）。
- `PATCH /api/v1/repairs/:id` 与管理端 `PATCH /api/v1/admin/repairs/:id` 的字段集增加
  `participantIds?: string[]`：**不含创建人本人**的成员档案 id 列表；缺省 = 不动，
  显式数组 = 整体替换（服务端去重、剔除创建人本人、保持提交顺序）。建档
  `POST /api/v1/repairs` 同样接受该字段。
- 校验：额外成员最多 8 个（总数含创建人 ≤ `repairFieldLimits.participantMaxCount = 9`，
  超限 400 `VALIDATION_FAILED`，报错文案含上限）；不存在的成员 400 `VALIDATION_FAILED`，
  软删除成员不得新增为参与者，但完整名单中保留已有关联不阻止普通编辑；移除后不能重新添加。
  数组中的非字符串元素一律 400 `VALIDATION_FAILED`，不得转换为空名单；ID 去空白、统一小写后去重。
- 候选名单复用 `GET /api/v1/repair-members`（`ACTIVE` 且未软删除的成员）；编辑器以
  姓名输入框按已输入内容进行不区分大小写的包含匹配，直接选择候选成员添加；仅匹配既有
  可添加成员，已选成员和创建人不再列出。chip 旁「移除」删除，创建人 chip 固定不可移除。
  标题旁常驻已选人数与上限；满 9 人时输入框禁用并显示「已到达上限」，移除协作者后可继续添加。
- 审核通知：`POST /api/v1/admin/repairs/:id/reviews`（含批量审核）的通知收件人从「创建人」
  改为**全部参与者**，审核人本人若是参与者则剔除自己；通知表结构与类型不变。
  通知列表、标已读响应与工作台摘要均继承现有记录可见性；通知事件保留，但当前收件人不可读取
  记录时，`repairRecordId`、`commentId` 与 `repairExcerpt` 返回 `null`，界面不展示详情跳转。
  额外参与者仍不能读取他人草稿 / 待审 / 退回记录；创建人与持 `repair:review` 者保留详情入口。
- 统计口径：全部正式统计（成员列表计数、排行榜、分类分布、月度趋势、成员摘要）改为按
  **参与关系**——每名参与者各计一次、时长取记录上的同一值；列表可见性不变（本人创建任意
  状态 + 全部已通过）；管理端列表 `memberId` 筛选与 `query` 姓名搜索按「参与过」匹配。
- 导出（`GET /api/v1/admin/repairs/export`）列新增「参与成员」（`participantNames`，
  全部参与者「、」连接），位置在「维修成员」之后。
- 回填：存量记录每行补一条创建人参与行（含软删除记录），统计口径零变化。

新增错误码：无。

### 工作台按角色分区与签到 / 撤回权限收紧（issue #108）

`GET /api/v1/member/repair-activities/:id/board` 返回结构新增：

- `canAdmin: boolean` —— 当前账号是否具备 `activity:admin`；看板据此渲染「待签到」区与「撤回」按钮；
- `eligible` 变为**仅对管理员下发**：成员拿到的 `eligible` 恒为空数组，且服务端在查询报名时
  就不再读取 `REGISTERED` 行（数据最小化；字段保留空数组而非缺省，形状对两种角色一致）。

`POST .../check-in` 与 `POST .../withdraw` 的权限从 `activity:staff` **收紧为 `activity:admin`**：

- 普通成员（仅 `activity:staff`）调用返回 403 `FORBIDDEN`，且先于出勤与报名状态校验；
- 有效账号 / 成员档案、本场出勤与报名截止闸门不变；`serve` 与电话按需读取保持 `activity:staff`。

成员看板布局（纯前端，无接口变化）：成员为「排队中 ｜ 已接待」两栏，管理员为
「待签到 ｜ 排队中 ｜ 已接待」三栏（≥1100px 并排，窄屏按此顺序纵向堆叠）；
「已接待」沿用 `servedAt` 降序，区块常驻、为空只换内容。

新增错误码：无。

### 成员「已接待」仅本人接待记录（issue #207）

- 普通成员（`activity:staff`）的 board 在**库层**只读取「`CHECKED_IN` + 本人 `SERVED`」：
  `served` 只包含 `servedByMemberProfileId = 当前成员档案` 的报名，他人接待的客户
  （含脱敏电话与记录状态）不进入响应；`canAdmin` 账号仍返回本场全部 `SERVED`
  （管理视图需要总览与跨人撤销）。
- `served` 列表与计数同源（本人接待数），A 账号看不到 B 接待的客户；无记录时成员显示
  「本场你还没有接待记录。」，管理员显示「本场还没有已接待的客户。」。
- 排队（`CHECKED_IN`）、管理员待签到、排序 / 脱敏 / 撤销接待资格 / 审计均不变；
  无新增端点、权限、错误码、Schema 或 Migration。
- 影响范围：`repair-activity-staff-service.ts`（`getBoard`）→ `MemberRepairActivityBoard.tsx`
  空态文案；集成测试 `repair-activity-board.test.ts` 钉住「成员只见本人 / 管理员全量」。

## 管理端活动列表显示出勤人数（issue #107）

`GET /api/v1/admin/repair-activities` 的响应每一项新增 `attendedCount: number` ——
本场 `repair_activity_attendances` 的记录数。口径：成员签到即计入，系统**无签退**，
历史场次为累计值，无记录为 0（与 `registeredCount` 的 `?? 0` 缺省一致）。

- 与 `registeredCount` 同样由 `listAdmin` 一次 `groupBy` 批量聚合（`loadAttendanceCounts`），
  不新增端点、权限、错误码、Schema 或 Migration；**只回计数，不下发出勤成员明细**
  （成员身份字段不进管理端列表响应）。
- `create` / `update` 的响应同口径带回：新建为 0；编辑在事务内实时计数，
  避免保存后列表刷新出旧值。
- 公开视图（`RepairActivityPublicView`）与成员侧不受影响；`attendedCount` 仅存在于
  管理端视图 `RepairActivityAdminView`。
- 界面：活动管理页表格「名额」列后新增「出勤」列，列内显示「N 人」
  （列头 / 手机卡片左侧字段名已是「出勤」，值里不再重复），
  文案在 `src/config/admin.ts` 的 `repairActivities.table.attendance` /
  `repairActivities.attendanceLine`。

影响范围：`repair-activity-service.ts`（`loadAttendanceCounts` / `toAdminView` /
`listAdmin` / `create` / `update`）→ 活动管理页表格列；单测
`tests/unit/repair-activity-attendance-count.test.ts` 钉住接线与「只回计数」红线。

### 管理端活动列表排序（issue #260）

`GET /api/v1/admin/repair-activities` 按 `activityAt` 倒序返回，最新活动在前；
同一 `activityAt` 再按 `createdAt` 倒序、`id` 倒序稳定排序。管理端列表不分页、
不提供状态筛选，因此没有跨页或分组排序的额外处理。公开活动列表与成员活动列表的
既有顺序不变；无 Schema / Migration / 新端点 / 权限变化。

### 报名结果确认与重复提交（issue #262）

- `POST /api/v1/repair-activities/:id/registrations` 的活动结束判定不变；报名尚未开始或已截止时
  返回 409 `ACTIVITY_NOT_OPEN`。报名窗口内**先查同活动同手机号的有效报名**，命中返回
  409 `ACTIVITY_REGISTRATION_DUPLICATE`（“你已报名本场活动，无需重复提交”），再判断新报名容量。
  已报名者在满额后重复提交不再误报 `ACTIVITY_FULL`。
- 公开报名成功凭条由客户端展示活动、姓名、脱敏手机号、报名编号与报名状态，并提供
  「查询本人记录」入口；满额页保留查询入口，查询到 `REGISTERED` 时突出“你已报名成功”，
  状态统一使用中文（`REGISTERED` / `CHECKED_IN` / `SERVED`）。
- 报名 POST 超时（15 秒）、网络中断、响应非 JSON 或 5xx 时，客户端先用同一手机号查询：
  查到则按成功展示凭条；查不到则停在待确认，查询本身失败则提示重试，不直接断言失败。
  待确认状态下查询到本人记录会清除待确认并展示凭条；确认未报名后可重新填写，查询失败可重试。
  手动查询同样 10 秒超时。报名与查询手机号输入补 11 位格式校验，错误在字段旁就地提示并关联输入；
  确认弹层展示活动、姓名与完整手机号，可「返回修改」再提交。
- `GET /api/v1/admin/repair-activities/:id/registrations` 的每一项新增
  `hasSameNameActive: boolean`（本场其他有效报名中是否同名，供人工核对，不参与唯一性）。
  管理端报名弹层默认只列有效报名；已删除记录收进可展开的「删除历史」，状态用中文。
- 报名与查询 Route 追加结构化结果码日志：`event`、`requestId`、`activityId`、`result`，
  不记录请求正文、姓名或完整手机号。
- 不改 Schema / Migration / 新端点 / 权限；`ACTIVITY_REGISTRATION_DUPLICATE` 与
  `ACTIVITY_FULL` 的 HTTP 状态保持 409。

## 成员工作台出勤成员名单（issue #107）

`GET /api/v1/member/repair-activities/:id/board` 返回结构新增：

- `attendanceMembers: { memberProfileId, name, checkedInAt }[]` —— 本场出勤成员名单，
  按 `checkedInAt` 升序（同毫秒按 `id` 兜底，保证顺序稳定）；
- **仅对管理员下发**（与 `eligible` 同策略，见 #108 一节）：成员拿到的
  `attendanceMembers` 恒为空数组，且服务端在为成员取数时**不查询**出勤名单
  （数据最小化）；字段保留空数组而非缺省，形状对两种角色一致；
- `name` 走展示名回退链 `nickname → realName → displayName → "成员"`
  （`resolveDisplayName`），**不含** QQ、手机号、学号等身份字段；
- 口径与管理端 `attendedCount` 一致：`repair_activity_attendances` 记录数，
  不按成员档案状态过滤（系统无签退，历史场次为累计值）；
- 只读：无新增写接口；「代打卡 / 撤销出勤」不在范围内（issue #107 V1.0 已砍）。

界面：成员工作台工具栏右侧新增管理员专有入口「出勤成员 N 人」（N 实时取自
本字段长度），点开为只读弹层（桌面两列、窄屏单列；人多由弹窗正文内部滚动，
页面高度与三栏布局不随人数变化）；空名单时入口显示「出勤成员 0 人」、
弹层显示「本场还没有成员出勤。」。

影响范围：`repair-activity-staff-service.ts`（`StaffAttendanceMemberView` /
`getBoard`）→ `MemberRepairActivityBoard.tsx` 弹层；集成测试
`tests/integration/repair-activity-board.test.ts` 钉住排序、名字解析与
「成员不下发」红线。

## 学号与班级（issue #147）

两个公开入口——邀请码注册（`POST /api/v1/member-registrations/invite`）与公开招募
（`POST /api/v1/join-applications`）——都要求 `studentId` 与 `className` **必填**：

- 约束只有一份（`src/lib/security/normalization.ts`）：学号 trim 后 1–32 字符、
  **保留前导零**，不要求纯数字 / 固定长度，**不做唯一性校验**（学号不是身份，
  不进 `user_identities`，提交报名 / 邀请码注册不按学号去重；首次面试通过另有 issue #176 的成员查重）；班级 trim 后 1–80 字符，不引入命名规则；
- 缺失、空串、纯空白、**非字符串值**（对象 / 数字不做强制转换）与超长输入返回
  400 `VALIDATION_FAILED`，`fieldErrors` 带 `studentId` / `className`；
- 校验失败不创建报名 / 账号，也不消耗邀请码次数；密码、QQ / 手机号与招募批次规则不变；
- 管理员详情的 `JoinApplicationDetail` 新增可空 `studentId` / `className`
  （历史报名为 `null`，界面显示 `—`）；报名导出在「姓名」后新增「学号」「班级」两列，
  历史空值导出空字符串，XLSX 的学号为文本单元格（保住前导零）；
- 面试通过发放时，报名上的有效值带入成员档案；历史 `NULL` / 空白值**不更新**该字段，
  不会清空档案里已有的有效值。

不新增端点、权限码、错误码或数据库索引；`join_applications` 新增的两列可空，见
数据契约的对应条目。

## 姓名（issue #147 返修）

两个公开入口（邀请码注册与公开招募）的 `realName` 共用一份约束
（`src/lib/security/normalization.ts`）：**只去首尾空白**，trim 后 2–64 字符，
内部字符与空格原样保留 —— 不引入「只能中文 / 不能有空格」等格式规则。

- 不满足时返回 400 `VALIDATION_FAILED`，`fieldErrors` 带 `realName`；
- 两个表单的原生约束（`minLength=2` / `maxLength=64`）由同一组常量生成，
  `/join` 的姓名不再设整串 `pattern`（此前是 `\S{2,20}`，会拒掉含空格的姓名
  并卡在 20 字符）；客户端只 trim，不再删除姓名内部空白；
- 密码、QQ / 手机号与学号 / 班级规则不变。

## 邮箱验证与重置授权基础设施（issue #146）

PR #150 已建立验证码、SMTP、限流 / 预算与重置授权原语；主动邮箱管理与匿名邮箱找回已接入；统一账号门禁已实现并按 `EMAIL_GATE_MODE` 分档启用，缺省 `off`（尚未在生产开启）。

- 新增错误码（唯一事实来源仍是 `src/lib/api/errors.ts`）：
  `EMAIL_NOT_ENABLED`、`EMAIL_NOT_VERIFIED`、`EMAIL_ALREADY_BOUND`、
  `EMAIL_CHALLENGE_INVALID`、`EMAIL_SEND_FAILED`、`EMAIL_SEND_UNCERTAIN`、
  `EMAIL_RESET_AUTHORIZATION_INVALID`、`EMAIL_RATE_LIMITED`、`EMAIL_BUDGET_EXHAUSTED`；
- 新增契约类型（`src/types/contracts.ts`）：`EmailChallengePurpose`
  （`EMAIL_BIND` / `EMAIL_CHANGE_OLD` / `EMAIL_CHANGE_NEW` / `PASSWORD_RESET`）、
  `EmailChallengeServiceContract`、`PasswordResetServiceContract` 及配套输入 / 结果类型；
  `IdentityType` 增加 `EMAIL`（`user_identities` 早已预留该枚举，无需迁移旧数据）；
- 固定参数：验证码 6 位 / 10 分钟；账号 + 用途 15 分钟 5 次错码 → 阻断 15 分钟
  （重发 / 换 IP 不清零）；验码 IP 15 分钟 30 次；发送冷却 60 秒（账号 / 目标各一）；
  每日 10 / 10 / 100（账号 / 目标 / IP，上海自然日）；全站预算缺省 150 封 / 天 +
  10 封 / 分钟；重置授权令牌 32 字节随机 / 10 分钟 / 一次性；安全记录保留 7 天；
- 邮件**缺省关闭**：`MAIL_ENABLED=false`（`MAIL_ENABLED` 未设置同理）时发信 / 验码 Service
  抛 `EMAIL_NOT_ENABLED`，站点启动、构建与其它模块完全不受影响；启用时缺 SMTP 配置
  会在取配置时报 `INTERNAL_ERROR`（fail fast，不空跑）；
- 发送结果语义：SMTP 明确拒绝 → `EMAIL_SEND_FAILED`；超时 / 连接中断等不确定结果 →
  `EMAIL_SEND_UNCERTAIN`（挑战保持 `PENDING` 直到过期，不激活、也不退预算 ——
  用户可在冷却后重发）；两者都不泄露 SMTP 细节；
- 审计动作 `email.challenge.requested / sent / send_discarded / send_failed / verified /
verify_failed / verify_blocked`、`email.reset.authorization.issued / consumed`；
  邮箱在审计中打码，验证码 / 令牌不落审计；
- 新增环境变量：`MAIL_ENABLED`、`SMTP_HOST`、`SMTP_PORT`（默认 465）、`SMTP_USER`、
  `SMTP_PASSWORD`、`MAIL_FROM`、`EMAIL_CODE_PEPPER`（独立 pepper）、
  `EMAIL_DAILY_BUDGET`；清理入口 `pnpm email:cleanup`。

## 主动邮箱管理与管理端兜底（Refs #146 / Refs #113）

所有响应（含失败）`private, no-store`，统一信封 / requestId。自助主体只取 Session，不接受 userId；所有写请求同源；管理员另需 member:manage，Service 复核权限。需改密时邮箱页面 / 自助接口优先返回强制改密。无需 MemberProfile。

| 方法 / 路径                                                     | 请求与结果                                                                                                                       |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| GET /api/v1/account/email                                       | 完整本人邮箱、verified、mailEnabled、有效 assistance（id / 固定 targetEmail / expiresAt）及 exemption（id / reason / expiresAt） |
| POST /api/v1/account/email/challenges                           | 下述 discriminated union；返回 challengeId / maskedEmail / expiresAt                                                             |
| POST /api/v1/account/email/confirm                              | 下述 union；返回 changed / 服务端 destination，设置轮换 Cookie，不返回 token                                                     |
| GET /api/v1/admin/accounts/:userId/email                        | maskedEmail、verified、脱敏 assistance、exemption、canAssist、canExempt、mustChangePassword                                      |
| POST /api/v1/admin/accounts/:userId/email/reveal                | 显式读取 email / targetEmail，写 email.detail.revealed 审计                                                                      |
| POST /api/v1/admin/accounts/:userId/email/assistance            | {targetEmail, reason}；创建固定目标 30 分钟待办，不发信                                                                          |
| POST /api/v1/admin/accounts/:userId/email/assistance/:id/revoke | 撤销具体记录，重复已撤销 / 已消费无副作用，不影响后续待办                                                                        |
| POST /api/v1/admin/accounts/:userId/email/exemptions            | {reason, durationHours?}，默认 24，1–168 整数；替换原有效记录                                                                    |
| POST /api/v1/admin/accounts/:userId/email/exemptions/:id/revoke | 撤销具体记录，重复撤销无副作用，不影响新记录                                                                                     |

验证码证明结构 `{challengeId, code}`，code 为 6 位数字；严格拒绝未知字段及错误类型，PASSWORD_RESET 不在自助入口中：

- 发码 BIND：`{mode:'BIND', targetEmail}`；初绑无需密码或旧邮箱。
- 发旧码 OLD：`{mode:'OLD', currentPassword}`，旧地址服务端解析。
- 发新码 NEW：`{mode:'NEW', currentPassword, targetEmail, old}`，先核验旧码但不消费。旧、新两封共用 60 秒冷却，不降低参数。
- 协助发码 ASSISTED：`{mode:'ASSISTED', assistanceId, currentPassword}`；目标仅取待办，不允许请求替换。
- 确认 BIND：`{mode:'BIND', targetEmail, proof, returnTo?}`。
- 确认 CHANGE：`{mode:'CHANGE', targetEmail, currentPassword, old, proof, returnTo?}`；同事务消费旧 / 新证明。
- 确认 ASSISTED：`{mode:'ASSISTED', assistanceId, currentPassword, proof, returnTo?}`；同事务消费待办和新邮箱证明。

returnTo 只接受规范站内 /member 或 /admin 业务路径，按当前有效角色判定。查询串、片段、编码、控制字符、反斜杠、外部地址、登录 / API / 邮箱页循环均回退角色默认页，客户端只用服务端 destination。

管理端列表不增加邮箱搜索或导出；从常驻“账号邮箱”入口走原 `POST /admin/accounts/lookup` 的 QQ 精确查询（保留 SELF / canReset 语义）；成员详情复用同一管理面板。普通状态与列表只给脱敏地址，只有 reveal 返回完整地址并审计。无 SMTP 时仍能查询 / 管理协助与豁免；不开启全员门禁。操作说明见 [邮箱管理](../email-management.md)。

## 匿名邮箱找回与自设密码（Refs #146 / Refs #113）

三个 POST 不套登录守卫，均同源、严格字段白名单、统一信封 / requestId，成功失败均 `private, no-store`。Service 显式实现 `PasswordRecoveryServiceContract`，Route 不查询 Prisma。

- `POST /api/v1/auth/password-reset/request`：仅 `{qq}`。QQ 规范化后，在账号查询前独立事务持久化 IP 30 次 / 15 分钟、QQ 60 秒冷却及上海自然日 10 次限制，独立 HMAC 命名空间；锁按 key 排序，锁齐后取时。未知 / 不合格 QQ 不退款。真实发送继续受既有账号 / 邮箱 / IP 与全站预算约束，SMTP 在事务外发送一次。
- request 返回 200 `{challengeId, expiresAt, message}`。符合条件使用真实挑战；未知 / 未验证 / 不合格账号、目标限额 / 预算及 SMTP 失败 / 未知使用安全随机 UUID 占位与相同 10 分钟期限口径及接受提示，不持久化伪挑战。无邮箱（含脱敏）、姓名、角色、资格错误。公共格式 / 同源 / 查询前限流 / 邮件全局关闭可受控拒绝；意外故障保持 `INTERNAL_ERROR`。
- `POST /api/v1/auth/password-reset/verify`：仅 `{challengeId, code}`（UUID、6 位数字），固定 PASSWORD_RESET，原子消费挑战并签发一次性 10 分钟授权。JSON 仅 `{authorized:true, expiresAt}`，无 token / grantId / userId；内部 32 字节随机 token 仅写 `pc_hospital_password_reset` Cookie（HttpOnly、生产 Secure、SameSite=Strict、Path=/api/v1/auth/password-reset，Expires 不超过数据库期限）。不创建任何 Session。
- `POST /api/v1/auth/password-reset/confirm`：仅 `{newPassword, newPasswordConfirmation}`，授权仅取专用 Cookie。密码 6–128 字符，不 trim、不要求旧密码或复杂度。成功 `{changed:true,destination:'/login'}`，清重置 Cookie 及当前浏览器登录 Cookie，不自动登录；只撤销授权目标账号的数据库 Session。无效 / 过期授权清 Cookie，可纠正的字段错误保留授权。

新 request 清旧授权 Cookie，verify 失败也清旧授权。最终事务与 SMTP 开关无关：凭据锁后复核资格、同一邮箱、凭据代次与期限，消费授权、写密码、代次递增、清临时状态、撤销目标所有 Session、作废其他恢复证明并写审计，失败全部回滚。继续复用有界 Serializable 重试，每次锁等待 / 重试后重新取时。

未经邮箱证明的请求使用 SYSTEM / 空 actorUserId，已知账号仅为 target；验证后才记录本人恢复。服务端可信 `anonymous` 请求审计选项不来自 HTTP；原已登录邮箱管理审计不变。QQ / 邮箱 / IP 沿用脱敏，密码 / 验证码 / 授权 / Cookie 不进审计。`off` 档下登录 / 注册 / 正常改密落点不变；这三个匿名端点**不套登录守卫**，因此不受门禁档位影响。

## 统一账号门禁与分阶段启用（Refs #146 / Refs #113）

判定只有一份（`src/lib/auth/account-access.ts`），页面守卫与业务 API 共用；每次受保护请求都按**当次**数据库状态重判，不取登录时快照、不接受任何前端标志或请求参数。顺序固定：有效 Session / 账号资格 → 必须改密 → 当前档位需要已验证邮箱且无有效豁免 → 原目标或角色默认页。

档位只有服务端 `EMAIL_GATE_MODE=off|admin|all`（缺省 `off`）：`admin` 约束**当次**持有 ADMIN 的账号（双角色访问成员侧同样受限，绕不过去），`all` 约束全部已认证账号；非法值抛 500 `EMAIL_GATE_MODE_INVALID`，不静默退回 `off`；改值须重启全部实例才生效。无 `NEXT_PUBLIC_*`、无请求参数、无前端存储可参与判定。邮件通道与门禁解耦：`MAIL_ENABLED` 关闭、SMTP 失败或预算耗尽既不会让门禁失效，也不会让门禁额外拦人。

| 状态                          | 含义                                     | HTTP 与用法                                                                                 |
| ----------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `PASSWORD_CHANGE_REQUIRED`    | 必须先改密（优先级最高，豁免也不能绕过） | 业务接口 403 `PASSWORD_CHANGE_REQUIRED`；落点 `/account/change-password`                    |
| `EMAIL_VERIFICATION_REQUIRED` | 当前档位需要已验证邮箱且无有效豁免       | 业务接口 **403** `EMAIL_VERIFICATION_REQUIRED`（不是 401，会话有效）；落点 `/account/email` |
| `READY`                       | 可以访问业务                             | 落点为原目标或角色默认页                                                                    |

`AccountAccessView`（`src/types/contracts.ts`）= `{ state, destination, exemptionExpiresAt }`：`destination` 一律由服务端计算，`exemptionExpiresAt` 只在豁免仍有效时报出（ISO 串），已到期 / 已撤销为 `null`。`GET /api/v1/me` 在受限态仍是 200 并带该视图；它额外接受一个**候选** `?returnTo=`（客户端跟随器交来的当前业务页或步骤链条里的目标），只用于让受限状态下的 `destination` 接上链条 —— 是否放行、去哪一步仍只看数据库，候选本身不构成任何绕过标志。`POST /api/v1/auth/login`、`POST /api/v1/auth/password/change`、`POST /api/v1/member-registrations/invite` 与邮箱确认都返回同一编排的 `destination`（邀请码注册响应类型为 `InviteRegistrationResponse` = 原 `MemberRegistrationResult` + `accountAccess` + `destination`；登录 / 注册切换的链接与注册表单都带着同一个候选，链条不在切换处断开）。

访问用途由 **Route 在服务端写死**，不由请求里的任何 allow 标志决定（`authenticateRequest(request, requestId, purpose)`，`purpose` 缺省 `business`）：

| 用途               | 放行的受限状态                     | 使用方                                                               |
| ------------------ | ---------------------------------- | -------------------------------------------------------------------- |
| `business`         | 无                                 | 全部成员 / 管理业务接口（缺省；82 个调用点中除下列例外均沿用缺省值） |
| `session-self`     | 改密与邮箱都只报告不拒绝           | `GET /api/v1/me`（登出本来就不经此入口，受限会话仍可登出）           |
| `email-self`       | 只豁免邮箱门禁，仍需先改密         | `GET /api/v1/account/email`、`POST …/challenges`、`POST …/confirm`   |
| `account-recovery` | 只豁免邮箱门禁，仍需先改密与有权限 | 见下方窄例外清单                                                     |

窄例外**只**放行这些既有端点：`POST /api/v1/admin/accounts/lookup`、
`POST /api/v1/admin/accounts/:userId/password-reset`，以及任务 4 的
`GET /api/v1/admin/accounts/:userId/email`、`POST …/email/reveal`、`POST …/email/assistance`、
`POST …/email/assistance/:id/revoke`、`POST …/email/exemptions`、`POST …/email/exemptions/:id/revoke`。
用途在每条 Route 里单独声明，**不给 `/admin/accounts/*` 或 `/admin/*` 前缀式放行**：
成员名单、导出、角色编辑、审计查询等照常受门禁。同源、权限、Service 二次校验、
SELF 禁止、资格判定与审计全部不变；豁免不授予任何权限，也不授予找回资格。

页面侧：`requireMemberPage()` / `requireActiveMemberPage()` / `requireAdminPage()` 统一调用
`enforcePageAccountAccess()`。**后台不能只靠 layout 守卫**：layout 在客户端导航之间保持挂载、
不为切页重新求值，所以 `/admin/**` 的每个 page 也各自调用同一个 `requireAdminPage()`
（任务 6 返修 F2）；它被 React `cache()` 包住，同一请求里 layout 与 page 共用一次求值，
请求之间仍然每次重判。会话缺失 / 失效时去登录页并带上**形状合法**的候选原目标
（`/login?reason=expired&returnTo=…`，此时还没有角色可查，认证之后由 `safeAccountReturnPath`
按当次角色复查）。步骤页 `/account/change-password`、`/account/email` 由调用方以编译期常量
声明自身，不会自环；「允许停留」按判定顺序给出（`isAccountStepPage`）：必须改密只能停在改密页，
**只差邮箱**的账号可以停在改密页也可以停在邮箱页（任务书要求改密页与改密接口对邮箱受限账号
照常可用）。`returnTo` 沿「登录 → 改密 → 邮箱」链条传递，沿用任务 4 的安全回跳规则并收敛到
`safeAccountReturnPath()`：只接受当前角色允许的规范 `/member` / `/admin` 业务 pathname，
拒绝外部地址、双斜杠、反斜杠、控制字符与空格、查询串 / 片段 / 百分号编码歧义以及登录 /
API / 两个步骤页的自环，不做二次 decode，非法值回退角色默认页。当前路径取自
`src/middleware.ts`：它只做一件事 —— 用 `NextRequest.nextUrl.pathname` 无条件覆写内部
`x-internal-pathname` 头（客户端伪造值被覆盖），Edge 内不查 Prisma、不发信；该头**只**用作
候选回跳目标，是否重定向、去哪一步只看数据库状态。中间件缺失时读到 `null`，落点退化为
角色默认页，行为仍安全。

客户端跟随器（`SessionMonitor`）与服务端同源判定：只有 401 算会话失效，门禁拒绝 / 业务错误 /
网络异常都不写成过期；受限状态按服务端 `destination` **整页跳一次**（重新走文档请求 = 重新判定），
已经在允许停留的步骤页时不跳。下一次复查按**最近的一个未来到期时间**安排（豁免比会话更早到期就
提前复查），24 小时只是上限不是下限；拿不到未来的到期时间时（首次、已过期、请求失败）按 60 秒
固定间隔重试，不出现 0 毫秒连发，也不引入新的高频轮询。

`/account/email` 在门禁下仍保留主动管理能力，并给出服务端授予的「继续原目标」：邮箱已验证
或豁免仍有效时是可点链接，否则按钮常驻但置灰。「刷新状态」同时重取本人邮箱状态与**服务端授予的
继续能力**（重放当前页面的 RSC 请求，由服务端重算 `continueTo`；查询串里的 `returnTo` 原样保留，
这一轮失败就维持原状、不伪造放行）—— 管理员刚授予的豁免不必整页重载就能继续。落点只有一个来源：
服务端；既不新增「门禁状态」接口，也不允许前端看见豁免就自行拼路径。
同一页面为完成改密且持有 ADMIN + `member:manage` 的账号常驻
「账号恢复」「账号邮箱」两个恢复入口，复用既有 `AdminAccountResetDialog` /
`AdminAccountEmailDialog`，同一时刻只挂一个窗口。

新增错误码：`EMAIL_VERIFICATION_REQUIRED`（403）、`EMAIL_GATE_MODE_INVALID`（500）。
门禁拒绝不额外逐请求写审计（既有登录 / 改密 / 邮箱管理审计不变），敏感值照旧不落日志。
无 Migration、无新依赖。启用顺序、冒烟判据与回退动作见
[门禁启用与回退](../email-gate-rollout.md)。

## 报名通知邮箱（Refs #158 · 第一轮）

- 新公开报名 `POST /api/v1/join-applications` 必填 `email`（严格字符串，不从 QQ 推导）。复用 `normalizeEmail`：去首尾空白、普通 ASCII 邮箱、全地址小写、最长 191 字符，保留点与 `+tag`；非法 / 缺失返回 `VALIDATION_FAILED` 与 `fieldErrors.email`，不创建报名。前端 type=email / required / maxLength 为辅助校验。
- Route 显式投影允许字段，招募批次继续由服务端决定。重复有效提交仍按同一批次 QQ / 手机号返回原回执（200 / duplicate=true），不会用新提交覆盖原邮箱；不同报名可共用邮箱。历史回执读取不要求补填。
- `SubmitJoinApplicationInput.email` 必填，`JoinApplicationDetail.email` 为 string | null。只在具有 `join:read` 权限并写 `join.application.detail.viewed` 访问审计的完整详情返回；历史无邮箱显示 `—`。列表、公开成功响应 / 回执不返回新增邮箱字段，不增加邮箱搜索。
- CSV / XLSX 导出沿用原显式 select / 行模型 / 列白名单与 `data:export` 权限，不增加通知邮箱列。业务审计不追加明文地址，邮箱类摘要继续复用既有脱敏规则。
- 隐私告知说明邮箱用于报名与账号通知。此地址仅为未验证的通知地址，不产生 EMAIL 身份 / verifiedAt，不影响当前邮箱门禁与恢复资格。第一轮仅保存地址；第二轮的报名建档通知见下节，邀请码与初始密码生成规则保持原样。

## 报名账号通知（Refs #158 · 第二轮）

- 审核通过后，建档成功事务同时创建 `APPLICATION_ACCOUNT` 通知任务；缺邮箱历史报名不建通知，既往成功建档不追溯补发。邀请码 / 手工建档不接入。建档与通知结果独立。
- `JoinApplicationDetail.notification: AccountNotificationView | null` 只在原有 `join:read`、完整详情访问审计路径返回。字段为 `status`、累计 `attemptCount`、本轮 `roundAttemptCount`、待发时的 `nextAttemptAt`、受控 `lastErrorCode`、`acceptedAt`、可用 `messageId` 和 `canRetry`。不返回任务收件地址、QQ 快照、领取标识、凭据代次或密码；列表、公开回执和导出不扩字段。
- `POST /api/v1/admin/join-applications/:id/notification/retry` 无请求体字段；同源、Session 认证、`join:review`，Service 再核权限；统一信封 / requestId，成功失败均 `private, no-store`。返回上述状态视图。仅 FAILED 复用原任务开启新一轮，轮内次数归零、累计及失败审计保留；PENDING / SENDING 重复请求幂等返回，ACCEPTED / UNCERTAIN 返回 `STATE_TRANSITION_INVALID`。不存在返回 `RESOURCE_NOT_FOUND`。只调度通知，不重新审核、建档或改密。
- `AccountNotificationServiceContract` 的 `get(applicationId, actor)` / `retry(applicationId, actor)` 承担管理端权限；`runBatch({limit?})` 只由受保护 CLI 调用（缺省 10，范围 1–50），返回无敏感值的批次统计，不提供公开发信入口。
- PENDING → SENDING → ACCEPTED / FAILED / UNCERTAIN；明确暂时拒绝可退回 PENDING。每轮最多 4 次实际 Sender 调用，间隔 1 / 5 / 30 分钟。邮件关闭、领取和预算等待不计尝试。结果未知或领取超时停止自动重发；“ACCEPTED”仅表示已提交发信服务。
- 运行、状态边界与发布 / 停用步骤见 [账号通知运行说明](../account-notifications.md)。

## 统一表格查询（issue #214）

本节覆盖管理端 members、repairs、join-applications、invite-codes、audit-logs；原权限及 Service 二次校验不变。
字段白名单与不支持原因见 [生成的能力清单](../table-capabilities.md)。分类/技能保留业务拖动序，活动/内嵌任务表保持专用交互。

- 列表接受 `sort=field:asc,other:desc`（最多 3 项）、重复 `filter=field:op:value`（最多 5 条、AND）、可选 `groupBy=field`。字段/方向/运算符/值非法返回 400 `VALIDATION_FAILED`；参数化查询，不透传任意 SQL 列名。
- 默认排序维持原规则，显式排序最终补 `id desc`；可空字段沿用 GreatSQL 原生排序。分页默认 20、上限 100。日期按上海自然日解释并含结束日；维修 DATE 列按日历日处理。
- 记录计数沿用 `meta.pagination.total`。选择分组时同一次列表 HTTP 响应可增加 `meta.summary: {field, counts: [{value: string | null, count: number}]}`，口径为权限范围内、当前全部筛选后的全量，与分页无关。未选择分组不执行分组查询、不新增网络请求。
- 分组白名单：members=status/department，repairs=status/result，join-applications=status/provisionStatus，invite-codes=status（派生生效状态），audit-logs=result/actorType。无其他统计指标、统计导出或新的导出权限。
- `JoinApplicationSummary.approvedAt: string | null` 是既有 PASSED 审核记录最早的服务端 `createdAt`；补记备注不改变它，历史缺失保持 null。原 `lastReviewedAt` 继续表示填写的面试时间，列表分别显示两列。新增通过时间排序/日期筛选不新增列、不伪造历史时间；不改变公开回执与详情披露范围。
- 报名列表/计数/分组/导出复用参数化 `joinQueryWhere`；通过时间派生式复用已有 `(application_id, created_at)` 索引定位审核记录。维修列表/导出继续共用 `listWhere`，并统一使用 `repairOrderBy`。两个导出保留原列/超限拒绝/权限与审计，不增加地址或统计列；新文本条件值和关键词不进入审计摘要。
- 管理端维修默认排除草稿保持有效；显式 `status=DRAFT` 或列级 `status:eq:DRAFT` 才选择草稿，其他标记/条件不隐式解除默认限制。
- 五个管理列表成功/失败均 `private, no-store`。共用客户端查询取消旧请求并丢弃旧结果，保留已有列表；不会悬停预取详情或按输入字符发请求。
- 页面 URL 仅保留受控排序、日期与枚举条件，不带姓名、QQ、手机号、学号等文本。刷新/回退恢复可分享部分，从第一页重新读取；清除统一恢复查询默认值，列宽通过独立动作恢复。

## 成员管理导出（issue #232）

`GET /api/v1/admin/members/export` 要求同时具备 `member:manage` 与 `data:export`，
使用既有 Session 与账号门禁。`format=csv|xlsx`（缺省 csv，大小写不敏感），非法格式返回
400 `EXPORT_FORMAT_INVALID`。其余查询参数与成员列表共用 `memberListInput`：
`query`、`status`、`role`、`sort`、重复 `filter`，白名单及上海自然日边界不变；
`page` / `pageSize` / `groupBy` 不影响导出内容。成员排序白名单还包含 `department`。

列表、计数、分组与导出共用 `memberListWhere`，导出与列表均由 `memberOrderBy` 排序；
没有显式排序时沿用管理员持久化的拖动顺序与稳定 ID 兜底。导出筛选后全部匹配成员，
不限于已加载页或已勾选项；并发修改时不承诺与先前列表冻结在同一快照。

列顺序：姓名、昵称、部门、技能标签（完整名单）、学号、班级、角色、状态、加入时间、
已通过维修次数、维修总时长（分钟）、QQ 号（脱敏）、手机号（脱敏）、成员档案 ID。
维修统计复用列表的有效参与记录口径；加入日期按上海日期输出，空值为空字符串。
QQ / 手机号沿用列表脱敏结果，不导出邮箱、凭据或内部账号 ID。完整联系方式的读取仍由
原详情 / 邮箱 reveal 接口负责并审计。XLSX 学号按文本保存前导零，CSV 沿用 BOM、转义与公式防护。

最多 20,000 行，超限返回 409 `EXPORT_ROW_LIMIT_EXCEEDED`，不截断；空结果返回只有表头
的附件及 `X-Export-Row-Count: 0`，前端提示无匹配结果并不触发下载。
成功返回附件流，带 `Content-Type`、`Content-Disposition`、`Content-Length`、
`X-Export-Row-Count` 与 `Cache-Control: private, no-store`。
每次成功导出写 `member.exported` / `MemberExport` 审计，摘要记录格式、行数和查询结构，
不记录搜索词或筛选值；审计失败不返回附件。错误沿用统一 API 信封。

## 活动工作台增量同步（issue #236）

`GET /api/v1/member/repair-activities/:id/board?view=full|live|served|attendance`，
缺省 `full` 保留原 `StaffBoardView`；未知 view 为 400 `VALIDATION_FAILED`。
所有视图保持统一信封、当前 Session/账号门禁、有效成员和活动检查，成功/失败均为
`Cache-Control: private, no-store`，不建立跨用户看板缓存。

| view       | 数据                                                                                                                           | 权限与读取                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| live       | 原 activity/attended/attendanceCheckedInAt/canAdmin/eligible/queue/pendingServeRegistration，另加 servedCount、attendanceCount | activity:staff；不查询 SERVED 明细、repairRecord 关系或出勤姓名关系。servedCount 管理员全场、成员本人；attendanceCount 成员为 null，管理员为本场出勤记录数 |
| served     | `{ served: StaffServedRow[] }`                                                                                                 | activity:staff；成员在库层仅本人，管理员全场；保留排序、旧草稿兼容、canFill/canRevert 及脱敏                                                               |
| attendance | `{ attendanceMembers: StaffAttendanceMemberView[] }`                                                                           | activity:admin；复用 checkedInAt/id 升序与展示名回退，只含 memberProfileId/name/checkedInAt；成员 403，查询前拒绝                                          |

live 用分组计数与最小字段读取替代历史/名单明细。管理员新增独立本人出勤与计数分支，
逻辑查询数量可能增加，不能把传输缩小或拆视图等同于实际 SQL/耗时改善；需以相同夹具和
时间窗口核对查询、读取行与关联。原完整视图仅为兼容，查询分支数不等于 SQL 条数。

前端进行中 live 每 5 秒、结束后每 60 秒；served 在桌面或手机已接待分区可见时首次立即
读取、其后每 60 秒，手机离开暂停；attendance 仅打开弹层/手动读取。写成功后立即刷新
受影响资源，写请求不自动重试；低频明细的更新时间单独显示，不伪装成实时状态。

自动 GET 失败保留快照与最后成功时间，显示失败/连续失败；进行中下次间隔
10→20→40→60 秒，结束与历史最多 120 秒。成功仅清除本资源的同步告警并恢复基础节拍。
401/403/404 停止本资源自动读取，手动重试仍可达。隐藏页、写操作及确认弹层暂停；
恢复无失败时立即同步，退避期间 focus/恢复不绕过冷却。每个资源在途合并；写入、
切活动或卸载使旧读失效，迟到明细不能改写 live 或复活结束状态。

未加载/失败不代表空列表；队列成功不改变明细的成功时间和失败状态。同场刷新保留有效
选择/草稿/滚动/焦点，切目标清空旧场状态，不让上一场可操作数据留在新目标。

## 报名查询姓名校验与设备锁定（issue #304）

`POST /api/v1/repair-activities/:id/registrations/lookup` 的 body 由 `{ phone }` 改为
`{ name, phone }`：两项 trim 后精确匹配、**都命中**才返回既有 `RegistrationLookupView`。
任一项不匹配统一返回 404 `ACTIVITY_REGISTRATION_NOT_FOUND`，文案不区分是姓名还是手机号错
（避免把「某手机号存在」变成可探测信息）。响应结构、`editToken` 与频控键不变。

`POST /api/v1/repair-activities/:id/registrations` 成功时额外下发签名 cookie
`ra_reg_<activityId>`（`HttpOnly; SameSite=Lax; Path=/; Secure(生产)`，**有效期到活动自然日结束、
上限 30 天**，值为 `registrationId + exp + HMAC(AUTH_SECRET)`；不含姓名 / 电话）。再次提交时：

- cookie 有效且对应报名仍存在（`deletedAt IS NULL`）→ 409
  `ACTIVITY_DEVICE_ALREADY_REGISTERED`（“本设备已提交过本场报名，请使用「已经报名？」查询，或联系管理员”）；
- 报名已被管理员删除 / 不存在 / 签名不符 / 过期 → 视为没有该凭证，继续按原规则（含
  `ACTIVITY_REGISTRATION_DUPLICATE` 手机号唯一）判断。

新增只读端点 `GET /api/v1/repair-activities/:id/registrations/device`：只读同名 cookie，
返回 `{ submitted: boolean, registration: RegistrationPublicView | null }`（不含 editToken），
`Cache-Control: private, no-store`；无 cookie / 凭证失效 / 记录已删除一律 `submitted=false`。
页面用它决定是否收起报名表单：结论返回前只显示占位、不渲染表单；收到
`ACTIVITY_DEVICE_ALREADY_REGISTERED` 时会重新读取并直接切到「已提交」面板；
面板上提供「重新检查报名状态」，管理员删除报名后无需刷新整页即可恢复填写。
前端调用该接口有 **8 秒超时**：超时 / 网络失败按「未知」处理并放开报名表单，
不能让设备接口卡住报名入口（真正的重复拦截仍在服务端）。

边界：清 cookie、无痕窗口、换浏览器/设备仍可绕过，本机制只约束「同一浏览器的重复填写」；
真正的重复兜底仍是 (活动, 手机号) 唯一与按 IP / 手机号限流。无 Schema / Migration 变更，
历史报名记录不受影响。
