/* 页面加载性能探针（CDP）。

   为什么要它：性能问题基本靠猜不出来 —— 这次量完才发现「首页 CLS 0.173 全部来自
   字体替换」「/about 的 688 KB 全是图集原图」「字体根本没预加载」这三件事。
   断言优先（AGENTS.md §8.1）在性能上同样成立：能读出来的数字就不要靠肉眼看录屏。

   与 tools/inspect.mjs 一样直连本机 Chrome 的调试端口，因此**不起任何服务**，
   测的是你已经在跑的那个（默认 3100 之类由你自己指定）。

   准备：
     ~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome \
       --headless=new --remote-debugging-port=9222 --no-sandbox about:blank

   用法：
     node tools/perf-probe.mjs <url> [更多 url...]

   环境变量：
     CDP_PORT     调试端口，默认 9222
     PERF_COOKIE  带会话的 Cookie（`name=value`），测后台页面时用
     PERF_NET     网络档位：slow4g（默认）| fast | offline-ish
     PERF_CPU     CPU 降速倍数，默认 4（桌面端用户不会这么慢，但移动端接近）
     PERF_QUIET   设 1 只打印汇总行，不打资源清单

   输出：TTFB / FCP / LCP / DCL / load / CLS，按类型分类的传输体积，
   最慢的请求，以及 CLS 的位移来源（元素 + 位移前后矩形）。 */
const [, , ...urls] = process.argv;
if (urls.length === 0) {
  console.error("用法：node tools/perf-probe.mjs <url> [更多 url...]");
  process.exit(1);
}

const PORT = process.env.CDP_PORT || "9222";
const COOKIE = process.env.PERF_COOKIE || "";
const NET = process.env.PERF_NET || "slow4g";
const CPU = Number(process.env.PERF_CPU || "4");

/** Chrome DevTools 的 Slow 4G 预设。 */
const PROFILES = {
  slow4g: { latency: 150, download: (1.6 * 1024 * 1024) / 8, upload: (750 * 1024) / 8 },
  fast: { latency: 20, download: (10 * 1024 * 1024) / 8, upload: (2 * 1024 * 1024) / 8 },
};

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) throw new Error("没有可用的页面目标（Chrome 起来了吗？）");

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const waiters = new Map();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    // 用 `if/else` 而不是三元表达式当语句：三元在这里会被 ESLint 判成
    // `no-unused-expressions`（`pnpm lint` 因此留了一条 warning），写成分支也更直白。
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  } else if (msg.method && waiters.has(msg.method)) {
    waiters.get(msg.method)(msg.params);
    waiters.delete(msg.method);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const once = (method) => new Promise((resolve) => waiters.set(method, resolve));

await new Promise((r) => ws.addEventListener("open", r));
await send("Page.enable");
await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
const profile = PROFILES[NET] ?? PROFILES.slow4g;
await send("Network.emulateNetworkConditions", {
  offline: false,
  latency: profile.latency,
  downloadThroughput: profile.download,
  uploadThroughput: profile.upload,
});
await send("Emulation.setCPUThrottlingRate", { rate: CPU });

// LCP 与 CLS 必须在导航**之前**挂观察器：buffered 只覆盖注册之后的条目。
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
    window.__perf = { lcp: 0, shifts: [] };
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.lcp = e.startTime; })
      .observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__perf.shifts.push({ value: e.value, t: Math.round(e.startTime), sources: (e.sources || []).map((s) => ({
          tag: s.node ? s.node.nodeName : "?",
          cls: s.node && s.node.className ? String(s.node.className).slice(0, 50) : "",
          text: s.node && s.node.textContent ? s.node.textContent.trim().slice(0, 34) : "",
          from: s.previousRect ? [Math.round(s.previousRect.x), Math.round(s.previousRect.y), Math.round(s.previousRect.width), Math.round(s.previousRect.height)] : null,
          to: s.currentRect ? [Math.round(s.currentRect.x), Math.round(s.currentRect.y), Math.round(s.currentRect.width), Math.round(s.currentRect.height)] : null,
        })) });
      }
    }).observe({ type: "layout-shift", buffered: true });
  `,
});
if (COOKIE) {
  const [name, ...rest] = COOKIE.split("=");
  await send("Network.setCookie", {
    name,
    value: rest.join("="),
    url: new URL(urls[0]).origin,
    path: "/",
  });
}

const kib = (n) => `${(n / 1024).toFixed(1)} KB`;

for (const url of urls) {
  await send("Network.clearBrowserCache");
  const loaded = once("Page.loadEventFired");
  await send("Page.navigate", { url });
  await loaded;
  // 再等 4s：交换字体、客户端请求、懒加载图片都发生在这之后
  await new Promise((r) => setTimeout(r, 4000));

  const { result } = await send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      const res = performance.getEntriesByType("resource");
      const byKind = {};
      for (const r of res) {
        const kind = r.initiatorType === "script" ? "js" : r.name.endsWith(".css") ? "css"
          : r.initiatorType === "fetch" || r.initiatorType === "xmlhttprequest" ? "api"
          : r.initiatorType === "img" ? "img" : "other";
        const slot = (byKind[kind] ??= { n: 0, transfer: 0, decoded: 0 });
        slot.n += 1; slot.transfer += r.transferSize || 0; slot.decoded += r.decodedBodySize || 0;
      }
      return {
        fcp: fcp ? fcp.startTime : null, lcp: window.__perf.lcp, cls: window.__perf.shifts.reduce((s, x) => s + x.value, 0),
        shifts: window.__perf.shifts.slice(0, 5),
        ttfb: nav.responseStart, dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd,
        html: nav.decodedBodySize, byKind, count: res.length,
        slowest: res.map((r) => ({ n: r.name.split("/").pop().slice(0, 38), t: Math.round(r.duration) })).sort((a, b) => b.t - a.t).slice(0, 4),
      };
    })()`,
  });
  const m = result.value;
  const path = new URL(url).pathname;
  console.log(`\n=== ${path} ===`);
  console.log(
    `TTFB ${m.ttfb.toFixed(0)}ms · FCP ${m.fcp?.toFixed(0) ?? "—"}ms · LCP ${m.lcp?.toFixed(0) ?? "—"}ms · ` +
      `DCL ${m.dcl.toFixed(0)}ms · load ${m.load.toFixed(0)}ms · CLS ${m.cls.toFixed(3)}（${NET} / CPU ${CPU}x）`,
  );
  console.log(`HTML ${kib(m.html)} · 请求 ${m.count} 个`);
  if (process.env.PERF_QUIET !== "1") {
    for (const [kind, s] of Object.entries(m.byKind).sort(
      (a, b) => b[1].transfer - a[1].transfer,
    )) {
      console.log(
        `  ${kind.padEnd(6)} ${String(s.n).padStart(3)} 个  传输 ${kib(s.transfer).padStart(9)}  解码 ${kib(s.decoded)}`,
      );
    }
    console.log(`  最慢：${m.slowest.map((r) => `${r.n} ${r.t}ms`).join(" · ")}`);
    if (m.shifts.length > 0) {
      console.log("  CLS 来源：");
      for (const s of m.shifts) {
        console.log(`    +${s.t}ms 分数 ${s.value.toFixed(4)}`);
        for (const src of s.sources)
          console.log(`      ${src.tag}.${src.cls} ${src.from} → ${src.to} 「${src.text}」`);
      }
    }
  }
}
ws.close();
