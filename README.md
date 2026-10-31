<p align="center">
  <a href="https://pczafu.cn/"><img src="public/icon.png" width="88" height="88" alt="浙江农林大学电脑医院标志" /></a>
</p>

<h1 align="center">浙江农林大学电脑医院 · 官方网站与社团综合服务平台</h1>

<p align="center">让志愿维修、活动组织与社团协作更有序</p>

<p align="center"><strong>简体中文</strong> · <a href="README.en.md">English</a></p>

<p align="center">
  <a href="https://github.com/ZAFU-PCHospital/zafu-pchospital-web/actions/workflows/ci.yml"><img src="https://github.com/ZAFU-PCHospital/zafu-pchospital-web/actions/workflows/ci.yml/badge.svg" alt="CI 校验与构建" /></a>
  <a href="https://nextjs.org/"><img src="https://img.shields.io/badge/Next.js-15.5.28-171717?logo=nextdotjs&amp;logoColor=white" alt="Next.js 15.5.28" /></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-19-149eca?logo=react&amp;logoColor=white" alt="React 19" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&amp;logoColor=white" alt="TypeScript strict" /></a>
  <a href="https://tailwindcss.com/"><img src="https://img.shields.io/badge/Tailwind_CSS-4-0f7490?logo=tailwindcss&amp;logoColor=white" alt="Tailwind CSS 4" /></a>
  <a href="https://www.prisma.io/"><img src="https://img.shields.io/badge/Prisma-7.10.1-2d3748?logo=prisma&amp;logoColor=white" alt="Prisma 7.10.1" /></a>
  <a href="https://greatsql.cn/"><img src="https://img.shields.io/badge/GreatSQL-8.0.32--27-276b60" alt="GreatSQL 8.0.32-27" /></a>
  <a href="https://pnpm.io/"><img src="https://img.shields.io/badge/pnpm-12.4.1-f69220?logo=pnpm&amp;logoColor=white" alt="pnpm 12.4.1" /></a>
</p>

<p align="center">
  <a href="https://pczafu.cn/">访问官网</a> ·
  <a href="https://pczafu.cn/repair-activities">维修活动</a> ·
  <a href="https://pczafu.cn/docs">技术文档</a> ·
  <a href="#快速开始">本地运行</a> ·
  <a href="CONTRIBUTING.md">参与贡献</a>
</p>

## 平台提供什么

电脑医院面向全校师生提供志愿计算机技术服务。本项目把社团介绍、活动报名与内部工作收进同一个平台：桌面与手机都能正常使用，并支持浅色 / 深色模式。

| 使用者 | 主要功能                                                                                                                         |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 公众   | 社团介绍、新社员登记、维修活动查询与报名、面向师生的技术文档                                                                     |
| 成员   | QQ 账号登录、邀请码注册、邮箱管理与密码找回；维修记录与照片、活动出勤与接待、案例库与收藏、通知、个人统计与排行榜                |
| 管理员 | 成员与角色管理、招募与维修审核、活动与出勤签到管理、故障分类与技能标签、邀请码、列表筛选与排序、数据导出、审计日志与公开展示设置 |

## 界面预览

<a href="https://pczafu.cn/">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/01-home-desktop-dark.png" />
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/01-home-desktop-normal.png" />
    <img src="docs/assets/01-home-desktop-normal.png" alt="电脑医院官网首页预览" width="1440" />
  </picture>
</a>

以下为归档的首页截图，线上界面可能已经更新；点击图片可直接访问官网。

## 快速开始

### 环境要求

