# AGENTS.md

> 本文件是给后续 AI Agent（Codex / Claude Code / Kimi / Cursor 等）阅读的**项目规则**。
> 开始任何改动前，先读完本文件，再读 `docs/design-system.md`。
>
> 你是这个项目的协作者，不是重写者。**已有且能正常工作的代码优先复用。**
>
> 本文件同时是本仓库的**工程手册**：环境与命令（第 6 节）、站内文档构建（第 7 节）、
> 本地验证与截图（第 8 节）、CI 与部署（第 11 节）都在这里。
> `README.md` 只保留上手信息，具体细节一律以本文件为准。

---

## 0. 项目一句话

浙江农林大学电脑医院官网（社团综合服务平台）的第一阶段基础框架。
目标是**风格统一、目录清晰、易于多人并行开发**，而不是把页面做完。

---

## 1. 技术栈（不得擅自更换）

| 项目     | 当前选择                                       |
| -------- | ---------------------------------------------- |
| 框架     | Next.js 15（App Router）                       |
| 语言     | TypeScript（strict）                           |
| 样式     | Tailwind CSS v4 + `src/app/globals.css` 组件层 |
| 包管理器 | **pnpm**（锁文件 `pnpm-lock.yaml`）            |
| 规范     | ESLint（eslint-config-next）+ Prettier         |

**禁止 Agent 擅自：**

- ❌ 更换框架（不要引入 Vite / Nuxt / Astro / Remix）
- ❌ 更换包管理器（不要改用 npm / yarn，不要删除 `pnpm-lock.yaml`）
- ❌ 引入另一套 CSS 体系（不要引入 styled-components / emotion / CSS Modules 体系 / Sass / Less）
- ❌ 引入另一套 UI Framework（不要引入 MUI / Ant Design / Chakra / Bootstrap）
- ❌ 引入状态管理库、动画库、图标库、`clsx` / `tailwind-merge`
- ❌ 安装大型新依赖（新增任何运行时依赖都必须在 PR 中单独说明理由）

如果确实认为需要引入某个依赖，**先问，不要直接装**。

---

## 2. Design（必须遵守）

> **所有页面必须遵守 `docs/design-system.md`。该文件是视觉的唯一来源。**

**禁止 Agent：**

- ❌ 自己创造新的品牌色（全站只有一个强调色：信号黄 `--accent`）
- ❌ 在组件里写死主题色值（`color: #2457ff`、`background: #ffd400` 这类），必须走语义令牌
- ❌ 在组件里判断当前显示模式再挑颜色（`theme === "dark" ? "#FFD400" : "#2457FF"`）
- ❌ 自己重新设计 Header（桌面索引栏 / 移动端顶栏与浮层的结构已固定）
- ❌ 自己重新设计 Footer
- ❌ 自己创建第二套 Button / Container / Card / Section
- ❌ 使用 `docs/design-system.md` 之外的圆角数值（只有 `2px` / `4px` / `999px`；
  主题层自带的 `--r-frame` 属于主题取值，组件不要自己写新的圆角）
- ❌ 添加 `box-shadow`（设计基准不使用任何阴影）
- ❌ 使用标准断点之外的新断点（只用 `760px` 与 `1100px`，即 `md:` / `lg:`）
- ❌ 为「高级感」添加粒子、3D、光晕、新的鼠标跟随特效

**必须做到：**

- ✅ 颜色与视觉取值一律使用语义令牌（`var(--bg)` / `var(--surface-1)` / `var(--ink)` /
  `var(--line)` / `var(--accent)` 等）。当前生效的主题由 `<html data-theme>` 决定，
  组件不需要知道是哪个主题 —— 详见 `docs/design-system.md` 第 9 节
- ✅ 需要新增主题：改 `src/config/theme.ts` 的注册表 + 在 `globals.css` 主题层加一段
  `html[data-theme="<id>"]`；**不要**为不同模式写两套页面或两套组件
- ✅ 文案与列表数据放在 `src/config/`，不要硬编码在组件里
- ✅ 页面区块用 `components/ui/Section.tsx` 包裹，不要自己写 `padding-block`
- ✅ 内容放在 `components/layout/Container.tsx` 内
- ✅ 图标使用 `components/ui/Icon.tsx`（24 格 / stroke 2 / round 端点）
- ✅ 需要社团确认的信息标注为「待补充」，**不要编造事实**

---

## 3. Scope（只做该做的）

> **只修改当前任务真正需要修改的代码。**

