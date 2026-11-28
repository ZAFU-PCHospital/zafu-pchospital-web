import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const returnMarker = 'data-pc-hospital-return="true"';
const bootstrapMarker = 'data-pc-hospital-theme-bootstrap="true"';
const fontMarker = 'data-pc-hospital-font="true"';
const returnLink =
  `<a href="/tools" class="pc-hospital-return" title="返回电脑医院官网" ${returnMarker}>` +
  `<span aria-hidden="true">←</span><span>电脑医院官网</span></a>`;
const siteFont = `<style ${fontMarker}>@font-face{font-family:Archivo;src:url("/fonts/archivo-latin-wdth.woff2") format("woff2-variations");font-weight:100 900;font-stretch:62% 125%;font-style:normal;font-display:swap}</style>`;
// 与官网保持同一解析顺序：显式偏好 → 系统偏好 → 正常模式。
const themeBootstrap = `<script ${bootstrapMarker}>(function(){try{var k="zafu-pchospital:theme-mode",m=localStorage.getItem(k);if(m!=="dark"&&m!=="normal"){m=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"normal"}localStorage.setItem("mdbook-theme",m==="dark"?"coal":"light")}catch(e){}})();</script>`;

function walkFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`文档产物不允许符号链接：${filename}`);
    return entry.isDirectory() ? walkFiles(filename) : [filename];
  });
}

/** 按各 HTML 所在位置解析资源，禁止越出文档目录。 */
function localAsset(root, htmlPath, reference) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(reference)) {
    throw new Error(`文档资源必须使用相对路径：${reference}`);
  }
  const asset = path.resolve(
    path.dirname(htmlPath),
    decodeURIComponent(reference.split(/[?#]/)[0]),
  );
  const relative = path.relative(root, asset);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error(`文档资源越界：${reference}`);
  }
  if (!existsSync(asset)) throw new Error(`文档引用的资源不存在：${relative}`);
  return relative.replaceAll(path.sep, "/");
}

export function validateHandbook(directory, requireCustomization = false) {
  const root = path.resolve(directory);
  const files = walkFiles(root);
  const indexPath = path.join(root, "index.html");
  if (!existsSync(indexPath)) throw new Error("文档产物缺少 index.html");
  const assets = new Set();
  let themeCss;
  for (const htmlPath of files.filter((file) => file.endsWith(".html"))) {
    const html = readFileSync(htmlPath, "utf8");
    // 只读 script 与 stylesheet 标签，避免把正文中的示例代码当成资源。
    const refs = [
      ...html.matchAll(
        /<(?:script\b[^>]*\bsrc|link\b[^>]*\bhref)\s*=\s*["']([^"']+\.(?:css|js)(?:[?#][^"']*)?)["']/gi,
      ),
    ];
    const pageAssets = refs.map((match) => localAsset(root, htmlPath, match[1]));
    // 搜索索引由内联配置交给 searcher.js 动态加载，不在 script src 中。
    const searchIndex = html.match(/window\.path_to_searchindex_js\s*=\s*["']([^"']+)["']/)?.[1];
    if (searchIndex) pageAssets.push(localAsset(root, htmlPath, searchIndex));
    pageAssets.forEach((file) => assets.add(file));
    // mdBook 的无脚本侧栏 iframe 没有主页面导航与主题脚本。
    if (htmlPath === path.join(root, "toc.html")) continue;
    const css = pageAssets.find((file) => /(?:^|\/)pc-hospital(?:[.-]).*\.css$/.test(file));
    if (!css || !pageAssets.some((file) => /(?:^|\/)pc-hospital(?:[.-]).*\.js$/.test(file))) {
      throw new Error(`文档 HTML 未引用自定义主题 CSS/JS：${path.relative(root, htmlPath)}`);
    }
    if (
      requireCustomization &&
      ![returnMarker, bootstrapMarker, fontMarker].every((marker) => html.includes(marker))
    ) {
      throw new Error(`文档 HTML 缺少官网定制：${path.relative(root, htmlPath)}`);
    }
    if (htmlPath === indexPath) themeCss = css;
  }
  const indexes = files.filter((file) => /^searchindex(?:[.-]).*\.js$/.test(path.basename(file)));
  if (!indexes.length) throw new Error("文档产物缺少 searchindex");
  indexes.forEach((file) => assets.add(path.relative(root, file).replaceAll(path.sep, "/")));
  return { root, themeCss: path.join(root, themeCss), assets: [...assets] };
}