- **Node.js**：`^20.19 || ^22.12 || >=24.0`，以 [package.json](package.json) 的 `engines` 为准。
- **pnpm**：使用 `packageManager` 固定的版本（当前 `12.4.1`）；Corepack 至少为 `0.34.5`，版本检查与升级见[环境配置](docs/database-windows.md#31-corepack-兼容要求)。
- **GreatSQL 8.0.32-27**：Windows 推荐 WSL 中的 Docker Engine；其他环境见[数据库指南](docs/database.md)。

### Windows 本地运行

先按 [Windows 环境指南](docs/database-windows.md) 准备 WSL 与 Docker，再在 **Windows PowerShell** 执行：

```powershell
git clone https://github.com/ZAFU-PCHospital/zafu-pchospital-web.git
cd zafu-pchospital-web
corepack --version   # 至少 0.34.5；低于此版本时先按环境指南升级
corepack enable pnpm
corepack pnpm --version   # 当前应为 12.4.1
pnpm --version           # 应与上一条一致；不一致时先按下方排错
.\tools\setup-greatsql-wsl.ps1
pnpm install
pnpm db:migrate:deploy
pnpm db:seed
pnpm db:health
pnpm dev
```

打开 <http://localhost:3000>。配置脚本只在文件缺失时生成本地 `.env` 与独立测试库配置，已有文件一律保留；执行任何数据库命令前，先确认当前 `DATABASE_URL` 指向本地目标库。

若提示找不到 `pnpm.cjs`，或 `pnpm` 与 `corepack pnpm` 的版本不同，先按 [Corepack 排错](docs/database-windows.md#33-corepack-排错)处理版本、旧缓存与 PATH，不要改锁文件。

已有可用的 GreatSQL 实例，或在 Linux / macOS 上开发时，先按[数据库指南](docs/database.md)准备数据库与 `.env`，再从 `pnpm install` 开始执行。

**首次使用请留意：**

- Seed 只初始化角色、故障分类与技能标签，**不会创建默认登录账号**；全新本地库的首个管理员需由维护者协助初始化。
- 重启 Windows 后，先运行 `.\tools\start-greatsql-wsl.ps1` 恢复数据库环境，再启动应用。
- `pnpm dev` 不需要 mdBook，但也不会生成技术文档正文；要查看本地 `/handbook/` 或执行完整 `pnpm build`，需先安装 mdBook，详见 [AGENTS.md](AGENTS.md) 第 7 节。

<details>
<summary>常用命令</summary>

| 命令              | 用途                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `pnpm dev`        | 本地开发                                                                                         |
| `pnpm test`       | 单元与契约测试；默认跳过数据库集成测试                                                           |
| `pnpm lint`       | ESLint 与官网 / 文档站调色板一致性检查                                                           |
| `pnpm audit`      | 检查锁文件中的已知依赖漏洞；处理方式见 [AGENTS.md 第 11 节](AGENTS.md#11-ci-与部署)              |
| `pnpm build`      | 完整构建，包含 mdBook 技术文档                                                                   |
| `pnpm docs:build` | 单独生成技术文档                                                                                 |
| `pnpm build:site` | 只编译官网，用于快速自检；不用于部署                                                             |
| `pnpm test:db`    | 仅连接独立 `_test` 库，串行运行集成测试；先阅读[切库步骤](docs/database-windows.md#4-独立测试库) |

</details>

## 第一次贡献

文档、文案、界面与范围明确的小问题都欢迎贡献。建议从一个范围清楚的 Issue 开始：

**确认问题 → Fork / 建分支 → 本地修改 → 按影响验证 → 提交 PR**

[新人贡献指南](CONTRIBUTING.md)给出完整操作步骤、目录说明、测试库用法与 PR 检查清单。纯文档改动只需检查格式、链接与规则一致性；涉及交互、接口或数据时按影响补验证，完整工程检查由 CI 统一协调，避免重复运行。

## 文档导航

完整目录与历史文档的查阅方式见 [维护文档目录](docs/README.md)。

| 想了解什么                           | 从这里开始                                                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| 项目环境、命令、验证、CI             | [工程手册 AGENTS.md](AGENTS.md)                                                                                 |
| 页面布局、主题与组件复用             | [设计系统](docs/design-system.md)                                                                               |
| 目录职责与 Service / Repository 边界 | [项目架构](docs/architecture.md)                                                                                |
| 本地数据库、迁移与测试隔离           | [数据库指南](docs/database.md) · [Windows 环境](docs/database-windows.md)                                       |
| API、数据与跨模块约定                | [公共契约](docs/contracts/)                                                                                     |
| 分支、提交与 PR 协作                 | [Git 工作流](docs/git-workflow.md)                                                                              |
| 面向师生的维修技术资料               | [在线技术文档](https://pczafu.cn/docs) · [文档源码仓库](https://github.com/ZAFU-PCHospital/ZAFU-PCHospital-Doc) |

## 部署与维护

CI 只做校验、构建与冒烟，不执行部署；CI 通过不代表已发布。

依赖声明与实际解析版本分别以 [package.json](package.json) 和 [pnpm-lock.yaml](pnpm-lock.yaml) 为准；安全升级与传递依赖覆盖的维护约定见 [AGENTS.md 第 11 节](AGENTS.md#11-ci-与部署)。

发布只能由获授权的维护者执行：以 [deploy skill](.agents/skills/zafu-pchospital-deploy/SKILL.md) 为操作手册、[`tools/deploy/deploy-prod.sh`](tools/deploy/deploy-prod.sh) 为唯一入口，完成本地构建、备份、上传、原子切换与冒烟验证。生产运行需要 Node.js 服务端、GreatSQL 与可持久化的照片存储目录。

参数、各阶段闸门与恢复方式见部署手册；通知配置见[部署结果通知](tools/deploy/NOTIFICATIONS.md)。

## 问题与建议

请先搜索[已有 Issue](https://github.com/ZAFU-PCHospital/zafu-pchospital-web/issues)，确认是否已有人提出。反馈问题时请附上复现步骤、预期表现与实际表现；截图和日志需去除账号凭据与个人资料。

## 许可证

版权所有 © 浙江农林大学电脑医院

本项目代码以 GNU Affero General Public License v3.0 或任何后续版本（[AGPL-3.0-or-later](LICENSE)）授权。

如果你修改本项目并通过网络向他人提供服务，需要按许可证要求，向通过网络与该版本交互的用户提供获取该版本完整对应源码的途径。

社团名称、Logo、校名校徽等标识不在此许可范围内，未经许可不得用于其他用途。字体、图片等非代码素材也不纳入本项目代码许可证，使用时须遵守各自的授权条件。第三方依赖保留各自的许可证。

`.env`、数据库内容、维修照片和成员资料属于运行数据，不随仓库开源。
