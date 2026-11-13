import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers/promises";
import test, { type TestContext } from "node:test";

import type { AccountAccessView } from "../../src/types/contracts";
import {
  clientSessionRevision,
  invalidateClientSession,
  sessionMutationFetch,
} from "../../src/lib/auth/client-session";
import { adminFetch, clearAdminCache } from "../../src/features/admin/admin-client";

/**
 * 真实 `SessionMonitor` 的排期与「允许停留」断言。
 *
 * 打的是客户端组件本体（只替换 hook 的存储与 `usePathname` 的取值），时钟与定时器由
 * `node:test` 的 mock timers 接管：不存在「等真到期」，也没有把公式抄进测试再自证。
 * `fetch` 记录每一次 `/api/v1/me` 请求，`window.location.replace` 记录整页跳转。
 */

const require = createRequire(import.meta.url);
const React = require("react") as typeof import("react");
const { PathnameContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime") as {
  PathnameContext: unknown;
};

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 固定起点：所有到期时间都相对它给出，判定不依赖真实时钟。 */
const T0 = Date.parse("2026-10-16T12:00:00.000Z");
/** 只在启用 mock 时钟之前使用（`Date` 被接管后就不再是真实构造函数）。 */
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

type MeReply =
  { payload: { success: boolean; data?: Record<string, unknown> } } | { networkError: true };

/** `/api/v1/me` 的最小载荷：受限会话同样是 200 + `accountAccess`。 */
const mePayload = (access: AccountAccessView, expiresAt?: string) => ({
  success: true,
  data: {
    userId: "user-a",
    sessionId: "session-a",
    roles: ["ADMIN", "MEMBER"],
    permissions: ["member:manage"],
    displayName: "测试账号",
    memberProfileId: "member-a",
    memberStatus: "ACTIVE",
    mustChangePassword: false,
    expiresAt: expiresAt ?? iso(DAY),
    accountAccess: access,
  },
});

async function monitor(
  t: TestContext,
  options: { pathname: string; href?: string; replies: MeReply[] },
) {
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: true }));
  await sessionMutationFetch("/reset", { method: "POST" });
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: T0 });

  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const redirects: string[] = [];
  const handlers: Record<string, () => void> = {};
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        href: options.href ?? `http://localhost${options.pathname}`,
        replace: (url: string) => {
          redirects.push(url);
        },
      },
      addEventListener: (type: string, handler: () => void) => {
        handlers[type] = handler;
      },
      removeEventListener: () => {},
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      visibilityState: "visible",
      addEventListener: (type: string, handler: () => void) => {
        handlers[`document:${type}`] = handler;
      },
      removeEventListener: () => {},
    },
  });

  const effects: (() => void | (() => void))[] = [];
  t.mock.method(React, "useState", <S>(initial: S | (() => S)) => {
    const value = typeof initial === "function" ? (initial as () => S)() : initial;
    return [value, () => {}] as [S, (next: S) => void];
  });
  t.mock.method(React, "useEffect", (effect: () => void | (() => void)) => {
    effects.push(effect);
  });
  t.mock.method(React, "useContext", (context: unknown) => {
    if (context === PathnameContext) return options.pathname;
    throw new Error("SessionMonitor 读到了预期之外的 context");
  });

  const calls: string[] = [];
  const replies = [...options.replies];
  t.mock.method(globalThis, "fetch", async (input: unknown) => {
    calls.push(String(input));
    const reply = replies.shift();
    if (!reply) throw new Error(`没有排好的 /api/v1/me 响应：${String(input)}`);
    if ("networkError" in reply) throw new TypeError("fetch failed");
    return Response.json(reply.payload);
  });

  (globalThis as unknown as { React: typeof React }).React = React;
  const { SessionMonitor } = await import("../../src/components/auth/SessionMonitor");
  SessionMonitor();
  let unmounted = false;
  const cleanups = effects.map((effect) => effect());
  const unmount = () => {
    if (unmounted) return;
    unmounted = true;
    for (const run of cleanups) if (run) run();
    invalidateClientSession();
  };
  t.after(() => {
    unmount();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  });
  await setImmediate();

  return {
    calls,
    redirects,
    handlers,
    unmount,
    tick: (ms: number) => t.mock.timers.tick(ms),
    settle: async () => {
      await setImmediate();
    },
  };
}

