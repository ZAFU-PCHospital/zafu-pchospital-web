# 浙江农林大学电脑医院 · 社团综合服务平台

浙江农林大学电脑医院社团的官方网站。对外展示社团与服务范围，同时也是后续
「清灰预约、活动维修、维修备案、志愿时长」等业务功能的载体。

当前进入 **Phase 2**：第一阶段官网框架保持稳定，M0 新增 GreatSQL、统一账户与招募数据契约、
API 规范以及权限与审计骨架；完整登录、管理页面、维修、评论、统计和通知功能留给后续模块。

---

## 快速开始

需要符合 `package.json` 约束的 Node.js 与 pnpm（本机没启用过先执行一次 `corepack enable`）。

```bash
pnpm install
cp .env.example .env
docker compose -f compose.greatsql.yml up -d
pnpm db:migrate:deploy
pnpm db:seed
pnpm db:health
pnpm dev        # 打开 http://localhost:3000
```

数据库凭据、Migration 和故障处理见 [`docs/database.md`](docs/database.md)。

---

## 页面

| 路由     | 页面         | 状态                                                       |
| -------- | ------------ | ---------------------------------------------------------- |
| `/`      | 首页         | 已完整实现（设计基准的六个区块）                           |
| `/about` | 关于我们     | 内容骨架（社团介绍 / 服务范围 / 联系方式），细节待社团补充 |
| `/join`  | 加入我们     | 内容骨架（含新社员登记表）                                 |
| `/docs`  | 技术文档入口 | 指向站内 `/handbook/`，正文来自独立文档仓库                |

---

## 常用命令

| 命令                     | 做什么                                             |
| ------------------------ | -------------------------------------------------- |
| `pnpm dev`               | 启动开发服务器                                     |
| `pnpm lint`              | 代码规范检查 + 主题调色板校验（必须 0 error）      |
| `pnpm test`              | 单元与 Contract 测试；真实数据库用例默认跳过       |
| `pnpm test:db`           | 对本地专用 GreatSQL 执行数据库集成测试             |
| `pnpm build`             | 生产构建（含站内技术文档，需要 mdBook）            |
| `pnpm build:site`        | 只编译官网，跳过文档构建（快速自检用，不用于部署） |
| `pnpm db:migrate:deploy` | 执行版本化 Migration                               |
| `pnpm db:seed`           | 幂等写入 MEMBER / ADMIN 基础角色                   |
| `pnpm db:health`         | 检查 GreatSQL 连接、UTC、字符集与排序规则          |
| `pnpm format`            | Prettier 格式化                                    |

> `pnpm build` 的 mdBook 前置条件、环境变量与常见报错见 [`AGENTS.md`](AGENTS.md) 第 7 节。
> Phase 2 完整生产形态必须运行 Next.js 服务端，浏览器不得直连 GreatSQL。

---

## 目录结构（顶层）

```text
prisma/                Schema、版本化 Migration 与幂等 Seed
src/app/               页面与 /api/v1 Route Handler
src/components/        layout 骨架、ui 原语与页面专属区块
src/config/            站点配置与页面文案
src/features/          领域 Service / Repository
src/lib/               DB、API、权限、审计、安全与通用逻辑
src/types/             公共 Enum / Contract 唯一事实来源
tests/                 单元、Contract 与 GreatSQL 集成测试
docs/                  设计、架构、数据库、契约与协作文档
```

各层详细职责见 [`docs/architecture.md`](docs/architecture.md) 第 2～3 节。

---

## 文档在哪

| 你想知道                                   | 看这个                                                     |
| ------------------------------------------ | ---------------------------------------------------------- |
| 界面规则：颜色 / 字号 / 间距 / 圆角        | [`docs/design-system.md`](docs/design-system.md)           |
| 代码放置、层次与数据流                     | [`docs/architecture.md`](docs/architecture.md)             |
| GreatSQL、Migration、Seed、检查与发布      | [`docs/database.md`](docs/database.md)                     |
| 公共数据 / API 契约及不变量                | [`docs/contracts/`](docs/contracts/)                       |
| Phase 2 模块状态、依赖和协作规则           | [`docs/phase2-development.md`](docs/phase2-development.md) |
| Phase 2 业务需求                           | [`docs/第二期需求分析文档.md`](docs/第二期需求分析文档.md) |
| 分支、commit 与 PR 流程                    | [`docs/git-workflow.md`](docs/git-workflow.md)             |
| 工程细节与硬性约束（主要给 AI / Agent 看） | [`AGENTS.md`](AGENTS.md)                                   |

---

## 参与开发

1. 先读 [`AGENTS.md`](AGENTS.md) 与当前模块任务书；页面改动还需读设计系统，服务端改动还需读数据库与 Contract 文档
2. 从最新 `main` 建分支：`git switch -c feat/xxx`
3. 运行 `pnpm lint && pnpm test && pnpm build`；数据库改动还要运行 Migration 和 `pnpm test:db`
4. 发起 Pull Request（禁止直接 push `main`）

完整流程与提交规范见 [`docs/git-workflow.md`](docs/git-workflow.md)。
