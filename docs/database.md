# Database

> 本文件是 Phase 2 数据库运行、Migration 与发布流程的事实来源。数据语义见
> `docs/contracts/data-contract.md`，M0 验收记录见 `docs/M0-交付报告.md`。

## 1. 固定基线

| 项目              | 固定值                                                     |
| ----------------- | ---------------------------------------------------------- |
| 数据库            | GreatSQL `8.0.32-27`（镜像 `greatsql/greatsql:8.0.32-27`） |
| 存储引擎          | InnoDB                                                     |
| 字符集 / 排序规则 | `utf8mb4` / `utf8mb4_unicode_ci`                           |
| 时区 / 时间精度   | 服务与应用会话均为 UTC；`DATETIME(3)`                      |
| ORM               | Prisma `7.10.0` + MariaDB driver adapter `7.10.0`          |
| 核心 ID           | 应用层 UUID，数据库 `CHAR(36)`                             |

不得擅自更换数据库、ORM、字符集或时区。QQ、手机号、学号不是 User 本体或业务主键；
统一账户主键是 `users.id`。

## 2. 本地启动

Prisma 7.10.0 要求 Node.js `^20.19 || ^22.12 || >=24.0`。安装依赖后，在 PowerShell 执行：

```powershell
Copy-Item .env.example .env
docker compose -f compose.greatsql.yml up -d
pnpm db:migrate:deploy
pnpm db:seed
pnpm db:health
```

Compose 默认把容器 3306 映射到本机 3307，并创建持久卷 `greatsql-data`。示例凭据只允许
本地使用；`.env` 不得提交。查看状态：

```powershell
docker compose -f compose.greatsql.yml ps
docker compose -f compose.greatsql.yml logs greatsql
```

停止容器使用 `docker compose -f compose.greatsql.yml stop`。除非明确要丢弃本地全部数据库
数据，不要删除 volume。

## 3. 环境变量与账户

`.env.example` 只包含可提交的名称、格式和占位值。开发、测试、预发布、生产必须使用独立
数据库、凭据、`AUTH_SECRET` 和 pepper。浏览器端不得暴露这些变量。

- `DATABASE_URL`：Prisma CLI 与服务端连接串。
- `AUTH_SECRET`：Session 令牌 HMAC 密钥，至少 32 个随机字节；轮换会使现有登录失效。
- `INVITE_CODE_PEPPER`：邀请码 HMAC pepper；轮换前必须设计兼容方案。
- `PII_AUDIT_PEPPER`：IP、User-Agent 等审计摘要 pepper。
- `RECRUITMENT_CYCLE`：M0 服务端权威招募批次；生命周期产品化见 Issue #23。

生产环境至少分离应用 DML 账户和 Migration 部署账户。应用账户不授予 DDL、用户管理或
全局权限；Migration 账户只在部署窗口使用。连接串通过部署平台 Secret 注入。

## 4. Migration 工作流

```powershell
pnpm db:generate          # Schema 变化后生成客户端
pnpm db:migrate:dev       # 仅本地开发：创建并应用新 Migration
pnpm db:migrate:deploy    # CI / 预发布 / 生产：只应用已有 Migration
pnpm db:seed              # 幂等写入 MEMBER / ADMIN 基础角色
```

禁止 `prisma db push`、手工生产 DDL 和修改已提交或已执行的 Migration。发布前备份并验证恢复；
Migration 失败时停止部署并保留旧应用版本，修复必须新增前向 Migration，不承诺自动回滚
破坏性 DDL。

M0 的升级基线是空库。后续数据库变更除空库部署外，还必须验证“上一版本 Migration + 代表性
数据 → 最新版本”的升级路径，以及重复执行 `pnpm db:migrate:deploy` 无待处理项。

## 5. 公共契约与影响贯通

高冲突文件包括：

- `prisma/schema.prisma` 与 `prisma/migrations/`
- `src/types/contracts.ts`、`src/lib/api/errors.ts`
- `docs/contracts/`、权限枚举、API 信封和跨模块 Service 接口

这些修改不强制单独评审，但提交前必须用 `rg` 找出所有消费者并在 PR 中记录影响范围。
如影响其他模块，必须在同一变更中同步贯通 Schema、前向 Migration、生成客户端、Service、
Route、调用方、Contract、测试与文档；不能留下字段、Enum、错误码或 API 语义不一致。

## 6. 关键事务不变量

- 邀请码允许同一码复用到 `maxUses`；管理员只管理 `activeFrom`、`expiresAt`、`maxUses`。
- `usedCount` 不接受管理输入，只能在兑换事务锁行后原子累计。
- 邀请码兑换把 User、MemberProfile、UserRole、Redemption、Provision、AuditLog 和计数放在
  同一事务中，任一步失败全部回滚。
- AccountProvision 同时以 `idempotencyKey` 和 `(sourceType, sourceId)` 防止重复发放。
- JoinApplication 以服务端招募批次 + 规范化 QQ / 手机号去重，不先创建 User。
- AuthSession 只存令牌摘要；LoginThrottle 只存 QQ + IP 摘要，登录失败窗口由数据库共享。
- 改密、密码重置和成员禁用必须在事务内撤销相关有效 Session。
- 成员资料更新与技能保存各自在 Serializable 事务内「读写版本 + 递增版本 + 写审计」，
  乐观锁失败重试至多 3 次；审计与业务行同事务提交或一同回滚。
