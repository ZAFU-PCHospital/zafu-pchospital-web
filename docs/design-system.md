# Design System

> 本文件是浙江农林大学电脑医院官网的**视觉唯一来源**。
> 所有页面必须遵守本文件。任何页面都不得自行发明品牌色、字体层级、圆角、阴影或按钮样式。
>
> 设计来源：团队已确认的视觉基准 Demo `zafu-pchospital-site/`（只读参考，不再改动）。
> 工程落地：`src/app/globals.css`（令牌 + 基础层 + 组件层）。

---

## 0. 使用方式

| 你想做的事           | 应该怎么做                                                            |
| -------------------- | --------------------------------------------------------------------- |
| 用品牌色 / 文字色    | 使用 Tailwind 工具类，如 `text-accent`、`bg-surface-1`、`border-line` |
| 用间距节奏           | 使用 `p-s-4`、`gap-s-5`、`py-s-sec` 等（`s-1` ~ `s-9`、`s-sec`）      |
| 用圆角               | 使用 `rounded-base` / `rounded-mid` / `rounded-pill`                  |
| 用缓动               | 使用 `ease-quart`、`ease-expo`、`ease-in`、`ease-io`                  |
| 写页面区块           | 用 `components/ui/Section.tsx`，不要自己写 `padding-block`            |
| 写按钮               | 用 `components/ui/Button.tsx`，不要新建第二套按钮                     |
| 需要新的稳定视觉模式 | 先在 `globals.css` 的组件层补充，并同步更新本文件                     |

**判断标准**：如果你写了一个新的十六进制颜色、新的 `border-radius` 数值或新的字号，就说明你在脱离设计系统。

---

## 1. Colors

> **本节描述的是「深色模式」所对应的主题 `black-yellow`。**
> 站点现在有两套主题：语义令牌的名称完全相同，取值不同，
> 由 `<html data-theme>` 决定。两套取值与完整主题架构见 **第 9 节**。
>
> ⚠️ 组件一律只使用语义令牌（`var(--accent)` 等），**不要写死本节里的色值** ——
> 写死之后切到另一个模式就会出现颜色冲突或看不见的文字。

基调：**工业极简 · 深色石墨 + 单一信号黄强调色**。
所有中性色统一带 **95° 微暖色相**，与信号黄同源，避免灰得发蓝。

调色板刻意只保留**一个强调色**。新增第二种强调色需要先经过设计确认。

### 1.1 背景与表面

| 令牌          | 值                      | Tailwind       | 用途                                 |
| ------------- | ----------------------- | -------------- | ------------------------------------ |
| `--bg`        | `oklch(14.5% 0.006 95)` | `bg-bg`        | 页面底色                             |
| `--bg-deep`   | `oklch(11.5% 0.006 95)` | `bg-bg-deep`   | 索引浮层、更深的底                   |
| `--surface-1` | `oklch(18% 0.006 95)`   | `bg-surface-1` | 面板、跑马灯、条目 hover             |
| `--surface-2` | `oklch(22% 0.007 95)`   | `bg-surface-2` | 列表 hover、选中态                   |
| `--surface-3` | `oklch(26% 0.008 95)`   | `bg-surface-3` | 需要第三层时使用（当前未使用，保留） |

### 1.2 描边

| 令牌            | 值                           | Tailwind             | 用途                                    |
| --------------- | ---------------------------- | -------------------- | --------------------------------------- |
| `--line`        | `oklch(31% 0.008 95)`        | `border-line`        | 面板边框、列表分隔                      |
| `--line-soft`   | `oklch(23% 0.007 95)`        | `border-line-soft`   | 区块分隔、更弱的分隔                    |
| `--line-strong` | `oklch(52% 0.009 95)`        | `border-line-strong` | **仅用于交互控件边界**，保证 3:1 对比度 |
| `--accent-line` | `oklch(85% 0.175 99 / 0.34)` | `border-accent-line` | 强调色描边、提示框边框                  |

### 1.3 文字

四档文字色**全部满足 WCAG AA**（最暗一档在 `--bg` 上约 5.0:1）。

| 令牌      | 值                    | Tailwind     | 用途                       |
| --------- | --------------------- | ------------ | -------------------------- |
| `--ink`   | `oklch(96% 0.008 95)` | `text-ink`   | 正文主色、标题             |
| `--ink-2` | `oklch(82% 0.009 95)` | `text-ink-2` | 次级正文（`.lead`）        |
| `--ink-3` | `oklch(68% 0.009 95)` | `text-ink-3` | 说明文字（`.muted`、描述） |
| `--ink-4` | `oklch(60% 0.009 95)` | `text-ink-4` | 元信息、标签、弱化文本     |

> 使用顺序建议：`ink` → `ink-2` → `ink-3` → `ink-4`，不要跳级使用造成层级混乱。

