/* 用 CDP 直连本机 Chrome，做页面诊断与截图。
   Chrome 需已用 --remote-debugging-port=9222 --headless=new 启动。

   用法：
     node tools/inspect.mjs <url> <输出png|-> [宽] [高] [要评估的JS]

   环境变量：
     CAP_Y      截图区域纵坐标（会先滚动到该位置以触发进场动效）
     CAP_SEL    改为滚动到该 CSS 选择器所在位置（与 CAP_Y 二选一）
     CAP_X      截图区域横坐标，默认 0
     CAP_W/H    截图区域尺寸，默认取视口宽高
     CAP_SCALE  截图缩放，默认 1（>1 可放大看细节）
     WAIT_MS    载入后等待时长，默认 1600
     REDUCED_MOTION=1  以 prefers-reduced-motion: reduce 渲染
     THEME_MODE normal|dark  指定显示模式；不设则清掉本地选择，走默认模式
*/
const [, , url, out, w = "1440", h = "900", expr = ""] = process.argv;
const PORT = process.env.CDP_PORT || "9222";
const capY = +(process.env.CAP_Y || 0);
const capX = +(process.env.CAP_X || 0);
const capW = +(process.env.CAP_W || w);
const capH = +(process.env.CAP_H || h);
const capScale = +(process.env.CAP_SCALE || 1);
const waitMs = +(process.env.WAIT_MS || 1600);
const themeMode = process.env.THEME_MODE || "";

/** 与 src/lib/theme.ts 的 THEME_STORAGE_KEY 保持一致（工具是独立脚本，不 import 源码） */
const THEME_STORAGE_KEY = "zafu-pchospital:theme-mode";

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) throw new Error("没有可用的页面目标");

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const events = new Map();

ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  } else if (msg.method && events.has(msg.method)) {
    events.get(msg.method)();
    events.delete(msg.method);
  }
});

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });

// 收集页面错误、console.error 与失败请求，跑完一并汇报
// 注意：Log.enable 会回放该标签页历史缓冲里的旧日志，会把上一轮已修复的报错
// 当成本轮问题重复报出来。因此开日志前先 Log.clear，并按时间戳过滤。
const problems = [];
const badRequests = [];
let logSince = 0;
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    problems.push("EXCEPTION: " + (d.exception?.description || d.text));
  }
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
    const e = m.params.entry;
    if (!logSince || (e.timestamp || 0) >= logSince) {
      problems.push("CONSOLE: " + e.text);
    }
  }
  if (m.method === "Network.responseReceived") {
    const r = m.params.response;
    if (r.status >= 400) badRequests.push(r.status + " " + r.url);
  }
  if (m.method === "Network.loadingFailed") {
    badRequests.push("FAILED " + m.params.errorText + " " + (m.params.type || ""));
  }
});

const once = (method) => new Promise((r) => events.set(method, r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => {
  const res = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
  return res.result?.value;
};

await new Promise((r) => ws.addEventListener("open", r));
await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("Log.enable");
try {
  await send("Log.clear");
} catch {
  /* 旧版本 Chrome 无 Log.clear，靠时间戳过滤兜底 */
}
logSince = Date.now() / 1000;
await send("Network.setCacheDisabled", { cacheDisabled: true }); // 避免旧资源干扰判断
await send("Emulation.setDeviceMetricsOverride", {
  width: +w,
  height: +h,
  deviceScaleFactor: 1,
  mobile: false,
});
if (process.env.REDUCED_MOTION === "1") {
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
}

// 显示模式：站点把用户的选择存在 localStorage 里，引导脚本在 hydration 之前就读它，
// 所以必须在文档创建之前写入 —— 等页面加载完再改 data-theme 会让主题切换控件的
// 选中状态对不上。不设 THEME_MODE 时反过来主动清掉这个键，否则上一轮跑 dark
// 留下的选择会把后面所有截图都拍成深色（这个坑踩过一次）。
await send("Page.addScriptToEvaluateOnNewDocument", {
  source:
    "try{" +
    (themeMode
      ? `localStorage.setItem(${JSON.stringify(THEME_STORAGE_KEY)},${JSON.stringify(themeMode)})`
      : `localStorage.removeItem(${JSON.stringify(THEME_STORAGE_KEY)})`) +
    "}catch(e){}",
});

const loaded = once("Page.loadEventFired");
await send("Page.navigate", { url });
await Promise.race([loaded, sleep(9000)]);

// 只改 hash 的同文档导航不会重新加载页面，会读到上一轮的旧脚本与旧数据，
// 所以这里强制 ignoreCache 重载一次，保证测的是磁盘上的最新版本。
const reloaded = once("Page.loadEventFired");
await send("Page.reload", { ignoreCache: true });
await Promise.race([reloaded, sleep(9000)]);
await sleep(waitMs);

if (expr) console.log(JSON.stringify(await evaluate(expr), null, 2));

if (out !== "-") {
  // 先滚到目标位置，让该区域内的进场动效播完，再回填截图
  if (process.env.CAP_SEL) {
    await evaluate(
      `(()=>{var el=document.querySelector(${JSON.stringify(process.env.CAP_SEL)});` +
        `if(el)el.scrollIntoView({block:"start",behavior:"instant"});void 0})()`,
    );
    await sleep(1500);
  } else if (capY > 0) {
    await evaluate(`window.scrollTo(0, ${capY}); void 0`);
    await sleep(1500);
  }
  const beyond = capY > 0;
  const fullViewport = capX === 0 && capY === 0 && capW === +w && capH === +h && capScale === 1;

  const params = {
    format: "png",
    // 整页表面会把 position:fixed 的浮层画错位置，视口内截图时不启用
    captureBeyondViewport: beyond,
  };
  if (!(fullViewport && !beyond)) {
    params.clip = { x: capX, y: capY, width: capW, height: capH, scale: capScale };
  }

  const shot = await send("Page.captureScreenshot", params);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log("saved " + out);
}

console.log("PAGE_PROBLEMS " + JSON.stringify(problems));
console.log("BAD_REQUESTS " + JSON.stringify(badRequests));
ws.close();