test("豁免比会话更早到期：下一次 /api/v1/me 按豁免到期点提前，24 小时只是上限", async (t) => {
  const ui = await monitor(t, {
    pathname: "/member",
    replies: [
      {
        payload: mePayload(
          { state: "READY", destination: "/member", exemptionExpiresAt: iso(30 * SECOND) },
          iso(2 * HOUR),
        ),
      },
      {
        payload: mePayload(
          { state: "READY", destination: "/member", exemptionExpiresAt: null },
          iso(30 * DAY),
        ),
      },
    ],
  });
  // 业务页把自身路径作为**候选**一起交出去（F4：受限状态下才接得出带链条的落点）。
  assert.deepEqual(ui.calls, ["/api/v1/me?returnTo=%2Fmember"]);
  assert.deepEqual(ui.redirects, []);

  ui.tick(10 * SECOND);
  await ui.settle();
  assert.equal(ui.calls.length, 1, "没到点不该再请求，也没有 0ms 空转");

  ui.tick(20 * SECOND);
  await ui.settle();
  // 旧实现把 24 小时写进了 `Math.max(...)`，于是这里要等到隔天才会复查 —— 正是返修的现象。
  assert.equal(ui.calls.length, 2, "豁免到点即复查，24 小时不是下限");

  ui.tick(MINUTE);
  await ui.settle();
  assert.equal(ui.calls.length, 2, "豁免撤销后回到会话到期点排期，不引入高频轮询");

  ui.tick(DAY);
  await ui.settle();
  assert.equal(ui.calls.length, 3, "到期时间再远也按 24 小时上限复查一次");
});

test("受限状态按服务端 destination 整页跳一次，不当作会话过期", async (t) => {
  const ui = await monitor(t, {
    pathname: "/admin",
    replies: [
      {
        payload: mePayload(
          {
            state: "EMAIL_VERIFICATION_REQUIRED",
            destination: "/account/email?returnTo=%2Fadmin",
            exemptionExpiresAt: null,
          },
          iso(2 * HOUR),
        ),
      },
    ],
  });
  assert.deepEqual(ui.redirects, ["/account/email?returnTo=%2Fadmin"]);
  assert.notEqual(ui.redirects[0], "/login?reason=expired", "门禁拒绝不能写成登录过期");

  ui.tick(DAY);
  await ui.settle();
  assert.equal(ui.calls.length, 1, "跳转即取消后续检查，不在旧页面上反复请求");
  assert.equal(ui.redirects.length, 1, "只跳一次");
});

test("仅邮箱受限可以停在改密页（任务书要求该页与改密接口仍可用）", async (t) => {
  const ui = await monitor(t, {
    pathname: "/account/change-password",
    href: "http://localhost/account/change-password?returnTo=%2Fmember%2Frepairs",
    replies: [
      {
        payload: mePayload(
          {
            state: "EMAIL_VERIFICATION_REQUIRED",
            destination: "/account/email",
            exemptionExpiresAt: null,
          },
          iso(2 * HOUR),
        ),
      },
    ],
  });
  assert.deepEqual(ui.redirects, [], "改密页对「只差邮箱」的账号是允许停留的一步");
  // 步骤页带着链条里的 returnTo，服务端给出的落点才不会把原目标丢掉。
  assert.deepEqual(ui.calls, ["/api/v1/me?returnTo=%2Fmember%2Frepairs"]);
});

test("必须改密不能停在邮箱页：换页时链条继续带着原目标", async (t) => {
  const ui = await monitor(t, {
    pathname: "/account/email",
    href: "http://localhost/account/email?returnTo=%2Fmember%2Frepairs",
    replies: [
      {
        payload: mePayload(
          {
            state: "PASSWORD_CHANGE_REQUIRED",
            destination: "/account/change-password?returnTo=%2Fmember%2Frepairs",
            exemptionExpiresAt: null,
          },
          iso(2 * HOUR),
        ),
      },
    ],
  });
  assert.deepEqual(ui.redirects, ["/account/change-password?returnTo=%2Fmember%2Frepairs"]);
});

