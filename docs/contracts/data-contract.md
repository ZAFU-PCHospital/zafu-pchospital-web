# Phase 2 M0–M2 数据契约

管理机器人增量：`repair_activities.version` 为默认1的单调版本，管理更新/软删除递增；
`bot_operations` 以机器主体与操作UUID去重，成功结果与活动及SYSTEM审计同事务提交。
不新增ADMIN用户，不把群成员OpenID作为网站User外键。详见 [机器接口契约](management-bot.md)。

## 数据库基线

- GreatSQL：`8.0.32-27`（MySQL 8.0 协议）
- 存储引擎：InnoDB
- 字符集 / 排序规则：`utf8mb4` / `utf8mb4_unicode_ci`
- 时区：数据库服务与应用会话均为 UTC
- 时间精度：`DATETIME(3)`；API 输出 ISO 8601
- 核心 ID：应用层生成 UUID，数据库 `CHAR(36)`

生产环境只允许执行版本化 Migration。禁止用 `db push` 或手工 DDL 替代 Migration。

`schema.prisma`、Migration 与公共 Contract 的后续修改不强制单独评审，但必须先搜索并记录
全部消费者。若影响其他模块，必须在同一变更中同步贯通前向 Migration、生成客户端、实现、
调用方、Contract、测试和文档；已执行 Migration 不得改写。

## 统一账户边界

`users.id` 是统一账户本体。QQ、手机号和未来 OAuth subject 只存放在
`user_identities`，业务表只能引用 `users.id` 或 `member_profiles.id`。

- `(type, identifier_normalized)` 全局唯一；软删除后也不自动复用。
- `member_profiles.user_id` 唯一，一名用户最多一个成员档案。
- `user_roles.active_key` 对有效授权唯一；撤销时清空该键并保留历史行。
- 密码仅以 scrypt 哈希写入 `password_credentials`。

## 认证与 Session 边界

- QQ 登录只通过 `user_identities(type=QQ)` 解析 `users.id`，QQ 不是 User 主键。
- `auth_sessions` 只保存 `HMAC-SHA-256(AUTH_SECRET, token)` 摘要；Cookie 只持有随机明文令牌。
- Session 默认 1 天，登录时 `rememberMe=true` 为 30 天；`auth_sessions.remember_me`
  默认 `false`。有效期从登录开始计算，不自动续期，Cookie 到期时间与 Session 一致；
  已有 Session 保留当前到期时间。改密轮换时保留选择并按 1 / 30 天重新计时。
  禁用 User、撤销 MemberProfile 或 UserRole 后实时拒绝。
- `login_throttles` 以 QQ + IP 的不可逆摘要持久化失败窗口，不保存原始 QQ 或 IP，可供多实例共享。
  临时凭据的密码错误**另计一条账号维度摘要**（独立命名空间，同一张表，15 分钟窗口
  5 次失败阻断 15 分钟）：6 位数字口令必须能拦住换 IP 猜解。两个命名空间的键互不相同，
  普通登录成功时的清除命中不到账号桶。
- 管理员发放的初始密码设置 `must_change_password=true`；邀请码注册的自设密码为 `false`。
  初始密码由成员 QQ 号推导：取后 6 位（QQ 不足 6 位时取整串，见 `initialPasswordFromQq`），
  提交给本人后首次登录即要求改密。**招募发放与管理端直建保持这条规则，管理员手动重置
  不再沿用**（见下条）。
- 管理员手动重置（成员详情与账号恢复共用）签发**临时凭据**（issue #113）：6 位安全随机
  数字（保留前导零）、1 小时有效。是否临时凭据只由 `temporary_expires_at` 非空判定，
  历史凭据该列为 `NULL`；过期 / 已消费的临时凭据对匿名登录统一按凭据错误拒绝，不暴露
  恢复状态。首次成功登录在事务内原子消费（`temporary_consumed_at`）并只建立一个
  受限 Session：最长 10 分钟、不晚于原到期时间、`remember_me=false`、不滑动续期。
  恢复态改密必须持有该受限 Session，且不得把新密码设回本次临时密码；完成改密清除临时
  状态并轮换普通 1 天 Session。`credential_version` 在每次重置与改密时递增，验密之后的
  建 Session / 改密必须复核代次 —— 旧校验结果不能作用到新一代凭据上。
- 改密和管理员重置密码必须撤销已有 Session；改密成功轮换当前 Session。

## 邮箱边界（issue #146，主动绑定与管理兜底已接入）

基础设施已由 PR #150 合并。主动绑定、正常换绑及管理员协助 / 临时豁免通过独立邮箱页面接入；匿名找回与自设密码恢复已接入，全员邮箱门禁仍未启用。

- 邮箱身份存 `user_identities(type='EMAIL')`；规范化（`normalizeEmail`）只接受 ASCII：
  trim → 小写 → 单个 `@` → 本地部 dot-atom ≤64 字符 → 域名 ≥2 段、每段 1–63 字母数字
  或连字符 → 全长 ≤191。不合规输入拒绝，不做任何静默修复。
- 新增 `active_email_key VARCHAR(80) NULL`：只有 EMAIL 行能写该键（迁移里手写 CHECK
  约束保证），值为 `email:{userId}`；唯一索引让**一名用户至多一个有效邮箱**由数据库兜底，
  软删除身份时置空、释放槽位。**一个规范化邮箱全局只归属一个用户**继续由既有
  `(type, identifier_normalized)` 唯一保证（软删除也不释放，与其它身份一致）。
  历史行保持 `NULL`。
