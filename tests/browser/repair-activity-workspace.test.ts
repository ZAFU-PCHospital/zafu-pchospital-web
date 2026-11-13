import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

/** 登录到有报名数据的本地活动对象页后，设置 URL 与 CDP_PORT 运行；只读取接口与操作页签。 */
const workspaceUrl = process.env.ACTIVITY_WORKSPACE_BROWSER_URL;

type Message = {
  id?: number;
  result?: unknown;
  error?: { message: string };
  method?: string;
  params?: { request?: { url: string }; exceptionDetails?: { text: string } };
};

test(
  "Next 页签点击同步 URL / 面板，隐藏看板暂停，历史返回保留搜索与逐页签滚动",
  {
    skip: !workspaceUrl,
    timeout: 45_000,
  },
  async (t) => {
    const target = new URL(workspaceUrl!);
    assert.match(target.pathname, /^\/admin\/repair-activities\/[^/]+$/);
    target.searchParams.set("tab", "board");
    const endpoint = `http://127.0.0.1:${Number(process.env.CDP_PORT ?? "9222")}`;
    const response = await fetch(`${endpoint}/json/new?about:blank`, { method: "PUT" });
    assert.equal(response.ok, true, "需要已启动并开放 CDP 端口的浏览器");
    const page = (await response.json()) as { id: string; webSocketDebuggerUrl: string };
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    t.after(async () => {
      socket.close();
      await fetch(`${endpoint}/json/close/${page.id}`).catch(() => {});
    });
    const pending = new Map<
      number,
      { resolve: (value: unknown) => void; reject: (error: Error) => void }
    >();
    const exceptions: string[] = [];
    let sequence = 0;
    let boardRequests = 0;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as Message;
      if (message.id) {
        const callback = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) callback?.reject(new Error(message.error.message));
        else callback?.resolve(message.result);
      }
      if (message.method === "Network.requestWillBeSent") {
        const url = message.params?.request?.url ?? "";
        if (/\/api\/v1\/member\/repair-activities\/[^/]+\/board\?view=(live|served)/.test(url))
          boardRequests++;
      }
      if (message.method === "Runtime.exceptionThrown")
        exceptions.push(message.params?.exceptionDetails?.text ?? "运行时错误");
    });
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("CDP 连接失败")), { once: true });
    });
    function send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve: (value) => resolve(value as T), reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    }
    async function read<T = unknown>(expression: string): Promise<T> {
      const result = await send<{ result: { value: T }; exceptionDetails?: { text: string } }>(
        "Runtime.evaluate",
        { expression, returnByValue: true, awaitPromise: true },
      );
      assert.equal(result.exceptionDetails, undefined, expression);
      return result.result.value;
    }
    async function until(expression: string) {
      const end = Date.now() + 10_000;
      while (Date.now() < end) {
        if (await read<boolean>(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.fail(`等待页面状态超时：${expression}`);
    }
    const selected = (tab: string) =>
      `document.querySelector('#activity-tab-${tab}')?.getAttribute('aria-selected') === 'true'`;
    async function select(tab: string) {
      await read(`document.querySelector('#activity-tab-${tab}').click()`);
      await until(
        `${selected(tab)} && new URL(location.href).searchParams.get('tab') === '${tab}'`,
      );
    }
    async function scroll() {
      const top = await read<number>(
        "Math.min(120, document.documentElement.scrollHeight - document.documentElement.clientHeight)",
      );
      assert.ok(top > 0, "测试活动应有足够内容形成页面滚动");
      await read(`window.scrollTo({top:${top},behavior:'instant'})`);
      await until(`window.scrollY === ${top}`);
      await read(
        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      );
      return top;
    }
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.enable");
    await send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const cookie = process.env.ACTIVITY_WORKSPACE_BROWSER_COOKIE;
    if (cookie) {
      const separator = cookie.indexOf("=");
      assert.ok(separator > 0);
      await send("Network.setCookie", {
        url: target.origin,
        name: cookie.slice(0, separator),
        value: cookie.slice(separator + 1),
        httpOnly: true,
        sameSite: "Lax",
      });
    }
    await send("Page.navigate", { url: target.href });
    await until(
      `${selected("board")} && !!document.querySelector('#activity-panel-board .activity-board--ready')`,
    );
    const marker = randomUUID();
    await read(
      `window.__workspaceDocumentMarker=${JSON.stringify(marker)}; window.__workspaceBoardNode=document.querySelector('#activity-panel-board .activity-board'); window.__workspaceSearchInput=document.querySelector('#activity-panel-board input[type=search]'); window.__workspaceSearchInput.focus()`,
    );
    await send("Input.insertText", { text: "回归" });
    await until("window.__workspaceSearchInput.value === '回归'");
    const boardScroll = await scroll();
    await select("registrations");
    await until("!!document.querySelector('#activity-panel-registrations tbody tr')");
    assert.equal(await read("document.querySelector('#activity-panel-board').hidden"), true);
    assert.equal(
      await read(
        "document.querySelector('#activity-panel-board .activity-board') === window.__workspaceBoardNode",
      ),
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const pausedRequests = boardRequests;
    assert.ok(pausedRequests > 0, "真实 member board 路由应已发出读取请求");
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    assert.equal(boardRequests, pausedRequests, "隐藏看板不得继续发出自动请求");
    const registrationScroll = await scroll();
    await read("window.history.back()");
    await until(
      `${selected("board")} && new URL(location.href).searchParams.get('tab') === 'board'`,
    );
    await until(`window.scrollY === ${boardScroll}`);
    assert.equal(
      await read(
        "document.querySelector('#activity-panel-board input[type=search]') === window.__workspaceSearchInput",
      ),
      true,
    );
    assert.equal(await read("window.__workspaceSearchInput.value"), "回归");
    await until("!document.querySelector('#activity-panel-board').hidden");
    await read("window.history.forward()");
    await until(
      `${selected("registrations")} && new URL(location.href).searchParams.get('tab') === 'registrations'`,
    );
    await until(`window.scrollY === ${registrationScroll}`);
    assert.equal(await read("window.__workspaceDocumentMarker"), marker, "页签切换保持同一文档");
    assert.deepEqual(exceptions, []);
    t.diagnostic(
      JSON.stringify({ boardScroll, registrationScroll, pausedRequests, history: "back/forward" }),
    );
  },
);