/** 本地构建与 gh-pages 同步必须走同一份定制，重复执行不重复注入。 */
export function customizeHandbook(directory) {
  validateHandbook(directory);
  for (const filename of walkFiles(directory).filter((file) => file.endsWith(".html"))) {
    if (path.resolve(filename) === path.resolve(directory, "toc.html")) continue;
    let html = readFileSync(filename, "utf8");
    const head = [
      !html.includes(bootstrapMarker) ? themeBootstrap : "",
      !html.includes(fontMarker) ? siteFont : "",
    ].join("");
    if (head) {
      if (!html.includes("<!-- Custom HTML head -->"))
        throw new Error(`缺少 mdBook head 插入点：${filename}`);
      html = html.replace("<!-- Custom HTML head -->", `<!-- Custom HTML head -->${head}`);
    }
    if (!html.includes(returnMarker)) {
      if (!html.includes('<div class="left-buttons">'))
        throw new Error(`缺少 mdBook 导航插入点：${filename}`);
      html = html.replace('<div class="left-buttons">', `<div class="left-buttons">${returnLink}`);
    }
    writeFileSync(filename, html);
  }
  return validateHandbook(directory, true);
}

function handbookUrl(baseUrl) {
  const url = new URL(baseUrl);
  if (
    !/^https?:$/.test(url.protocol) ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith("/handbook/")
  ) {
    throw new Error("DOCS_SYNC_BASE_URL 必须是以 /handbook/ 结尾的 HTTP(S) 地址");
  }
  return url;
}

async function verifyFile(root, relative, baseUrl) {
  const encoded = relative.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(new URL(encoded, baseUrl), {
    signal: AbortSignal.timeout(15000),
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`文档 HTTP 校验失败：${relative} → ${response.status}`);
  const type = response.headers.get("content-type")?.split(";")[0].trim();
  const expected = relative.endsWith(".css")
    ? ["text/css"]
    : relative.endsWith(".js")
      ? ["application/javascript", "text/javascript"]
      : relative.endsWith(".html")
        ? ["text/html"]
        : null;
  if (expected && !expected.includes(type))
    throw new Error(`文档 HTTP 类型错误：${relative} → ${type}`);
  const actual = Buffer.from(await response.arrayBuffer());
  if (!actual.equals(readFileSync(path.join(root, relative)))) {
    throw new Error(`文档 HTTP 内容与磁盘不一致：${relative}`);
  }
}

export async function verifyHandbookHttp(directory, baseUrl) {
  const url = handbookUrl(baseUrl);
  const { root, assets } = validateHandbook(directory, true);
  const files = ["index.html", ...assets];
  for (let offset = 0; offset < files.length; offset += 4) {
    const results = await Promise.allSettled(
      files.slice(offset, offset + 4).map((file) => verifyFile(root, file, url)),
    );
    const failed = results.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
  }
}

/** 发布前证明新文件能立即被 HTTP 读取；Next.js 生产静态清单会在这里被挡住。 */
export async function probeHandbookHttp(directory, baseUrl) {
  const url = handbookUrl(baseUrl);
  const filename = `docs-sync-probe-${randomUUID()}.txt`;
  mkdirSync(directory, { recursive: true });
  const target = path.join(directory, filename);
  writeFileSync(target, filename, { flag: "wx" });
  try {
    await verifyFile(directory, filename, url);
  } finally {
    rmSync(target, { force: true });
  }
}

async function runCli() {
  const [, , command, directory, baseUrl] = process.argv;
  try {
    if (!directory)
      throw new Error("用法：node tools/handbook.mjs prepare|verify|probe <目录> [URL]");
    if (command === "prepare") console.log(customizeHandbook(directory).themeCss);
    else if (command === "verify") await verifyHandbookHttp(directory, baseUrl);
    else if (command === "probe") await probeHandbookHttp(directory, baseUrl);
    else throw new Error(`未知命令：${command}`);
  } catch (error) {
    console.error(`[handbook] ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runCli();
}
