# 参与贡献

**简体中文** · [English](CONTRIBUTING.en.md) · [返回项目首页](README.md)

欢迎帮助电脑医院改进文档、界面与服务流程。这份指南带你完成第一次贡献；详细工程规则以 [AGENTS.md](AGENTS.md) 为准，分支与提交约定见 [Git 工作流](docs/git-workflow.md)。

## 1. 选一个范围清楚的问题

先搜索 [Issue](https://github.com/ZAFU-PCHospital/zafu-pchospital-web/issues) 和 [PR](https://github.com/ZAFU-PCHospital/zafu-pchospital-web/pulls)，避免重复工作。首次贡献可以从文案、文档、可复现的小问题开始；涉及业务流程、权限或个人资料时，先与维护者对齐范围和验收。

一个 PR 聚焦一个任务。开始前先读本文件、[工程手册](AGENTS.md)和[设计系统](docs/design-system.md)；服务端与数据改动还要阅读架构、数据库和对应公共契约。

## 2. Fork 并建立工作分支

在 GitHub 点击 **Fork**，把下面的 `YOUR_GITHUB_NAME` 替换成你的账号：

```bash
git clone https://github.com/YOUR_GITHUB_NAME/zafu-pchospital-web.git
cd zafu-pchospital-web
git remote add upstream https://github.com/ZAFU-PCHospital/zafu-pchospital-web.git
git fetch upstream main
git switch -c docs/short-description upstream/main
```

把示例分支名换成你的任务，例如 `fix/activity-message` 或 `feat/member-filter`。每次开始前运行 `git status`；已有改动先妥善保留，不要用 reset / clean 清空工作区，也不要直接在 `main` 上开发或推送。

## 3. 准备本地环境

Node.js 与 pnpm 版本以 [package.json](package.json) 为准，使用 pnpm 和现有锁文件。

- **Windows**：按 [WSL + Docker + GreatSQL 指南](docs/database-windows.md) 准备环境，然后执行 [README 的启动步骤](README.md#快速开始)。仓库已克隆，无需再次执行 clone / cd。
- **已有数据库或其他系统**：按[数据库指南](docs/database.md)配置本地 GreatSQL 和 `.env`，再安装依赖、应用 Migration、Seed、检查数据库并启动开发服务。
- **重启 Windows 后**：在仓库根目录执行 `.\tools\start-greatsql-wsl.ps1`，然后 `pnpm dev`。

环境文件只留在本机；进程中的 `DATABASE_URL` 会覆盖 `.env`，执行迁移前确认实际指向。不要使用生产数据库或生产凭据进行开发与验证。

### 第一次登录

Seed 只创建角色、分类和技能，**没有默认账号或通用初始密码**。全新本地库请联系维护者协助初始化首个管理员，再通过现有账号发放或邀请码流程准备本地账号。

### 本地技术文档

`pnpm install` 会在缺失时补一份文档占位清单，因此可以先运行 `pnpm dev` 开发页面。

要查看真实 `/handbook/` 或执行完整 `pnpm build`，需安装 mdBook；文档源码来自独立的 [ZAFU-PCHospital-Doc](https://github.com/ZAFU-PCHospital/ZAFU-PCHospital-Doc)，构建时缺失会自动克隆。国内网络下载、已有源码路径和离线配置见 [AGENTS.md](AGENTS.md) 第 7 节及 Windows 环境指南。

`src/data/doc-manifest.json` 与 `public/handbook/` 都是生成物，不手改、不提交。`pnpm build:site` 可用于官网快速自检，不能代替完整发布构建。

## 4. 找到该修改的位置

| 目录                     | 职责                             |
| ------------------------ | -------------------------------- |
| `src/app/`               | 路由、页面拼装与薄 API Route     |
| `src/components/`        | 页面区块、交互与公共 UI 组件     |
| `src/config/`            | 文案、导航与页面配置             |
| `src/features/`          | 业务 Service / Repository 与事务 |
| `src/lib/`、`src/types/` | 公共基础设施、类型与 Contract    |
| `prisma/`                | Schema、前向 Migration 与 Seed   |
| `tests/`、`docs/`        | 自动验证与正式文档               |

先搜索现有组件和配置，复用已有能力。页面或 Route 不直接查询 Prisma；公共 Contract / 组件 API 改动前搜索调用方，同步实现、消费者和文档。迁移只追加，不改已执行的 SQL，不使用 `prisma db push` 代替 Migration。

## 5. 按改动影响验证

先说明这次改变了什么，再选择最小必要检查。以下为选择依据，详细要求见 [AGENTS.md](AGENTS.md) 第 8 / 10 节。

| 改动                 | 本地重点                                                                          |
| -------------------- | --------------------------------------------------------------------------------- |
| 文档 / 文案          | 改动文件格式、链接、规则一致性与 `git diff --check`；布局未变通常无需浏览器       |
| 组件 / 表单 / 列表   | 改动文件 lint / format、相关类型与组件 / DOM 断言；布局变化检查受影响的桌面和窄屏 |
| Service / API / 权限 | 定向单元、Contract 与必要集成回归，重点核对权限、隐私及事务                       |
| Schema / Migration   | 独立 `_test` GreatSQL、串行；新增迁移验证空库、基线升级与重复 deploy              |

例如修改这四份入门文档时：

```bash
pnpm exec prettier --check README.md README.en.md CONTRIBUTING.md CONTRIBUTING.en.md
git diff --check
```

运行某个相关单元测试时，可使用既有 Node test runner，例如：

```bash
pnpm exec tsx --test tests/unit/repair-photo-policy.test.ts
```

请按实际改动替换测试文件。完整 `pnpm lint` / `pnpm test` / `pnpm build` 与 CI、维护者协调；同提交已有有效结果可复用，修复后只重跑受影响项。合并前仍须满足必需 CI 和完整构建门槛。

### 数据库测试：先切库，再运行

数据库测试会创建和删除夹具，部分用例会清表。只使用**库名以 `_test` 结尾的独立 GreatSQL**，同一测试库串行运行，不打开放行变量绕过闸门。

Windows 配置脚本会创建 `.env.test.local`，但 `pnpm test:db` **不会自动读取它**。请照[独立测试库步骤](docs/database-windows.md#4-独立测试库)显式切换 `DATABASE_URL`、准备测试库，并在结束后恢复原值。已有迁移没有变化时，不重复跑迁移三态。

### 界面截图

优先用组件 / DOM 断言验证行为。确需展示视觉变化时，只提供受影响视图的代表性截图，检查窄屏、桌面、焦点与溢出；个人资料和凭据不可进入公开截图。

验证截图放在仓库外，PR 中只附本次有必要展示的图片。`docs/assets/` 仅保留 README 的浅 / 深色首页预览，不随日常功能 PR 更新；确需更新时先与维护者确认范围。

## 6. 提交 Pull Request

提交前检查 `git diff`，确认只包含本任务文件。以下以同时修改中英文 README 为例：

```bash
git add README.md README.en.md
git diff --cached
git commit -m "docs(readme): 更新项目说明"
git push -u origin docs/short-description
```

在你的 Fork 打开 **Compare & pull request**，目标选择 `ZAFU-PCHospital/zafu-pchospital-web` 的 `main`。提交信息采用 `feat` / `fix` / `docs` 等类型，描述具体变化；更多示例见 [Git 工作流](docs/git-workflow.md)。

PR 描述写清楚：

- 解决的问题与最终行为，关联 Issue。
- 改动范围；公共契约、依赖或 Migration 的影响。
- **实跑、复用、未跑**的检查及原因；保留失败结果和剩余限制。
- 界面变化的代表性截图与必要说明。

等待评审和必需 CI，通过后由维护者按权限合并。评审返修继续推送同一工作分支，并只复跑受影响检查。贡献 PR 不包含生产部署授权。

## 7. 许可证

提交 PR 即表示你同意以本项目的许可证（[AGPL-3.0-or-later](LICENSE)）授权你的贡献，并确认你有权提交这些内容。