### 1.4 强调色（唯一）

安全标识黄的语义是**「这是重点 / 这是可操作项」**，不是装饰色。

| 令牌            | 值                           | Tailwind                    | 用途                            |
| --------------- | ---------------------------- | --------------------------- | ------------------------------- |
| `--accent`      | `oklch(85% 0.175 99)`        | `text-accent` / `bg-accent` | 强调、编号、图标高亮            |
| `--accent-deep` | `oklch(70% 0.155 97)`        | `text-accent-deep`          | 强调色的深色变体（标记文字）    |
| `--accent-on`   | `oklch(17% 0.03 99)`         | `text-accent-on`            | **强调色底上的文字色**          |
| `--accent-wash` | `oklch(85% 0.175 99 / 0.1)`  | `bg-accent-wash`            | 提示框底色、ghost 按钮 hover 底 |
| `--accent-line` | `oklch(85% 0.175 99 / 0.34)` | `border-accent-line`        | 强调描边                        |

**对比度规则**：任何「强调色底 + 文字」的组合必须使用 `--accent-on`，不得使用 `--ink`。

### 1.5 语义色

设计基准中**没有** Success / Warning / Danger 三色，现在也没有。

`/join` 的新社员登记表是站点第一个带校验的界面，它同样不引入语义色：

- 必填与格式约束交给**浏览器原生约束校验**（`required` / `pattern` / `maxLength`）；
- 被拒绝的字段只用唯一的强调色标出：描边 `--accent`、说明文字 `--accent-deep`，
  语义仍然是「这一项需要你处理」，与 1.4 节的强调色语义一致；
- 提交成功**不使用 `.notice`**，改用中性 `--surface-1` 面板（见 4.6）。

后续阶段（报修、备案、评价）引入完整的状态反馈时，**必须先在这里补充语义色定义**，不得由各页面自行挑选红色或绿色。补充时要求：

- 与现有色板同色相体系（或明确说明为何需要不同色相）；
- 文字与底色组合满足 WCAG AA；
- 同时给出深色底下的可用变体。

---

## 2. Typography

字体栈：

- `--font-latin` → `font-latin`：`Archivo`（可变字体，含 `wght` 100–900 与 `wdth` 62%–125% 双轴）+ 回退
- `--font-sans` → `font-sans`：`Archivo` + 中文栈（PingFang SC / HarmonyOS Sans SC / MiSans / Microsoft YaHei / Noto Sans SC）

字体文件：`public/fonts/archivo-latin-wdth.woff2`，`font-display: swap`。

> 关键约定：**Archivo 通过 `font-stretch` 调节字宽**，这是该设计语言的识别特征。
> 大写标签通常用 `font-stretch: 116%–125%` + `letter-spacing: 0.14em–0.3em`。
> 不要用其他字体替代，也不要用 `transform: scaleX()` 模拟字宽。

### 2.1 字号层级

音阶为 **1.333 完美四度**。正文固定 `rem`，展示级使用 `clamp()` 流体。

| 层级      | 令牌        | 值                               | Tailwind         | 用途                  |
| --------- | ----------- | -------------------------------- | ---------------- | --------------------- |
| Micro     | `--t-micro` | `0.6875rem`                      | `text-micro`     | 等宽大写标签、编号    |
| XS        | `--t-xs`    | `0.75rem`                        | `text-xs`        | 小标签、页脚          |
| SM        | `--t-sm`    | `0.8125rem`                      | `text-sm`        | 按钮文字              |
| Base      | `--t-base`  | `1rem`                           | `text-base`      | 正文（`body` 默认）   |
| Display 3 | `--t-lg`    | `clamp(1.25rem, 1.6vw, 1.5rem)`  | `text-display-3` | `.lead` 引导段        |
| Display 2 | `--t-xl`    | `clamp(1.75rem, 3.4vw, 2.75rem)` | `text-display-2` | 移动端索引大标题      |
| Display 1 | `--t-2xl`   | `clamp(2.25rem, 4.6vw, 3.75rem)` | `text-display-1` | `.sec-title` 区块标题 |
| Hero      | `--t-hero`  | `clamp(3.4rem, 12.5vw, 9.5rem)`  | `text-hero`      | 首页主标题            |

**不要**在页面里直接写 `font-size: 28px` 这类固定值。需要新层级时先在这里加一行。

### 2.2 字重

| 值  | 用途                        |
| --- | --------------------------- |
| 600 | 英文标签（`.sec-head__en`） |
| 650 | 按钮、跳转链接              |
| 700 | 小标题、列表项标题          |
| 750 | 服务名（`.svc__name`）      |
| 800 | 编号、区块标题、品牌字标    |
| 900 | 首页主标题、水印字形        |

### 2.3 行高

