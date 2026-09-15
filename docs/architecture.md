# Architecture

> 目标：新成员看 5～10 分钟，就知道代码应该放在哪里。
> 本文件只讲「放哪里」和「为什么这么放」，不讲业务细节。

---

## 1. 技术栈

| 项目       | 选择                                 | 说明                                                |
| ---------- | ------------------------------------ | --------------------------------------------------- |
| 框架       | **Next.js 15**（App Router）         | 页面、Route Handler 与生产服务端                    |
| 语言       | **TypeScript**（strict）             | 全量类型检查，不允许 `any` 兜底                     |
| 样式       | **Tailwind CSS v4**                  | 工具类 + `globals.css` 中的组件层                   |
| 数据库     | **GreatSQL 8.0.32-27**               | InnoDB、`utf8mb4_unicode_ci`、UTC                   |
| 数据访问   | **Prisma 7.10.0** + MariaDB adapter  | 版本化 Migration；应用层连接池                      |
| 包管理     | **pnpm 12.4.1**                      | 锁文件为 `pnpm-lock.yaml`                           |
| 测试与规范 | Node test runner + ESLint + Prettier | `pnpm test` / `pnpm lint` / `pnpm format`           |
| 部署形态   | 静态公开页 + Node.js 服务端          | Phase 2 完整形态必须运行 `next build && next start` |

**不允许更换以上任何一项。** 详见 `AGENTS.md`。

未引入的依赖（刻意的）：状态管理库、组件库（shadcn/ui 等）、CSS-in-JS、动画库、`clsx` / `tailwind-merge`。
当前阶段的界面复杂度不需要它们；确需引入时先在 PR 中说明理由。

---

## 2. 目录结构

```text
.
├── AGENTS.md                  # 给 AI Agent 的项目规则（必读）
├── README.md                  # 项目说明与上手步骤
├── docs/                      # 协作文档
│   ├── design-system.md       # 视觉唯一来源
│   ├── architecture.md        # 本文件
│   ├── database.md            # GreatSQL / Migration / Seed / 运维基线
│   ├── contracts/             # 数据与 API 公共契约
│   ├── phase2-development.md  # 模块状态、依赖与协作规则
│   └── git-workflow.md        # 分支与 PR 流程
│
├── prisma/
│   ├── schema.prisma          # 公共数据库 Schema
│   ├── migrations/            # 只追加的版本化前向 Migration
│   └── seed.ts                # 幂等基础角色 Seed
├── compose.greatsql.yml       # 固定 GreatSQL 版本的本地环境
│
├── src/
│   ├── app/                   # 路由与页面（Next.js App Router）
│   │   ├── api/v1/            # 薄 Route Handler：解析、授权、调用 Service、包装响应
│   │   ├── layout.tsx         # 根布局：Header / Footer / SiteEffects
│   │   ├── globals.css        # 设计令牌 + 基础层 + 组件层（设计系统的工程落地）
│   │   ├── page.tsx           # /
│   │   ├── about/page.tsx     # /about
│   │   ├── join/page.tsx      # /join
│   │   ├── docs/page.tsx      # /docs
│   │   ├── not-found.tsx      # 404
│   │   └── icon.svg           # 站点图标
│   │
│   ├── components/
│   │   ├── layout/            # 全站级骨架组件（Header / Footer / Container /
│   │   │                      #   PageHead / SiteEffects / ThemeSwitcher）
│   │   ├── ui/                # 通用 UI 原语
│   │   ├── home/              # 仅首页使用的区块
│   │   ├── docs/              # 文档相关区块（首页与 /docs 共用）
│   │   └── join/              # /join 的登记表区块（客户端组件）
│   │
│   ├── config/                # 站点配置与页面文案数据
│   │   ├── site.ts            # 站点信息、外链、联系方式、文档仓库、二维码
│   │   ├── navigation.ts      # 导航菜单（新增页面只改这里）
│   │   ├── theme.ts           # 主题注册表与「模式 → 主题」映射
│   │   ├── home.ts            # 首页文案与服务/流程数据
│   │   ├── about.ts           # /about 文案
│   │   └── join.ts            # /join 文案
│   │
│   ├── lib/                   # 无 UI 的纯逻辑
│   │   ├── db/                # Prisma client、事务和隔离级别
│   │   ├── api/               # 信封、错误、requestId、分页、限流接口
│   │   ├── auth/              # 权限定义与授权骨架
│   │   ├── audit/             # 审计写入与脱敏
│   │   └── security/          # 摘要、规范化、凭据工具
│   ├── features/              # 按领域组织 Service / Repository
│   │   ├── recruitment/       # JoinApplication
│   │   ├── invitations/       # InviteCode 与原子兑换
│   │   └── accounts/          # AccountProvision
│   ├── types/                 # 公共 Enum / API / Service Contract 唯一事实来源
│   │
│   └── data/
│       └── doc-manifest.json  # 文档仓库清单（由文档仓库构建脚本生成）
│
├── public/
│   ├── fonts/archivo-latin-wdth.woff2   # 品牌可变字体
│   └── handbook/              # 【生成物】站内技术文档，由 pnpm docs:build 产出，已 gitignore
│
├── tools/                     # 构建工具与本地验证脚本（不参与运行时）
│   ├── build-docs.mjs         # 站内文档构建：mdBook 产物 → public/handbook/ + 生成清单
│   ├── mdbook-theme/          # 官网同款 mdBook 主题（pc-hospital.css / pc-hospital.js）
│   ├── check-theme-palette.mjs# 校验官网与文档站的调色板没有漂移
│   ├── inspect.mjs            # 页面诊断与截图（CDP）
│   └── console-probe.mjs      # 收集 console 报错与运行时异常（CDP）
├── tests/                     # 单元、Contract 与真实 GreatSQL 集成测试
│
├── .docs-source/              # 【本地产物】文档仓库检出，docs:build 缺省时自动浅克隆，已 gitignore
└── shots/                     # 视觉验证截图（tools/inspect.mjs 产出，每个视图 normal / dark 各一张）
```

