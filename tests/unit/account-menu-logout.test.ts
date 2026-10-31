import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import type { ReactElement, ReactNode } from "react";

import { accountMenuCopy } from "../../src/config/auth";
import { clientSessionRevision, invalidateClientSession } from "../../src/lib/auth/client-session";

const require = createRequire(import.meta.url);
const React = require("react") as typeof import("react");
const { PathnameContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
(globalThis as unknown as { React: typeof React }).React = React;

type Props = {
  children?: ReactNode;
  onClick?: () => void;
  onConfirm?: () => void;
  onClose?: () => void;
  confirmLabel?: string;
  title?: string;
  busy?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
};

function find(node: ReactNode, match: (props: Props) => boolean): ReactElement<Props> | undefined {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement<Props>(child)) continue;
    if (match(child.props)) return child;
    const nested = find(child.props.children, match);
    if (nested) return nested;
  }
}

async function mount(t: TestContext) {
  invalidateClientSession();
  const state: unknown[] = [];
  const effects: (() => void | (() => void))[] = [];
  let cursor = 0;
  t.mock.method(React, "useState", <S>(initial: S) => {
    const index = cursor++;
    if (!(index in state)) state[index] = initial;
    return [
      state[index],
      (next: S | ((previous: S) => S)) => {
        state[index] =
          typeof next === "function" ? (next as (previous: S) => S)(state[index] as S) : next;
      },
    ];
  });
  t.mock.method(React, "useRef", () => ({ current: null }));
  t.mock.method(React, "useId", () => "account-menu-test");
  t.mock.method(React, "useEffect", (effect: () => void | (() => void)) => {
    if (effects.length < 2) effects.push(effect);
  });
  const destinations: string[] = [];
  let refreshes = 0;
  t.mock.method(React, "useContext", (context: unknown) =>
    context === PathnameContext
      ? "/member"
      : {
          replace: (path: string) => destinations.push(path),
          refresh: () => {
            refreshes++;
          },
        },
  );
  const { AccountMenu } = await import("../../src/components/layout/AccountMenu");
  function render() {
    cursor = 0;
    return AccountMenu({ initialDisplayName: "测试成员" });
  }
  const trigger = () =>
    find(render(), (props) => props["aria-label"] === accountMenuCopy.menuLabel)!;
  function button() {
    let element = find(
      render(),
      (props) =>
        props.children === accountMenuCopy.logout || props.children === accountMenuCopy.loggingOut,
    );
    if (!element) {
      trigger().props.onClick!();
      element = find(
        render(),
        (props) =>
          props.children === accountMenuCopy.logout ||
          props.children === accountMenuCopy.loggingOut,
      );
    }
    assert.ok(element);
    return element.props;
  }
  return {
    destinations,
    refreshes: () => refreshes,
    button,
    logout: async () => {
      button().onClick!();
      await setImmediate();
    },
    dialog: () => find(render(), (props) => typeof props.onConfirm === "function")?.props,
    trigger: () => find(render(), (props) => props["aria-label"] === accountMenuCopy.menuLabel),
    resolveInitialSession: async () => {
      render();
      effects[0]();
      await setImmediate();
    },
  };
}

const failures: [string, () => Promise<Response>][] = [
  [
    "network",
    async () => {
      throw new TypeError("offline");
    },
  ],
  ["403", async () => Response.json({ success: true, data: { loggedOut: true } }, { status: 403 })],
  ["500", async () => Response.json({ success: false }, { status: 500 })],
  ["failure-envelope", async () => Response.json({ success: false, data: { loggedOut: true } })],
  ["invalid-json", async () => new Response("<html>error</html>")],
  ["empty", async () => new Response(null, { status: 204 })],
  ...[
    null,
    {},
    { success: true },
    { success: true, data: null },
    { success: true, data: { loggedOut: false } },
    { success: "true", data: { loggedOut: true } },
    { success: true, data: { loggedOut: "true" } },
  ].map((payload): [string, () => Promise<Response>] => [
    JSON.stringify(payload),
    async () => Response.json(payload),
  ]),
];

for (const [name, response] of failures) {
  test(`退出 ${name} 后不跳转，持续提示未确认并可重试成功`, async (t) => {
    const ui = await mount(t);
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (input: unknown, init: RequestInit) => {
      assert.equal(input, "/api/v1/auth/logout");
      assert.equal(init.method, "POST");
      assert.equal(init.cache, "no-store");
      calls++;
      return calls === 1 ? response() : Response.json({ success: true, data: { loggedOut: true } });
    });
    const revision = clientSessionRevision();
    await ui.logout();
    assert.deepEqual(ui.destinations, []);
    assert.equal(ui.refreshes(), 0);
    assert.ok(clientSessionRevision() > revision, "失败也应失效客户端会话缓存");
    assert.equal(ui.dialog()?.title, accountMenuCopy.logoutUnconfirmed);
    assert.equal(ui.dialog()?.busy, false);
    assert.equal(ui.button().disabled, false);
    assert.ok(ui.dialog(), "重开账号菜单也不能丢失失败提示");
    await ui.dialog()!.onConfirm!();
    await setImmediate();
    assert.deepEqual(ui.destinations, ["/login"]);
    assert.equal(ui.refreshes(), 1);
  });
}