| 场景                        | 行高         | 说明                      |
| --------------------------- | ------------ | ------------------------- |
| 正文 `body`                 | `1.75`       | 浅字深底，比常规再松 0.05 |
| `.lead`                     | `1.72`       | 引导段                    |
| 描述文字（`.svc__desc` 等） | `1.8 ~ 1.85` | 小字号收紧可读性          |
| `.sec-title`                | `1.14`       | 大标题收紧                |
| `.hero__title`              | `0.94`       | 展示级标题                |

---

## 3. Layout

### 3.1 容器

| 令牌        | 值                              | Tailwind        | 说明               |
| ----------- | ------------------------------- | --------------- | ------------------ |
| `--maxw`    | `1480px`                        | `max-w-shell`   | 内容最大宽度       |
| `--gutter`  | `clamp(1.25rem, 4.2vw, 4.5rem)` | `px-gutter`     | 页面左右边距       |
| `--measure` | `62ch`                          | `max-w-measure` | 正文最大行宽       |
| `--rail`    | `88px`                          | `pl-rail`       | 桌面左侧索引栏宽度 |

**所有页面内容必须放在 `components/layout/Container.tsx`（`.shell`）内。**
不要自己写 `max-width` 与 `padding-inline`。

### 3.2 间距节奏

以 8px 为基本单位，段落级使用流体值。

| 令牌      | 值                           | Tailwind | 典型用途                     |
| --------- | ---------------------------- | -------- | ---------------------------- |
| `--s-1`   | `0.25rem`                    | `s-1`    | 图标与文字间隙               |
| `--s-2`   | `0.5rem`                     | `s-2`    | 紧凑间隙                     |
| `--s-3`   | `0.75rem`                    | `s-3`    | 按钮内间距                   |
| `--s-4`   | `1rem`                       | `s-4`    | 常规间隙                     |
| `--s-5`   | `1.5rem`                     | `s-5`    | 段落间距                     |
| `--s-6`   | `2rem`                       | `s-6`    | 标题下间距                   |
| `--s-7`   | `3rem`                       | `s-7`    | 大段落间距                   |
| `--s-8`   | `4rem`                       | `s-8`    | 区块内大间距                 |
| `--s-9`   | `6rem`                       | `s-9`    | 页面底部收尾                 |
| `--s-sec` | `clamp(5.5rem, 13vh, 11rem)` | `s-sec`  | **区块上下留白（统一用它）** |

### 3.3 区块与页面头

| 类           | 用途                                                                             |
| ------------ | -------------------------------------------------------------------------------- |
| `.band`      | 常规区块：`padding-block: var(--s-sec)` + 底部分隔线（`Section variant="band"`） |
| `.page-head` | 内页页面头：顶部大留白 + 底部分隔线（`Section variant="page-head"`）             |
| `.contact`   | 首页联系区块：底部留白收窄为 `--s-9`                                             |

### 3.4 响应式断点

设计基准只用两个断点，Tailwind 的 `md:` / `lg:` 已对齐：

| 断点 | 值       | 变化                                                          |
| ---- | -------- | ------------------------------------------------------------- |
| `md` | `760px`  | 首页 Hero / 关于 / 文档区块由单列变两列；服务条目状态标签归位 |
| `lg` | `1100px` | 左侧索引栏出现，移动端顶栏隐藏，`body` 让出 `--rail` 宽度     |

`@media (max-width: 759px)` 的移动端专属规则：服务条目状态标签换行、读数面板压成一行、Hero 水印字号放大。

> `md` 与 `lg` 覆盖了 Tailwind 默认值（768 / 1024）。这是刻意的：
> 设计系统只承认 760 与 1100 两个断点，页面不要使用 `sm:` / `xl:` 另开一套。

### 3.5 横向溢出

`body` 已设置 `overflow-x: hidden`，但**这不是用来兜底的**。
新增内容必须自行保证不溢出：长英文串要能断行，宽表格要包一层可横向滚动的容器。

---

## 4. Components

公共组件位于 `src/components/`。**以下组件不允许各页面重复实现。**

### 4.1 布局组件

| 组件          | 路径                     | 对应类                        | 说明                                        |
| ------------- | ------------------------ | ----------------------------- | ------------------------------------------- |
| `Container`   | `layout/Container.tsx`   | `.shell`                      | 内容容器                                    |
| `Header`      | `layout/Header.tsx`      | `.rail` / `.topbar` / `.menu` | 全站导航，桌面竖排索引栏 + 移动端顶栏与浮层 |
| `Footer`      | `layout/Footer.tsx`      | `.footer`                     | 全站页脚                                    |
| `PageHead`    | `layout/PageHead.tsx`    | `.page-head`                  | 内页页面头（章节头 + H1 + 引导语）          |
| `SiteEffects` | `layout/SiteEffects.tsx` | `.progress-line` / `.reticle` | 站点级滚动与指针效果，全站挂载一次          |

