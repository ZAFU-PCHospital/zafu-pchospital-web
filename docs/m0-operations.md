# M0 GreatSQL 运行与迁移

> 通用数据库操作、Migration、账户权限、测试与发布规范已统一到
> [`docs/database.md`](database.md)。本文件仅保留 M0 快速参考。

## 固定环境

本项目锁定 GreatSQL `8.0.32-27`、InnoDB、`utf8mb4_unicode_ci` 与 UTC。仓库提供
`compose.greatsql.yml`，本地端口为 3307，避免与已有 MySQL 冲突。
Prisma 7.10.0 要求 Node.js `^20.19 || ^22.12 || >=24.0`，`package.json` 已同步该下限。

```bash
docker compose -f compose.greatsql.yml up -d
   cp .env.example .env
pnpm db:migrate:deploy
pnpm db:seed
pnpm db:health
```

`.env.example` 只有占位符。开发、测试、预发布、生产必须使用独立数据库与独立 pepper。
应用运行账户只需要业务 DML 权限；Migration 使用独立部署账户。

## Migration

- 本地开发：`pnpm db:migrate:dev`
- CI / 预发布 / 生产：`pnpm db:migrate:deploy`
- 生成客户端：`pnpm db:generate`
- 幂等基础角色：`pnpm db:seed`

发布前备份并演练恢复。Migration 失败时停止部署，保留原应用版本，修复后新增前向
Migration；不得修改已执行的 Migration，也不承诺对破坏性 DDL 自动回滚。

M0 是项目第一个数据库版本，因此不存在 M0 前数据库 Schema 的数据升级；本次升级测试的
基线为空库。后续变更必须增加“上一 Migration → 最新 Migration”的带数据升级测试。
Schema、Migration 或公共 Contract 修改前必须分析所有消费者；影响其他模块时，必须在同一
变更中同步贯通实现、调用方、测试与文档，详细规则见 `docs/database.md`。

## 运行与健康检查

Phase 2 的完整生产形态是 `next build && next start`，需要 Node.js 服务端运行时，不能部署为
纯静态导出。默认 HTTP 端口为 3000；`GET /api/v1/health` 检查数据库可达性。
`public/handbook/` 仍由现有 mdBook 流程构建并保持同域静态路径。

进程收到终止信号后应停止接收流量并等待在途请求结束；平台在超时后终止进程。Prisma 客户端
在开发环境复用连接池；独立脚本必须在结束前调用 `$disconnect()`。
