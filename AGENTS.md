# AGENTS.md

> 本文件是给后续 AI Agent（Codex / Claude Code / Kimi / Cursor 等）阅读的**项目规则**。
> 开始任何改动前，先读完本文件，再读 `docs/design-system.md`。涉及 Phase 2 服务端或数据时，
> 还必须读 `docs/architecture.md`、`docs/database.md` 与 `docs/contracts/`。
>
> 你是这个项目的协作者，不是重写者。**已有且能正常工作的代码优先复用。**
>
> 本文件同时是本仓库的**工程手册**：环境与命令（第 6 节）、站内文档构建（第 7 节）、
> 本地验证与截图（第 8 节）、CI 与部署（第 11 节）都在这里。
> `README.md` 只保留上手信息，具体细节一律以本文件为准。

---

## 0. 项目一句话

浙江农林大学电脑医院官网与社团综合服务平台。公开官网与账号、招募、维修、活动、统计和
管理后台按领域协作，复用 GreatSQL、数据库 Session、公共契约与权限审计机制。
现行文档入口见 [docs/README.md](docs/README.md)。

### 0.1 文档职责与规则级别

- 本文件负责工程、安全、协作与验证；[设计规范](docs/design-system.md)负责页面分类、信息层级、视觉令牌和交互模式；[Git 工作流](docs/git-workflow.md)负责分支、提交与合并。
- **必须遵守**：鉴权 / 权限、隐私与凭据保护、Service / Repository 边界、公共契约贯通、测试库隔离、前向 Migration、Git 保护及本轮授权范围。设计调整不能绕过这些要求。
- **默认建议**：已有视觉令牌、组件、页面模式与验证方法是起点；先根据页面类型选择，不能把展示页的布局直接套在功能页上。
- **可说明理由后调整**：任务所需的局部尺寸、字号、断点、组件 API、反馈位置或成熟依赖，按第 2 节的轻量决策方式处理，不必逐次申请视觉豁免。

在上述工程与安全底线内，按本轮明确需求与验收、对应页面类型规则、通用设计默认值的顺序处理取舍。设计规范中的历史页面记录描述既有实现，不自动成为所有页面的新要求；未标明级别的视觉尺寸与构图按默认建议理解。业务或安全要求有实质冲突、任务范围不清时再与用户对齐。

---

## 1. 技术栈（不得擅自更换）

| 项目     | 当前选择                                       |
| -------- | ---------------------------------------------- |
| 框架     | Next.js 15.5.28（App Router）                  |
| 语言     | TypeScript（strict）                           |
| 样式     | Tailwind CSS v4 + `src/app/globals.css` 组件层 |
| 数据库   | **GreatSQL 8.0.32-27**（InnoDB / UTC）         |
| 数据访问 | **Prisma 7.10.1** + MariaDB driver adapter     |
| 包管理器 | **pnpm**（锁文件 `pnpm-lock.yaml`）            |
| 测试规范 | Node test runner（tsx）+ ESLint + Prettier     |

**工程底线：**

- 不擅自更换 Next.js / TypeScript / Tailwind、pnpm / 锁文件、GreatSQL / Prisma；不引入另一套全站 CSS 或 UI 框架来替换现有体系。
- 禁止用 `prisma db push`、手工 DDL 代替 Migration；不删除锁文件。
- 先复用既有能力。确有任务需要可采用成熟依赖，在 diff / PR 或交回中说明用途、现有实现为何不足、体积与维护代价，以及涉及的服务端 / 客户端或数据传输影响；按第 2 节记录取舍，不为小功能默认安装整套库。
- 替换技术栈、引入大型框架、付费或外部服务、改变数据流向等超出本轮范围的决策，先与用户对齐；常规的局部组件依赖不因“新增”二字一律停工申请。

---

## 2. Design（按页面场景使用）

