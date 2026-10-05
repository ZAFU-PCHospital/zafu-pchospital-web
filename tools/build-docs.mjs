import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveDocsSourceRoot } from "./docs-source.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolveDocsSourceRoot(projectRoot);
const outputRoot = path.resolve(projectRoot, "public", "handbook");
const manifestPath = path.resolve(projectRoot, "src", "data", "doc-manifest.json");
const themeRoot = path.join(sourceRoot, "theme");
const themeCssPath = path.join(themeRoot, "pc-hospital.css");
const themeJsPath = path.join(themeRoot, "pc-hospital.js");
const summaryPath = path.join(sourceRoot, "src", "SUMMARY.md");
const bookConfigPath = path.join(sourceRoot, "book.toml");
const repoUrl = "https://github.com/ZAFU-PCHospital/ZAFU-PCHospital-Doc";
const buildSourceRoot = mkdtempSync(path.join(tmpdir(), "zafu-pchospital-docs-"));

process.once("exit", () => {
  const resolvedTempRoot = path.resolve(tmpdir());
  const resolvedBuildSource = path.resolve(buildSourceRoot);
  if (resolvedBuildSource.startsWith(`${resolvedTempRoot}${path.sep}`)) {
    rmSync(resolvedBuildSource, { recursive: true, force: true });
  }
});

function fail(message) {
  throw new Error(`[docs:build] ${message}`);
}

const mdbookBin = process.env.MDBOOK_BIN || "mdbook";

/**
 * 文档源码：默认自动浅克隆到 .docs-source/，所以干净克隆的仓库也能直接构建。
 * 想用本地已有的检出就设 DOCS_SOURCE_DIR；完全离线用 DOCS_OFFLINE=1 跳过克隆。
 */
function ensureSource() {
  if (existsSync(sourceRoot)) return;

  if (process.env.DOCS_SOURCE_DIR) {
    fail(
      `DOCS_SOURCE_DIR 指向的目录不存在：${sourceRoot}\n` +
        "请先检出文档仓库，或去掉该环境变量让脚本自动克隆。",
    );
  }
  if (process.env.DOCS_OFFLINE === "1") {
    fail(
      `文档源码目录不存在：${sourceRoot}\n` +
        "DOCS_OFFLINE=1 时不会联网克隆。请把文档仓库检出到该目录，或用 DOCS_SOURCE_DIR 指定路径。",
    );
  }

  console.log(`[docs:build] 未找到文档源码，浅克隆 ${repoUrl} → ${sourceRoot}`);
  try {
    execFileSync("git", ["clone", "--depth", "1", "--branch", "main", repoUrl, sourceRoot], {
      cwd: projectRoot,
      stdio: "inherit",
    });
  } catch {
    fail(
      `克隆文档仓库失败：${repoUrl}\n` +
        "  请检查网络；或把文档仓库手动检出到 .docs-source/；\n" +
        "  或用 DOCS_SOURCE_DIR 指向已有的检出；完全离线时用 DOCS_OFFLINE=1（仍需先有源码）。",
    );
  }
}