test("退出请求在途时禁用操作并阻止重复发送", async (t) => {
  const ui = await mount(t);
  let finish!: (value: Response) => void;
  let calls = 0;
  t.mock.method(globalThis, "fetch", () => {
    calls++;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  const pending = ui.logout();
  assert.equal(ui.button().disabled, true);
  await ui.logout();
  assert.equal(calls, 1);
  assert.deepEqual(ui.destinations, []);
  finish(Response.json({ success: true, data: { loggedOut: true } }));
  await pending;
  await setImmediate();
  assert.deepEqual(ui.destinations, ["/login"]);
});

test("初始会话迟到时关闭退出提示后重新确认会话，账号菜单仍可重试", async (t) => {
  const ui = await mount(t);
  let finishInitial!: (response: Response) => void;
  let meCalls = 0;
  const principal = {
    userId: "test-user",
    sessionId: "test-session",
    displayName: "测试成员",
    roles: ["MEMBER"],
    permissions: [],
    memberProfileId: null,
    memberStatus: null,
    mustChangePassword: false,
    rememberMe: false,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    accountAccess: { state: "READY", destination: "/member", exemptionExpiresAt: null },
  };
  t.mock.method(globalThis, "fetch", async (input: unknown) => {
    if (String(input).startsWith("/api/v1/me")) {
      if (++meCalls === 1)
        return new Promise<Response>((resolve) => {
          finishInitial = resolve;
        });
      return Response.json({ success: true, data: principal });
    }
    throw new TypeError("logout network failure");
  });
  const initial = ui.resolveInitialSession();
  await setImmediate();
  await ui.logout();
  finishInitial(Response.json({ success: true, data: principal }));
  await initial;
  await setImmediate();
  assert.ok(ui.dialog());
  ui.dialog()!.onClose!();
  await setImmediate();
  assert.equal(meCalls, 2);
  assert.ok(ui.trigger());
  assert.equal(ui.button().disabled, false);
  assert.deepEqual(ui.destinations, []);
});

for (const outcome of ["offline", "unauthenticated"] as const) {
  test(`关闭提示后会话复查 ${outcome} 时保持正确的菜单状态`, async (t) => {
    const ui = await mount(t);
    let finishInitial!: (response: Response) => void;
    let meCalls = 0;
    t.mock.method(globalThis, "fetch", async (input: unknown) => {
      if (String(input).startsWith("/api/v1/me")) {
        if (++meCalls === 1)
          return new Promise<Response>((resolve) => {
            finishInitial = resolve;
          });
        if (outcome === "unauthenticated") return new Response(null, { status: 401 });
      }
      throw new TypeError("offline");
    });
    const initial = ui.resolveInitialSession();
    await setImmediate();
    await ui.logout();
    finishInitial(new Response(null, { status: 401 }));
    await initial;
    await setImmediate();
    ui.dialog()!.onClose!();
    await setImmediate();
    assert.equal(meCalls, 2);
    if (outcome === "offline") {
      assert.ok(ui.trigger());
      assert.equal(ui.button().disabled, false);
    } else {
      assert.equal(ui.trigger(), undefined);
    }
    assert.deepEqual(ui.destinations, []);
  });
}

test("初始会话查询迟到失败不能隐藏退出失败提示和重试入口", async (t) => {
  const ui = await mount(t);
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("offline");
  });
  await ui.logout();
  await ui.resolveInitialSession();
  assert.equal(ui.dialog()?.title, accountMenuCopy.logoutUnconfirmed);
  assert.equal(ui.dialog()?.busy, false);
  assert.equal(ui.button().disabled, false);
  assert.deepEqual(ui.destinations, []);
});

test("黑洞请求在十秒超时后恢复操作并提示未确认，可使用新的超时信号重试", async (t) => {
  const ui = await mount(t);
  const controllers: AbortController[] = [];
  t.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    assert.equal(milliseconds, 10_000);
    const controller = new AbortController();
    controllers.push(controller);
    return controller.signal;
  });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
    assert.equal(init.signal, controllers.at(-1)?.signal);
    if (++calls > 1) return Response.json({ success: true, data: { loggedOut: true } });
    return new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    });
  });
  await ui.logout();
  assert.equal(ui.button().disabled, true);
  assert.deepEqual(ui.destinations, []);
  controllers[0].abort(new DOMException("Timed out", "TimeoutError"));
  await setImmediate();
  assert.equal(ui.dialog()?.title, accountMenuCopy.logoutUnconfirmed);
  assert.equal(ui.dialog()?.busy, false);
  assert.equal(ui.button().disabled, false);
  assert.equal(ui.refreshes(), 0);
  assert.deepEqual(ui.destinations, []);
  await ui.dialog()!.onConfirm!();
  await setImmediate();
  assert.equal(controllers.length, 2);
  assert.equal(controllers[1].signal.aborted, false);
  assert.deepEqual(ui.destinations, ["/login"]);
});