> 先按 [设计规范第 0 节](docs/design-system.md#0-使用方式与规则级别)区分公开展示页、账号表单、成员工作区和管理后台。规范提供一致的品牌与交互基础，不要求四类页面使用相同的外壳和密度。

### 必须保留的基础

- 使用语义颜色与主题令牌，不在组件里按主题挑写死的色值；文字、控件边界、焦点与状态保持可辨识，状态不能只靠颜色表达。
- 使用真实标签、语义结构和可见焦点，键盘 / 触屏可完成主要任务；弹层处理焦点、Esc 与滚动锁，关闭后返回合理焦点。
- 用户无需了解的凭据代次、门禁档位、实施阶段等内部信息不进入产品文案；真实的权限或验证步骤不能因简化界面被跳过。文案与列表配置放 `src/config/`，社团未确认的信息标为“待补充”。

### 默认模式与可调整项

- 公开展示页优先复用 Header / Footer、Container / Section / PageHead；账号表单可用登录页式紧凑面板，成员 / 后台使用对应工作区，不强制包展示型 PageHead / Section / Card，也不要求每个功能页出现公开站导航与页脚。
- 先搜索 Button / Icon / 表单 / 列表 / 弹层与业务组件，避免平行实现。默认沿用令牌、标准断点和既有组件；必要的组件 API 扩展应搜索调用方、保持兼容或同步迁移，并验证受影响场景。
- 局部字号、尺寸、间距、圆角、断点、浮层层次或交互可按任务需要调整；跨页面反复出现的取值再沉淀为共享令牌 / 变体。不要为“高级感”添加与任务无关的装饰，或为避开旧组件的绝对禁令重复造轮子。
- 文案只保留操作所需信息，不复述界面，不解释内部实现；短句、标签和提示末尾不加句号，必要的风险与限制提示保留。
- 每一步只显示必要标签和主要动作；有需要再提供操作提示与帮助。低频管理动作可收在详情、菜单或折叠区，无须为了位置不变而常驻所有按钮。

### 交互稳定，而非冻结布局

- 异步刷新保留已渲染列表、有效选择和草稿，不因整表卸载丢失滚动或焦点。列表优先复用 `useAdminList` + `AdminListEnd`，批量操作与排序优先复用 `AdminBatchTools` / `useRowDragSort`。
- 允许用户明确触发的步骤切换、条件字段、展开帮助、就地字段错误和成功面板；步骤边界清楚，保留可纠正输入，并在必要时将焦点移到新步骤标题或错误字段。不能用任意滚动 / 自动抢焦点提示普通刷新。
- 反馈按用途选择：字段错误靠近字段并关联可读说明；局部任务结果可就地显示；后台列表上的短暂操作反馈优先复用 fixed `AdminToast`。不要求所有错误都进浮层，也不为未发生的反馈预留大段空白。
- 列表原地更新时避免无关内容跳动；批量条可在固定工具区原地替换，或在明确选择后出现并保持焦点 / 选中上下文，无须全页像素冻结。拖动仅由手柄开始并保留键盘 / 触屏路径。

### 轻量设计决策

常规功能布局直接按页面类型实施。在现有 PR 描述或交回中用 1–3 句写清“场景 / 现有模式不足 → 选择 → 受影响范围与验证”即可，无需新增审批单、单独 ADR 或逐次请求视觉豁免。例如：“找回采用三步紧凑表单，仅保留当前步骤字段；错误就地纠正，异步请求禁用关键输入，验证返回与重发状态。”

只有需求含糊且会影响业务含义、权限 / 隐私，或涉及全站品牌 / 导航重做、技术栈 / 大型依赖等范围扩张时才先问；不把普通字号、反馈位置与步骤切换都升级为用户决策。

---

## 3. Scope（只做该做的）

> **只修改当前任务真正需要修改的代码。**

**未经任务明确要求，禁止：**

- ❌ 大规模重构
- ❌ 修改其他页面（做 `/about` 就不要动 `/join`）
- ❌ 删除已有业务代码
- ❌ 重命名大量目录
- ❌ 全量格式化（会淹没真实改动）

**关于业务范围（重要）：**

模块职责见 `docs/architecture.md`，数据与接口约定见 `docs/contracts/`。当前任务没有明确要求时：

- ❌ 不要提前实现未经确认的业务页面或状态机
- ❌ 不要让页面组件或 Route Handler 直接查询 Prisma；必须经过 Feature Service / Repository
- ❌ 不要把 QQ、手机号、学号作为 User 本体、主键或跨领域外键
- ❌ 不要绕过统一 API 信封、错误码、权限与审计入口
- ❌ 不要改写已经提交或执行过的 Migration；修复必须新增前向 Migration

业务规则以现行公共契约、负责人确认的需求和当前模块任务书为准；
`docs/第二期需求分析文档.md` 仅供原始设计背景参考。只完成当前模块要求，
不要为了「考虑未来」提前实现不存在的业务。

公共组件 API 可为当前任务调整，先查调用方并说明兼容 / 迁移方案；依赖按第 1 节处理。不要借此重写未受影响的页面。

### 公共契约变更规则

以下属于高冲突公共契约：

- `prisma/schema.prisma` 与 `prisma/migrations/`
- `src/types/contracts.ts` 与 `src/lib/api/errors.ts`
- `docs/contracts/`、权限枚举、API 信封和跨模块 Service 接口

修改不强制走单独评审，但**必须先搜索并记录影响范围**。若影响其他模块，必须在同一变更中
同步贯通 Schema、前向 Migration、生成客户端、实现、调用方、Contract、测试与文档；不能只让
当前模块通过。无法安全贯通时停止修改并在 Issue / PR 中说明依赖。

---

## 4. Existing Code（优先复用）

> **已经存在且工作的代码应优先复用。**

- 注释只说明代码职责、约束和注意事项，不记录改动过程、验收轮次或 Issue 编号；显而易见的代码不加注释。
- ✅ 先搜索 `src/components/ui/` 与 `src/components/layout/`，确认没有现成实现再动手写。
- ✅ 先读 `src/config/`，确认要用的数据是否已经存在。
- ✅ 先读 `docs/design-system.md` 第 4 节，确认要用的视觉模式是否已经存在。
- ❌ 不要为了「代码更优雅」随意重写团队成员已经完成的内容。
- ❌ 不要把一个跨页面复用的区块留在页面专属目录里 —— 提升到 `components/ui/`。

---

## 5. 目录职责速查

| 路径                     | 放什么                                                           | 不放什么                 |
| ------------------------ | ---------------------------------------------------------------- | ------------------------ |
| `src/app/*/page.tsx`     | 路由、`metadata`、区块拼装                                       | 大段 JSX、文案、内联样式 |
| `src/components/layout/` | 全站骨架（Header / Footer / Container / PageHead / SiteEffects） | 页面专属内容             |
| `src/components/ui/`     | 跨页面复用的 UI 原语                                             | 只被一个页面用的东西     |
| `src/components/<页面>/` | 该页面专属区块                                                   | 跨页面复用的东西         |
| `src/config/`            | 站点配置、导航、页面文案数据                                     | 组件、逻辑               |
| `src/features/<领域>/`   | 领域 Service / Repository、事务边界                              | React 组件、页面文案     |
| `src/lib/`               | DB、API、权限、审计、安全与通用逻辑                              | React 组件               |
| `src/types/`             | 公共 Enum 与 API / Service Contract                              | Feature 私有实现         |
| `prisma/`                | Schema、前向 Migration、幂等 Seed                                | 手工生产数据修补         |
| `tests/`                 | 单元、Contract 与 GreatSQL 集成测试                              | 未隔离的生产数据访问     |
| `src/data/`              | 构建脚本生成的结构化数据                                         | 手写内容                 |
| `src/app/globals.css`    | 设计令牌 + 基础层 + 组件层                                       | 页面专属样式             |
| `public/`                | 字体、图片等静态资源                                             | 源码里能 import 的东西   |

完整的目录树与逐文件职责见 `docs/architecture.md` 第 2 节。

新增页面时的标准动作：

```text
1. src/app/<route>/page.tsx
2. src/components/<route>/         （如果需要页面专属区块）
3. src/config/<route>.ts           （文案与数据）
4. src/config/navigation.ts        （需要导航入口时登记，不把所有功能页加入公开导航）
```

---

## 6. 环境与命令

需要符合 `package.json` `engines` 的 Node.js（Prisma 7 要求 `^20.19 || ^22.12 || >=24.0`）与 **pnpm**。
当前 `packageManager` 固定 pnpm `12.4.1`，Corepack 至少需要 `0.34.5`。
先检查版本，再启用入口；旧版升级与 `pnpm.cjs` 错误处理见
[Windows 环境指南](docs/database-windows.md#31-corepack-兼容要求)。`corepack enable` 不会升级 Corepack 本身。

```bash
corepack --version        # 至少 0.34.5
corepack enable pnpm
corepack pnpm --version   # 当前应为 12.4.1
pnpm --version           # 应与上一条一致；不一致时先按环境指南排错
```

| 命令                         | 说明                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `pnpm install`               | 安装依赖、生成 Prisma Client，并补占位文档清单                                                                |
| `pnpm dev`                   | 启动开发服务器（`predev` 同样补清单）                                                                         |
| `pnpm build`                 | 生产构建，**含站内技术文档**（需要 mdBook，见第 7 节）                                                        |
| `pnpm build:site`            | 只编译官网，跳过文档构建（用当时磁盘上的清单，**不要用于部署**）                                              |
| `pnpm docs:build`            | 只生成站内技术文档到 `public/handbook/`                                                                       |
| `pnpm start`                 | 以生产模式启动（需先 build）                                                                                  |
| `pnpm lint`                  | `eslint .` + 主题调色板一致性校验，**必须 0 error**                                                           |
| `pnpm test`                  | 单元与 Contract 测试                                                                                          |
| `pnpm test:db`               | 真实 GreatSQL 集成测试                                                                                        |
| `pnpm db:migrate:deploy`     | 部署版本化 Migration                                                                                          |
| `pnpm db:seed`               | 幂等基础角色 Seed                                                                                             |
| `pnpm db:health`             | GreatSQL 连接与运行参数检查                                                                                   |
| `pnpm import:repair-history` | 历史修机数据导入（issue #72）：缺省 dry-run，确认后加 `--apply`；见 `tools/import-repair-history.ts` 头部说明 |
| `pnpm check:palette`         | 只跑调色板校验（官网与文档站两份令牌是否逐值一致）                                                            |
| `pnpm format`                | Prettier 格式化                                                                                               |
| `pnpm format:check`          | 检查格式是否符合规范                                                                                          |

> 不要用 npm / yarn，也不要删除 `pnpm-lock.yaml`。

### 6.1 `pnpm test:db` 必须指向独立测试库（已加闸门）

`pnpm test:db` 跑的是 `tests/integration/**`，它们用的都是 `.env` 里的 `DATABASE_URL`，
而本地 `.env` 指的是**开发库**。这些用例不是只读的：按前缀建夹具也按前缀删夹具，
其中 `m0-database.test.ts` 还会**整表清空** `user_identities` / `password_credentials` /
`member_profiles` / `audit_logs` 等表。**2026-09-23 实际发生过两次**：

1. 跑了一次 `pnpm test:db` → 开发库**所有账号一起失去登录身份**（登录报「QQ 号或密码错误」，
   因为查不到那条 QQ 身份），而 `users` 被
   `public_content_settings.updated_by_user_id` 的 RESTRICT 外键挡住，留下 254 个
   「有用户、没身份」的孤儿（验收账号 `123456` 就是这样失效的）；
2. 推导测试库 URL 的 `sed` 在 `.env` 多了 `?allowPublicKeyRetrieval=true` 之后**悄悄**
   匹配不上 → 40 秒里往开发库写进 49 个夹具档案与 2 条维修记录（那次靠下面的第二道闸门
   挡住了清库，没有重演第一次）。

所以现在有两道闸门（`tests/integration/db-guard.ts`），判据都是**库名以 `_test` 结尾**，
而不是「命令里有没有写 test:db」——真正决定数据落到哪里的是 `DATABASE_URL`：

| 闸门                           | 管什么                                   | 放行开关                       |
| ------------------------------ | ---------------------------------------- | ------------------------------ |
| `integrationTestsEnabled()`    | **全部**集成测试（每个文件加载时就检查） | `ALLOW_NON_TEST_DB=1`          |
| `assertDestructiveDbAllowed()` | 只有整表清空的那几个用例                 | `ALLOW_DESTRUCTIVE_DB_TESTS=1` |

两个开关刻意分开：为了对着 staging 库跑而设了前者，清库那一步仍然会停下来。
`pnpm test`（只跑单元与契约）不开集成测试，闸门保持安静、不抛错。

正确用法：

```bash
DATABASE_URL="mysql://app_user:change-me@127.0.0.1:3307/zafu_pchospital_test" pnpm test:db
```

> 另外：测试库是**共享**的，两套集成测试**不能并发**跑 —— 各自的 `prepareFixtures`
> 会按前缀删掉对方的夹具（实测出现过一条「默认顺序」用例偶发失败，单独重跑就过）。

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

文档仓库的 `theme/pc-hospital.css` 是 `globals.css` 主题层的**拷贝**（mdBook 只吃静态 CSS，
无法引用官网变量）。官网直接使用文档仓库 `book.toml` 配置的主题，不再维护本地副本。
**改了 `globals.css` 的主题层就必须同步改文档仓库**，否则 `pnpm lint` 失败。
`pnpm lint` 需有含主题的文档源码；路径选择与构建相同，`DOCS_SOURCE_DIR` 优先，
其次 `.docs-source/`

`.docs-source/` 是独立文档仓库的检出，可能包含 Mermaid 等第三方压缩脚本；
官网 ESLint 排除该目录，主题一致性仍由 `tools/check-theme-palette.mjs` 单独校验。
`.gitignore` 不会自动影响 ESLint 的扫描范围，新增外部检出目录时需同步确认 lint 边界。

---

## 8. 本地验证与截图

> **先读这一节再验证任何东西。** 验证围绕本轮影响，断言优先；临时脚本和截图放仓库外，
> 不维护逐页图库，也不为日常改动批量重拍。

### 8.1 验证优先级：断言 > 截图

1. **能用断言说清楚的，绝不截图。** 判「元素在不在、宽不宽、对齐对不对、请求发没发、
   文案是什么」，全部用 CDP 的 `Runtime.evaluate` 读 DOM / 读网络。截图只在**必须由人眼
   判断观感**时才拍（配色、间距是否协调、图标是否可辨这类没有客观判据的东西）。
2. **只验证这轮真正改到的视图。** 改了公共元素（页脚、导航、主题令牌）也**不必**全量重拍：
   先说明「哪些视图的观感确实变了」，只拍那几个，其余在提交信息里写清楚未重拍。
3. **验证按影响选择。** 纯文档检查格式、链接和规则一致性；纯文案或不改行为的组件整理通常无需浏览器。交互、鉴权或数据变化才补对应回归，详见第 10 节；不为“跑一遍流程”巡检整站。

CDP 脚本仍然有用，但用途是**断言**：

```bash
# 只收集 console 报错与运行时异常（跑完页面即退出，不产图）
node tools/console-probe.mjs http://localhost:3000/
```

需要登录态的页面（`/admin/**`、`/member/**`）用带调试端口的 Chrome 手动登录一次，
之后脚本复用同一个 profile 里的 Cookie：

```bash
chrome --headless=new --remote-debugging-port=9222 --user-data-dir=./.chrome-profile about:blank
```

### 8.2 临时产物：用完即删

- 验证脚本、探针、临时截图**一律不留在仓库里**。放仓库外的临时目录（本机约定 `C:\Temp` /
  `/tmp`），**任务结束前删掉**，不要在提交信息里留下 `dsh-*.mjs` 这类文件名。
- 仓库里只保留 `tools/` 下**长期有用**的脚本（`inspect.mjs` / `console-probe.mjs`）。
- 需要重放某次验证时再写一个新脚本，不要为了「以后可能用得上」攒一堆。

### 8.3 展示图片与验证截图

- 仓库仅在 `docs/assets/` 保留 README 使用的浅 / 深色首页预览，不再维护逐页成品图库。
- 这两张预览不随日常功能 PR 更新；确需替换时先确认展示范围，浅 / 深色成对、单独更新。
- PR 需要说明视觉变化时，只附本轮受影响视图的代表性截图；验证图片放仓库外，不加入源码目录。
- 截图不替代行为断言，也不作为当前功能清单；以代码、公共契约与测试为准。

模式必须在**文档创建之前**写进 `localStorage`（键见 `src/config/theme.ts`）。
用 `tools/inspect.mjs` 时它已经处理好；**不传 `THEME_MODE` 时它会主动清掉那个键**，
避免上一轮留下的深色选择把后面所有截图都拍成深色（这个坑踩过一次）。

```bash
THEME_MODE=normal CAP_SEL="#services" node tools/inspect.mjs URL /tmp/home-services-normal.png
THEME_MODE=dark   CAP_SEL="#services" node tools/inspect.mjs URL /tmp/home-services-dark.png
```

上述输出路径用于类 Unix 环境；Windows 使用仓库外的 `C:\Temp`，按所用 Shell 设置环境变量。

`inspect.mjs` 的环境变量：`CAP_SEL` / `CAP_Y`（截图前先滚到这里，触发进场动效）、
`CAP_X` / `CAP_W` / `CAP_H` / `CAP_SCALE`（截图区域）、`WAIT_MS`（载入后等待时长）、
`REDUCED_MOTION=1`、`THEME_MODE=normal|dark`。脚本最后打印的 `PAGE_PROBLEMS` 与
`BAD_REQUESTS` **两项都为空才算通过**。

---

## 9. 开工前必做

```bash
git status              # 确认工作区状态
git switch -c feat/xxx  # 确认不在 main 上直接开发
```

- 查看当前分支与已有文件，**不要直接删除现有项目内容**。
- 确认本次任务的范围，只改相关文件。
- 涉及公共契约时，用 `rg` 搜索所有消费者并列出跨模块影响。
- 按第 2 节处理常规设计取舍；业务含义、权限 / 隐私或范围存在实质不确定时，先与用户对齐。

---

## 10. 完工前：按影响验证并交回证据

先说明本轮改了什么、哪些风险实际变化，再选择最小必要检查。优先复用同一提交 / 同一实现且覆盖范围有效的结果；修复后只重跑受影响项，不把旧结果当成新实跑。开发期定向检查与最终工程检查由负责方协调，避免写手、主线和 CI 重复跑同一轮。

| 改动                            | 本轮必要验证                                                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 纯规范 / 文档                   | 改动段落格式、有效的本地链接 / 锚点、规则一致性、`git diff --check`；不因修改 Markdown 跑数据库或浏览器                |
| 文案 / 局部样式                 | 改动文件 lint / format；布局有变化时检查受影响视图的窄屏 / 桌面、长内容与焦点，不巡检整站                              |
| 分步表单 / 弹层 / 列表交互      | 复用组件 / DOM 断言，覆盖实际变化的在途、失败纠正、返回 / 重发、焦点与滚动保持；必要时才用浏览器                       |
| Service / HTTP / 鉴权           | 定向类型、单元 / Contract 与必要集成回归，重点覆盖真实的权限、隐私和事务变化，不逐接口堆重复套件                       |
| Schema / Migration              | 独立 `_test` GreatSQL、串行；新增前向迁移时验证空库、基线升级与重复 deploy。迁移未变不重跑三态，不默认跑全量 `test:db` |
| 公共组件 / 契约 / 依赖 / 构建链 | 先列真实消费者，再覆盖兼容性及相关构建；只有影响无法局部界定或实际失败需要时扩大验证                                   |

工程命令仍为 `pnpm lint`、`pnpm test`、`pnpm build`。合并所需 CI / 构建门槛保持有效，不以定向结果冒充完整通过；同提交已有有效 CI 时可复用，记录来源，不要求每次文档或返修在本机重跑全部命令。CI 触发与必需检查由第 11 节及仓库配置决定，本条不修改流水线。

`pnpm build` 含 `docs:build`，发布产物必须包含文档站；`build:site` 只能作为官网快速自检，不能冒充完整构建或用于部署。主题令牌变更仍须同步文档仓库并校验调色板（第 7 节）。

交回列明：

- 实际运行、复用、未运行的验证及原因；未通过项与剩余风险，不虚报全量检查。
- 公共契约 / 组件受影响的调用方是否已贯通，是否有 Migration / 新依赖。
- 受影响视图的可用性与设计取舍；只有涉及布局 / 交互时才检查相应桌面 / 窄屏、焦点、溢出和运行时错误。
- 工作目录、分支、HEAD、status 与未提交 / 新文件；Git 操作按用户本轮授权执行。

不常规增加压测、时序穷举、依赖或全仓安全审计；发现具体风险再补能回答该风险的验证。分支与提交规范见 [Git 工作流](docs/git-workflow.md)，**禁止直接 push `main`**。

---

## 11. CI 与部署

`.github/workflows/ci.yml` 在 **PR** 与 **push 到 `main`** 时运行（也可手动触发），**只校验与构建，不执行部署**：

1. 解析并固定文档版本（`DOCS_REF` → sha，保证构建可复现）
2. 把文档仓库检出到 `.docs-source/`
3. 安装**固定版** mdBook（版本写在 workflow 的 `MDBOOK_VERSION`，不用 `latest`）
4. `pnpm install` → `pnpm audit`（**不阻断**，见下）→ `pnpm lint` → `pnpm build`（含文档）
5. 校验构建产物：`public/handbook/index.html`、`searchindex`、官网主题 CSS/JS、清单结构
6. 起生产服务冒烟：`/`、`/about`、`/join`、`/docs`、`/handbook/` 必须全部 200

`main` 合并后不会自动发布：生产部署由维护者在本地按 [README 的「部署与维护」](README.md#部署与维护)
执行 `tools/deploy/deploy-prod.sh`（本地构建、备份、迁移核对、原子切换与回滚）。

**依赖漏洞审计：**

`pnpm audit` 在 CI 里**只警告不阻断**（`--audit-level=high`，报出的 high/critical 会打成
`::warning::` 注解）。它给出的是一份**待办清单**，不是「构建失败」—— 看到注解就按 GHSA
链接评估、单独提升级 PR，不要在同一个 PR 里顺手升级依赖。依赖自动更新（Dependabot）
**暂不启用**，依赖升级由人按审计结果手工做。

安全升级时同步 `package.json`、`pnpm-lock.yaml` 与相关版本文档；Prisma Client、CLI 和
adapter 保持同版，并确认项目直接依赖与 adapter 下的 MariaDB 都已升级。验证按第 10 节
选择，升级后复跑 `pnpm audit`，交回剩余告警与未覆盖的回归范围。

传递依赖覆盖集中在 `pnpm-workspace.yaml`，优先限定父包并记录兼容性与移除条件。
当前 `next>postcss` 覆盖固定的旧版 PostCSS，待 Next 的依赖包含 source-map 修复后移除；
`exceljs>uuid` 使用仍支持 CommonJS 的 `11.1.1`，兼容 ExcelJS 的 `v4()` 调用，待其上游
依赖包含缓冲区边界修复后移除。调整覆盖时验证完整构建与实际 Excel 导出路径。

**仓库侧设置（代码里做不到，只能上 GitHub 改）：**

- **`main` 的保护已生效**：仓库 ruleset「default」（Settings → Rules → Rulesets）
  要求所有改动走 PR，并把 `校验与构建` 设为必需状态检查，同时禁止强推与删除。
  后果：**直接 push `main` 会被拒绝**（ADMIN 也一样），PR 必须等 CI 绿了才能合并；
  0 个 approving review 即可自合并，允许的合并方式只有 squash / merge。
  要调整这些约束就改 ruleset，不要在 workflow 里想办法绕过去。
- **CI 不部署生产**：workflow 中没有部署 job，也不需要 `DEPLOY_COMMAND` 之类的部署变量；
  CI 绿色只代表校验与构建通过，不代表已发布。

可选：设置仓库变量 `DOCS_REF` 指定文档仓库的分支（默认 `main`）。

---

## 12. 一句话总结

> 保持风格统一、目录清晰、改动最小。
> 有疑问先读文档，读不到就问，**不要猜**。