**Header 规则**：

- 桌面（≥1100px）显示左侧固定索引栏：品牌方块 + 竖排编号导航 + 底部徽标。
- 移动 / 平板显示顶部栏 + 全屏索引浮层（`clip-path` 展开）。
- 两套表现**不重复实现**，都由 `Header` 输出，导航项来自 `src/config/navigation.ts`。
- 当前页通过 `aria-current="page"` 标记，样式为 `--accent` 文字 + 左侧 2px 竖条。

### 4.2 基础 UI 组件

| 组件           | 路径                  | 对应类                   | 变体                                 |
| -------------- | --------------------- | ------------------------ | ------------------------------------ |
| `Button`       | `ui/Button.tsx`       | `.btn`                   | `outline`（默认）/ `solid` / `ghost` |
| `Card`         | `ui/Card.tsx`         | `.card` / `.notice`      | `surface` / `notice`                 |
| `Section`      | `ui/Section.tsx`      | `.band` / `.page-head`   | `band` / `page-head` / `plain`       |
| `SectionHead`  | `ui/SectionHead.tsx`  | `.sec-head`              | 编号 + 走线 + 英文标签               |
| `SectionTitle` | `ui/SectionTitle.tsx` | `.sec-title`             | `h1` / `h2` / `h3`                   |
| `Readout`      | `ui/Readout.tsx`      | `.readout`               | 读数面板（数值必须真实）             |
| `Reveal`       | `ui/Reveal.tsx`       | `.reveal`                | 进场揭示容器，`index` 控制错位       |
| `Icon`         | `ui/Icon.tsx`         | 内联 SVG                 | 24 格 / stroke 2 / round 端点        |
| `ServiceList`  | `ui/ServiceList.tsx`  | `.svc-list` / `.svc`     | 服务条目列表                         |
| `ChannelList`  | `ui/ChannelList.tsx`  | `.channels` / `.channel` | 渠道与外链入口                       |
| `GalleryCarousel` | `ui/GalleryCarousel.tsx` | `.gallery` / `.gallery__*` | 现场图集走马灯（自动播放 + 暂停）  |
| `QrCard`       | 内联（`/about` 联系方式收束区） | `.contact-close__qr`    | 二维码退为辅助：不设外框，只留图形 + 一行小注 |
| `QrCard`       | 内联（`/join` 登记完成区）      | `.qr` / `.qr__*`      | 二维码展示卡：描边 + 图注，按主题在深浅两版之间切换 |

### 4.3 业务区块组件

| 组件                                                                                                         | 路径    | 使用位置                      |
| ------------------------------------------------------------------------------------------------------------ | ------- | ----------------------------- |
| `Hero` / `Ticker` / `AboutSection` / `ServicesSection` / `ProcessSection` / `DocsSection` / `ContactSection` | `home/` | 仅首页                        |
| `DocList` / `DocReadout`                                                                                     | `docs/` | 首页文档区块与 `/docs` 页共用 |
| `MemberSignup`                                                                                               | `join/` | 仅 `/join`                    |

### 4.4 按钮的具体规则

- `solid`：信号黄底 + `--accent-on` 文字。**每个页面最多一个**，用于该页最重要的行动点。
- `outline`：默认形态，透明底 + `--line-strong` 描边，hover 时黄色自下而上填充。
- `ghost`：无边框文字按钮，hover 时下划线从左展开。用于次级动作。
- 三者共用一个「hover 填充」机制（`::before` 的 `scaleY`），不要为某个按钮单独写 hover。
- 最小高度 `46px`，保证移动端可点面积。

### 4.5 提示框 `.notice` 规则

信号黄描边 + `--accent-wash` 淡底，**只用于「须知 / 风险 / 待补充」这类需要用户注意的静态信息**。
不要用它做成就提示或成功反馈。

### 4.6 表单控件（`.signup` / `.field`）

第一阶段只有 `/join` 的新社员登记表用到表单，使用面还不够宽，因此**没有抽成
`components/ui/` 组件**，稳定的部分落在 `globals.css` 组件层；等第二个表单出现时再提升。

| 类                                              | 用途                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| `.signup` / `.signup__form`                    | 登记区栅格（≥760px 两栏：表单 / 说明）与表单的纵向节奏                    |
| `.field` / `.field__label` / `.field__num`     | 字段：两位编号 + 中文标签 + 必填标记                                      |
| `.field__input`                                 | 输入框：`--line-strong` 描边、`--r-base` 圆角、最小高度 46px、字号 16px |
| `.field__hint`                                  | 字段下方的格式说明（原生校验提示很简略，格式必须在这里讲清楚）            |
| `.signup__actions` / `.signup__status`         | 提交行与状态 / 失败提示                                                   |
| `.signup__done`                                 | 提交完成后的确认面板（`--surface-1` 面板，**不是** `.notice`）         |