---

## 3. 各层职责

### 3.1 `src/app/` —— 路由与页面

- 页面只做三件事：定义路由、导出 `metadata`、把区块组件按顺序拼起来。
- 页面文件里**不应该**出现大段 JSX 结构、内联样式或业务文案。
- 页面文案来自 `src/config/`，视觉来自 `components/`。
- 全局样式只在 `app/globals.css` 一处，页面不要新建 CSS 文件。
- `app/api/v1/**/route.ts` 只做 HTTP 解析、requestId、授权、调用 Feature Service 和响应包装；
  不在 Route Handler 中直接写 Prisma 查询或跨领域事务。

> 判断标准：如果 `page.tsx` 超过约 120 行，说明有区块该抽成组件了。

### 3.2 `src/components/layout/` —— 全站骨架

放**每个页面都出现**的东西：`Header`、`Footer`、`Container`、`PageHead`、`SiteEffects`。

规则：

- 全站唯一，**不允许在页面里重复实现** Header / Footer。
- 需要新增导航项 → 改 `src/config/navigation.ts`，不要改组件。
- 这些组件的 API 变更属于**破坏性变更**，必须单独 PR 并说明影响范围。

### 3.3 `src/components/ui/` —— 通用 UI 原语

放**跨页面复用、视觉稳定**的基础件：`Button`、`Card`、`Section`、`SectionHead`、`SectionTitle`、`Reveal`、`Readout`、`Icon`、`ServiceList`、`ChannelList`。

规则：

- 只抽真正重复的模式。**不要为了「组件化」把每一行 JSX 都拆成组件。**
- 新增原语前先确认 `components/ui/` 里没有可以复用的。
- 样式写在 `globals.css` 的组件层，组件只负责结构、变体与语义。

### 3.4 `src/components/<页面名>/` —— 页面专属区块

