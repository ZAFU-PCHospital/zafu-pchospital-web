# Database

> 本文件是 Phase 2 数据库运行、Migration 与发布流程的事实来源。数据语义见
> `docs/contracts/data-contract.md`；历史验收记录通过 Git 历史查阅，入口见 [文档目录](README.md)。

## 1. 固定基线

| 项目               | 固定值                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| 数据库             | GreatSQL `8.0.32-27`（国内镜像 `registry.cn-beijing.aliyuncs.com/greatsql/greatsql:8.0.32-27`） |
| 存储引擎           | InnoDB                                                                                          |
| 字符集 / 排序规则  | `utf8mb4` / `utf8mb4_unicode_ci`                                                                |
| 时区 / 时间精度    | 服务与应用会话均为 UTC；`DATETIME(3)`                                                           |
| ORM                | Prisma `7.10.1` + MariaDB driver adapter `7.10.1`                                               |
| Node.js 数据库驱动 | MariaDB Connector/Node.js `3.5.4`（项目直接依赖与 adapter 使用同一版本）                        |
| 核心 ID            | 应用层 UUID，数据库 `CHAR(36)`                                                                  |

不得擅自更换数据库、ORM、字符集或时区。QQ、手机号、学号不是 User 本体或业务主键；
统一账户主键是 `users.id`。

## 2. 本地启动

Windows 推荐在 WSL 中运行 Docker Engine，使用独立的 `compose.greatsql.wsl.yml`；
配置脚本、首次安装和注意事项见 [Windows 数据库环境配置](database-windows.md)。
`compose.greatsql.yml` 保持既有部署内容，本地 WSL 脚本不使用它。
以下命令保留给使用原文件的环境；Prisma 7.10.1 要求 Node.js `^20.19 || ^22.12 || >=24.0`。