规则：

- 必填与格式约束**只有一份**，写在原生约束校验属性上（`src/config/join.ts` 的字段定义），
  页面不重复实现一套 JS 校验，也不自造错误提示样式。
- 控件边界一律 `--line-strong`（3:1）；输入框字号必须是 `--t-base`（16px），
  更小会让 iOS Safari 在聚焦时把整页放大。
- 提交成功**不用 `.notice`**（见 4.5），用中性面板 + 强调色标记。
- **提交后新插入的内容不要包 `.reveal`**：`SiteEffects` 只在挂载时收集一次 `.reveal`，
  后插入的元素永远拿不到 `.is-in`，会一直停在 `opacity: 0`。

---

## 5. Radius / Border / Shadow

### 5.1 圆角

**单一 2px 基数**，工业感，刻意接近直角。

| 令牌       | 值      | Tailwind       | 用途                       |
| ---------- | ------- | -------------- | -------------------------- |
| `--r-base` | `2px`   | `rounded-base` | 按钮、标签、控件、序号方块 |
| `--r-mid`  | `4px`   | `rounded-mid`  | 面板、卡片、提示框         |
| `--r-full` | `999px` | `rounded-pill` | 圆点、滚动条（仅此两类）   |

**禁止**出现 `8px`、`12px`、`16px` 之类圆角。需要更大的面就用 `--r-mid`。

### 5.2 边框

统一 **1px**，颜色只用 `--line` / `--line-soft` / `--line-strong` / `--accent-line` 四个令牌。

- 区块之间：`1px solid var(--line-soft)`
- 面板边界：`1px solid var(--line)`
- 交互控件：`1px solid var(--line-strong)`（保证 3:1）
- 强调：`1px solid var(--accent-line)`

### 5.3 阴影

**设计基准不使用任何 `box-shadow`。**

层次完全由「边框 + 底色明度差」表达：

| 层级             | 表达方式                          |
| ---------------- | --------------------------------- |
| 页面底           | `--bg`                            |
| 面板             | `--surface-1` + `--line` 边框     |
| 面板内的交互态   | `--surface-2`                     |
| 浮层（索引浮层） | `--bg-deep`（比底更深）+ 全屏遮罩 |

禁止为「高级感」添加投影。需要浮层时用底色加深 + 全屏遮罩。

---

## 6. Motion

### 6.1 令牌

| 令牌           | 值                               | 语义                   |
| -------------- | -------------------------------- | ---------------------- |
| `--ease-quart` | `cubic-bezier(0.25, 1, 0.5, 1)`  | 常规过渡（颜色、背景） |
| `--ease-expo`  | `cubic-bezier(0.16, 1, 0.3, 1)`  | 位移、展开、进场       |
| `--ease-in`    | `cubic-bezier(0.7, 0, 0.84, 0)`  | 退出                   |
| `--ease-io`    | `cubic-bezier(0.65, 0, 0.35, 1)` | 循环动效               |
| `--d-fast`     | `140ms`                          | 颜色、描边             |
| `--d-mid`      | `260ms`                          | 背景、常规过渡         |
| `--d-slow`     | `420ms`                          | 位移、下划线展开       |
| `--d-enter`    | `760ms`                          | 进场揭示               |

### 6.2 既有动画清单

设计基准已有、正式站点全部保留：

| 名称       | 位置                   | 说明                                                  |
| ---------- | ---------------------- | ----------------------------------------------------- |
| 进场揭示   | `.reveal`              | 进入视口上移 20px + 淡入，同级元素错位 70ms，只播一次 |
| 标题行进场 | `.hero__title .hl__in` | 从 `translateY(105%)` 上移，逐行错位 130ms            |
| 顶部进度线 | `.progress-line__bar`  | 优先 CSS 滚动时间轴（合成线程），JS 兜底              |
| 跑马灯     | `.ticker__track`       | 42s 线性无缝循环                                      |
| 区块走线   | `.sec-head__rule`      | 进入视口时从左展开 900ms                              |
| 按钮填充   | `.btn::before`         | hover 时 `scaleY(0) → 1`                              |
| 箭头下沉   | `.hero__scroll svg`    | 2.4s 循环的 `nudge`                                   |
| 索引浮层   | `.menu`                | `clip-path` 展开 + 子项逐个上浮                       |
| 指针准星   | `.reticle`             | 鼠标跟随，阻尼 0.22，仅在精确指针设备启用             |

### 6.3 禁止清单

不要为「高级感」增加以下内容：

- 大量粒子特效
- 复杂 3D 变换
- 新的鼠标跟随 / 光晕跟随特效（已有的准星是唯一一个）
- 大面积炫光、渐变光斑
- 每个组件各自一套动画体系

### 6.4 无障碍：减少动效

