# Phase 2 M0–M2 数据契约

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
- Session 默认 30 天，在剩余 7 天内续期；禁用 User、撤销 MemberProfile 或 UserRole 后实时拒绝。
- `login_throttles` 以 QQ + IP 的不可逆摘要持久化失败窗口，不保存原始 QQ 或 IP，可供多实例共享。
- 管理员发放的初始密码设置 `must_change_password=true`；邀请码注册的自设密码为 `false`。
- 改密和管理员重置密码必须撤销已有 Session；改密成功轮换当前 Session。

## 招募与发放边界

- `join_applications` 可独立存在，不要求先创建用户。
- 同一招募批次的规范化 QQ、手机号分别有数据库唯一约束。
- 面试状态与账号发放状态使用两个独立字段。
- `account_provisions` 同时约束幂等键以及 `(source_type, source_id)` 唯一。
- Review、Redemption、Provision、AuditLog 不提供业务删除入口。

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
- 草稿允许不完整；提交时要求业务日期、1–10080 分钟、启用分类、10–10000 字正文、固定结果和至少一张有效照片。
- `repair_reviews` 和 `repair_timeline_events` 只追加；退回审核意见必填。
- 照片数据库只保存元数据与服务端 `storage_key`，文件不在 `public/` 下；照片访问继承维修记录可见性。
- 分类使用稳定 `code` 幂等 Seed。停用分类不能用于新提交，但历史引用保留。
- 默认业务查询排除 `repair_records.deleted_at IS NOT NULL` 和已软删除照片。
- 后续所有正式统计必须统一使用 `status = APPROVED AND deleted_at IS NULL`。查询条件的代码事实来源为
  `approvedRepairWhere()`；M2 分析入口 `listApprovedRepairsForAnalytics()` 与 M3 成员摘要均在其上追加范围条件。

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

## M3 成员资料契约

- 昵称 `nickname` 由成员自助维护，长度上限 64（`MEMBER_NICKNAME_MAX_LENGTH`），
  拒绝换行与控制字符；留空表示回退展示实名。
- `member_profiles.version` 是资料与技能共用的乐观锁：昵称更新与技能保存都必须提交当前版本，
  成功后版本递增；过期版本返回 `MEMBER_PROFILE_VERSION_CONFLICT`。
- 资料的字段可见性由 `ProfileVisibilityPolicy` 裁剪，分三档：

  | 视图 | 出现场景 | 含 QQ | 含学号/班级 | 含 `userId` |
  |---|---|---|---|---|
  | summary | 工作台、列表、公开响应 | 否 | 否 | 否 |
  | self | 仅 `GET /member/profile` | 是 | 是 | 否 |
  | internal | 仅 `GET /members/:id/profile` | 是 | 否 | 否 |

  因此 QQ、学号、班级只存在于受保护的单成员详情，绝不进入列表、统计或公开数据。
- 学生身份标识（学号、班级）当前由管理员维护，M3 不提供自助修改入口。

## M4 内部交流契约

- `repair_comments` 主体是维修记录 + 作者成员档案。`parent_comment_id` 为空表示根评论；
  回复一律挂到根评论（两层）。默认查询排除 `deleted_at IS NOT NULL`。
- `comment_mentions` 唯一约束 `(comment_id, mentioned_member_profile_id)`，同一评论对同一成员只记一次。
  提及对象必须是有效成员档案；QQ / 手机号 / `users.id` 不进入该表。
- `repair_favorites` 唯一约束 `(member_profile_id, repair_record_id)`。取消收藏只写
  `deleted_at`，再次收藏恢复同一行并刷新时间。并发下不会产生重复关联。
- `notifications` 收件人是 `member_profiles.id`。类型为 `MENTIONED` /
  `REPAIR_COMMENTED` / `REPAIR_APPROVED` / `REPAIR_REJECTED`；状态为 `UNREAD` / `READ`。
  删除走 `deleted_at`，状态保留。审核员可以没有成员档案（`actor_member_profile_id` 可空）。
- 业务外键一律 `ON DELETE RESTRICT`，指向 `member_profiles` / `repair_records` /
  `repair_comments`，不存联系方式。
- 评论与收藏可见性继承维修记录对象级权限；通知只能由收件人本人读取、标已读或软删除。

## M6 批次 2 管理端契约

- **技能标签库**（`skills`，M3 已建表，M6 批次 2 才开放写能力）：与故障分类同一策略 ——
  只停用 / 启用，**不做物理删除**。标签被 `user_skills` 引用，删行会让历史成员标签无声消失；
  停用后成员侧 `GET /api/v1/skills` 不再返回它，已有的关联仍然回显。
  `code` 是小写输入也统一大写的稳定机器码，创建后不可修改；重复 code 返回 409
  `SKILL_CODE_CONFLICT`（在入口查重，不让唯一键冲突冒泡成 500）。
- **评论管理**：`repair_comments` 的软删除语义与成员端**完全同一份实现**（写 `deleted_at`，
  正文保留供审计），只是不再要求操作者拥有有效成员档案。因此
  `repairCommentService.softDelete` 的成员档案解析改为**可空**：没有档案时 `isAuthor`
  恒为 false，必然走 `comment:delete`（仅 ADMIN）。管理端列表跨记录，使用独立权限
  `comment:moderate`，不复用成员也持有的 `comment:read`。
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
- **报名数据导出**：与维修导出共用列模型、CSV/XLSX 写入器与三条硬规则
  （筛选与列表同源、超限拒绝而非截断、导出必写审计），但**故意包含 QQ 与手机号明文**
  —— 招募要按联系方式联系人，而需求 §34 对维修导出的要求是只输出记录 ID 与照片链接。
  两条路径因此分开权限与审计动作：维修导出 `repair.exported`，报名导出
  `join.applications.exported`。
- **日期筛选口径**：所有面向界面的日期区间按 `Asia/Shanghai` 自然日解释，
  **结束日包含全天**（排他上界 = 次日 00:00），与学期统计区间同一套换算。
  `repairDateFrom/To` 例外：那一列是 `DATE`（本身就存上海自然日），不做时刻换算。