**未经任务明确要求，禁止：**

- ❌ 大规模重构
- ❌ 修改其他页面（做 `/about` 就不要动 `/join`）
- ❌ 删除已有业务代码
- ❌ 重命名大量目录
- ❌ 修改公共组件 API（`components/layout/*`、`components/ui/*` 的 props）
- ❌ 安装大型新依赖
- ❌ 全量格式化（会淹没真实改动）

**关于业务范围（重要）：**

本项目后续会承载报修、活动报名、维修备案、志愿时长、成员系统、管理后台等业务，
但**这些属于后续阶段，本阶段一律不实现**：

- ❌ 不要引入数据库、ORM、鉴权、会话
- ❌ 不要实现登录、用户系统、成员系统、权限系统
- ❌ 不要实现报修系统、活动报名、备案、评价、志愿时长
- ❌ 不要实现 API 路由与后台管理界面

业务规则以仓库根目录的《电脑医院社团综合服务平台需求分析.md》为准。
**目录结构已经为这些模块预留了位置**（见 `docs/architecture.md` 第 6 节），
但不要为了「考虑未来」提前实现不存在的业务。

---

## 4. Existing Code（优先复用）

> **已经存在且工作的代码应优先复用。**

- ✅ 先搜索 `src/components/ui/` 与 `src/components/layout/`，确认没有现成实现再动手写。
- ✅ 先读 `src/config/`，确认要用的数据是否已经存在。
- ✅ 先读 `docs/design-system.md` 第 4 节，确认要用的视觉模式是否已经存在。
- ❌ 不要为了「代码更优雅」随意重写团队成员已经完成的内容。
- ❌ 不要把一个跨页面复用的区块留在页面专属目录里 —— 提升到 `components/ui/`。

**关于设计基准 Demo：**

- `zafu-pchospital-site/` 是团队已确认的**视觉基准**，**只读**。
- ❌ 不要修改、删除、重构、格式化它。
- ✅ 需要确认某个视觉细节时，直接读其中的 `assets/css/style.css`。

---

## 5. 目录职责速查

| 路径                     | 放什么                                                           | 不放什么                 |
| ------------------------ | ---------------------------------------------------------------- | ------------------------ |
| `src/app/*/page.tsx`     | 路由、`metadata`、区块拼装                                       | 大段 JSX、文案、内联样式 |
| `src/components/layout/` | 全站骨架（Header / Footer / Container / PageHead / SiteEffects） | 页面专属内容             |
| `src/components/ui/`     | 跨页面复用的 UI 原语                                             | 只被一个页面用的东西     |
| `src/components/<页面>/` | 该页面专属区块                                                   | 跨页面复用的东西         |
| `src/config/`            | 站点配置、导航、页面文案数据                                     | 组件、逻辑               |
| `src/lib/`               | 纯函数、数据读取                                                 | React 组件               |
| `src/data/`              | 构建脚本生成的结构化数据                                         | 手写内容                 |
| `src/app/globals.css`    | 设计令牌 + 基础层 + 组件层                                       | 页面专属样式             |
| `public/`                | 字体、图片等静态资源                                             | 源码里能 import 的东西   |

完整的目录树与逐文件职责见 `docs/architecture.md` 第 2 节。

新增页面时的标准动作：

```text
1. src/app/<route>/page.tsx
2. src/components/<route>/         （如果需要页面专属区块）
3. src/config/<route>.ts           （文案与数据）
4. src/config/navigation.ts        （登记导航项）
```

---

## 6. 环境与命令

需要 **Node ≥ 20.9**（见 `package.json` 的 `engines`）与 **pnpm**。
本机未启用 Corepack 时先执行一次：

```bash
corepack enable   # 之后 pnpm 会自动使用 packageManager 里固定的版本
```

| 命令                 | 说明                                                             |
| -------------------- | ---------------------------------------------------------------- |
| `pnpm install`       | 安装依赖（`postinstall` 会补占位文档清单，见第 7 节）            |
| `pnpm dev`           | 启动开发服务器（`predev` 同样补清单）                            |
| `pnpm build`         | 生产构建，**含站内技术文档**（需要 mdBook，见第 7 节）           |
| `pnpm build:site`    | 只编译官网，跳过文档构建（用当时磁盘上的清单，**不要用于部署**） |
| `pnpm docs:build`    | 只生成站内技术文档到 `public/handbook/`                          |
| `pnpm start`         | 以生产模式启动（需先 build）                                     |
| `pnpm lint`          | `eslint .` + 主题调色板一致性校验，**必须 0 error**              |
| `pnpm check:palette` | 只跑调色板校验（官网与文档站两份令牌是否逐值一致）               |
| `pnpm format`        | Prettier 格式化                                                  |
| `pnpm format:check`  | 检查格式是否符合规范                                             |