`prefers-reduced-motion: reduce` 时必须：

- 关闭所有进场揭示与循环动画
- 关闭指针准星
- `scroll-behavior` 回退为 `auto`

进度条是**功能性指示**而非装饰，保留其滚动驱动行为（`.progress-line__bar` 显式排除在全局 `animation-duration: 0.01ms` 之外）。

### 6.5 性能约定

- 动画只动 `transform` 与 `opacity`，不动 `width` / `height` / `top` / `left`。
- 滚动相关效果使用 `IntersectionObserver` 或 CSS 滚动时间轴，**不要监听 `scroll` 事件计算位置**。
- 站点级效果集中在 `SiteEffects` 一处挂载，不要在页面里各写一份监听。

---

## 7. 可访问性底线

| 项目         | 要求                                                       |
| ------------ | ---------------------------------------------------------- |
| 焦点         | 全站统一 `:focus-visible`：2px 信号黄描边 + 3px 偏移       |
| 跳转正文     | 每个页面提供 `跳到正文` 链接（`.skip-link`），聚焦时滑入   |
| 文字对比     | 四档文字色在 `--bg` 上均满足 WCAG AA                       |
| 控件边界     | 交互控件使用 `--line-strong`，保证 3:1                     |
| 强调色底文字 | 必须使用 `--accent-on`                                     |
| 装饰元素     | 水印、跑马灯、准星、进度线加 `aria-hidden="true"`          |
| 导航当前项   | 使用 `aria-current="page"`                                 |
| 移动端浮层   | 打开时锁定滚动、`Esc` 关闭、焦点移入关闭按钮并在关闭后归还 |
| 点按面积     | 按钮最小高度 `46px`                                        |

---

## 8. 变更流程

1. 判断是「一次性样式」还是「会复用的模式」。
2. 一次性 → 用现有工具类组合，不要新增令牌。
3. 会复用 → 在 `globals.css` 组件层补充 → 同步更新本文件 → 在 PR 描述里说明原因。
4. 涉及**新增颜色、新增字号层级、新增圆角数值**的改动，必须在 PR 中单独说明，不能混在功能改动里。

> 目标：任何人拉取代码后，只看本文件就能知道界面应该长什么样，
> 以及自己写的页面有没有跑偏。

---

## 9. Theme Architecture

### 9.1 三个概念

```text
Mode      用户能看到的开关        normal | dark
Theme     具体视觉方案            swiss-cobalt | black-yellow
Mapping   Mode → Theme            src/config/theme.ts 的 siteThemeConfig
```

界面**只暴露 Mode**。`Swiss Cobalt`、`Black Yellow` 这类主题名属于后台与文档，
不出现在任何页面文案里。

解析链路：

```text
用户点「深色」
      ↓
siteThemeConfig.dark                    ← 管理员配置层（未来改为数据库读取）
      ↓
"black-yellow"
      ↓
<html data-mode="dark" data-theme="black-yellow">
      ↓
CSS 主题层的语义令牌
      ↓
所有组件（组件不认识主题，只认识令牌）
```

**页面结构与主题视觉完全解耦。** 主题只决定颜色、圆角、边框、排版尺度、装饰强度；
不决定内容、区块顺序、Grid 主结构、路由、权限、数据或业务逻辑。
因此**永远不要**出现下面这种写法：

```tsx
// ❌ 禁止：为两个模式维护两套页面
if (theme === "normal") return <NormalAboutPage />;
return <DarkAboutPage />;
```

### 9.2 语义令牌

组件只使用语义令牌，不要判断当前是什么模式。

| 语义           | 令牌                                     | Tailwind                                     |
| -------------- | ---------------------------------------- | -------------------------------------------- |
| 页面底色       | `--bg`                                   | `bg-bg`                                      |
| 更深一层底     | `--bg-deep`                              | `bg-bg-deep`                                 |
| 面板 / 表面    | `--surface-1` … `--surface-3`            | `bg-surface-1` …                             |
| 正文 / 标题    | `--ink`                                  | `text-ink`                                   |
| 次级正文       | `--ink-2`                                | `text-ink-2`                                 |
| 说明文字       | `--ink-3`                                | `text-ink-3`                                 |
| 元信息 / 标签  | `--ink-4`                                | `text-ink-4`                                 |
| 强调（主色）   | `--accent`                               | `text-accent` / `bg-accent`                  |
| 主色深色变体   | `--accent-deep`                          | `text-accent-deep`                           |
| 主色底上的文字 | `--accent-on`                            | `text-accent-on`                             |
| 主色淡底       | `--accent-wash`                          | `bg-accent-wash`                             |
| 主色描边       | `--accent-line`                          | `border-accent-line`                         |
| 描边           | `--line` / `--line-soft` / `--line-strong` | `border-line` / `border-line-soft` / `border-line-strong` |

