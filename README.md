# 浙江农林大学电脑医院 · 社团综合服务平台

电脑医院社团的官方网站与内部服务平台，用于介绍社团、招募新成员、组织维修活动和管理维修记录。

目前已实现：

- **公开网站**：社团介绍、新社员登记、维修活动查询与报名、技术文档。
- **成员区**：QQ 号与密码登录、邀请码注册、个人资料、维修记录与照片、活动接待与签到、案例库、评论与收藏、通知、个人统计与排行榜。
- **管理后台**：成员与角色管理、招募审核、维修审核、活动管理、故障分类与技能标签、邀请码、评论管理、数据导出、审计日志和公开展示设置。

页面支持浅色与深色模式，并适配桌面和手机。

## 技术栈

Next.js 15（App Router）· React 19 · TypeScript · Tailwind CSS v4 · GreatSQL 8.0.32-27 · Prisma 7.10.0（MariaDB adapter）。使用 pnpm 管理依赖。

## 本地运行

准备 Node.js（`^20.19 || ^22.12 || >=24.0`）和 pnpm。pnpm 版本由 `package.json` 固定；未启用 Corepack 时先运行 `corepack enable`。

Windows 开发环境采用 **WSL 中的 Docker Engine + GreatSQL 容器**（支持 WSL 3.x，发行版使用 WSL 2 架构），应用与 pnpm 在 Windows 运行。先按 [Windows 数据库环境配置](docs/database-windows.md) 安装 WSL 与 Docker、配置国内下载源，再在项目根目录执行：

```powershell
.\tools\setup-greatsql-wsl.ps1
pnpm install
pnpm db:migrate:deploy
pnpm db:seed
pnpm db:health
pnpm dev
```

脚本使用独立的 `compose.greatsql.wsl.yml` 启动数据库、创建独立测试库，并在缺失时生成 `.env`（含随机密钥）和 `.env.test.local`；已有文件会保留。服务器使用的 `compose.greatsql.yml` 保持原样。重启 Windows 后运行 `.\tools\start-greatsql-wsl.ps1`。安装、测试库使用与排错见 [详细配置文档](docs/database-windows.md)。

打开 <http://localhost:3000>。已有 GreatSQL 实例或在 Linux 开发时，按 [数据库指南](docs/database.md) 配置 `DATABASE_URL`、密钥和数据库即可。

Seed 会初始化角色、故障分类和技能标签，不会创建默认账号。成员账号由管理员发放或通过邀请码注册；全新数据库的首个管理员需由维护者初始化。数据库配置与排错见 [数据库指南](docs/database.md)。

## 主要入口

| 路径                  | 用途                                                       |
| --------------------- | ---------------------------------------------------------- |
| `/`、`/about`         | 首页与社团介绍                                             |
| `/repair-activities`  | 维修活动查询与报名                                         |
| `/join`               | 新社员登记                                                 |
| `/docs`、`/handbook/` | 技术文档目录与正文                                         |
| `/login`              | 成员登录，可切换邀请码注册                                 |
| `/member`             | 成员工作台，包含维修、活动、案例、通知、统计与个人资料入口 |

## 常用命令

| 命令              | 用途                                                       |
| ----------------- | ---------------------------------------------------------- |
| `pnpm dev`        | 本地开发                                                   |
| `pnpm lint`       | ESLint 与主题调色板校验                                    |
| `pnpm test`       | 单元与契约测试                                             |
| `pnpm test:db`    | GreatSQL 集成测试，必须连接库名以 `_test` 结尾的独立测试库 |
| `pnpm build`      | 完整生产构建，包含技术文档                                 |
| `pnpm start`      | 启动已构建的生产服务                                       |
| `pnpm docs:build` | 单独构建技术文档                                           |
| `pnpm build:site` | 跳过文档构建，仅用于官网快速自检                           |

技术文档来自独立的 [ZAFU-PCHospital-Doc](https://github.com/ZAFU-PCHospital/ZAFU-PCHospital-Doc) 仓库，由 mdBook 生成。完整构建需要安装 mdBook，缺少文档源码时会自动克隆到 `.docs-source/`。只运行 `pnpm dev` 不会生成文档正文；本地查看 `/handbook/` 前需执行 `pnpm docs:build`。配置细节见 [工程手册第 7 节](AGENTS.md#7-站内文档构建 handbook)。

部署使用 `pnpm build` 和 `pnpm start`，需要 Node.js 服务端与 GreatSQL；上传照片的存储目录需要持久化。

## 参与开发

从最新 `main` 创建工作分支，通过 Pull Request 提交改动。提交前运行 `pnpm lint`、`pnpm test` 和 `pnpm build`；涉及数据库时还需验证迁移并在独立测试库运行集成测试

- [设计系统](docs/design-system.md)：页面样式与公共组件
- [项目架构](docs/architecture.md)：目录职责与代码组织
- [数据库指南](docs/database.md)与[数据 / API 契约](docs/contracts/)：数据开发与运行规范
- [第二期需求](docs/第二期需求分析文档.md)与[模块开发计划](docs/phase2-development.md)：业务范围和模块划分
- [协作流程](docs/git-workflow.md)：分支、提交与 PR 规范
- [工程手册](AGENTS.md)：环境、验证、文档构建与 CI 的详细说明，也是 AI Agent 的项目规则
