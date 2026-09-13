# 浙江农林大学电脑医院 · 社团综合服务平台

浙江农林大学电脑医院社团的官方网站。除了对外展示社团与服务范围，这里也是后续
「清灰预约、活动维修、维修备案、志愿时长」等业务功能的载体。

当前仓库完成的是**第一阶段：官网基础框架**。

---

## 当前开发阶段

第一阶段的目标不是把页面做完，而是建立一个**风格统一、目录清晰、易于多人并行开发**的基础：

- 把团队已确认的视觉基准 Demo 工程化、组件化、规范化，形成统一的 Design System
- 搭好 Next.js + TypeScript + Tailwind 的正式开发框架
- 建立四个公开页面的路由骨架
- 写清协作文档，让新成员与 AI Agent 都知道代码该放哪里、什么不能改

**本阶段不实现**（属于后续阶段）：登录、用户/成员/权限系统、管理后台、数据库、
报修系统、活动报名、维修备案、志愿时长、API。详见
[`docs/architecture.md`](docs/architecture.md) 第 6 节。

已完成页面：

| 路由     | 页面         | 状态                                                       |
| -------- | ------------ | ---------------------------------------------------------- |
| `/`      | 首页         | 完整复刻设计基准的六个区块                                 |
| `/about` | 关于我们     | 内容骨架（社团介绍 / 服务范围 / 联系方式），待社团补充细节 |
| `/join`  | 加入我们     | 内容骨架，标注为「待补充」                                 |
| `/docs`  | 技术文档入口 | 跳转与目录入口，不重新实现文档系统                         |

---

## 技术栈

| 项目   | 选择                                           |
| ------ | ---------------------------------------------- |
| 框架   | Next.js 15（App Router）                       |
| 语言   | TypeScript（strict）                           |
| 样式   | Tailwind CSS v4 + `src/app/globals.css` 组件层 |
| 包管理 | pnpm                                           |
| 规范   | ESLint（`eslint-config-next`）+ Prettier       |

---

## 快速开始

```bash
pnpm install
pnpm dev
```

打开 http://localhost:3000 即可开始开发。

> 如果本机还没有 pnpm：
>
> ```bash
> corepack enable && corepack prepare pnpm@latest --activate
> # 或
> npm install -g pnpm
> ```

### 常用命令

| 命令                | 说明                         |
| ------------------- | ---------------------------- |
| `pnpm dev`          | 启动开发服务器               |
| `pnpm build`        | 生产构建                     |
| `pnpm start`        | 以生产模式启动（需先 build） |
| `pnpm lint`         | ESLint 检查                  |
| `pnpm format`       | Prettier 格式化              |
| `pnpm format:check` | 检查格式是否符合规范         |

---

## 目录结构

```text
.
├── AGENTS.md              # 给 AI Agent 的项目规则（必读）
├── README.md              # 本文件
├── docs/                  # 协作文档
│   ├── design-system.md   # 视觉唯一来源
│   ├── architecture.md    # 架构与目录职责
│   └── git-workflow.md    # 分支与 PR 流程
│
├── src/
│   ├── app/               # 路由与页面
│   ├── components/
│   │   ├── layout/        # 全站骨架（Header / Footer / Container / PageHead / SiteEffects）
│   │   ├── ui/            # 通用 UI 原语（Button / Card / Section / Readout / Icon ...）
│   │   ├── home/          # 仅首页使用的区块
│   │   └── docs/          # 文档相关区块
│   ├── config/            # 站点配置与页面文案数据
│   ├── lib/               # 纯逻辑工具
│   └── data/              # 文档仓库清单（构建脚本生成）
│
├── public/fonts/          # 品牌字体
├── shots/                 # 视觉验证截图（按显示模式命名，见「本地验证」）
├── tools/                 # 本地验证脚本（CDP 诊断）
└── zafu-pchospital-site/  # 【只读】设计基准 Demo
```

---

## 文档在哪

