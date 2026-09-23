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

浙江农林大学电脑医院官网与社团综合服务平台。第一阶段官网框架保持稳定，当前进入
**Phase 2 模块化开发**；M0 已建立 GreatSQL 与公共契约，M1 在此基础上实现数据库 Session、
QQ 身份登录、首次改密、成员账号发放与核心管理 API。

---

## 1. 技术栈（不得擅自更换）

| 项目     | 当前选择                                       |
| -------- | ---------------------------------------------- |
| 框架     | Next.js 15（App Router）                       |
| 语言     | TypeScript（strict）                           |
| 样式     | Tailwind CSS v4 + `src/app/globals.css` 组件层 |
| 数据库   | **GreatSQL 8.0.32-27**（InnoDB / UTC）         |
| 数据访问 | **Prisma 7.10.0** + MariaDB driver adapter     |
| 包管理器 | **pnpm**（锁文件 `pnpm-lock.yaml`）            |
| 测试规范 | Node test runner（tsx）+ ESLint + Prettier     |

**禁止 Agent 擅自：**

- ❌ 更换框架（不要引入 Vite / Nuxt / Astro / Remix）
- ❌ 更换包管理器（不要改用 npm / yarn，不要删除 `pnpm-lock.yaml`）
- ❌ 引入另一套 CSS 体系（不要引入 styled-components / emotion / CSS Modules 体系 / Sass / Less）
- ❌ 引入另一套 UI Framework（不要引入 MUI / Ant Design / Chakra / Bootstrap）
- ❌ 引入状态管理库、动画库、图标库、`clsx` / `tailwind-merge`
- ❌ 安装大型新依赖（新增任何运行时依赖都必须在 PR 中单独说明理由）
- ❌ 更换 GreatSQL / Prisma 或改用另一套 ORM；禁止用 `prisma db push`、手工 DDL 代替 Migration

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
- ✅ **响应操作时不要改变页面格局**（见下方「### 交互不得夺走操控权」）

### 交互不得夺走操控权

**用户的每一次点击之后，页面上已有元素的位置都不应该变。** 这条规则来自三次实际反馈：

| 踩到的写法                                          | 用户感受到的                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| 点「停用」时把表格卸载再挂回（`state = "loading"`） | 页面高度瞬间塌陷，浏览器把滚动位置夹回顶部 →「点一下就被弹回页首」 |
| 批量操作条插在筛选栏与表格之间，勾选时出现          | 整张表往下跳一段，取消选择又跳回去 →「界面在我手里乱动」           |
| 成功反馈内联插一行文字                              | 下面的表单与表格被顶下去，而且那行不会自己消失                     |

**必须做到：**

- ✅ 反馈用**不参与布局**的浮层（`AdminToast`，`position: fixed`），不要内联插一行
- ✅ 需要「随状态出现的东西」优先做成**常驻工具栏**（`AdminListToolbar`：按钮一直在，
  未选中时置灰），这样根本不存在出现/消失，也就没有位移；兜底方案才是固定定位的浮层
- ✅ 重载数据时**保持已渲染的内容**（`useAdminList` 已经保证：只有首次加载才进 `loading`），
  写操作之后不该再出现整块骨架
- ✅ 新内容优先**原地替换**（换行数据、改文本），而不是先卸载再挂载
- ✅ 列表取数与「往下滚动自动加载下一页」统一用 `components/admin/useAdminList.tsx` 的
  `useAdminList` + `AdminListEnd`，不要再写第二份分页逻辑
- ✅ 批量操作条统一用 `components/admin/AdminBatchTools.tsx`：结构固定为
  `[全选] [已选择 N 项 / 未选择记录] │ [批量动作…] [取消选择]`，各列表只传动作按钮；
  需要额外输入的批量动作（如批量退回要填原因）放**弹层**，不要塞进顶栏
- ✅ 列表顺序调整统一用 `components/admin/useRowDragSort.ts` 的拖动排序：
  **只有行首手柄 `draggable`**（整行可拖会让表格里的文字选不中），
  落点按目标行的上半 / 下半判断（否则永远拖不到末尾），
  指示线用绝对定位伪元素（`border` 会改行高、`box-shadow` 是禁止项），
  同时保留 ↑ ↓ 按钮给键盘与触屏（HTML5 拖放在触屏上不触发）

**禁止：**

- ❌ 在用户操作后插入/移除会占位的元素，让下方内容位移
- ❌ 用「把整块内容卸载掉」来表达加载中
- ❌ 用滚动位置变化来「提示」用户某事发生了
- ❌ 同一件事在两个页面各写一遍（批量条、分页、拖动排序都踩过：两处长得不一样，
  用户立刻会问「为什么这里和那里不同」）

> 判据很简单：**操作前后截图对比，除了用户明确要改的那一处，其它像素不该移动。**
> 这条规则与「不加装饰性动画」是同一条思路的两面：界面不主动抢注意力。

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

Phase 2 按 M0–M7 分模块实施，状态和依赖见 `docs/phase2-development.md`。当前任务没有明确要求时：

