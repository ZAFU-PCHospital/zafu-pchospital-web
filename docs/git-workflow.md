# Git Workflow

> 本项目由多人（含多个 AI Agent）并行开发，流程必须统一。
> 核心原则：**main 永远可构建、可部署。**

---

## 1. 分支模型

### 1.1 长期分支

| 分支   | 用途     | 规则                                                  |
| ------ | -------- | ----------------------------------------------------- |
| `main` | 正式代码 | **受保护**。禁止直接 push，只能通过 Pull Request 合并 |

### 1.2 工作分支

所有开发都在独立分支进行，生命周期尽量短。命名格式：

```text
<类型>/<简短描述>
```

| 类型        | 用途               | 示例                                     |
| ----------- | ------------------ | ---------------------------------------- |
| `feat/`     | 新功能、新页面     | `feat/home`、`feat/about`、`feat/join`   |
| `fix/`      | 缺陷修复           | `fix/mobile-navbar`、`fix/overflow-hero` |
| `docs/`     | 仅文档改动         | `docs/update-design-system`              |
| `refactor/` | 不改变行为的重构   | `refactor/extract-button`                |
| `chore/`    | 依赖、配置、工程化 | `chore/upgrade-next`                     |

描述部分用**小写英文 + 连字符**，不要用中文、不要用空格。

> 由 Agent 创建分支时同样遵守该命名，例如 `feat/activities-list`。

---

## 2. 标准流程

```text
同步 main
   ↓
创建分支
   ↓
开发
   ↓
pnpm lint  /  pnpm build
   ↓
commit
   ↓
push
   ↓
Pull Request
   ↓
Review
   ↓
合并 main
```

### 2.1 具体命令

```bash
# 1. 同步 main
git switch main
git pull --ff-only

# 2. 创建分支
git switch -c feat/about

# 3. 开发，然后本地自检（必须都通过）
pnpm lint
pnpm build

# 4. 提交
git add <具体文件>          # 不要用 git add -A
git commit -m "feat(about): 补齐服务范围区块"

# 5. 推送并发起 PR
git push -u origin feat/about
```

---

## 3. 硬性规则

1. **禁止直接 push `main`。** 所有改动必须经过 Pull Request。
2. **一个 PR 只解决一个任务。** 不要在同一个 PR 里混入大量无关修改。
3. **合并前必须保证项目可以正常构建**：`pnpm lint` 与 `pnpm build` 都要通过。
4. **禁止提交下列内容**：
   - `node_modules/`、`.next/`、`out/`、`build/`
   - 任何 `.env` / `.env*.local`（已在 `.gitignore` 中）
   - 编辑器与系统临时文件
   - 密钥、令牌、社长密钥、手机号等敏感信息
5. **不要把格式化改动混进功能 PR。** 需要全量格式化时单独开 `chore/` PR。
6. **不要修改 `zafu-pchospital-site/`**（设计基准 Demo）。它只读。
7. **不要直接修改 `src/data/doc-manifest.json`**，该文件由文档仓库构建脚本生成。

---

## 4. Commit 规范

采用约定式提交（Conventional Commits）：

```text
<类型>(<范围>): <描述>
```

| 类型       | 含义                 |
| ---------- | -------------------- |
| `feat`     | 新功能               |
| `fix`      | 缺陷修复             |
| `docs`     | 仅文档               |
| `refactor` | 重构（不改变行为）   |
| `chore`    | 依赖、配置、工具     |
| `style`    | 仅格式（不影响行为） |

范围建议用页面或模块名：`home`、`about`、`join`、`docs`、`ui`、`layout`、`config`。

示例：

```text
feat(home): 复刻首页 Hero 与读数面板
fix(ui): 修正按钮 hover 在触屏下的粘连
docs(design-system): 补充断点说明
chore(deps): 升级 next 到 15.5
```

要求：

- 描述用中文，**说清楚「做了什么」**，不要写「update」「fix bug」这类无信息量的内容。
- 一次提交只做一件事。
- 每个 PR 的第一个提交建议是 `feat(<范围>): ...`，便于生成 PR 标题。

---

## 5. Pull Request

### 5.1 提交前自检

```bash
pnpm install        # 确保依赖最新
pnpm lint           # 必须 0 error（含主题调色板一致性校验）
pnpm build          # 必须成功（含站内文档构建，需要 mdBook，见 AGENTS.md 第 7 节）
pnpm dev            # 手动检查以下项目
```

> 合并前必须保证的是**完整的**构建产物。`pnpm build` 已经包含 `docs:build`，
> 不要在 PR 里用 `pnpm build:site` 的结果当作「构建通过」——
> 它不生成 `/handbook/`，而 `/docs` 页的全部链接都指向那里。
> 仓库已有 CI（`.github/workflows/ci.yml`，见 `AGENTS.md` 第 11 节）会在 PR 上跑
> `lint` 与含文档的完整 `build`，但**本地仍要先自检一遍**，不要依赖 CI 兜底。

手动检查清单：

- [ ] Desktop 页面正常（≥1100px，左侧索引栏出现）
- [ ] Mobile 页面基本正常（<760px，顶栏与索引浮层可用）
- [ ] 不存在横向溢出（横拉页面不应出现白边）
- [ ] Console 无报错
- [ ] 键盘 Tab 可以走通，焦点可见
- [ ] 导航当前项高亮正确
- [ ] 未偏离 `docs/design-system.md`

### 5.2 PR 描述模板

```markdown
## 做了什么

<!-- 一句话说明这个 PR 解决什么 -->

## 改动范围

- 新增：`src/app/about/page.tsx`
- 修改：`src/config/navigation.ts`

## 自检

- [ ] pnpm lint 通过
- [ ] pnpm build 通过
- [ ] Desktop / Mobile 已手动检查
- [ ] 未修改 `zafu-pchospital-site/`
- [ ] 未修改公共组件 API（如修改，已在下方说明影响）

## 相关 Issue

Closes #
```

### 5.3 Review 关注点

评审人重点看：

1. 是否偏离 `docs/design-system.md`（颜色、字号、圆角、间距）
2. 是否重复实现了已有的公共组件
3. 是否改动了与本次任务无关的文件
4. 是否引入不必要的依赖
5. 文案与数据是否放在 `src/config/`，而非硬编码在组件里

### 5.4 合并

- 使用 **Squash and merge**，保持 `main` 的提交历史线性可读。
- 合并后删除远端工作分支。
- 合并前确保 CI / 本地构建通过。**不要未经确认直接覆盖远端 `main`。**

---

## 6. Agent 协作约定

多个 Agent 可能同时在同一个仓库工作，因此：

1. **开工前先看分支**：确认当前不在 `main` 上直接开发。
2. **只改本任务需要的文件**：不要顺手重构、不要顺手格式化。
3. **公共组件 API 变更需要单独 PR**：`components/layout/*` 与 `components/ui/*` 的 props 变更会影响所有页面。
4. **不要删除他人代码**：确需替换时先在 PR 中说明为什么新实现能完全覆盖。
5. **不要执行破坏性命令**：`git reset --hard`、`git clean -fd`、批量删除文件等。
6. **冲突处理**：优先 rebase 到最新 `main`，手工解决冲突，不要用 `-X ours` / `-X theirs` 粗暴取舍。
7. **不确定就问**：涉及视觉、文案或业务规则的判断，先确认再动手。
