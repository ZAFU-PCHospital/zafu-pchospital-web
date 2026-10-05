/* 校验官网与站内文档站（mdBook）的调色板没有漂移。
 *
 * 背景：官网的主题令牌在 src/app/globals.css 的主题层，文档站的主题令牌是
 * ZAFU-PCHospital-Doc/theme/pc-hospital.css 里的一份**拷贝**（mdBook 只吃静态 CSS，
 * 无法直接引用官网的变量）。两份必须逐值一致，否则同一个站点会出现两种观感。
 * 靠人记着「改一边要改另一边」迟早会漂，所以放在 pnpm lint 里强制校验。
 *
 * 另外校验主题存储键在 src/lib/theme.ts 与 tools/build-docs.mjs 里一致 ——
 * 文档站靠读这个 localStorage 键来跟随官网的显示模式。
 *
 * 用法：node tools/check-theme-palette.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveDocsSourceRoot } from "./docs-source.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const globalsCssPath = path.join(projectRoot, "src", "app", "globals.css");
const sourceRoot = resolveDocsSourceRoot(projectRoot);
const mdbookCssPath = path.join(sourceRoot, "theme", "pc-hospital.css");
const themeTsPath = path.join(projectRoot, "src", "lib", "theme.ts");
const buildDocsPath = path.join(projectRoot, "tools", "build-docs.mjs");

if (!existsSync(mdbookCssPath)) {
  console.error(
    `[check-theme-palette] 文档版本缺少主题：${mdbookCssPath}\n` +
      "请检出包含 theme/pc-hospital.css 的文档版本，或设置 DOCS_SOURCE_DIR 指向修改后的文档仓库。",
  );
  process.exit(1);
}

/** 需要两份文件保持一致的语义令牌（官网名 → 文档站名 = 加 --pc- 前缀） */
const SEMANTIC_TOKENS = [
  "--bg",
  "--bg-deep",
  "--surface-1",
  "--surface-2",
  "--line",
  "--line-soft",
  "--line-strong",
  "--ink",
  "--ink-2",
  "--ink-3",
  "--ink-4",
  "--accent",
  "--accent-deep",
  "--accent-on",
  "--accent-wash",
  "--accent-line",
];

/** 取出顶层 `selector { body }`（这里的目标块都不嵌套，够用） */
function topLevelBlocks(css) {
  const blocks = [];
  let cursor = 0;
  for (;;) {
    const open = css.indexOf("{", cursor);
    if (open === -1) break;
    const selector = css
      .slice(cursor, open)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim();
    let depth = 1;
    let index = open + 1;
    while (index < css.length && depth > 0) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") depth -= 1;
      index += 1;
    }
    blocks.push({ selector, body: css.slice(open + 1, index - 1) });
    cursor = index;
  }
  return blocks;
}

function declarations(body) {
  const out = new Map();
  /* 必须先剥掉注释再按冒号切分：注释里会出现 `:root`、`--bg` 这类文本，
     否则紧跟注释的那条声明会被当成注释的一部分而漏掉。 */
  const cleaned = body.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const line of cleaned.split(";")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (name.startsWith("--")) out.set(name, value);
  }
  return out;
}