> 不要用 npm / yarn，也不要删除 `pnpm-lock.yaml`。

---

## 7. 站内文档构建（`/handbook`）

`/docs` 页指向站内的 `/handbook/`，正文由独立仓库
[`ZAFU-PCHospital-Doc`](https://github.com/ZAFU-PCHospital/ZAFU-PCHospital-Doc)
在**构建期**生成。`pnpm build` 已包含这一步，因此多出两个前置条件：

1. **mdBook**（Rust 工具链，npm 里没有）。二选一：

   ```bash
   cargo install mdbook
   # 或从 https://github.com/rust-lang/mdBook/releases 下载对应平台的二进制，然后
   MDBOOK_BIN=/path/to/mdbook pnpm build
   ```

2. **文档源码**：缺省会自动浅克隆到 `.docs-source/`（已 gitignore），**通常不用手动做**。
   - 用本地已有的检出：`DOCS_SOURCE_DIR=/path/to/ZAFU-PCHospital-Doc pnpm build`
   - 完全离线：`DOCS_OFFLINE=1`（前提是源码已经在本地）

只开发官网页面时**不必装 mdBook**：`pnpm install` 会通过 `postinstall` 写一份**占位清单**
（`src/data/doc-manifest.json`，目录为空），所以 `pnpm dev` 与 `pnpm build:site` 开箱可用；
要看真实目录再跑 `pnpm docs:build`（需要 mdBook）。

> `src/data/doc-manifest.json` 是**构建产物**（已 gitignore、不进仓库），而
> `src/lib/docs.ts` 是静态 import 它 —— 文件缺失时 `next dev` / `next build` 会直接报
> `Module not found`。`tools/ensure-doc-manifest.mjs` 负责在缺失时补占位清单，已挂在
> `postinstall`、`predev`、`prebuild:site` 上。**不要手改这个文件**（见 `docs/git-workflow.md`）。

> `public/handbook/` 同样是构建产物：`pnpm dev` 下 `/handbook/` 是空的
> （`/handbook` → `/handbook/index.html` 会 404），要本地看文档先跑一次 `pnpm docs:build`。

> `pnpm build:site` 用的是**当时磁盘上的**清单：若还是占位清单，`/docs` 页会显示 0 个条目。
> **不要用它部署** —— 部署必须用 `pnpm build`（含文档构建）。

`tools/mdbook-theme/pc-hospital.css` 是 `globals.css` 主题层的**拷贝**（mdBook 只吃静态 CSS，
无法引用官网变量）。**改了 `globals.css` 的主题层就必须同步改它**，否则 `pnpm lint` 失败。

---

## 8. 本地验证与截图

`tools/` 下有两个基于 Chrome DevTools Protocol 的诊断脚本（只用 Node 内置 API，没有额外依赖）。
先起一个带调试端口的 Chrome：

```bash
chrome --headless=new --remote-debugging-port=9222 --user-data-dir=./.chrome-profile about:blank
```

然后：

```bash
# 页面诊断 + 截图：<url> <输出png|-> [宽] [高]
node tools/inspect.mjs http://localhost:3000/ shots/01-home-desktop-normal.png 1440 900
CAP_SEL="#services" node tools/inspect.mjs http://localhost:3000/ shots/02-home-services-normal.png

# 只收集 console 报错与运行时异常
node tools/console-probe.mjs http://localhost:3000/
```

脚本最后会打印两行，**两项都为空才算通过**：

- `PAGE_PROBLEMS`：页面异常 / `console.error`
- `BAD_REQUESTS`：状态码 ≥ 400 或加载失败的请求

`inspect.mjs` 支持的环境变量：`CAP_SEL` / `CAP_Y`（截图前先滚到这里，触发进场动效）、
`CAP_X` / `CAP_W` / `CAP_H` / `CAP_SCALE`（截图区域）、`WAIT_MS`（载入后等待时长）、
`REDUCED_MOTION=1`、`THEME_MODE=normal|dark`。

### shots/ 的命名

`shots/` 里的截图一律以 `<编号>-<页面>-<视图>-<模式>.png` 命名，模式取 `normal` / `dark`，
与 `<html data-mode>` 一致。

**每个视图两种模式各一张，同一编号成对出现**，文件排序也天然相邻：

```text
01-home-desktop-normal.png       01-home-desktop-dark.png
14-join-signup-done-normal.png   14-join-signup-done-dark.png
```

站点有两套主题（见 `docs/design-system.md` 第 9 节）。主题改的不只是颜色 —— 走线栅格、
扫描线、水印描边、索引栏面板色、准星混合模式都随主题变，所以**每个视图都要两种模式各拍一张**，
不能只留一套。成对拍：

```bash
THEME_MODE=normal CAP_SEL="#services" node tools/inspect.mjs URL shots/02-home-services-normal.png
THEME_MODE=dark   CAP_SEL="#services" node tools/inspect.mjs URL shots/02-home-services-dark.png
```

站点把用户的选择存在 `localStorage` 里、引导脚本在 hydration 之前就读它，所以模式必须在
**文档创建之前**写进去。`tools/inspect.mjs` 已经处理好这件事；**不传 `THEME_MODE` 时它会主动
清掉那个键**，避免上一轮留下的深色选择把后面所有截图都拍成深色（这个坑踩过一次）。

---

## 9. 开工前必做

```bash
git status              # 确认工作区状态
git switch -c feat/xxx  # 确认不在 main 上直接开发
```

- 查看当前分支与已有文件，**不要直接删除现有项目内容**。
- 确认本次任务的范围，只改相关文件。
- 不确定的视觉、文案、业务判断，**先问再做**。

---

## 10. 完工前必做

```bash
pnpm lint      # 必须 0 error（除 ESLint 外还会校验主题调色板一致性）
pnpm build     # 必须成功；已包含站内文档构建，需要 mdBook（见第 7 节）
pnpm dev       # 手动检查 Desktop / Mobile / Console
```

> **`pnpm build` 已包含 `docs:build`**，所以标准构建一定产出完整的站内文档。
> 不要为了绕开 mdBook 而改用 `pnpm build:site` 就宣布完工 —— 它只编译官网，
> `/handbook/` 会缺失，`/docs` 页的链接全部 404。只改页面、本机确实没有 mdBook 时
> 可以用它做快速自检，但必须在 PR 描述里说明「未验证文档构建」。
>
> **改了 `globals.css` 的主题层，必须同步改 `tools/mdbook-theme/pc-hospital.css`
> 的对应主题块**，否则 `pnpm lint` 会直接失败。

自检清单：

- [ ] `pnpm lint` 通过
- [ ] `pnpm build` 通过
- [ ] Desktop（≥1100px）与 Mobile（<760px）都正常
- [ ] 无横向溢出
- [ ] Console 无报错
- [ ] 未偏离 `docs/design-system.md`
- [ ] 未修改 `zafu-pchospital-site/`
- [ ] 未修改与任务无关的文件
- [ ] 文案数据在 `src/config/`，未硬编码

分支与提交规范见 `docs/git-workflow.md`。**禁止直接 push `main`。**

---

## 11. CI 与部署

`.github/workflows/ci.yml` 在 **PR** 与 **push 到 `main`** 时运行（也可手动触发）：

1. 解析并固定文档版本（`DOCS_REF` → sha，保证构建可复现）
2. 把文档仓库检出到 `.docs-source/`
3. 安装**固定版** mdBook（版本写在 workflow 的 `MDBOOK_VERSION`，不用 `latest`）
4. `pnpm install` → `pnpm lint` → `pnpm build`（含文档）
5. 校验构建产物：`public/handbook/index.html`、`searchindex`、官网主题 CSS/JS、清单结构
6. 起生产服务冒烟：`/`、`/about`、`/join`、`/docs`、`/handbook/` 必须全部 200
7. `main` 上通过后调用部署

**有两件事只能在 GitHub 上操作才生效**（代码里做不到）：

- **把 `CI / 校验与构建` 设为 `main` 的必需状态检查**（Settings → Branches）。
  当前 `main` **未启用任何分支保护**；不设置的话 CI 只是「跑给你看」，拦不住合并。
- **配置部署**：设置仓库变量 `DEPLOY_COMMAND`（部署目标尚未确定，见 workflow 内注释）。
  未配置时部署步骤只打印 `::warning::`，不会失败。

可选：设置仓库变量 `DOCS_REF` 指定文档仓库的分支（默认 `main`）。

---

## 12. 一句话总结

> 保持风格统一、目录清晰、改动最小。
> 有疑问先读文档，读不到就问，**不要猜**。