/** 一次列全所有前置问题，而不是撞一个报一个（装完 mdbook 才发现还缺源码） */
function preflight() {
  /* 先查本机与仓库内的条件（便宜、不联网）：这些不满足就没必要下载源码 */
  const problems = [];

  try {
    execFileSync(mdbookBin, ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    problems.push(
      `找不到 mdBook 可执行文件：${mdbookBin}\n` +
        "    二选一安装：\n" +
        "      · cargo install mdbook（需要 Rust 工具链）\n" +
        "      · 或从 https://github.com/rust-lang/mdBook/releases 下载对应平台二进制，\n" +
        "        再用 MDBOOK_BIN 指过去：MDBOOK_BIN=/path/to/mdbook pnpm build",
    );
  }

  if (problems.length > 0) fail(`前置条件不满足：\n  - ${problems.join("\n  - ")}`);

  /* 本机条件齐了再取源码：缺省会自动浅克隆 */
  ensureSource();

  const missing = [];
  if (!existsSync(bookConfigPath)) missing.push(`缺少 mdBook 配置：${bookConfigPath}`);
  if (!existsSync(summaryPath)) missing.push(`缺少文档目录：${summaryPath}`);
  if (!existsSync(themeCssPath)) missing.push(`文档版本缺少主题样式：${themeCssPath}`);
  if (!existsSync(themeJsPath)) missing.push(`文档版本缺少主题脚本：${themeJsPath}`);
  if (missing.length > 0) fail(`文档源码不完整：\n  - ${missing.join("\n  - ")}`);

  // 校验实际构建的文档版本，而不是官网中的另一份主题副本。
  execFileSync(process.execPath, [path.join(projectRoot, "tools", "check-theme-palette.mjs")], {
    cwd: projectRoot,
    env: { ...process.env, DOCS_SOURCE_DIR: sourceRoot },
    stdio: "inherit",
  });
}

function toPosix(value) {
  return value.replaceAll("\\", "/");
}

function localMarkdownPath(href) {
  const clean = href.split(/[?#]/, 1)[0].trim();
  if (!clean || /^[a-z][a-z\d+.-]*:/i.test(clean) || clean.startsWith("//")) return null;

  const decoded = decodeURIComponent(clean);
  const relativePath = path.posix.normalize(toPosix(decoded));
  if (
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    path.posix.isAbsolute(relativePath)
  ) {
    fail(`SUMMARY.md 包含越界路径：${href}`);
  }
  return relativePath;
}

function outputCandidates(markdownPath) {
  const parsed = path.posix.parse(markdownPath);
  const standard = path.posix.join(parsed.dir, `${parsed.name}.html`);
  if (parsed.base.toLowerCase() === "readme.md") {
    return [path.posix.join(parsed.dir, "index.html"), standard];
  }
  return [standard];
}

function resolveOutputPath(markdownPath) {
  const candidates = outputCandidates(markdownPath);
  const match = candidates.find((candidate) =>
    existsSync(path.join(outputRoot, ...candidate.split("/"))),
  );
  if (!match) {
    fail(`已就绪条目没有对应的 mdBook HTML：${markdownPath}（检查过 ${candidates.join("、")}）`);
  }
  return match;
}

function markdownDetails(markdownPath, title) {
  const absolutePath = path.join(sourceRoot, "src", ...markdownPath.split("/"));
  if (!existsSync(absolutePath)) fail(`SUMMARY.md 引用了不存在的文件：${markdownPath}`);

  const markdown = readFileSync(absolutePath, "utf8");
  const headingMatch = markdown.match(/^#{1,6}\s+(.+)$/m);
  return {
    title,
    heading: headingMatch?.[1].replaceAll("**", "").trim() || title,
    markdown,
    bytes: Buffer.byteLength(markdown),
  };
}

function parseSummary() {
  const tree = [];
  const pages = {};
  let activeChildren = tree;
  let stack = [{ indent: -1, children: activeChildren }];

  const addEntry = (title, href, indent) => {
    while (stack.length > 1 && stack.at(-1).indent >= indent) stack.pop();

    const markdownPath = localMarkdownPath(href);
    const children = [];
    const node = markdownPath
      ? {
          kind: "page",
          title,
          path: markdownPath,
          outputPath: resolveOutputPath(markdownPath),
          exists: true,
          children,
        }
      : { kind: "pending", title, path: null, children };

    stack.at(-1).children.push(node);
    stack.push({ indent, children });

    if (markdownPath) pages[markdownPath] = markdownDetails(markdownPath, title);
  };

  for (const line of readFileSync(summaryPath, "utf8").split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) {
      if (heading[1].trim().toLowerCase() === "summary") continue;
      const group = { kind: "group", title: heading[1].trim(), path: null, children: [] };
      tree.push(group);
      activeChildren = group.children;
      stack = [{ indent: -1, children: activeChildren }];
      continue;
    }

    const listEntry = line.match(/^(\s*)[-*+]\s+\[([^\]]+)]\(([^)]*)\)\s*$/);
    if (listEntry) {
      const indent = listEntry[1].replaceAll("\t", "    ").length;
      addEntry(listEntry[2].trim(), listEntry[3], indent);
      continue;
    }

    const rootEntry = line.match(/^\[([^\]]+)]\(([^)]*)\)\s*$/);
    if (rootEntry) {
      activeChildren = tree;
      stack = [{ indent: -1, children: activeChildren }];
      addEntry(rootEntry[1].trim(), rootEntry[2], 0);
    }
  }

  return { tree, pages };
}

function walkFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(entryPath) : [entryPath];
  });
}

function customizeHtml() {
  const marker = 'data-pc-hospital-return="true"';
  const link =
    `<a href="/docs" class="pc-hospital-return" title="返回电脑医院官网" ${marker}>` +
    `<span aria-hidden="true">←</span><span>电脑医院官网</span></a>`;
  const themeBootstrapMarker = 'data-pc-hospital-theme-bootstrap="true"';
  const siteFont =
    '<style data-pc-hospital-font="true">@font-face{font-family:Archivo;src:url("/fonts/archivo-latin-wdth.woff2") format("woff2-variations");font-weight:100 900;font-stretch:62% 125%;font-style:normal;font-display:swap}</style>';
  /* 主题引导：解析顺序必须与官网 src/lib/theme.ts 完全一致 ——
       本地存过明确模式 → 用它；否则跟随 prefers-color-scheme；再否则回落到正常模式。
     漏掉「跟随系统」那条会出现：首次访客系统是深色 → 官网深色、文档站却是浅色。
     存储键与官网共用（同域 localStorage）；tools/check-theme-palette.mjs
     会校验这个键在 build-docs.mjs 与 src/lib/theme.ts 里一致。 */
  const themeBootstrap = `<script ${themeBootstrapMarker}>(function(){try{var k="zafu-pchospital:theme-mode",m=localStorage.getItem(k);if(m!=="dark"&&m!=="normal"){m=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"normal"}localStorage.setItem("mdbook-theme",m==="dark"?"coal":"light")}catch(e){}})();</script>`;
  let injected = 0;

  for (const htmlPath of walkFiles(outputRoot).filter((file) => file.endsWith(".html"))) {
    let html = readFileSync(htmlPath, "utf8");
    if (!html.includes(themeBootstrapMarker) && html.includes("<!-- Custom HTML head -->")) {
      html = html.replace(
        "<!-- Custom HTML head -->",
        `<!-- Custom HTML head -->${themeBootstrap}${siteFont}`,
      );
    }
    if (!html.includes(marker) && html.includes('<div class="left-buttons">')) {
      html = html.replace('<div class="left-buttons">', `<div class="left-buttons">${link}`);
      injected += 1;
    }
    writeFileSync(htmlPath, html);
  }

  const indexHtml = readFileSync(path.join(outputRoot, "index.html"), "utf8");
  if (!injected || !indexHtml.includes(marker) || !indexHtml.includes(themeBootstrapMarker)) {
    fail("无法向 mdBook 加入官网导航或主题引导，请检查当前 mdBook 主题结构");
  }
}