- `email_challenges` 只存验证码的 **HMAC 摘要**（绑定 challengeId / userId / purpose /
  规范化邮箱；pepper 独立为 `EMAIL_CODE_PEPPER`），不存明文。6 位数字、10 分钟有效；
  状态机 `PENDING → ACTIVE（SMTP 已接受）→ CONSUMED`，被替代转 `INVALIDATED`，
  到期由 `expires_at` 派生。同一用途重新签发会把旧的 `PENDING / ACTIVE` 挑战置为
  `INVALIDATED`（含换目标地址）；发送结果只在挑战仍为 `PENDING` 且未过期时激活。
- `email_security_counters`：桶键为主键，存 `HMAC(PII_AUDIT_PEPPER, 'email:' + key)`
  摘要，不落明文邮箱 / IP / 用户 ID。计数在 `SELECT … FOR UPDATE` 行锁事务内进行，
  多桶预占按**明文键排序后的固定顺序**取锁（防死锁）；窗口过期按清零重新计时
  （滚动窗口锚定首次事件；每日窗口锚定 Asia/Shanghai 自然日，数据库存 UTC）。口径：
  - 验码失败（账号 + 用途，跨目标）：15 分钟 5 次 → `blocked_until` 阻断 15 分钟；
    重发 / 换 IP 不清零；失败计数在独立提交的事务里先落库再返回失败；
  - 验码 IP：15 分钟 30 次；
  - 发送冷却：账号、目标各 60 秒（跨用途共享）；
  - 每日：账号 10 / 目标 10 / IP 100；
  - 全站预算：缺省 150 封 / 天 + 10 封 / 分钟（`EMAIL_DAILY_BUDGET` 可调），
    发送前在同一事务原子预占；任一桶超限整笔回滚、不消耗任何额度。
- `password_reset_authorizations`：只存令牌摘要（`HMAC(EMAIL_CODE_PEPPER,
'password-reset:' + token)` 唯一索引），32 字节随机令牌只在签发返回值出现一次；
  10 分钟、一次性（条件更新消费，同事务只允许成功一次）。签发与消费都重查账号资格、
  邮箱身份仍在（同 id / 未软删 / 已验证 / 同属该账号）与 `credential_version`
  未被重置推进 —— 管理员刚重置过密码时，旧验证码不能兑换新代次授权。
- 消费原语（`consumeEmailChallenge` / `consumePasswordResetAuthorization`）与调用方
  事务共享：传入既有事务，成功即改状态，失败整笔回滚。
- 审计动作：`email.challenge.requested / sent / send_discarded / send_failed / verified /
verify_failed / verify_blocked`、`email.reset.authorization.issued / consumed`；
  审计摘要里的邮箱字段统一打码（`a***@example.com`），验证码与令牌绝不进审计。
- 清理：`pnpm email:cleanup`（`tools/email-cleanup.ts`）分批删除 7 天前已结束的挑战、
  过期授权与过期计数桶，幂等、可重复执行。

## 成员部门（issue #171）

- `MemberDepartment` 固定为 `REPAIR`（维修部）、`PUBLICITY`（宣传部）、`OFFICE`（办公室），
  一名成员只有一个部门，不参与角色与权限计算，不新增部门表。
- `member_profiles.department VARCHAR(32) NOT NULL DEFAULT 'REPAIR'`，数据库 CHECK 限定上述值；
  前向迁移 `20261020000000_member_department` 将所有存量成员归入维修部。
- `join_applications.admitted_department VARCHAR(32) NULL` 保存首次通过的录取部门，CHECK
  允许上述三个值或 NULL。历史报名保持 NULL；当前成员归属与历史录取部门分别保存。
- 首次通过必须选择部门，录取部门与面试结论、Provision 任务、审计在同一审核事务提交。
  发放事务读取已保存的录取部门；失败重试、重复通过、补记备注均不修改录取部门。
- 历史已通过任务发放复用已有档案时按录取部门更新，部门变化递增档案版本并在发放审计记录前后值。
  成功后重放不再建档，不覆盖管理员后来调整的归属。历史已通过且无录取部门的任务：
  新建档案默认维修部，复用档案保留当前部门。
- 管理员新增可选部门（缺省维修部），详情修改复用 `member:manage`、version 与
  `member.profile.updated` 审计；邀请码注册新建默认维修部，未指定部门的共享建档调用不覆盖已有归属。
  普通成员自助资料接口不开放部门修改。

## 招募与发放边界

- `join_applications` 可独立存在，不要求先创建用户。
- 同一招募批次的规范化 QQ、手机号分别有数据库唯一约束。
- 软删除保留这两个唯一键；同批次再次报名明确返回 `JOIN_APPLICATION_DUPLICATE` 并提示联系管理员，
  不恢复旧记录、不返回删除回执，不新增或修改 Migration。跨批次仍可报名。
- 管理员以 `join:review` 可软删除任意状态报名；只写 `deleted_at` 和 `join.application.deleted` 审计，
  不撤销成员与账号，不级联删除 Review / Provision / Notification / AuditLog。
  列表、详情、导出排除删除记录，后续审核、发放与通知重试拒绝操作。删除与审核 / 发放锁同一报名行；
  通知发送准备保留删除检查。已交给 SMTP 的邮件无法撤回。