- ❌ 不要提前实现其他里程碑的完整业务页面或状态机
- ❌ 不要让页面组件或 Route Handler 直接查询 Prisma；必须经过 Feature Service / Repository
- ❌ 不要把 QQ、手机号、学号作为 User 本体、主键或跨领域外键
- ❌ 不要绕过统一 API 信封、错误码、权限与审计入口
- ❌ 不要改写已经提交或执行过的 Migration；修复必须新增前向 Migration

业务规则以 `docs/第二期需求分析文档.md` 和当前模块任务书为准。只完成当前模块要求，
不要为了「考虑未来」提前实现不存在的业务。

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
4. src/config/navigation.ts        （登记导航项）
```

---

## 6. 环境与命令

需要符合 `package.json` `engines` 的 Node.js（Prisma 7 要求 `^20.19 || ^22.12 || >=24.0`）与 **pnpm**。
本机未启用 Corepack 时先执行一次：

```bash
corepack enable   # 之后 pnpm 会自动使用 packageManager 里固定的版本
```

| 命令                     | 说明                                                             |
| ------------------------ | ---------------------------------------------------------------- |
| `pnpm install`           | 安装依赖、生成 Prisma Client，并补占位文档清单                   |
| `pnpm dev`               | 启动开发服务器（`predev` 同样补清单）                            |
| `pnpm build`             | 生产构建，**含站内技术文档**（需要 mdBook，见第 7 节）           |
| `pnpm build:site`        | 只编译官网，跳过文档构建（用当时磁盘上的清单，**不要用于部署**） |
| `pnpm docs:build`        | 只生成站内技术文档到 `public/handbook/`                          |
| `pnpm start`             | 以生产模式启动（需先 build）                                     |
| `pnpm lint`              | `eslint .` + 主题调色板一致性校验，**必须 0 error**              |
| `pnpm test`              | 单元与 Contract 测试                                             |
| `pnpm test:db`           | 真实 GreatSQL 集成测试                                           |
| `pnpm db:migrate:deploy` | 部署版本化 Migration                                             |
| `pnpm db:seed`           | 幂等基础角色 Seed                                                |
| `pnpm db:health`         | GreatSQL 连接与运行参数检查                                      |
| `pnpm check:palette`     | 只跑调色板校验（官网与文档站两份令牌是否逐值一致）               |
| `pnpm format`            | Prettier 格式化                                                  |
| `pnpm format:check`      | 检查格式是否符合规范                                             |

> 不要用 npm / yarn，也不要删除 `pnpm-lock.yaml`。

### 6.1 `pnpm test:db` 必须指向独立测试库（已加闸门）

`pnpm test:db` 跑的是 `tests/integration/**`，其中 `m0-database.test.ts` 会**整表清空**
`user_identities` / `password_credentials` / `member_profiles` / `audit_logs` 等表，
而它用的是 `.env` 里的 `DATABASE_URL` —— 本地 `.env` 指的是**开发库**。
两者一凑就是：跑一遍测试 → 开发库所有账号同时失去登录身份（登录报「QQ 号或密码错误」，
因为查不到那条 QQ 身份），而 `users` 会被
`public_content_settings.updated_by_user_id` 的 RESTRICT 外键挡住、留下一堆「有用户没身份」的孤儿。
**2026-09-23 实际发生过一次**（验收账号 `123456` 就是这样失效的）。

所以破坏性用例现在过了闸门（`tests/integration/db-guard.ts`）：库名不以 `_test` 结尾就
直接拒绝执行，并在报错里给出正确命令。正确用法：

```bash
DATABASE_URL="mysql://app_user:change-me@127.0.0.1:3307/zafu_pchospital_test" pnpm test:db
```

确实要对着某个库清空时，显式设置 `ALLOW_DESTRUCTIVE_DB_TESTS=1` 放行。

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

> **先读这一节再验证任何东西。** 踩过的坑：每改一点就把 `shots/` 里的几十张图重拍一遍，
> 一轮下来几分钟没了，diff 里全是二进制噪声，临时脚本和临时图堆在仓库和 `C:\Temp` 里没人清。
> 下面三条是硬规则。

### 8.1 验证优先级：断言 > 截图

1. **能用断言说清楚的，绝不截图。** 判「元素在不在、宽不宽、对齐对不对、请求发没发、
   文案是什么」，全部用 CDP 的 `Runtime.evaluate` 读 DOM / 读网络。截图只在**必须由人眼
   判断观感**时才拍（配色、间距是否协调、图标是否可辨这类没有客观判据的东西）。
2. **只验证这轮真正改到的视图。** 改了公共元素（页脚、导航、主题令牌）也**不必**全量重拍：
   先说明「哪些视图的观感确实变了」，只拍那几个，其余在提交信息里写清楚未重拍。
3. **不需要验证的界面就不验证。** 只改了服务端逻辑、只改了文案字符串、只重构了组件内部，
   跑测试与 lint 即可，不要为了「跑一遍流程」去开浏览器。

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

### 8.3 shots/ 不进日常提交（第三次反馈后定稿的规则）

`shots/` 是**对外展示用的成品图库**，不是验证缓存，也不是「代码变了就得跟着变」的镜像。

**硬规则：**

- ❌ **日常提交里不允许出现 `shots/**` 的改动。** 二进制 diff 无法 review，每次 commit 都改
  几十张图会让人没法看这次到底改了什么 —— 已经因此被明确要求停止。
- ✅ 需要重拍时**先问人**，并且**等一批功能全部做完**再一次性拍（「做完这一批你跟我确认再拍」）。
- ✅ 拍的时候**只拍确认过的那几个编号**，同一编号两种模式成对更新；不要顺手全量重拍。
- ✅ 图库更新的那次提交**只包含图片**，不夹带代码改动，方便单独 review / revert。
- 图库与当前代码不一致**是可接受的**：以代码、`docs/` 与测试为准；图库说明的是
  「上一次确认过的样子」，在文件不够新时**不要**因为「看起来不一致」就去重拍。

`shots/` 的命名规范（`<编号>-<页面>-<视图>-<模式>.png`，模式取 `normal` / `dark`，
同一编号成对出现）继续有效：

```text
01-home-desktop-normal.png       01-home-desktop-dark.png
14-join-signup-done-normal.png   14-join-signup-done-dark.png
```

站点有两套主题，主题改的不只是颜色（走线栅格、扫描线、水印描边、索引栏面板色、准星混合
模式都随主题变），所以**同一个视图的两种模式要么一起更新、要么都不动**。

模式必须在**文档创建之前**写进 `localStorage`（键见 `src/config/theme.ts`）。
用 `tools/inspect.mjs` 时它已经处理好；**不传 `THEME_MODE` 时它会主动清掉那个键**，
避免上一轮留下的深色选择把后面所有截图都拍成深色（这个坑踩过一次）。

```bash
THEME_MODE=normal CAP_SEL="#services" node tools/inspect.mjs URL shots/02-home-services-normal.png
THEME_MODE=dark   CAP_SEL="#services" node tools/inspect.mjs URL shots/02-home-services-dark.png
```

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
- 不确定的视觉、文案、业务判断，**先问再做**。

---

## 10. 完工前必做

```bash
pnpm lint      # 必须 0 error（除 ESLint 外还会校验主题调色板一致性）
pnpm test      # 单元与 Contract 测试必须通过
pnpm build     # 必须成功；已包含站内文档构建，需要 mdBook（见第 7 节）
```

浏览器验证**按第 8 节的规则做**：能用断言说清楚的就用 CDP 断言，截图只在需要人眼判断观感时拍，
且只拍受影响的视图。不要为了「走一遍流程」把整站重拍一遍。

> **`pnpm build` 已包含 `docs:build`**，所以标准构建一定产出完整的站内文档。
> 不要为了绕开 mdBook 而改用 `pnpm build:site` 就宣布完工 —— 它只编译官网，
> `/handbook/` 会缺失，`/docs` 页的链接全部 404。只改页面、本机确实没有 mdBook 时
> 可以用它做快速自检，但必须在 PR 描述里说明「未验证文档构建」。
>
> **改了 `globals.css` 的主题层，必须同步改 `tools/mdbook-theme/pc-hospital.css`
> 的对应主题块**，否则 `pnpm lint` 会直接失败。

自检清单：

- [ ] `pnpm lint` 通过
- [ ] `pnpm test` 通过；涉及数据库时 `pnpm test:db` 连接真实 GreatSQL 通过
- [ ] `pnpm build` 通过
- [ ] Migration 在空库可部署，重复 deploy 无待执行项；已有基线变更提供升级测试
- [ ] 公共契约的所有受影响模块、调用方、测试和文档已同步贯通
- [ ] Desktop（≥1100px）与 Mobile（<760px）都正常
- [ ] 无横向溢出
- [ ] Console 无报错
- [ ] 未偏离 `docs/design-system.md`
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

**仓库侧设置（代码里做不到，只能上 GitHub 改）：**

- **`main` 的保护已生效**：仓库 ruleset「default」（Settings → Rules → Rulesets）
  要求所有改动走 PR，并把 `校验与构建` 设为必需状态检查，同时禁止强推与删除。
  后果：**直接 push `main` 会被拒绝**（ADMIN 也一样），PR 必须等 CI 绿了才能合并；
  0 个 approving review 即可自合并，允许的合并方式只有 squash / merge。
  要调整这些约束就改 ruleset，不要在 workflow 里想办法绕过去。
- **部署尚未配置**：需要在仓库变量里设置 `DEPLOY_COMMAND`（部署目标尚未确定，见
  workflow 内注释）。未配置时部署步骤只打印 `::warning::`，不会失败。

可选：设置仓库变量 `DOCS_REF` 指定文档仓库的分支（默认 `main`）。

---

## 12. 一句话总结

> 保持风格统一、目录清晰、改动最小。
> 有疑问先读文档，读不到就问，**不要猜**。