test("网络异常后不拿已过期的豁免排期：按固定间隔重试，且不报会话过期", async (t) => {
  const ui = await monitor(t, {
    pathname: "/member",
    replies: [
      // 真实 `/me` 会同时给出会话到期时间：这里 Session 两小时后到期、豁免十秒后到期。
      {
        payload: mePayload(
          { state: "READY", destination: "/member", exemptionExpiresAt: iso(10 * SECOND) },
          iso(2 * HOUR),
        ),
      },
      { networkError: true },
      {
        payload: mePayload(
          { state: "READY", destination: "/member", exemptionExpiresAt: null },
          iso(2 * HOUR),
        ),
      },
    ],
  });
  assert.equal(ui.calls.length, 1);

  ui.tick(10 * SECOND);
  await ui.settle();
  assert.equal(ui.calls.length, 2, "豁免到点照常复查，这一次请求失败");

  // 失败响应不能把已过期的豁免当成排期依据（0ms 连发），也不能因为还留着两小时后的
  // Session 时间就等两小时：按固定退避重试。
  ui.tick(MINUTE - SECOND);
  await ui.settle();
  assert.equal(ui.calls.length, 2, "失败后按固定间隔重试，不是 0ms 连发");

  ui.tick(SECOND);
  await ui.settle();
  assert.equal(ui.calls.length, 3, "一分钟到点恢复复查，不等那个两小时后的到期时间");
  assert.deepEqual(ui.redirects, [], "网络异常不等于会话失效");
});

test("会话到期转登录页时带着当前业务候选（与页面守卫同一交接，返修 S2）", async (t) => {
  const ui = await monitor(t, {
    pathname: "/member/repairs",
    href: "http://localhost:3001/member/repairs",
    replies: [
      {
        payload: mePayload(
          { state: "READY", destination: "/member/repairs", exemptionExpiresAt: null },
          iso(10 * SECOND),
        ),
      },
    ],
  });
  assert.equal(ui.calls.length, 1);
  assert.deepEqual(ui.redirects, [], "还没到期不该跳");

  ui.tick(10 * SECOND);
  await ui.settle();
  assert.deepEqual(ui.redirects, ["/login?reason=expired&returnTo=%2Fmember%2Frepairs"]);
  assert.equal(ui.calls.length, 1, "失效即取消后续检查");

  ui.tick(DAY);
  await ui.settle();
  assert.equal(ui.redirects.length, 1, "只跳一次");
});

test("focus / visibilitychange 触发复查，卸载后定时器与监听都不再生效", async (t) => {
  const reply = {
    payload: mePayload(
      { state: "READY", destination: "/member", exemptionExpiresAt: null },
      iso(2 * HOUR),
    ),
  };
  const ui = await monitor(t, { pathname: "/member", replies: [reply, reply, reply] });
  assert.equal(ui.calls.length, 1);

  ui.handlers["document:visibilitychange"]();
  await ui.settle();
  ui.handlers.focus();
  await ui.settle();
  assert.equal(ui.calls.length, 3, "回到前台/窗口聚焦都会复查一次");

  ui.unmount();
  ui.tick(DAY);
  await ui.settle();
  assert.equal(ui.calls.length, 3, "卸载后不再产生请求（定时器与监听已撤）");
});