- 首次面试通过查重只匹配有效成员（User ACTIVE 且未删除、档案 ACTIVE 且未删除、MEMBER 角色未撤销）；
  QQ / 手机号 / 邮箱匹配其未删除身份，学号匹配档案。沿用身份规范化，学号 trim、保留前导零，
  NULL / 空白不判重；不把报名通知地址当作已绑定的成员邮箱。
  冲突只返回字段名称，不披露其他成员联系方式，不复用 / 合并有效成员资料。
- 首次审核用 `AccountProvisionService.provisionInTransaction` 复用既有发放过程：
  查重、审核记录、录取部门、账号 / 档案 / 角色、Provision、通知入队及审计共享 Serializable 事务，
  并发冲突重试后重新核对，任一步失败整笔回滚。`finishProvision` 只在提交后认领历史维修数据。
  原 `provisionFromApplication` 保留历史已通过任务的独立事务、失败记录与重试；成功重放不覆盖部门或凭据。
- 报名通知邮箱 `JoinApplication.email`（issue #158）为可空 `VARCHAR(191)`，新提交应用层必填并使用现有 `normalizeEmail` 规范化。迁移 `20261019090000_join_application_email` 只加可空列，不回填；历史无邮箱保持 NULL，仍可查看与审核建档。不增加唯一索引，不按邮箱去重，不从 QQ 推导，也不由重复提交覆盖。
- 通知地址保存于报名记录及下述通知任务快照，不写 `user_identities` / verifiedAt / MemberProfile，不授予邮箱门禁或找回资格。仅授权且有访问审计的完整报名详情可见；列表、回执及原导出列不新增邮箱披露。审计摘要继续按既有邮箱字段脱敏，第一轮仅保存地址，第二轮仅为本次成功报名建档创建通知任务。
- 面试状态与账号发放状态使用两个独立字段。
- `account_provisions` 同时约束幂等键以及 `(source_type, source_id)` 唯一。
- Review、Redemption、Provision、AuditLog 不提供业务删除入口。
- 招募与邀请码注册都要求学号 / 班级**必填**（issue #147）：学号是保留前导零的自由字符串，
  trim 后 1–32 字符，不要求纯数字、不建唯一索引、不进入 `user_identities`；
  提交报名 / 邀请码注册不按学号去重，首次面试通过另按上述规则检查有效成员；
  班级 trim 后 1–80 字符。`join_applications` 的两列为可空列 —— 迁移前的历史报名没有
  该信息，保持 `NULL`、不批量回填；新提交由应用层保证必填。
- 面试通过发放把报名上的有效学号 / 班级带入成员档案；历史 `NULL` / 空白值转为
  「不更新该字段」，不会清空档案里已有的有效值。`MemberProfile` 的历史可空性不变。

## 邀请码不变量

- 数据库只保存 `HMAC-SHA-256(INVITE_CODE_PEPPER, normalizedCode)` 的 32 字节摘要。
- 明文只在创建返回值出现一次；列表、日志、数据库均无法再次读取。
- `NOT_STARTED / EXPIRED / EXHAUSTED` 由时间与计数派生，数据库只存
  `ACTIVE / REVOKED`。
- 同一码可以复用到 `max_uses`。管理员只能修改 `activeFrom`、`expiresAt`、`maxUses`。
- `usedCount` 不在管理输入契约中，只能在 Redemption 事务中原子递增。
- Migration 的 CHECK 约束保证 `max_uses >= 1` 与
  `0 <= used_count <= max_uses`。
- 消费事务锁定邀请码行，并把 User、MemberProfile、UserRole、Redemption、Provision、
  AuditLog 与计数一并提交；任一步失败全部回滚。

## 软删除

User、UserIdentity、MemberProfile、JoinApplication、InviteCode 使用 `deleted_at`。
Repository / Service 的默认读取必须加 `deletedAt: null`。身份采用全局不复用策略，
因此软删除不会释放身份唯一键；未来身份转移必须是独立、受审计的管理流程。

公共枚举与 TypeScript 类型的唯一事实来源是 `src/types/contracts.ts`。数据库使用受控
字符串列，禁止 Feature 自行拼写新状态。

## M2 维修记录契约

- `repair_records.member_profile_id` 是唯一业务归属，不保存 QQ、手机号或姓名外键。
- 状态只允许 `DRAFT → PENDING → APPROVED|REJECTED` 和 `REJECTED → PENDING`。
- `version` 在记录修改、提交、审核、标记和软删除时递增；成员保存必须提交当前版本。
- 草稿允许不完整；成员提交时要求业务日期（不早于 2020-01-01、不晚于今天）、维修时长
  （1–10080 的整数分钟，issue #72 起必填）、启用分类、机主姓名与机主电话
  （issue #79 第 6 项：`ownerPhone` 必须是 11 位大陆手机号）。**维修内容与照片不再是提交门槛**
  （照片降级为「备注与附件」里的选填附件，正文可从表单退场）；日期范围、时长上下限与电话格式
  在保存草稿时就开始校验（issue #62 后端3），字段上下限集中在 `src/config/repairs.ts` 的
  `repairFieldLimits`。`content` 的长度上限校验保留（管理员仍可修正历史正文）。
- 维修结果默认「已完成」：成员端不填写该字段，缺省写入 `COMPLETED`，管理端仍可改成「未完成」。
  维修时长由成员在填写记录时录入并提交必填（issue #72）；管理端仍可修正异常值。