| 你想知道                                    | 看这个                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| 界面应该长什么样、颜色/字号/间距/圆角的规则 | [`docs/design-system.md`](docs/design-system.md)                             |
| 代码应该放在哪里、各层职责、未来如何扩展    | [`docs/architecture.md`](docs/architecture.md)                               |
| 分支怎么建、commit 怎么写、PR 怎么提        | [`docs/git-workflow.md`](docs/git-workflow.md)                               |
| 业务需求与规则                              | [`电脑医院社团综合服务平台需求分析.md`](电脑医院社团综合服务平台需求分析.md) |

### AGENTS.md 的作用

[`AGENTS.md`](AGENTS.md) 是给后续 AI Agent（Codex / Claude Code / Kimi / Cursor 等）阅读的
**项目规则文件**。它规定了：

- 技术栈不得擅自更换（框架 / 包管理器 / CSS 体系 / UI Framework）
- 所有页面必须遵守 `docs/design-system.md`，不得自创品牌色或重建 Header / Footer / Button
- 只修改当前任务真正需要修改的代码，不做无关重构
- 已经存在且工作的代码优先复用

多人 + 多 Agent 并行开发时，这个文件是防止风格跑偏和互相覆盖的第一道约束。

---

## 关于设计基准 Demo

`zafu-pchospital-site/` 是团队已确认的视觉基准，**只读参考，不再改动**。

- 它不参与构建（Next.js 只处理 `src/`）
- ESLint / Prettier 已忽略该目录
- 需要确认某个视觉细节时，直接读其中的 `assets/css/style.css`

`src/app/globals.css` 中的设计令牌与该 Demo **逐值一致**，视觉规则在
[`docs/design-system.md`](docs/design-system.md) 中有完整记录。

---

## 本地验证

`tools/` 下有两个基于 Chrome DevTools Protocol 的验证脚本（无需额外依赖）：

```bash
# 1. 启动一个带调试端口的 Chrome
chrome --headless=new --remote-debugging-port=9222 --user-data-dir=./.chrome-profile about:blank

# 2. 诊断某个页面并截图
node tools/inspect.mjs http://localhost:3000/ shots/01-home-desktop-normal.png 1440 900
CAP_SEL="#services" node tools/inspect.mjs http://localhost:3000/ shots/02-home-services-normal.png

# 3. 收集 console 报错与运行时异常
node tools/console-probe.mjs http://localhost:3000/
```

脚本会输出 `PAGE_PROBLEMS`（页面异常 / console 错误）与 `BAD_REQUESTS`（失败请求），
两项都为空才算通过。

### shots/ 的命名

`shots/` 里的截图一律以 `<编号>-<页面>-<视图>-<模式>.png` 命名，模式取
`normal` / `dark`，与 `<html data-mode>` 一致：

```text
01-home-desktop-normal.png      首页首屏，正常模式
14-join-signup-done-normal.png  /join 提交完成，正常模式
16-join-signup-done-dark.png    同上，深色模式
```

**必须写模式后缀。** 站点有两套主题（见 design-system 第 9 节），
不带后缀的截图没人知道拍的是哪一套；主题只改颜色、不改结构，
所以绝大多数视图只拍默认的 `normal`，
只有「同一次交互在两种模式下看到的东西不一样」时才另拍一张 `dark`
（例如 `/join` 提交后的二维码：正常模式是浅底原色版，深色模式是深底黄码版）。

截图前先在浏览器里把模式恢复成默认，否则 `localStorage` 里记住的选择
会把整批截图都拍成深色：

```js
localStorage.removeItem("zafu-pchospital:theme-mode");
```

---

## 参与开发

1. 读 [`AGENTS.md`](AGENTS.md) 与 [`docs/design-system.md`](docs/design-system.md)
2. 从最新 `main` 建分支：`git switch -c feat/xxx`
3. 开发后自检：`pnpm lint && pnpm build`
4. 提交并发起 Pull Request（**禁止直接 push `main`**）

完整流程见 [`docs/git-workflow.md`](docs/git-workflow.md)。