- `user_skills` 的取消选择只写 `deleted_at`，不删行；恢复时清空 `deleted_at`。
  唯一约束 `(member_profile_id, skill_id)` 保证并发下不会产生重复关联。
- 评论删除、通知删除、收藏取消一律写 `deleted_at`，默认查询排除已删除行。
- `repair_favorites` 再次收藏恢复同一行并刷新 `created_at` / `updated_at`；
  唯一约束 `(member_profile_id, repair_record_id)` 保证并发下不会产生重复关联。
- 通知软删除不改 `status` / `read_at`。评论创建、删除与收藏增减与 `AuditLog` 同事务。
- 公开内容与展示策略是**单行配置**（`public_content_settings`，主键固定为 `public-content`），
  写入走 upsert 而不是 insert；表里没有行时按契约默认值（全部关闭 + 仅昵称）处理，
  读不到配置**不等于**可以公开。

M3 引入 `skills` 与 `user_skills` 两张表（Migration `20260917100000_p2_m3_member_dashboard`）。
两者都不含 QQ 或任何联系方式，成员侧的引用键始终是 `member_profiles.id`。

M4 引入 `repair_comments`、`comment_mentions`、`repair_favorites`、`notifications`
（Migration `20260918120000_p2_m4_community`）。四张表均为 InnoDB、`utf8mb4_unicode_ci`，
外键指向 `member_profiles` / `repair_records` / `repair_comments`，`ON DELETE RESTRICT`，
不含 QQ、手机号或学号。

M6 批次 2 引入 `public_content_settings`
（Migration `20260923100000_p2_m6_public_content_settings`）：InnoDB、`utf8mb4_unicode_ci`，
主键 `id CHAR(32)` 本身就是单行约束；`ranking_display_name` 带 CHECK 约束，只允许
`REAL_NAME` / `NICKNAME` / `HIDDEN`；`updated_by_user_id` 指向 `users`，`ON DELETE RESTRICT`，
用于回答「这份对外策略是谁在什么时候改的」。该表**不含**任何成员联系方式，
也不挂 `member_profiles` / `repair_records` 外键 —— 它是全局策略，不属于任何成员或记录。
M6 批次 2 的其余能力（技能标签库 CRUD、评论管理、邀请码列表、审计查询、报名导出）
全部建立在既有表上，没有新增表或列。

完整字段与状态语义见 `docs/contracts/data-contract.md`。

## 7. 检查与测试

```powershell
pnpm db:health
pnpm test
pnpm test:db
pnpm lint
pnpm build
```

`pnpm test` 默认运行单元与 Contract 测试并跳过真实数据库用例；`pnpm test:db` 必须连接
专用测试 GreatSQL，覆盖 Seed 幂等、招募去重、账号发放幂等、邀请码并发限次和管理员更新
边界。也可在 PowerShell 用 `$env:RUN_DB_TESTS='1'; pnpm test` 一次运行全部测试。

`pnpm db:health` 应确认数据库可达、**产品确为 GreatSQL**、版本严格属于 `8.0.32-27` 基线、InnoDB、
UTC、`utf8mb4` 和排序规则。脚本同时校验 `@@version` 与 `@@version_comment`：GreatSQL 的
`version_comment` 形如 `GreatSQL (GPL), Release 27, Revision ...`，`version` 形如 `8.0.32-27`
（允许其后的 `-` / `+` 构建元数据后缀）。两项必须同时匹配；版本串不能代替产品注释。
本地若用其它 MySQL 兼容实例替代，该命令会**明确失败**，
不要把这类实例记为「GreatSQL 已验证」。

连接串中的 `allowPublicKeyRetrieval` **默认关闭**。仅当 MySQL 8+/9 使用
`caching_sha2_password` 且**未启用 TLS** 时（典型为本机开发），才需要显式追加
`?allowPublicKeyRetrieval=true`；否则非 TLS 首次认证会报
`SQLState 08S01 "RSA public key is not available client side"`，在应用层表现为
`pool timeout: ... active=0 idle=0`，看着像连接池耗尽、实为握手失败。
该开关会让客户端接受服务端下发的 RSA 公钥，开启后存在中间人替换公钥的风险，
因此**生产必须改用 TLS，而不是打开它**。

## 8. 发布、备份与遗留治理

Phase 2 完整部署必须运行 `pnpm build && pnpm start`，浏览器不能直连 GreatSQL。部署顺序为：
备份与恢复点确认 → `pnpm db:migrate:deploy` → 应用发布 → `/api/v1/health` 与关键接口冒烟。

尚未纳入 M0 的治理项：

- [#22 多实例共享限流](https://github.com/ZAFU-PCHospital/zafu-pchospital-web/issues/22)
- [#23 招募批次生命周期](https://github.com/ZAFU-PCHospital/zafu-pchospital-web/issues/23)
- [#24 数据保留、删除与匿名化](https://github.com/ZAFU-PCHospital/zafu-pchospital-web/issues/24)
- [#25 PII 权限、脱敏与导出审计](https://github.com/ZAFU-PCHospital/zafu-pchospital-web/issues/25)