- `repair_reviews` 和 `repair_timeline_events` 只追加；退回审核意见必填。
- 照片数据库只保存元数据与服务端 `storage_key`，文件不在 `public/` 下；照片访问继承维修记录可见性。
- 分类使用稳定 `code` 幂等 Seed。停用分类不能用于新提交，但历史引用保留。
- 历史修机数据导入（issue #72，`tools/import-repair-history.ts`）走独立落库通道：按姓名匹配
  **在册活跃成员**、按名称匹配启用分类，通过后直接落 `APPROVED`（无照片、不走 `repair_reviews`），
  以 timeline 三条事件与 `repair.history_imported` 审计标注来源 `history_import`。逐行指纹
  （`create_request_key = history-import:{sha256}`）只含业务字段（成员归属与备注不参与，
  保证「暂存认领」与「重跑导入」算出同一个键），重复导入同一行只跳过不重复入库。
  业务字段完全相同的行（同一人同一天做同样的活）由 `classifyHistoryRows` 按文件行序追加出现
  序号：第 1 行保持原键（与既有导入一致，重跑即跳过），第 2..N 行依次为 `#2`..`#N`，
  因此同组行不再互相吞并，重跑同一文件只增量补录缺失行（2026-09-30 实测：无序号时
  两个收集表被吞 126 行）。**增量补录必须用同一份文件**——序号取决于同组行在文件内的出现顺序，
  换文件或改行序会算出不同的键。
- 「先修机、后注册」的行由暂存表 `repair_history_pending` 自动闭环（PR #73 评审 1）：
  导入时姓名尚未在册、但其余字段有效的行先落暂存（指纹幂等，记来源文件与行号）；
  该姓名的新成员在**邀请码注册 / 面试通过发放 / 管理端新增**三条建档路径成功后，
  自动按姓名认领补录 —— 同样直接落 `APPROVED`，timeline 三条事件与 `member.history_claimed`
  审计标注来源 `history_import_claim`。同名在册成员不止一位时整组不认领（与导入重名口径
  一致，留人工）。暂存表**不建外键**：归属成员在录入时还不存在，`claimed_by_profile_id` /
  `created_record_id` 只是事后追溯值；补录失败不影响注册（暂存行保留、重跑导入也能补）。
  双保险：成员建档后对同一文件重跑 `--apply` 亦可补录，已入库行被指纹跳过。
- 收集表实况的解析口径（社团确认，issue #72）：成员归属按「**维修人员姓名**」列匹配在册成员——
  一格多人取第一人、姓名粘连班级号（如「计算机233蔡廷耀」）剥前缀后匹配，两种处理都在备注留痕；
  日期取「提交时间（自动）」列的日历日；时长为自由文本，按「分钟 / 小时（含半小时、两小时、
  X小时Y分）/ 纯数字（≤12 按小时、>12 按分钟）」解析，解析不出（如「一次」「十五min」）逐行拒收；
  分类列缺失时 `--fallback-category` 统一挂兜底分类（`HISTORY_IMPORT`，`--apply` 时自动创建），
  时长列缺失或为空时 `--default-duration` 按分钟补录——补录值一律写进备注，可事后甄别修正。
- `device_model` 是机型（issue #68 引入、issue #218 起成为成员表单字段，可空 `VarChar(60)`）：
  活动报名时选填，接待落单时**复制**进记录，此后两边独立；成员在维修表单里填写 / 修改，
  **提交审核时必填**（草稿允许暂时为空），历史记录不回填。上限 60 字、去首尾空白，集中在
  `repairFieldLimits.deviceModelMaxLength`。当前只用于展示与核对，不参与统计口径与筛选。
- 机主两列（issue #79 第 6 项，Migration `20261008000000_repair_record_owner`，纯增量）：
  `owner_name`（可空 `VarChar(40)`）与 `owner_phone`（可空 `VarChar(11)`，存储剔除非数字字符后的
  11 位）。来源：接待落单自动带自报名，手工建单由成员填写；**历史数据不回填**（导入工具未映射
  「机主」列，旧数据也没有该信息），旧记录两列为 `NULL`。可见性口径：`ownerName` 在成员区
  全站可见；`ownerPhone` 完整号仅记录归属人与 `repair:review` 持有者可读，其余情形由视图层
  下发 `null`（`toRepairView` 的 `canViewOwnerPhone` 默认 `false`，fail-closed），导出
  （`data:export`，有审计）原样输出。接待落单（`serve`）生成的是 **DRAFT** 草稿并把报名上的
  机主信息带进记录，成员补齐后自行提交。
- 默认业务查询排除 `repair_records.deleted_at IS NOT NULL` 和已软删除照片。
- 后续所有正式统计必须统一使用 `status = APPROVED AND deleted_at IS NULL`。查询条件的代码事实来源为
  `approvedRepairWhere()`；M2 分析入口 `listApprovedRepairsForAnalytics()` 与 M3 成员摘要均在其上追加范围条件。

### 维修参与人员（issue #114，Migration `20261012000000_repair_record_participants`，纯增量）

- 新表 `repair_record_participants`（记录 × 成员的**参与关系**，每个组合一行）：
  `id` / `repair_record_id` / `member_profile_id` / `sort_order`（0 起，创建人恒为 0）/
  `created_at`；唯一键 `(repair_record_id, member_profile_id)`，两条外键一律 `ON DELETE RESTRICT`。
  **表上没有时长列** —— 时长是记录级字段，不分人（口径：每名参与者各计一次、时长取记录上的同一值）。
