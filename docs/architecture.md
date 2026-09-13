# Architecture

> 目标：新成员看 5～10 分钟，就知道代码应该放在哪里。
> 本文件只讲「放哪里」和「为什么这么放」，不讲业务细节。

---

## 1. 技术栈

| 项目     | 选择                                     | 说明                                       |
| -------- | ---------------------------------------- | ------------------------------------------ |
| 框架     | **Next.js 15**（App Router）             | 页面路由与构建                             |
| 语言     | **TypeScript**（strict）                 | 全量类型检查，不允许 `any` 兜底            |
| 样式     | **Tailwind CSS v4**                      | 工具类 + `globals.css` 中的组件层          |
| 包管理   | **pnpm**                                 | 锁文件为 `pnpm-lock.yaml`                  |
| 代码规范 | ESLint（`eslint-config-next`）+ Prettier | `pnpm lint` / `pnpm format`                |
| 部署形态 | 静态优先                                 | 当前全部页面可静态导出，无服务端运行时依赖 |

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
│   └── git-workflow.md        # 分支与 PR 流程
│
├── src/
│   ├── app/                   # 路由与页面（Next.js App Router）
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
│   │   ├── utils.ts           # cn / revealIndex / pad2
│   │   ├── theme.ts           # 主题持久化、DOM 应用、订阅、引导脚本
│   │   ├── docs.ts            # 读取文档清单、目录摊平、外链生成
│   │   └── member-signup.ts   # 新社员登记：数据规范化 + 后端接入点
│   │
│   └── data/
│       └── doc-manifest.json  # 文档仓库清单（由文档仓库构建脚本生成）
│
├── public/
│   └── fonts/archivo-latin-wdth.woff2   # 品牌可变字体
│
└── zafu-pchospital-site/      # 【只读】设计基准 Demo，不再改动
```

---

## 3. 各层职责

### 3.1 `src/app/` —— 路由与页面

- **只做三件事**：定义路由、导出 `metadata`、把区块组件按顺序拼起来。
- 页面文件里**不应该**出现大段 JSX 结构、内联样式或业务文案。
- 页面文案来自 `src/config/`，视觉来自 `components/`。
- 全局样式只在 `app/globals.css` 一处，页面不要新建 CSS 文件。

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

### 3.6 `src/lib/` —— 纯逻辑

无 UI、无副作用的工具与数据读取。

- `utils.ts`：`cn`（类名拼接）、`revealIndex`（进场错位序号）、`pad2`（两位编号）
- `docs.ts`：文档清单读取与派生（目录摊平、条目计数、外链生成）
- `member-signup.ts`：新社员登记表的**数据形状与唯一提交入口**。它是前端与后续后端
  之间唯一的接缝：接入后端前返回本地回执、不发任何请求，接入时只改这一个文件
  （字段名与《需求分析》第 16 章的数据模型对齐）

规则：这里不放 React 组件，不放与具体页面强绑定的逻辑。

### 3.7 `src/data/` —— 结构化数据

- `doc-manifest.json`：文档仓库清单，**由文档仓库的构建脚本生成，不要手改**。
- 更新方式：用文档仓库的 `tools/build_doc_data.py` 重新生成后覆盖。

### 3.8 `public/` —— 静态资源

- `fonts/`：品牌字体
- 其余图片、图标按需新增

规则：

- 图标优先使用 `components/ui/Icon.tsx` 的内联 SVG（24 格 / stroke 2 / round 端点），不要引入图标库。
- 不要往 `public/` 放源码里可以 import 的资源。

---

## 4. 数据流

```text
src/config/*.ts  ──┐
src/data/*.json ──┤
                  ├──►  src/app/*/page.tsx  ──►  src/components/**  ──►  HTML
src/lib/*.ts    ──┘         （拼装）              （渲染）
```

- 配置与数据**只向下流动**：页面读取配置，组件通过 props 接收数据。
- 组件**不直接 import** `src/config/` 里的页面文案（`DocList` 这类纯展示组件除外）。
- 当前阶段没有数据请求：所有数据在构建时确定，页面可静态生成。
- 唯一的例外是 `/join` 的登记表：它在客户端提交，但提交入口
  （`lib/member-signup.ts`）在后端接入前不发起任何网络请求，因此页面仍然可静态导出。

---

## 5. 样式分层

`src/app/globals.css` 是唯一的样式入口，分四段：

| 段                  | 内容                                          | 谁可以改     |
| ------------------- | --------------------------------------------- | ------------ |
| `:root`             | 主题无关令牌 + 默认主题的语义色（无脚本兜底） | 需要设计确认 |
| 主题层              | `html[data-theme="<id>"]`，一个主题一段        | 需要设计确认 |
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
| Theme Registry | `src/config/theme.ts` → `themeRegistry`（主题身份与元数据）            |
| Theme Config   | `src/config/theme.ts` → `siteThemeConfig`（模式 → 主题的映射）         |
| Theme Resolver | `src/config/theme.ts` → `resolveTheme(mode)`                          |
| 主题取值       | `src/app/globals.css` 主题层，选择器 `html[data-theme="<id>"]`        |
| 持久化         | `localStorage`，键 `zafu-pchospital:theme-mode`（`src/lib/theme.ts`）  |
| 运行时         | `src/lib/theme.ts`：读写 DOM、订阅、生成引导脚本                       |
| 用户入口       | `src/components/layout/ThemeSwitcher.tsx`，挂在 Header 的索引栏与浮层 |
| HTML 表达      | `<html data-mode="normal\|dark" data-theme="<ThemeId>">`               |

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

## 6. 未来扩展

当前阶段**不实现**以下模块，但目录结构已为它们留好位置：

| 未来模块    | 建议路由                          | 建议组件目录             | 配套配置               |
| ----------- | --------------------------------- | ------------------------ | ---------------------- |
| 登录        | `/login`                          | `components/auth/`       | `config/auth.ts`       |
| 活动中心    | `/activities`、`/activities/[id]` | `components/activities/` | `config/activities.ts` |
| 报修 / 预约 | `/repair`                         | `components/repair/`     | `config/repair.ts`     |
| 个人中心    | `/profile`                        | `components/profile/`    | —                      |
| 成员工作台  | `/member`                         | `components/member/`     | —                      |
| 管理后台    | `/admin`                          | `components/admin/`      | —                      |

扩展时的约定：

- 新页面 → `app/<route>/page.tsx` + `components/<route>/` + `config/<route>.ts`
- 新页面必须在 `src/config/navigation.ts` 中登记，导航自动生效。
- **不要**为了「考虑未来」提前实现不存在的业务。
- **不要**改动现有页面与公共组件 API 来迁就未来的需求。

> ⚠️ 重要约束：本项目后续会承载报修、备案、志愿时长等业务，
> 但这些属于**后续阶段**。当前阶段的职责边界是「官网框架 + 设计系统」，
> 不要在本阶段引入数据库、鉴权或业务状态管理。
> 业务需求以《电脑医院社团综合服务平台需求分析.md》为准。

---

## 7. 设计基准 Demo

`zafu-pchospital-site/` 是团队已确认的视觉基准，**只读参考**：

- 它**不参与**构建（Next.js 只处理 `src/`），但仍在仓库中保留以便比对。
- ESLint 与 Prettier 已忽略该目录。
- **不要修改、不要删除、不要重构它。**
- 需要确认某个视觉细节时，直接读其中的 `assets/css/style.css`。

---

## 8. 常用命令

```bash
pnpm install     # 安装依赖
pnpm dev         # 启动开发服务器
pnpm build       # 生产构建
pnpm lint        # ESLint 检查
pnpm format      # Prettier 格式化
```