**禁止**：

```css
color: #2457ff; /* ❌ 写死某个主题的具体色值 */
background: #ffd400; /* ❌ */
```

```tsx
theme === "dark" ? "#FFD400" : "#2457FF"; // ❌ 组件里判断主题再挑颜色
```

**应该**：

```css
color: var(--accent);
background: var(--bg);
border-color: var(--line);
```

判断标准：组件代码里出现任何一个具体色值，就是在脱离主题系统。

### 9.3 主题层的位置

色值的唯一来源是 `src/app/globals.css` 顶部的两段：

| 选择器                        | 内容                                                                       |
| ----------------------------- | -------------------------------------------------------------------------- |
| `:root`                       | 主题无关令牌 + **默认主题**（normal → `swiss-cobalt`）的语义色，同时作为无脚本兜底 |
| `html[data-theme="black-yellow"]` | 深色主题（dark）的语义色覆盖                                            |

`src/config/theme.ts` **只登记主题身份与映射关系，不存放色值**。
两者的对应关系是「ThemeId ↔ `html[data-theme="<id>"]`」。

### 9.4 两套主题的实际取值

| 语义令牌                     | normal / `swiss-cobalt`      | dark / `black-yellow`        |
| ---------------------------- | ---------------------------- | ---------------------------- |
| `--bg`                       | `#f5f5f2` 暖白纸面           | `oklch(14.5% 0.006 95)` 石墨 |
| `--bg-deep`                  | `#edece7`                    | `oklch(11.5% 0.006 95)`      |
| `--surface-1`                | `#ffffff`                    | `oklch(18% 0.006 95)`        |
| `--surface-2`                | `#efeee9`                    | `oklch(22% 0.007 95)`        |
| `--line`                     | `#d8d8d4`                    | `oklch(31% 0.008 95)`        |
| `--line-soft`                | `#e6e6e1`                    | `oklch(23% 0.007 95)`        |
| `--line-strong`              | `#8a8a85`                    | `oklch(52% 0.009 95)`        |
| `--ink`                      | `#171717` 炭黑               | `oklch(96% 0.008 95)`        |
| `--ink-2`                    | `#3d3d3b`                    | `oklch(82% 0.009 95)`        |
| `--ink-3`                    | `#5f5f5d`                    | `oklch(68% 0.009 95)`        |
| `--ink-4`                    | `#70706e`                    | `oklch(60% 0.009 95)`        |
| `--accent`                   | `#2457ff` 钴蓝               | `oklch(85% 0.175 99)` 信号黄 |
| `--accent-deep`              | `#1c44d6`                    | `oklch(70% 0.155 97)`        |
| `--accent-on`                | `#ffffff`                    | `oklch(17% 0.03 99)`         |
| `color-scheme`               | `light`                      | `dark`                       |

`swiss-cobalt` 取自实验分支 `style-about-editorial-test` 已验证的
「暖白 + 炭黑 + 钴蓝 · Swiss Editorial / Technical Editorial」方向。
其中 `--ink-3` / `--ink-4` 两档比实验原值（`#737373` / `#8f8f8b`）更深：
原值是按纯白 `#ffffff` 计算的，落在实际纸面 `#f5f5f2` 上只有 4.34:1 / 2.97:1，
达不到 AA，因此重新按实际底色配了一组（见 9.6）。

### 9.5 主题还能控制什么：视觉令牌

主题不只是颜色。`globals.css` 里另有一组可被主题覆盖的视觉令牌：

| 令牌                     | 用途                      | normal                   | dark                    |
| ------------------------ | ------------------------- | ------------------------ | ----------------------- |
| `--r-frame`              | 图集 / 照片框圆角         | `0`（直角，接近印刷品）  | `var(--r-mid)`          |
| `--t-page-title`         | 内页页头主标题字号        | `clamp(3rem, 8vw, 6.25rem)` 海报级 | `var(--t-2xl)` 常规 |
| `--page-title-leading`   | 同上，行高                | `1.04`                   | `1.14`                  |
| `--page-title-tracking`  | 同上，字距                | `-0.025em`               | `-0.015em`              |
| `--deco-grid-line`       | 背景走线栅格的线色        | `var(--line)`            | `var(--line-soft)`      |
| `--deco-scan`            | 扫描质感带                | 钴蓝 5%                  | 信号黄 2.8%             |
| `--deco-watermark`       | 首页水印字形描边          | 钴蓝 17%                 | 信号黄 16%              |
| `--deco-reticle-blend`   | 指针准星的混合模式        | `multiply`               | `screen`                |
| `--rail-panel`           | 左侧索引栏面板的渐变起点  | `var(--surface-1)` 做亮  | `var(--bg-deep)` 做暗   |