- `repair_records.member_profile_id` 语义不变，仍是**创建人（主维修人）**；参与关系单独存储，
  以「创建人恒为 `sort_order = 0` 的参与行」建立不变量（每条记录恒有 ≥1 参与行）。
- 迁移回填：对存量 `repair_records` 每行插入一条创建人参与行（`sort_order = 0`、
  `created_at` 取记录创建时间），含软删除记录；统计口径因此**零变化**。
- 写入路径（创建人参与行恒在）：
  - 成员建档 `createDraft`、接待落单 `serve`、历史导入、暂存认领：插入创建人一行；
  - 成员与管理端编辑（`PATCH`）：请求体 `participantIds`（**不含创建人本人**；缺省 = 不动、
    数组 = 整体替换）经 `composeParticipantIds`（创建人恒在首位、去重）落库并修正 `sort_order`。
- 上限 `repairFieldLimits.participantMaxCount = 9`（含创建人，额外成员 ≤ 8）；候选名单默认来自
  `GET /api/v1/repair-members`（`ACTIVE` 且未软删除），返回展示名、姓名与昵称，支持按姓名或昵称搜索。
  **活动接待建单例外**（issue #238）：
  候选随预填接口下发，仅本场出勤且 `ACTIVE`、未软删除的成员；姓名与昵称均可作为搜索关键字。
  `createServedRepairRecord` 在服务端按 `activityId` 复核**最终参与人（含创建人）**均在本场出勤，
  绕过界面直接提交未出勤成员会返回 400 `VALIDATION_FAILED`，不占用接待登记。
  存在性校验（`assertParticipantsExist`）
  仅对新增关联排除软删除成员；保留已有参与行不阻止普通编辑，移除后不能重新新增软删除成员。
  ID 去空白、统一小写后去重，非字符串输入拒绝；停用（非 ACTIVE）成员不主动新增、但历史参与行不受影响。
- **统计口径切换**：全部正式统计从「记录归属」改为「参与关系」。涉及成员列表计数
  （`member-repository.approvedRepairStats`）、排行榜（`rankedBaseSql` 窗口函数）、
  分类分布与月度趋势（`aggregateCategoryDistribution` / `aggregateMonthlyTrend`）、
  成员摘要（`approvedForMember` 改 `participants.some`）。唯一谓词
  `APPROVED AND deleted_at IS NULL`（`approvedRepairWhere` / `approvedRepairSql`）不变，
  只是作用在 JOIN 后的记录上。工作队列 / 最近操作 / 收藏摘要仍按**创建人**，列表可见性不变。
- 审核结果通知（`createReviewNotification`）发给**全部参与者**（创建人恒在其中），
  审核人本人若是参与者则跳过自己那条；管理端列表的 `memberId` 筛选与 `query` 姓名搜索
  按「参与过」匹配。
  通知事件不授予记录读取权限：通知列表、标已读与工作台摘要按详情同一权限判断，对不可见记录
  返回空引用与空摘要（`repairRecordId` / `commentId` / `repairExcerpt` 为 `null`），不提供详情链接。
- 展示：`RepairView.participants: { id, name }[]`（创建人恒在首位，服务端防御性重排）；
  导出新增「参与成员」列（全部参与者「、」连接）。

## 活动签到类型修正

- `repair_activity_registrations.issue_type` 继续保存现有四种类型，不新增字段或枚举。
  有效且已出勤的成员持 `activity:staff` 时，可在签到事务内明确修正 REGISTERED 报名的类型；
  未传修改项时保留当前类型，不用弹窗快照覆盖其他修改。
- 类型、CHECKED_IN、checkedInAt 与所有审计在锁定活动的 Serializable 事务中整批提交或回滚。
  已 CHECKED_IN 的相同类型重试不重置时间 / 队列顺序；不同类型修改及 SERVED 均拒绝。
- 真正的类型变更逐条复用 USER 审计 `repair_activity.registration_issue_type_updated`，
  actorUserId 为成员账号，before / after 只记 issueType；无变更或幂等重试不重复记录类型审计。
- 撤回排队只恢复 REGISTERED、清空 checkedInAt，保留核对后的类型；公开查询、后台与 board
  读取同一报名行，后续 serve 用该类型映射维修草稿分类。

## M3 技能标签契约

- `skills` 用稳定 `code` 幂等 Seed，初始 8 项：`WINDOWS`、`HARDWARE`、`NETWORK`、`LINUX`、
  `LAPTOP_DISASSEMBLY`、`SYSTEM_INSTALLATION`、`DRIVER`、`STORAGE`。停用用 `is_active = false`，
  不物理删除，历史引用保留。
- `user_skills` 是 `member_profiles` 与 `skills` 的多对多关联，**不使用** `users` 作主体 ——
  成员身份的唯一载体是 `member_profiles`，QQ 绝不出现在关联键上。
- `user_skills` 唯一约束为 `(member_profile_id, skill_id)`，**取消选择走 `deleted_at` 软删除**，
  不物理删除行；重新选择恢复同一行，保证历史可追溯且不产生重复记录。