只被某一个页面使用的区块放这里。例如 `home/Hero.tsx` 只服务首页。

规则：

- 归属明确：新页面 → 新建同名目录。
- 如果某个区块被两个页面用到，**提升到 `components/ui/`**，不要跨页面目录互相引用。

### 3.5 `src/config/` —— 全局配置与文案

- 站点信息、外链、联系方式、导航 → `site.ts` / `navigation.ts`
- 页面文案与列表数据 → `home.ts` / `about.ts` / `join.ts`

规则：

- **禁止**把文案与列表数据硬编码散落在组件中。
- 需要社团确认的内容（值班地点、招新时间等）写成显式字段并在页面上标注「待补充」，不要编造。
- 新增页面时同步新建对应配置文件。

### 3.6 `src/lib/` —— 跨领域基础设施

这里放不依赖 React 的共享能力：`db/` 管理 Prisma client 与事务，`api/` 管理响应信封、
错误码、requestId、分页和限流接口，`auth/` 管理授权骨架，`audit/` 管理审计与脱敏，
`security/` 管理摘要、身份规范化和凭据工具。现有 `utils.ts`、`theme.ts`、`docs.ts` 继续保留。

规则：这里不放 React 组件，不放 Feature 专属状态机；敏感值不得写入日志或错误响应。

### 3.7 `src/features/` —— 领域能力与事务边界

- Feature Service 承载业务不变量、权限二次校验、幂等和跨表事务。
- Repository 封装领域数据访问，默认查询必须处理 `deletedAt: null`。
- 页面和 Route Handler 不得绕过 Service 直接访问 Prisma。
- 跨领域事务必须显式设计；邀请码兑换和账号发放的原子性约束见数据契约。

### 3.8 `src/types/` 与 `docs/contracts/` —— 公共契约

`src/types/contracts.ts` 是公共 Enum 与 TypeScript Contract 的代码事实来源；
`docs/contracts/` 记录给开发者和接口消费者阅读的稳定语义。两者修改必须保持一致。

修改公共契约前先用 `rg` 找出全部消费者。若影响其他模块，必须在同一变更中同步贯通
Schema、前向 Migration、生成客户端、Service、Route、调用方、测试与文档。

### 3.9 `prisma/` —— 数据库版本

- `schema.prisma`：当前完整数据库形状。
- `migrations/`：发布历史，只追加；已经提交或执行的 Migration 不得改写。
- `seed.ts`：幂等基础数据，不写入真实用户或生产凭据。

具体流程见 `docs/database.md`。禁止 `prisma db push` 和绕过 Migration 的手工 DDL。

### 3.10 `src/data/` —— 结构化数据

- `doc-manifest.json`：文档仓库清单，**由文档仓库的构建脚本生成，不要手改**。
- 更新方式：运行 `pnpm docs:build`，从同一份文档源码生成 mdBook 正文并覆盖清单。

### 3.11 `public/` —— 静态资源

- `fonts/`：品牌字体
- `handbook/`：**生成物**，站内技术文档（mdBook 产物），由 `pnpm docs:build` 写入，
  已 gitignore。不要手改里面的任何文件，也不要提交它。
- 其余图片、图标按需新增

规则：

- 图标优先使用 `components/ui/Icon.tsx` 的内联 SVG（24 格 / stroke 2 / round 端点），不要引入图标库。
- 不要往 `public/` 放源码里可以 import 的资源。

### 3.12 `tools/` —— 构建工具与本地验证

放**不参与运行时**的脚本：文档构建、调色板校验、基于 CDP 的本地诊断。

#### 站内技术文档（mdBook）

技术文档的正文维护在独立仓库 `ZAFU-PCHospital-Doc`，在**官网构建期**生成到同域
`public/handbook/`，`/docs` 页只指向站内路径，不再外链 GitHub。

```text
ZAFU-PCHospital-Doc ──► .docs-source/ ──► mdbook build ──► public/handbook/
        （自动浅克隆）      （本地产物）      + 官网定制主题     （生成物，已 gitignore）
```

