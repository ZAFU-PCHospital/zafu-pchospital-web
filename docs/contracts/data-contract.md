# Phase 2 M0 数据契约

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