- 成员选择的技能上限为 12（`MEMBER_SKILL_LIMIT`），服务端为权威校验点。
- 已停用技能不能新增关联，但既有保留不被静默删除。
- 成员可自建标签（issue #68，业务确认无需审核），但只能提供名称（≤ 80 字符）：
  库里已有同名启用标签时**复用该行**，已停用则拒绝（`SKILL_INACTIVE`）——
  停用状态不能靠重新输入同一个名字复活；`code` / 描述 / 排序仍由系统或管理员决定。

## M3 成员资料契约

- 昵称 `nickname` 由成员自助维护，长度上限 64（`MEMBER_NICKNAME_MAX_LENGTH`），
  拒绝换行与控制字符；留空表示回退展示实名。
- `member_profiles.version` 是资料与技能共用的乐观锁：昵称更新与技能保存都必须提交当前版本，
  成功后版本递增；过期版本返回 `MEMBER_PROFILE_VERSION_CONFLICT`。
- 资料的字段可见性由 `ProfileVisibilityPolicy` 裁剪，分三档：

  | 视图     | 出现场景                      | 含 QQ | 含学号/班级 | 含 `userId` |
  | -------- | ----------------------------- | ----- | ----------- | ----------- |
  | summary  | 工作台、列表、公开响应        | 否    | 否          | 否          |
  | self     | 仅 `GET /member/profile`      | 是    | 是          | 否          |
  | internal | 仅 `GET /members/:id/profile` | 是    | 否          | 否          |

  因此 QQ、学号、班级只存在于受保护的单成员详情，绝不进入列表、统计或公开数据。

- 学生身份标识（学号、班级）当前由管理员维护，M3 不提供自助修改入口。

## M4 收藏与审核通知契约（评论已退役，issue #198）

- `repair_comments`、`comment_mentions` 及反向关系仅保留历史兼容；不再提供评论、回复或提及的 Service / UI / 写入入口，不销毁旧行或修改旧 Migration。
- `repair_favorites` 唯一约束 `(member_profile_id, repair_record_id)`。取消收藏只写 `deleted_at`，再次收藏恢复同一行并刷新时间；可见性仍继承维修记录对象级权限。
- `notifications` 收件人为 `member_profiles.id`。公开 `NotificationType` 仅 `REPAIR_APPROVED` / `REPAIR_REJECTED`；历史 `MENTIONED` / `REPAIR_COMMENTED` 继续存储但不可查询或操作，也不计入列表 total、未读数或工作台摘要。全读只更新开放类型的本人未读行。
- `NotificationView.commentId` 为废弃兼容字段，始终返回 null。通知只由收件人读取、标已读或软删除；删除不改状态 / readAt，记录可见性的既有降级不变。
- 审核通知仍在审核事务内向所有参与者去重发送、跳过审核人本人，兼容没有成员档案的管理员。审核失败时通知和审计一并回滚。
- `ON DELETE RESTRICT` 关系继续保留；接待草稿撤销沿用 #195 的历史通知 / 提及 / 回复 / 根评论清理顺序，不因评论下线删除历史表或跳过关联。

## M6 批次 2 管理端契约

- **技能标签库**（`skills`，M3 已建表，M6 批次 2 才开放写能力）：与故障分类同一策略 ——
  只停用 / 启用，**不做物理删除**。标签被 `user_skills` 引用，删行会让历史成员标签无声消失；
  停用后成员侧 `GET /api/v1/skills` 不再返回它，已有的关联仍然回显。
  `code` 是小写输入也统一大写的稳定机器码，创建后不可修改；重复 code 返回 409
  `SKILL_CODE_CONFLICT`（在入口查重，不让唯一键冲突冒泡成 500）。
- **原评论管理**：已随全部维修评论统一退役；保留历史评论与 `repair.comment.*` 审计的可读解释，不再授予评论权限或提供管理能力。
- **邀请码列表**：`status` 筛选的是**生效状态**（`NOT_STARTED` / `ACTIVE` / `REVOKED` /
  `EXPIRED` / `EXHAUSTED`），不是库里的存储状态 —— 除 `REVOKED` 外，其余四态在库里都是
  `status = 'ACTIVE'` 加时间或计数条件推出来的，因此判定被下推到 SQL，与纯函数
  `getInviteCodeEffectiveStatus` 的分支顺序严格对应。`used_count` 与 `max_uses` 用
  Prisma 字段引用做**列对列**比较，不把 `maxUses` 读出来当常量比较（那会破坏分页下推）。
  绑定 QQ / 手机号在列表里只出现脱敏值；完整明文邀请码只在创建响应里返回一次
  （库里只有 `code_digest` 与明文前 8 位）。
- **审计记录**：只读。不提供任何修改或删除入口 —— 能改的审计等于没有审计。
  `before_summary` / `after_summary` 在**写入时**就已经过 `redactAuditSummary`
  （凭据类字段整条丢弃、QQ / 手机号打码），因此**读取审计不再写审计**：
  读这条路径不会带来新的 PII 暴露，而每读一次写一行会让审计表自我增殖。
  对比 `member.detail.viewed` 与 `join.application.detail.viewed`：那两条路径真的返回了
  明文联系方式，所以必须留痕。
