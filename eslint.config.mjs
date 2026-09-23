import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      // mdBook 构建产物：由外部工具生成，不参与官网源码检查
      "public/handbook/**",
      // tools/inspect.mjs 的本地 Chrome 配置与扩展缓存
      ".chrome-profile/**",
      // 本地 Agent 工具的临时工作区（Chromium 用户数据、截图脚本等）。
      // 内含浏览器扩展压缩源码，会被当成业务代码报出上百条无关 warning/error，
      // 让 `pnpm lint` 长期变红 —— 它不属于仓库源码，直接整目录忽略。
      ".codex-tmp/**",
      // 仓库内的**嵌套 git worktree**（`.worktree/<name>`，`git worktree add` 建的）。
      // 它是同一仓库的第二份检出，里面还有一份 `src/generated`、`next-env.d.ts` 与构建产物；
      // 不忽略的话 `pnpm lint` 会连带扫描第二份代码，一次报出上万条与本工作树无关的
      // error（2026-09-23 实际踩到：lint 直接变红，而改动本身是干净的）。
      // 那份工作树的改动由它自己的分支负责。
      ".worktree/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