- `build-docs.mjs`：唯一入口。缺 `.docs-source/` 时**自动浅克隆**；产出 mdBook 正文
  与 `src/data/doc-manifest.json`。
- `mdbook-theme/`：官网同款的 mdBook 主题。mdBook 只吃静态 CSS，无法引用官网变量，
  所以这里的 `--pc-*` 是 `globals.css` 主题层的**拷贝** —— 见下一条。
- 环境变量：`DOCS_SOURCE_DIR`（指向已有的文档检出）、`MDBOOK_BIN`（mdbook 可执行文件）、
  `DOCS_OFFLINE=1`（禁止联网克隆）、`DOCS_SHA`（覆盖清单里记录的版本号）。

`pnpm build` **已包含** `docs:build`，所以标准构建一定产出完整站点；
只想快速编译官网源码时用 `pnpm build:site`。

#### 调色板一致性

`tools/check-theme-palette.mjs` 校验官网与文档站两份调色板逐值一致，
并校验主题存储键在 `src/lib/theme.ts` 与 `build-docs.mjs` 里相同。
它挂在 `pnpm lint` 后面（也可单独跑 `pnpm check:palette`）——
**改 `globals.css` 的主题层时必须同步改 `tools/mdbook-theme/pc-hospital.css` 对应主题块**，
否则 lint 直接失败。

#### 本地诊断

`inspect.mjs` / `console-probe.mjs` 基于 Chrome DevTools Protocol，用法见 `AGENTS.md` 第 8 节。

---

## 4. 数据流

```text
Browser
  ├── public page ──► app/*/page.tsx ──► components/** ──► HTML
  └── /api/v1 ─────► Route Handler ──► Feature Service ──► Repository ──► Prisma ──► GreatSQL
                            │                 │
                            ├── API envelope  ├── authorization / audit
                            └── requestId     └── transaction / idempotency
```

- 配置与数据**只向下流动**：页面读取配置，组件通过 props 接收数据。
- 组件**不直接 import** `src/config/` 里的页面文案（`DocList` 这类纯展示组件除外）。
- 公开内容页仍优先静态生成；Phase 2 API 和数据库访问只在 Node.js 服务端执行。
- 浏览器不得持有 `DATABASE_URL`、pepper 或数据库权限，也不得直连 GreatSQL。
- 招募批次由服务端配置决定；QQ / 手机号只作为身份或联系方式，不作为 User 主键。

---

## 5. 样式分层

`src/app/globals.css` 是唯一的样式入口，分四段：

| 段                  | 内容                                          | 谁可以改     |
| ------------------- | --------------------------------------------- | ------------ |
| `:root`             | 主题无关令牌 + 默认主题的语义色（无脚本兜底） | 需要设计确认 |
| 主题层              | `html[data-theme="<id>"]`，一个主题一段       | 需要设计确认 |
| `@theme inline`     | 令牌到 Tailwind 命名空间的映射                | 需要设计确认 |
| `@layer base`       | 重置与全局元素样式                            | 谨慎         |
| `@layer components` | 稳定可复用的视觉模式                          | 常规开发     |

组件里优先使用 **Tailwind 工具类**；复杂且稳定的模式使用**组件类**。
不要写行内 `style`（`--i` 这类 CSS 变量除外）。

### 5.1 主题系统（Theme）

页面结构不参与主题，主题只作用在语义令牌这一层。完整视觉约定见
`docs/design-system.md` 第 9 节，这里只记录「代码放在哪、状态存在哪」。

