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
- `AUTH_SECRET`：会话/鉴权预留密钥，至少 32 个随机字节。
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

`pnpm db:health` 应确认数据库可达、GreatSQL 版本、InnoDB、UTC、`utf8mb4` 和排序规则。

## 8. 发布、备份与遗留治理

Phase 2 完整部署必须运行 `pnpm build && pnpm start`，浏览器不能直连 GreatSQL。部署顺序为：
备份与恢复点确认 → `pnpm db:migrate:deploy` → 应用发布 → `/api/v1/health` 与关键接口冒烟。

尚未纳入 M0 的治理项：

- [#22 多实例共享限流](https://github.com/ZAFU-PCHospital/zafu-pchospital-web/issues/22)
- [#23 招募批次生命周期](https://github.com/ZAFU-PCHospital/zafu-pchospital-web/issues/23)
- [#24 数据保留、删除与匿名化](https://github.com/ZAFU-PCHospital/zafu-pchospital-web/issues/24)
- [#25 PII 权限、脱敏与导出审计](https://github.com/ZAFU-PCHospital/zafu-pchospital-web/issues/25)