- **公开内容与展示策略**：`public_content_settings` 是**单行**配置表（主键固定
  `public-content`），字段为 `public_repair_stats_enabled`、
  `public_repair_stats_detail_enabled`、`public_rankings_enabled`、`ranking_display_name`。
  表里没有行时按契约默认值处理（三个开关全关、展示名 `NICKNAME`）——
  读不到配置不等于可以公开。不变量：**辅助数据不能脱离主数据存在**，
  关闭主开关时 `public_repair_stats_detail_enabled` 一并归零（而不是报错，
  否则「关掉首页统计」要分两次操作才能达成）。每次写入写审计
  `settings.public_content.updated`，并记录 `updated_by_user_id`。
  首页在每次请求时通过 `publicHomeService.get()` 消费这份策略，默认或读取失败时保守隐藏。
  `PublicHomeAnalytics` 是独立公开 DTO，不包含成员 ID、头像、账号、联系方式及配置修改人；
  关闭的区块返回 `null`，辅助开关关闭时不查询或下发 `details`。
  总量按 M5 的正式谓词对维修记录聚合，每条记录计一次，不累加多人参与贡献；
  本学年榜单复用 M5 的数据库排名（前 `RANKING_PREVIEW_LIMIT` 条，即 3 条）。
  学年区间固定为 9/1 → 次年 9/1（issue #178，不依赖环境变量），因此学年指标恒为真实值；
  DTO 同时下发 `academicYear.label`（如「2026–2027 学年」），标题与注脚必须与数据同源。
  `NICKNAME` 仅使用昵称、`REAL_NAME` 仅使用实名，缺失时使用中性名「成员」，
  两种模式均不回退到另一种姓名或登录展示名；`HIDDEN` 使用中性名且不读取成员资料。
  两个区块独立降级，查询失败时隐藏失败区块，不伪造统计数字。
- **报名数据导出**：与维修导出共用列模型、CSV/XLSX 写入器与三条硬规则
  （筛选与列表同源、超限拒绝而非截断、导出必写审计），但**故意包含 QQ 与手机号明文**
  —— 招募要按联系方式联系人，而需求 §34 对维修导出的要求是只输出记录 ID 与照片链接。
  两条路径因此分开权限与审计动作：维修导出 `repair.exported`，报名导出
  `join.applications.exported`。
- **日期筛选口径**：所有面向界面的日期区间按 `Asia/Shanghai` 自然日解释，
  **结束日包含全天**（排他上界 = 次日 00:00），与学期统计区间同一套换算。
  `repairDateFrom/To` 例外：那一列是 `DATE`（本身就存上海自然日），不做时刻换算。

## 邮箱管理状态（Refs #146 / Refs #113）

前向 Migration `20261016150000_email_binding_support` 新建两张表，不改历史迁移，不回填身份或验证时间：

- `email_assistances`：目标 userId、固定规范化新邮箱、旧身份 ID 快照（初绑为 NULL）、凭据代次、操作人、2–500 字原因及创建 / 到期 / 消费 / 撤销时刻。旧身份 ID 为快照，身份记录沿用软删除保留。30 分钟、一次性；同用户新建使旧记录和相关新邮箱码失效；撤销按具体记录 ID；过期惰性判断，原身份 / 凭据改变即失效。不能给自己创建；需改密对象先改密。
- `email_exemptions`：目标 userId、原因、操作人、创建 / 到期 / 撤销时刻及撤销人。默认 24 小时、整数 1–168 小时；重新授予撤销原记录，记录 ID 撤销不影响后续记录。禁止给自己授予或续期。已到期即无效，无定时任务或自动续期。
- 两表均按 userId 与有效性字段建索引，User 外键 RESTRICT；不依赖 MemberProfile。管理员无成员档案也可操作 / 绑定。豁免不修改 Session、密码、账号或邮箱身份，不授予找回资格，不绕过强制改密。
- `getEmailVerificationState(userId, tx?, now?)` 返回验证 / 当前有效豁免状态；无 SMTP / HTTP / authenticate 依赖，供后续门禁复用，本轮不接守卫。
- 历史未软删且 verifiedAt 非空、activeEmailKey 为空仍是有效邮箱；当前用户多条未软删 EMAIL 受控拒绝，不全库清洗。新增身份使用 `email:{userId}` 唯一键；软删地址不释放给其他账号，原账号重用仍需重新验证。
- 所有新绑定挑战保存发码时凭据代次与旧身份快照；最终核验必须匹配当前账号、用途和目标，切换事务再复核快照。协助请求不接受可替换的新邮箱。
- 当前密码现验独立使用 `verify:fail:{userId}:ACCOUNT_EMAIL_PASSWORD` 摘要桶：15 分钟 5 次错误后阻断 15 分钟；不清验证码桶、登录桶或临时凭据桶。
- 最终切换在 Serializable / 有界重试中重查 Session、凭据、强制改密、资格、当前身份、协助和期限；同事务消费两份正常换绑证明（协助仅新证明）、更新身份、使旧挑战 / 重置授权 / 待办失效、撤销旧 Session 并创建当前新 Session、撤销豁免、写审计。失败全回滚。
- 取锁链：Session 读取、凭据行锁、资格 / 身份 / 待办、目标归属、按 ID 排序的挑战行锁、消费与写入。锁等待后的当前服务端时间判期限，重试重新取时；不改 #113 的现有逻辑。计数决策独立事务提交，SMTP 仍在预占事务外发送一次，不退款 / 补发。
- 邮箱切换的新 Session 保留原 rememberMe 与原到期时刻，不延长期限；新 token 仅 HTTP-only Cookie 交付，JSON 只含 changed / destination。
- 业务审计：`email.bound / changed / password.rejected / assistance.created / assistance.revoked / exemption.granted / exemption.revoked / detail.revealed` 与 `auth.session.revoked`。管理员 actorUserId 和目标 userId 分开，邮箱摘要脱敏；验证码 / 密码 / Session token 不进入审计。
- 成员后台 DTO 仅增加 `emailMasked / emailVerified`，显示在原联系方式单元格；公开成员 DTO 不带邮箱，不允许邮箱搜索 / 筛选 / 导出。精确 QQ 查询沿用原 POST lookup 语义。