| 关注点         | 位置                                                                  |
| -------------- | --------------------------------------------------------------------- |
| Theme Registry | `src/config/theme.ts` → `themeRegistry`（主题身份与元数据）           |
| Theme Config   | `src/config/theme.ts` → `siteThemeConfig`（模式 → 主题的映射）        |
| Theme Resolver | `src/config/theme.ts` → `resolveTheme(mode)`                          |
| 主题取值       | `src/app/globals.css` 主题层，选择器 `html[data-theme="<id>"]`        |
| 持久化         | `localStorage`，键 `zafu-pchospital:theme-mode`（`src/lib/theme.ts`） |
| 运行时         | `src/lib/theme.ts`：读写 DOM、订阅、生成引导脚本                      |
| 用户入口       | `src/components/layout/ThemeSwitcher.tsx`，挂在 Header 的索引栏与浮层 |
| HTML 表达      | `<html data-mode="normal\|dark" data-theme="<ThemeId>">`              |

**首次访问的默认值**：本地无保存偏好时跟随系统 `prefers-color-scheme`，
否则落到 `DEFAULT_THEME_MODE`。一旦用户点过切换，就以本地保存的选择为准。

**防闪烁**：`app/layout.tsx` 在 `<body>` 起始处注入一段同步内联脚本，
在首次绘制前把 `data-mode` / `data-theme` / `theme-color` 写好。
脚本内容由 `buildThemeBootstrapScript()` 从主题注册表生成，
**不要在 `layout.tsx` 里硬编码主题名或色值**。

**为什么不用 CSS 媒体查询兜底无脚本场景**：那会把深色主题的色值写两遍
（媒体查询一份、属性选择器一份），造成两个事实来源。当前取舍是：
无脚本时回落到默认主题，并在文档里写明。

**未来管理员后台**只负责改变 `siteThemeConfig` 里
「normal → 哪个 ThemeId / dark → 哪个 ThemeId」的映射，
数据来源由静态配置换成数据库读取即可。页面与组件一行都不用改。

> 本阶段**不实现**后台主题管理：无数据库表、无外观设置页、无主题 CRUD、无用户自定义主题。

---

## 6. Phase 2 扩展边界

M0 只交付公共基础，不提前实现完整产品页面。M1–M7 的账号权限、维修记录、成员工作台、
交流通知、统计、管理后台与公开数据接入按 `docs/phase2-development.md` 的依赖顺序推进。

扩展时的约定：

- 页面仍按 `app/<route>/page.tsx` + `components/<route>/` + `config/<route>.ts` 组织。
- 新领域放 `src/features/<domain>/`，跨领域能力放 `src/lib/`，公共 Type 放 `src/types/`。
- Route Handler 保持薄层；所有写操作的校验、权限、幂等、事务和审计在 Service 中闭环。
- 修改 Schema、Migration 或公共 Contract 不强制单独评审，但必须先分析全部消费者；若有
  跨模块影响，必须在同一变更中同步实现、调用方、Migration、Contract、测试和文档。
- 不得为未来模块提前添加未经需求确认的字段、状态或页面。

---

## 7. 设计系统的来源

**`docs/design-system.md` 是视觉的唯一来源**（颜色 / 字号 / 间距 / 圆角 / 动效 / 对比度实测），
工程落地在 `src/app/globals.css` 的令牌层与组件层。

早期用于比对的设计基准 Demo（`zafu-pchospital-site/`）已在架构整理中移除：它的设计取值
已逐值固化进上述两处，而它自身不参与构建、不被任何脚本引用。需要新增或修改视觉规则时，
改 `docs/design-system.md` 与 `globals.css`，不要再引入第二份基准。

---

## 8. 常用命令

```bash
pnpm install             # 安装依赖并生成 Prisma Client
pnpm dev                 # 启动开发服务器
pnpm build               # 生产构建（包含 mdBook）
pnpm lint                # ESLint + 主题调色板检查
pnpm test                # 单元与 Contract 测试
pnpm test:db             # 真实 GreatSQL 集成测试
pnpm db:migrate:deploy   # 部署所有待执行 Migration
pnpm db:seed             # 幂等基础角色 Seed
pnpm db:health           # GreatSQL / UTC / 字符集健康检查
```

数据库的启动、权限、迁移、备份和故障处理见 `docs/database.md`。