/** 归一化：折叠空白、小写、把 `.5` 补成 `0.5`，这样写法差异不算漂移 */
function normalize(value) {
  return value
    .toLowerCase()
    .replace(/(^|[\s(,])\.(\d)/g, "$1 0.$2")
    .replace(/\s+/g, " ")
    .trim();
}

function pickBlock(css, predicate, description) {
  const found = topLevelBlocks(css).filter((block) => predicate(block));
  if (found.length !== 1) {
    throw new Error(
      `在 ${description} 中期望恰好一个匹配的主题块，实际找到 ${found.length} 个。` +
        "若主题层结构变了，请同步更新 tools/check-theme-palette.mjs。",
    );
  }
  return declarations(found[0].body);
}

const globalsCss = readFileSync(globalsCssPath, "utf8");
const normalSite = pickBlock(
  globalsCss,
  (block) => block.selector === ":root" && block.body.includes("--bg:"),
  "src/app/globals.css（默认/正常主题的 :root）",
);
const darkSite = pickBlock(
  globalsCss,
  (block) => block.selector.includes('data-theme="black-yellow"'),
  'src/app/globals.css（html[data-theme="black-yellow"]）',
);

const mdbookCss = readFileSync(mdbookCssPath, "utf8");
const normalDocs = pickBlock(
  mdbookCss,
  (block) => block.selector.includes(".light"),
  `${mdbookCssPath}（.light）`,
);
const darkDocs = pickBlock(
  mdbookCss,
  (block) => block.selector.includes(".coal"),
  `${mdbookCssPath}（.coal）`,
);

const problems = [];
const bookConfig =
  readFileSync(path.join(sourceRoot, "book.toml"), "utf8").match(
    /\[output\.html\]\s*([\s\S]*?)(?=\n\s*\[|$)/,
  )?.[1] ?? "";
for (const [key, value] of [["preferred-dark-theme", "coal"]]) {
  if (!new RegExp(`^\\s*${key}\\s*=\\s*["']${value}["']`, "m").test(bookConfig)) {
    problems.push(`文档 book.toml 的 ${key} 必须为 "${value}"，与官网模式映射一致。`);
  }
}
for (const [key, resource] of [
  ["additional-css", "theme/pc-hospital.css"],
  ["additional-js", "theme/pc-hospital.js"],
]) {
  const resources = bookConfig.match(
    new RegExp(`^\\s*${key}\\s*=\\s*\\[([^\\]]*)\\]`, "m"),
  )?.[1];
  if (!resources?.includes(`"${resource}"`) && !resources?.includes(`'${resource}'`)) {
    problems.push(`文档 book.toml 的 ${key} 缺少 "${resource}"。`);
  }
}

for (const [label, siteTokens, docsTokens] of [
  ["正常模式 normal ↔ .light", normalSite, normalDocs],
  ["深色模式 dark ↔ .coal", darkSite, darkDocs],
]) {
  for (const token of SEMANTIC_TOKENS) {
    const siteValue = siteTokens.get(token);
    const docsValue = docsTokens.get(`${token.replace(/^--/, "--pc-")}`);
    if (siteValue === undefined) {
      problems.push(`${label}：官网 globals.css 缺少 ${token}`);
      continue;
    }
    if (docsValue === undefined) {
      problems.push(`${label}：文档站 pc-hospital.css 缺少 --pc-${token.slice(2)}`);
      continue;
    }
    if (normalize(siteValue) !== normalize(docsValue)) {
      problems.push(
        `${label}：${token} 取值不一致\n` +
          `      官网：${siteValue}\n` +
          `      文档：${docsValue}`,
      );
    }
  }
}

/* 主题存储键：文档站靠它跟随官网的模式 */
const keyMatch = readFileSync(themeTsPath, "utf8").match(/THEME_STORAGE_KEY\s*=\s*["']([^"']+)["']/);
if (!keyMatch) {
  problems.push("无法从 src/lib/theme.ts 读到 THEME_STORAGE_KEY");
} else if (!readFileSync(buildDocsPath, "utf8").includes(`"${keyMatch[1]}"`)) {
  problems.push(
    `主题存储键不同步：src/lib/theme.ts 用 "${keyMatch[1]}"，` +
      "但 tools/build-docs.mjs 的主题引导脚本里找不到同一个字符串。",
  );
}

if (problems.length > 0) {
  console.error("[check-theme-palette] 调色板/主题键不一致：\n  - " + problems.join("\n  - "));
  console.error(
    "\n两份文件必须逐值一致：官网改 src/app/globals.css 的主题层时，" +
      "要同步改 ZAFU-PCHospital-Doc/theme/pc-hospital.css 对应主题块。",
  );
  process.exit(1);
}

console.log(
  `[check-theme-palette] 通过：${SEMANTIC_TOKENS.length} 个令牌 × 2 套主题与文档站一致，主题配置与存储键同步。`,
);