function validateAssets() {
  const files = walkFiles(outputRoot);
  if (!existsSync(path.join(outputRoot, "index.html"))) fail("缺少 public/handbook/index.html");
  if (!files.some((file) => file.endsWith(".js"))) fail("mdBook 产物中没有 JavaScript 资源");
  if (!files.some((file) => file.endsWith(".css"))) fail("mdBook 产物中没有 CSS 资源");
  if (!files.some((file) => /^searchindex(?:[.-])/.test(path.basename(file)))) {
    fail("mdBook 已启用搜索，但产物中没有 searchindex.*");
  }
  if (!files.some((file) => /^pc-hospital(?:[.-]).*\.css$/.test(path.basename(file)))) {
    fail("mdBook 产物中没有电脑医院自定义主题 CSS");
  }
  if (!files.some((file) => /^pc-hospital(?:[.-]).*\.js$/.test(path.basename(file)))) {
    fail("mdBook 产物中没有电脑医院自定义主题 JavaScript");
  }
}

function resolveRevision() {
  if (process.env.DOCS_SHA) return process.env.DOCS_SHA;
  try {
    return execFileSync(
      "git",
      ["-c", `safe.directory=${sourceRoot}`, "-C", sourceRoot, "rev-parse", "HEAD"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return "local";
  }
}

function readBookMetadata() {
  const config = readFileSync(bookConfigPath, "utf8");
  const bookSection = config.match(/\[book]\s*([\s\S]*?)(?=\n\s*\[|$)/)?.[1] ?? "";
  const scalar = (key, fallback) =>
    bookSection.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, "m"))?.[1] ?? fallback;
  const authors = bookSection
    .match(/^\s*authors\s*=\s*\[([^\]]*)]/m)?.[1]
    ?.split(",")
    .map((author) => author.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

  return {
    title: scalar("title", "ZAFU-PCHospital-Doc"),
    authors: authors?.length ? authors : ["RepentStar"],
    language: scalar("language", "zh-Hans-CN"),
  };
}

function stripEmptyChildren(nodes) {
  return nodes.map((node) => {
    if (!node.children?.length) {
      return Object.fromEntries(Object.entries(node).filter(([key]) => key !== "children"));
    }
    return { ...node, children: stripEmptyChildren(node.children) };
  });
}

function countEntries(nodes) {
  let ready = 0;
  let pending = 0;
  for (const node of nodes) {
    if (node.kind === "page") ready += 1;
    if (node.kind === "pending") pending += 1;
    if (node.children) {
      const nested = countEntries(node.children);
      ready += nested.ready;
      pending += nested.pending;
    }
  }
  return { ready, pending };
}

preflight();

cpSync(sourceRoot, buildSourceRoot, {
  recursive: true,
  filter(source) {
    const relativePath = path.relative(sourceRoot, source);
    if (!relativePath) return true;
    const firstSegment = relativePath.split(path.sep)[0];
    return firstSegment !== ".git" && firstSegment !== "book";
  },
});

if (outputRoot !== path.resolve(projectRoot, "public", "handbook")) {
  fail(`拒绝清理非预期目录：${outputRoot}`);
}
rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });

console.log(`[docs:build] source: ${sourceRoot}`);
execFileSync(
  mdbookBin,
  ["build", buildSourceRoot, "--dest-dir", outputRoot],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      MDBOOK_OUTPUT__HTML__SITE_URL: '"/handbook/"',
    },
    stdio: "inherit",
  },
);

const cnamePath = path.join(outputRoot, "CNAME");
if (existsSync(cnamePath) && statSync(cnamePath).isFile()) rmSync(cnamePath);

validateAssets();
customizeHtml();

const { tree, pages } = parseSummary();
const counts = countEntries(tree);
const sourceRevision = resolveRevision();
const bookMetadata = readBookMetadata();
const manifest = {
  meta: {
    ...bookMetadata,
    repoUrl,
    sourceRevision,
    generatedAt: new Date().toISOString(),
    counts: { total: counts.ready + counts.pending, ...counts },
  },
  tree: stripEmptyChildren(tree),
  pages,
};

mkdirSync(path.dirname(manifestPath), { recursive: true });
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[docs:build] revision: ${sourceRevision}`);
console.log(`[docs:build] manifest: ${counts.ready} ready / ${counts.pending} pending`);
console.log(`[docs:build] output: ${outputRoot}`);