test("前台恢复确认同一会话时，保留在途重置操作返回的临时密码", async (t) => {
  const initial = mePayload(
    { state: "READY", destination: "/admin", exemptionExpiresAt: null },
    iso(2 * HOUR),
  );
  const ui = await monitor(t, { pathname: "/admin", replies: [{ payload: initial }] });
  t.after(clearAdminCache);
  let finish!: (value: Response) => void;
  let checks = 0;
  t.mock.method(globalThis, "fetch", (url: unknown) => {
    if (String(url).startsWith("/api/v1/me")) {
      checks++;
      return Promise.resolve(Response.json(initial));
    }
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  const revision = clientSessionRevision();
  const reset = adminFetch<{ temporaryPassword: string }>("/api/v1/admin/accounts/reset", {
    method: "POST",
  });
  await ui.settle();
  ui.handlers.focus();
  await ui.settle();
  ui.handlers["document:visibilitychange"]();
  await ui.settle();
  (ui.handlers.pageshow as (event: { persisted: boolean }) => void)({ persisted: true });
  await ui.settle();
  assert.equal(checks, 3);
  assert.equal(clientSessionRevision(), revision);
  finish(Response.json({ success: true, data: { temporaryPassword: "012345" } }));
  const result = await reset;
  assert.ok(result.ok);
  assert.equal(result.data.temporaryPassword, "012345");
  assert.deepEqual(ui.redirects, []);
});

test("另一标签页切换账号后，原后台页整页重判，清除旧组件状态", async (t) => {
  const initial = mePayload(
    { state: "READY", destination: "/admin/members", exemptionExpiresAt: null },
    iso(2 * HOUR),
  );
  const next = {
    ...initial,
    data: { ...initial.data, userId: "user-b", sessionId: "session-b", roles: ["MEMBER"] },
  };
  const ui = await monitor(t, {
    pathname: "/admin/members",
    replies: [{ payload: initial }, { payload: next }],
  });
  ui.handlers.focus();
  await ui.settle();
  assert.deepEqual(ui.redirects, ["http://localhost/admin/members"]);
  ui.tick(DAY);
  await ui.settle();
  assert.equal(ui.calls.length, 2, "重新加载后不再调度旧页面的会话检查");
});

test("在途复查期间再次失效会立即重查，迟到的旧 /me 不触发跳转", async (t) => {
  const initial = mePayload(
    { state: "READY", destination: "/admin", exemptionExpiresAt: null },
    iso(2 * HOUR),
  );
  const ui = await monitor(t, { pathname: "/admin", replies: [{ payload: initial }] });
  let finish!: (value: Response) => void;
  let requests = 0;
  t.mock.method(globalThis, "fetch", () => {
    requests++;
    if (requests === 1)
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    return Promise.resolve(Response.json(initial));
  });
  ui.handlers.focus();
  await ui.settle();
  invalidateClientSession(true);
  finish(Response.json(initial));
  await ui.settle();
  assert.deepEqual(ui.redirects, []);
  ui.tick(0);
  await ui.settle();
  assert.equal(requests, 2, "不能等到失败退避的一分钟后才确认最新会话");
  assert.deepEqual(ui.redirects, []);
});

test("从浏览器往返缓存恢复时重新确认身份", async (t) => {
  const reply = {
    payload: mePayload(
      { state: "READY", destination: "/admin", exemptionExpiresAt: null },
      iso(2 * HOUR),
    ),
  };
  const ui = await monitor(t, { pathname: "/admin", replies: [reply, reply] });
  (ui.handlers.pageshow as (event: { persisted: boolean }) => void)({ persisted: true });
  await ui.settle();
  assert.equal(ui.calls.length, 2);
});

test("首次检查已是普通成员时，旧后台壳也按服务端落点离开", async (t) => {
  const reply = mePayload(
    { state: "READY", destination: "/member", exemptionExpiresAt: null },
    iso(2 * HOUR),
  );
  reply.data.roles = ["MEMBER"];
  const ui = await monitor(t, { pathname: "/admin/members", replies: [{ payload: reply }] });
  assert.deepEqual(ui.redirects, ["/member"]);
});

for (const scenario of [
  {
    pathname: "/admin/repair-activities/activity-id",
    permissions: ["activity:staff"],
    allowed: true,
  },
  { pathname: "/admin/repair-activities/activity-id", permissions: [], allowed: false },
  { pathname: "/admin/members", permissions: ["activity:staff"], allowed: false },
  {
    pathname: "/admin/repair-activities/activity-id/edit",
    permissions: ["activity:staff"],
    allowed: false,
  },
]) {
  test(`活动权限会话监控：${scenario.pathname} ${scenario.allowed ? "停留且不重复导航" : "离开受限页面"}`, async (t) => {
    const reply = mePayload(
      {
        state: "READY",
        destination: scenario.allowed ? scenario.pathname : "/member",
        exemptionExpiresAt: null,
      },
      iso(2 * HOUR),
    );
    reply.data.roles = ["MEMBER"];
    reply.data.permissions = scenario.permissions;
    const ui = await monitor(t, {
      pathname: scenario.pathname,
      replies: [{ payload: reply }, { payload: reply }],
    });
    ui.handlers.focus();
    await ui.settle();
    assert.deepEqual(ui.redirects, scenario.allowed ? [] : ["/member"]);
  });
}
