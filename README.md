# 浙江农林大学电脑医院 · 社团综合服务平台

浙江农林大学电脑医院社团的官方网站。对外展示社团与服务范围，同时也是后续
「清灰预约、活动维修、维修备案、志愿时长」等业务功能的载体。

当前完成的是**第一阶段：官网基础框架**，目标是风格统一、目录清晰，方便多人（以及 AI）
并行开发，而不是把页面做完。登录、成员系统、管理后台、报修与报名等业务属于后续阶段，
**本阶段一律不实现**。

---

## 快速开始

需要 Node ≥ 20.9 与 pnpm（本机没装过先执行一次 `corepack enable`）。

```bash
pnpm install
pnpm dev        # 打开 http://localhost:3000
```

改代码，浏览器自动刷新 —— 可以开始干活了。

---

## 页面

| 路由     | 页面         | 状态                                                       |
| -------- | ------------ | ---------------------------------------------------------- |
| `/`      | 首页         | 已完整实现（设计基准的六个区块）                           |
| `/about` | 关于我们     | 内容骨架（社团介绍 / 服务范围 / 联系方式），细节待社团补充 |
| `/join`  | 加入我们     | 内容骨架（含新社员登记表），标注为「待补充」               |
| `/docs`  | 技术文档入口 | 指向站内 `/handbook/`，正文来自独立文档仓库，本站不重实现  |

---

## 常用命令

| 命令              | 做什么                                                   |
| ----------------- | -------------------------------------------------------- |
| `pnpm dev`        | 起开发服务器                                             |
| `pnpm lint`       | 代码规范检查 + 主题调色板校验（**必须 0 error**）        |
| `pnpm build`      | 生产构建（**含站内技术文档**，需要 mdBook）              |
| `pnpm build:site` | 只编译官网，跳过文档构建（快速自检用，**不要用于部署**） |
| `pnpm format`     | Prettier 格式化                                          |

> `pnpm build` 里的文档构建需要 mdBook（npm 里没有）。只写页面时不用管它：
> `pnpm dev` 与 `pnpm build:site` 开箱可用。确实要做完整构建时，前置条件、环境变量
> 与常见报错都写在 [`AGENTS.md`](AGENTS.md) 第 7 节「站内文档构建」。

---

## 目录结构（顶层）

```text
src/app/               路由与页面
src/components/        组件（layout 骨架 / ui 原语 / 各页面专属区块）
src/config/            站点配置与页面文案数据 ← 文案写这里，不要硬编码在组件里
src/lib/               纯逻辑工具
docs/                  协作文档（设计系统 / 架构 / Git 流程）
```

各目录该放什么、不该放什么，见 [`docs/architecture.md`](docs/architecture.md) 第 2 节。

---

## 文档在哪

| 你想知道                                  | 看这个                                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| 界面该长什么样：颜色 / 字号 / 间距 / 圆角 | [`docs/design-system.md`](docs/design-system.md)                             |
| 代码该放在哪里、各层职责、以后怎么扩展    | [`docs/architecture.md`](docs/architecture.md)                               |
| 分支怎么建、commit 怎么写、PR 怎么提      | [`docs/git-workflow.md`](docs/git-workflow.md)                               |
| 业务需求与规则                            | [`电脑医院社团综合服务平台需求分析.md`](电脑医院社团综合服务平台需求分析.md) |
| 工程细节与硬性约束（主要给 AI 看）        | [`AGENTS.md`](AGENTS.md)                                                     |

---

## 参与开发

1. 先读 [`AGENTS.md`](AGENTS.md) 与 [`docs/design-system.md`](docs/design-system.md)
2. 从最新 `main` 建分支：`git switch -c feat/xxx`
3. 开发后自检：`pnpm lint && pnpm build`
4. 发起 Pull Request（**禁止直接 push `main`**）

完整流程与提交规范见 [`docs/git-workflow.md`](docs/git-workflow.md)。