## 匿名邮箱找回编排（Refs #146 / Refs #113）

无新增表、列或 Migration。复用 `email_security_counters`，新增 `recovery:request:ip:*` / `recovery:request:qq:cooldown:*` / `recovery:request:qq:daily:*` 独立 HMAC key 命名空间；请求预占先提交再查询账号，不因未知 / 不合格、目标额度或 SMTP 结果回滚。验证码 / 一次性授权的数据结构、哈希、凭据代次、清理策略沿用邮箱基础设施。

`PasswordRecoveryServiceContract` 连接 QQ 发起、固定 PASSWORD_RESET 验码与最终改密。发起仅解析服务端当前有效已验证 EMAIL，兼容历史 activeEmailKey 为空的有效身份；不接受邮箱或 userId。临时豁免与恢复资格独立，无档案管理员可恢复，需改密不阻止找回；禁用 / 软删 / 无效成员身份仍拒绝。

最终事务以授权摘要预读定位目标，再锁 `password_credentials`，调用既有授权锁定消费原语，读取账号资格 / 当前邮箱 / 凭据代次并以锁后时间复核有效期，条件消费授权与更新凭据。原语先写的消费状态仍在同一事务；后续失败整体回滚。新哈希、mustChangePassword=false、临时状态清空、credentialVersion + 1、目标全部 Session 撤销、其他 ACTIVE/PENDING 邮箱挑战及 ISSUED 重置授权作废与审计同事务完成，不建立 Session。

与 #113 管理员重置 / 已登录改密、邮箱切换交叉时沿用 Serializable 有界重试；凭据先锁、授权后锁，其他事务的读 / 写冲突由数据库检测并重试，回调重新取时，不在可重试事务内发送 SMTP。不修改角色、MemberProfile、账号状态、邮箱或临时豁免。HTTP 使用独立 Strict / HttpOnly Cookie 交付授权，公共 JSON 不暴露授权与内部主体。统一邮箱门禁未启用。

## 报名建档通知任务（Refs #158）

前向迁移 `20261019120000_account_notifications` 新增 `account_notifications`，不回填历史成功建档。`(provision_id, kind)` 唯一，关联 AccountProvision / JoinApplication / User 的外键均 RESTRICT 删除；任务不会因清掉业务关联而静默丢失。

保存规范化收件地址及 QQ 快照、本次是否真正新建凭据与代次、状态、累计 / 轮内尝试次数、下次执行时间、领取 UUID / 租约、最后尝试 / 受控原因、服务商接受时间和可用 Message-ID。`status + next_attempt_at` / `status + lease_expires_at` 用于有界待办和超时扫描，application / user 索引支持详情与关联。不存初始密码、哈希副本、全文邮件或原始 SMTP 报文；报名地址快照不构成已验证 EMAIL 身份。

入队与建档成功同一事务；SMTP 完全在事务外。领取用任务行锁，回写匹配 SENDING + claimId；两分钟租约到期一律 UNCERTAIN，迟到结果不得覆盖。不承诺 SMTP exactly once 或最终送达。仅明确未接受的暂时失败每轮最多四次；FAILED 人工重试归零 `round_attempt_count`，保留 `attempt_count` 及原失败审计。只在实际调用 Sender 后计数，邮件关闭 / 预算等待 / 单纯领取不计数。

验证码与通知共用 `email_security_counters` 原 `budget:global:day` / `budget:global:minute` HMAC 桶（每日配置，默认 150；分钟 10）。通知不创建验证码用户、目标或伪 IP 桶；预算不足提交下个允许窗口，不退款。任务 → 凭据 → 当前资格 / QQ / 报名 / 建档 → 原预算桶为本轮发送准备锁序，预算内部仍按原键排序；取锁及有界 Serializable 重试后重新取当前时间。发送前每次复核当前凭据；不在 SMTP 期间锁住改密。

业务审计使用既有入口：`account.notification.queued / attempted / retry_scheduled / accepted / failed / uncertain` 为 SYSTEM；`retry_requested` 记录授权管理员及操作时间。摘要只含关联 ID、状态、计数和受控原因，不加完整邮箱、QQ、密码、正文或服务商报文；详情沿用 `join.application.detail.viewed` 访问审计。

## 成员管理导出（issue #232）

成员 CSV / XLSX 导出复用现有成员列表 DTO、筛选谓词、排序与有效维修参与统计，
无 Schema / Migration。`MemberExportInput` 复用 `MemberListInput` 的条件与排序，
去掉分页和分组；`MemberExportServiceContract` 通过既有附件结果模型返回文件。

导出同时要求 `member:manage` 与 `data:export`。QQ / 手机号沿用列表脱敏值，邮箱及凭据
不进入文件；明文读取仍限原详情 / reveal 路径。成功导出必写 `member.exported` 审计，
不保存搜索词和筛选值，超限拒绝而非截断。列及 HTTP 语义见
[API 契约](api-v1.md#成员管理导出issue-232)。