已有旧容器若挂载到 `/var/lib/mysql`，先按 [旧挂载处理](database-windows.md#6-旧环境的数据挂载处理)
备份与迁移，再执行下面的 `up`；直接重建可能丢失容器可写层中的数据。

```powershell
Copy-Item .env.example .env
docker compose -f compose.greatsql.yml up -d --wait
pnpm db:migrate:deploy
pnpm db:seed
pnpm db:health
```

原 Compose 保留端口 `3307:3306` 和卷挂载 `/var/lib/mysql`，WSL 专用文件则绑定
`127.0.0.1:3307` 并挂载镜像实际的数据目录 `/data/GreatSQL`。服务器若需调整挂载，
必须另行核对现有数据目录、备份与恢复，不随本地环境配置一起修改。
示例凭据只允许本地使用；`.env` 不得提交。查看状态：

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
- 通知删除、收藏取消写 `deleted_at`，默认查询排除已删除行；评论已统一退役，历史删除标记保留。
- `repair_favorites` 再次收藏恢复同一行并刷新 `created_at` / `updated_at`；
  唯一约束 `(member_profile_id, repair_record_id)` 保证并发下不会产生重复关联。
- 通知软删除不改 `status` / `read_at`。收藏增减与 `AuditLog` 同事务；审核通知仍与审核同事务写入。
- 公开内容与展示策略是**单行配置**（`public_content_settings`，主键固定为 `public-content`），
  写入走 upsert 而不是 insert；表里没有行时按契约默认值（全部关闭 + 仅昵称）处理，
  读不到配置**不等于**可以公开。
- 邮箱验证码挑战与重置授权只存摘要（挑战码绑定 userId / 用途 / 邮箱的上下文 HMAC，
  授权令牌独立 HMAC），明文只在签发返回值出现一次。重发会先把旧的
  `PENDING / ACTIVE` 挑战置为 `INVALIDATED`（含目标地址变化）；发送结果回写只在
  挑战仍为 `PENDING` 且未过期时激活它 —— 迟到的 SMTP 结果不会复活被替代的挑战。
- 邮箱限流 / 预算计数全部持久化在 `email_security_counters`：桶键是不可逆摘要，
  计数在行锁事务内「先持久化再返回失败」；发送前的预占（冷却 / 每日 / 预算）在
  同一事务内按固定键序取锁，任一桶超限整笔回滚、不消耗任何额度。
  验证失败计数用独立提交的事务写入，不随调用方事务回滚。

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
M6 批次 2 的其余能力（技能标签库 CRUD、原评论管理、邀请码列表、审计查询、报名导出）
全部建立在既有表上，没有新增表或列。

活动模块引入 `repair_activities` / `repair_activity_registrations` /
`repair_activity_attendances` 三张表（Migration `20260925100000_repair_activities`）。
此后两次加列都是**可空前向迁移**，都不用默认值伪造历史数据：

- `20260927120000_repair_activity_registration_consent`：报名表加 `consent_version` /
  `consent_accepted_at`（issue #62）。迁移之前的报名没有签署动作，保持 `NULL`。
- `20260928120000_repair_activity_device_model`：报名表与 `repair_records` 各加一列
  `device_model VARCHAR(60) NULL`（issue #68）。报名时选填，接待落单时复制进维修记录；
  历史报名与手工建单没有这个信息。不建外键、不建索引 —— 它只用于展示。
- `20261008000000_repair_record_owner`：`repair_records` 加 `owner_name VARCHAR(40) NULL` 与
  `owner_phone VARCHAR(11) NULL`（issue #79 第 6 项）。接待落单自动带自报名，手工建单由成员
  填写；历史记录不回填，保持 `NULL`（旧数据没有该信息）。不建外键；可见性收口在视图层
  （`ownerPhone` 仅归属人与 `repair:review` 可读），详见 `docs/contracts/data-contract.md`。
- `20261016000000_join_application_student_fields`：`join_applications` 加
  `student_id VARCHAR(32) NULL` 与 `class_name VARCHAR(80) NULL`（issue #147），
  字段名与长度和 `member_profiles` 同名列一致。历史报名保持 `NULL`、不批量回填，
  新版应用层保证必填；不建索引与唯一约束，学号也不进入 `user_identities`。
- `20261016120000_password_credential_temporary`：`password_credentials` 加
  `temporary_expires_at DATETIME(3) NULL`、`temporary_consumed_at DATETIME(3) NULL`
  与 `credential_version INT NOT NULL DEFAULT 0`（issue #113）。历史凭据保持
  `NULL` / `0`、不批量回填：是否临时凭据**只由 `temporary_expires_at` 非空判定**，
  历史初始密码（QQ 后六位）不被误认为有过期时间。`credential_version` 用于
  「验密 → 建 Session / 改密」之间的代次复核，每次重置与改密递增；
  不建索引与唯一约束。
- `20261016140000_email_security_infrastructure`：邮箱验证与重置授权基础设施
  （issue #146，任务 3 基础设施）。`user_identities` 加 `active_email_key VARCHAR(80) NULL`
  与唯一索引：只有 `type = 'EMAIL'` 的行能写该键（手写 CHECK 约束保证），值为
  `email:{userId}` —— 「一名用户至多一个有效邮箱」由数据库兜底，软删除时置空释放槽位；
  「一个规范化邮箱全局只归属一个用户」继续由既有 `(type, identifier_normalized)` 唯一保证；
  历史行保持 `NULL`。同批新增三张表，均为 InnoDB、`utf8mb4_unicode_ci`，外键
  `ON DELETE RESTRICT`：`email_challenges`（验证码只存上下文绑定的 HMAC 摘要，不存明文）、
  `email_security_counters`（限流 / 预算计数，桶键不可逆摘要为主键，行锁串行化）、
  `password_reset_authorizations`（重置授权只存令牌摘要，一次性消费）。
  三张表都不含明文验证码、令牌或原始邮箱 / IP。

完整字段与状态语义见 `docs/contracts/data-contract.md`。

## 7. 检查与测试

成员部门（issue #171）迁移 `20261020000000_member_department` 新增成员非空部门
（默认 `REPAIR`）与报名可空录取部门，两列均以 CHECK 限定 `REPAIR / PUBLICITY / OFFICE`。
存量成员归维修部，历史报名保持 NULL；不新增表或权限。后续
`20261023000000_member_department_index` 为成员部门列补索引（issue #210 列级筛选）。
发布需先部署迁移再启用新版应用。

```powershell
pnpm db:health
pnpm test
pnpm test:db
pnpm lint
pnpm build
```

`pnpm test` 默认运行单元与 Contract 测试并跳过真实数据库用例；`pnpm test:db` 必须先将
`DATABASE_URL` 指向库名以 `_test` 结尾的专用测试 GreatSQL，覆盖 Seed 幂等、招募去重、
账号发放幂等、邀请码并发限次和管理员更新边界。上面的 `pnpm test:db` 不能直接沿用
`.env` 中的开发库；Windows 的切库与恢复命令见 [独立测试库](database-windows.md#4-独立测试库)。
也可在指定测试库后用 `$env:RUN_DB_TESTS='1'; pnpm test` 一次运行全部测试。不要并发运行多轮集成测试。

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

## 邮箱协助与临时豁免（任务 4）

`20261016150000_email_binding_support` 追加 email_assistances / email_exemptions；仅新增表与 userId / 有效性索引、User RESTRICT 外键，不触碰历史身份 / 凭据 / 验证时间，不需要回填。字段与事务见 [数据契约](contracts/data-contract.md#邮箱管理状态refs-146--refs-113)。部署沿用版本化 migrate deploy；运行时不需要调度系统。绑定成功原子作废既有豁免；单独管理豁免不改任何 Session、密码或邮箱，且不依赖 SMTP。本阶段不接全员邮箱门禁。

## 评论退役与历史兼容（issue #198）

评论 / 回复 / 提及及后台管理已下线；通知所有查询和单条 / 全部已读 / 删除操作仅开放 `REPAIR_APPROVED`、`REPAIR_REJECTED`。历史 `MENTIONED` / `REPAIR_COMMENTED` 行保留，不计入分页、未读数或工作台摘要，也不被全读改写。

本轮不修改 Schema / Migration，不清理历史数据。`repair_comments`、`comment_mentions`、`notifications.comment_id` 及 RESTRICT 关联继续存在；#195 的目标接待草稿撤销仍按通知 → 提及 → 回复 → 根评论等原顺序处理历史关联，不扩大清理范围。历史评论审计照常可读。