> `--deco-reticle-blend` 是个例子：准星原本写死 `mix-blend-mode: screen`，
> 这在深色底上成立、在暖白底上会让准星彻底看不见。装饰类取值必须同样令牌化。
>
> `--rail-panel` 是另一个例子：索引栏原本写死 `gradient(--bg-deep → --bg)`。
> 深色主题下面板比页面更深是成立的；但浅色主题里 `--ink-4` 在 `--bg-deep`
> 上只有 4.20:1，栏内导航文字会掉出 AA。**浅色主题必须把面板做亮，而不是做暗。**

**主题不控制**：区块顺序、Grid 主结构、DOM、交互、数据、路由、权限。
否则多主题会演变成多套网站。

主题**可以**调整 `--d-*` / `--ease-*` 动效令牌，但当前两套主题没有差异，
因此它们仍留在 `:root` 的主题无关段里。

### 9.6 对比度（实测）

两套取值按 WCAG 相对亮度公式算出的结果（正文门槛 4.5:1，控件边界 3:1）：

| 组合                                  | normal     | dark       |
| ------------------------------------- | ---------- | ---------- |
| `--ink` on `--bg`                     | 16.41:1 ✅ | 17.64:1 ✅ |
| `--ink-2` on `--bg`                   | 9.97:1 ✅  | 11.35:1 ✅ |
| `--ink-3` on `--bg`                   | 5.86:1 ✅  | 6.86:1 ✅  |
| `--ink-4` on `--bg`                   | 4.54:1 ✅  | 5.01:1 ✅  |
| `--ink-3` on `--bg-deep`（浮层 / 面板） | 5.41:1 ✅  | 7.06:1 ✅  |
| `--accent` on `--bg`                  | 4.95:1 ✅  | 12.60:1 ✅ |
| `--accent-on` on `--accent`           | 5.41:1 ✅  | 12.18:1 ✅ |
| `--accent-deep` on `--accent-wash`    | 6.13:1 ✅  | 6.48:1 ✅  |
| `--line-strong` on `--bg`（控件边界）   | 3.18:1 ✅  | 3.59:1 ✅  |

**边界规则（务必记住）**：`--ink-4` 只能用在 `--bg` 与 `--surface-1` 上。
它在更深的表面上会掉出 AA：

| 组合                  | normal | dark  |
| --------------------- | ------ | ----- |
| `--ink-4` on `--surface-2` | 4.27:1 ❌ | 4.36:1 ❌ |
| `--ink-4` on `--bg-deep`   | 4.20:1 ❌ | 5.16:1 ✅ |

所以：

- 落在 `--surface-2` / `--bg-deep` 上的文字，用 `--ink-3` 而不是 `--ink-4`
  （浮层底部标签、切换控件未选中项都按这条处理）。
- 浅色主题的深色面板（索引栏）通过 `--rail-panel` 改做亮，而不是靠加深文字补救。
- 强调色**底**（`--accent-wash`）上的文字用 `--accent-deep`，不要用 `--accent`：
  后者在淡底上只有 4.50:1，正好卡在门槛上。

> 上面的数字是实测值。改主题取值后在真实页面里复核渲染后的对比度，
> 注意把 oklch 等色彩空间先归一化成 sRGB —— 浏览器会把计算值原样序列化成
> `oklch(...)`，直接按 `rgb()` 解析会全部落空、静默跳过检查。

### 9.7 新增一个主题

1. 在 `src/config/theme.ts` 的 `themeRegistry` 登记 `{ id, name, mode, colorScheme, browserThemeColor }`。
2. 在 `globals.css` 主题层追加一段 `html[data-theme="<id>"]`，覆盖需要的语义色与视觉令牌。
3. 需要让用户看到它 → 改 `siteThemeConfig`（例如把 `normal` 指向新主题）。
4. 用 9.6 的方式复核对比度，并在 PR 中给出实测数字。

**页面代码一行都不用改。** 这正是把 Mode 与 Theme 分开的目的。

### 9.8 按主题取图（唯一的例外）

真实照片**不随主题换图**（深色模式最多允许极轻微的 brightness / contrast 调整）。
唯一的例外是二维码这类功能性图形：`/qq-group-qrcode-accent.png` 自带深色底，
放在暖白纸面上会像一块贴错位置的补丁。

处理方式：`src/config/site.ts` 的 `contactQr` 同时提供 `src`（黑底黄码版）
与 `srcLight`（浅底原色版），两个 `<img>` 都在服务端渲染，
由 `html[data-theme]` 决定显示哪一张。隐藏的那张是 `display:none`，
不进入无障碍树、也不会产生 hydration 分支。

`/join` 的 `joinSignupQr`（`src/config/join.ts`）按同一套处理：两版取自同一张
截图的同一区块，尺寸必须一致（`1044 × 1323`），否则切主题会引起布局跳动。

**除这类功能性图形外，不要为不同主题准备两套图片。**
