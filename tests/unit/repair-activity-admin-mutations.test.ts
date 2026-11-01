import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import type { ReactElement, ReactNode } from "react";

import { adminCopy } from "../../src/config/admin";
import type * as client from "../../src/features/admin/admin-client";
import { checkClientSession, invalidateClientSession } from "../../src/lib/auth/client-session";

const require = createRequire(import.meta.url);
const React = require("react") as typeof import("react");
const copy = adminCopy.repairActivities.registrations;
function find(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, predicate);
      if (found) return found;
    }
  } else if (React.isValidElement<Record<string, unknown>>(node)) {
    if (predicate(node)) return node;
    return find(node.props.children as ReactNode, predicate);
  }
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (React.isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return typeof node === "string" ? node : "";
}
const failure = (code: string, status = 0): client.AdminApiResult<never> => ({
  ok: false,
  code,
  status,
  message: `失败：${code}`,
});
const ok = <T>(data: T): client.AdminApiResult<T> => ({ ok: true, data });

async function mount(t: TestContext) {
  const previousReact = (globalThis as { React?: unknown }).React;
  (globalThis as { React?: unknown }).React = React;
  t.after(() => {
    (globalThis as { React?: unknown }).React = previousReact;
  });
  const slots: unknown[] = [];
  let cursor = 0;
  let mounted = false;
  const effects: (() => void)[] = [];
  t.mock.method(React, "useState", <S>(initial: S) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [
      slots[index],
      (next: S | ((old: S) => S)) => {
        slots[index] =
          typeof next === "function" ? (next as (old: S) => S)(slots[index] as S) : next;
      },
    ];
  });
  t.mock.method(React, "useRef", <T>(initial: T) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  });
  t.mock.method(React, "useCallback", (fn: unknown) => fn);
  t.mock.method(React, "useEffect", (fn: () => void) => {
    if (!mounted) effects.push(fn);
  });
  const activity = {
    id: "a",
    title: "测试活动",
    capacity: 30,
    registeredCount: 1,
    remaining: 29,
    attendedCount: 0,
    activityAt: "2026-11-05T06:00:00Z",
    signupOpensAt: "2026-11-01T00:00:00Z",
    signupClosesAt: "2026-11-05T05:00:00Z",
    status: "OPEN",
  };
  const registration = {
    id: "r",
    activityId: "a",
    name: "测试客户",
    phone: "13800138000",
    issueType: "CLEAN_ONLY",
    deviceModel: null,
    status: "REGISTERED",
    deletedAt: null as string | null,
    hasSameNameActive: false,
  };
  let mutation: () => Promise<client.AdminApiResult<unknown>> = async () => ok({ deleted: true });
  let readFailure: client.AdminApiResult<never> | undefined;
  let mutations = 0;
  let reads = 0;
  const signals: (AbortSignal | undefined)[] = [];
  const response = (result: client.AdminApiResult<unknown>) =>
    result.ok
      ? Response.json({ success: true, data: result.data })
      : Response.json({ success: false, error: result }, { status: result.status || 500 });
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.startsWith("/api/v1/me"))
      return Response.json({
        success: true,
        data: {
          userId: "admin-331",
          sessionId: "session-331",
          roles: ["ADMIN"],
          permissions: ["activity:admin"],
          expiresAt: "2099-01-01T00:00:00Z",
          accountAccess: { state: "READY", destination: "/admin" },
        },
      });
    if (init?.method && init.method !== "GET") {
      mutations++;
      signals.push(init.signal ?? undefined);
      return response(await mutation());
    }
    if (path.endsWith("/registrations")) {
      reads++;
      return response(readFailure ?? ok([structuredClone(registration)]));
    }
    return response(ok([activity]));
  });
  invalidateClientSession();
  await checkClientSession("");
  t.mock.method(globalThis, "FormData", function () {
    return new Map([
      ["name", registration.name],
      ["phone", "13800138002"],
      ["issueType", registration.issueType],
    ]);
  });
  const { RepairActivityAdminPanel } =
    await import("../../src/components/admin/RepairActivityAdminPanel");
  const view = () => {
    cursor = 0;
    const node = RepairActivityAdminPanel();
    if (!mounted) {
      mounted = true;
      effects.splice(0).forEach((fn) => fn());
    }
    return node;
  };
  const button = (label: string) => {
    const node = find(
      view(),
      (element) =>
        typeof element.props.onClick === "function" &&
        text(element.props.children as ReactNode) === label,
    );
    assert.ok(node, label);
    return node;
  };
  const dialog = (title: string) =>
    find(
      view(),
      (element) => element.props.title === title && typeof element.props.onClose === "function",
    );
  view();
  await setImmediate();
  (button(adminCopy.repairActivities.action.registrations).props.onClick as () => void)();
  await setImmediate();
  return {
    view,
    dialog,
    registration,
    signals,
    counts: () => ({ mutations, reads }),
    setMutation(fn: typeof mutation) {
      mutation = fn;
    },
    failReads(result: client.AdminApiResult<never>) {
      readFailure = result;
    },
    remove() {
      (button(copy.delete).props.onClick as () => void)();
      const node = dialog(copy.delete);
      assert.ok(node);
      return node;
    },
    edit() {
      (button(copy.edit).props.onClick as () => void)();
      const node = dialog(copy.edit);
      assert.ok(node);
      return node;
    },
    async confirm() {
      const node = dialog(copy.delete);
      assert.ok(node);
      (node.props.onConfirm as () => void)();
      await setImmediate();
    },
    async save() {
      const node = dialog(copy.edit);
      assert.ok(node);
      const form = find(node, (element) => typeof element.props.onSubmit === "function");
      assert.ok(form);
      await (form.props.onSubmit as (event: unknown) => Promise<void>)({
        preventDefault() {},
        currentTarget: {},
      });
    },
  };
}

test("正常删除成功后关闭确认窗并刷新名单", async (t) => {
  const app = await mount(t);
  app.remove();
  await app.confirm();
  assert.equal(app.dialog(copy.delete), undefined);
  assert.equal(app.counts().reads, 2);
});

test("正常保存成功后关闭编辑窗并刷新整份名单", async (t) => {
  const app = await mount(t);
  app.setMutation(async () => {
    app.registration.phone = "13800138002";
    return ok(structuredClone(app.registration));
  });
  app.edit();
  await app.save();
  assert.equal(app.dialog(copy.edit), undefined);
  assert.equal(app.counts().reads, 2);
});

test("会话变化时保留确认窗，不用新会话核查旧操作", async (t) => {
  const app = await mount(t);
  app.setMutation(async () => {
    invalidateClientSession();
    return ok({ deleted: true });
  });
  app.remove();
  await app.confirm();
  assert.equal(app.counts().reads, 1);
  assert.match(text(app.dialog(copy.delete)), /登录状态已变化/);
});

for (const code of [
  "NETWORK_ERROR",
  "INVALID_RESPONSE",
  "REQUEST_ABORTED",
  "INTERNAL_ERROR",
  "ACTIVITY_REGISTRATION_NOT_FOUND",
]) {
  test(`删除返回 ${code}，重读确认已删除后关闭确认窗`, async (t) => {
    const app = await mount(t);
    app.setMutation(async () => {
      app.registration.deletedAt = "2026-11-01T06:00:00Z";
      return failure(
        code,
        code === "INTERNAL_ERROR" ? 500 : code === "ACTIVITY_REGISTRATION_NOT_FOUND" ? 404 : 0,
      );
    });
    app.remove();
    await app.confirm();
    assert.equal(app.dialog(copy.delete), undefined);
    assert.equal(app.counts().mutations, 1);
    assert.ok(app.counts().reads >= 2);
  });
}

test("删除未生效时保留确认窗，错误在当前窗口可见", async (t) => {
  const app = await mount(t);
  app.setMutation(async () => failure("NETWORK_ERROR"));
  app.remove();
  await app.confirm();
  const dialog = app.dialog(copy.delete);
  assert.ok(dialog);
  assert.match(text(dialog), /失败：NETWORK_ERROR/);
});

test("结果核查失败不报告删除成功", async (t) => {
  const app = await mount(t);
  app.setMutation(async () => failure("INVALID_RESPONSE"));
  app.remove();
  app.failReads(failure("NETWORK_ERROR"));
  await app.confirm();
  assert.ok(app.dialog(copy.delete));
  assert.match(text(app.dialog(copy.delete)), /失败：INVALID_RESPONSE/);
});

test("删除返回不存在但名单仍有效时，不误报删除成功", async (t) => {
  const app = await mount(t);
  app.setMutation(async () => failure("ACTIVITY_REGISTRATION_NOT_FOUND", 404));
  app.remove();
  await app.confirm();
  assert.ok(app.dialog(copy.delete));
  assert.match(text(app.dialog(copy.delete)), /失败：ACTIVITY_REGISTRATION_NOT_FOUND/);
  assert.equal(app.registration.deletedAt, null);
});

test("删除已收到成功响应，后续名单刷新失败仍关闭确认窗", async (t) => {
  const app = await mount(t);
  app.remove();
  app.failReads(failure("NETWORK_ERROR"));
  await app.confirm();
  assert.equal(app.dialog(copy.delete), undefined);
  assert.ok(app.dialog(copy.title));
  assert.match(text(app.dialog(copy.title)), /失败：NETWORK_ERROR/);
});

test("权限拒绝不核查、不关闭确认窗，直接显示错误", async (t) => {
  const app = await mount(t);
  app.setMutation(async () => failure("FORBIDDEN", 403));
  app.remove();
  await app.confirm();
  assert.equal(app.counts().reads, 1);
  assert.match(text(app.dialog(copy.delete)), /当前账号没有执行该操作的权限/);
});

test("手机号更新响应丢失，核查字段一致后关闭编辑窗", async (t) => {
  const app = await mount(t);
  app.setMutation(async () => {
    app.registration.phone = "13800138002";
    return failure("NETWORK_ERROR");
  });
  app.edit();
  await app.save();
  assert.equal(app.dialog(copy.edit), undefined);
});

test("手机号更新未生效或被他人更改时保留草稿并显示错误", async (t) => {
  const app = await mount(t);
  app.setMutation(async () => failure("NETWORK_ERROR"));
  app.edit();
  await app.save();
  assert.match(text(app.dialog(copy.edit)), /失败：NETWORK_ERROR/);
});

test("手机号更新结果核查失败，保留编辑窗且不重发写操作", async (t) => {
  const app = await mount(t);
  app.setMutation(async () => failure("INVALID_RESPONSE"));
  app.edit();
  app.failReads(failure("NETWORK_ERROR"));
  await app.save();
  assert.match(text(app.dialog(copy.edit)), /失败：INVALID_RESPONSE/);
  assert.equal(app.counts().mutations, 1);
});

test("手机号保存已收到成功响应，后续刷新失败仍关闭编辑窗", async (t) => {
  const app = await mount(t);
  app.setMutation(async () => {
    app.registration.phone = "13800138002";
    return ok(structuredClone(app.registration));
  });
  app.edit();
  app.failReads(failure("NETWORK_ERROR"));
  await app.save();
  assert.equal(app.dialog(copy.edit), undefined);
  assert.ok(app.dialog(copy.title));
  assert.match(text(app.dialog(copy.title)), /失败：NETWORK_ERROR/);
});

test("手机号重复错误显示在编辑窗里", async (t) => {
  const app = await mount(t);
  app.setMutation(async () => failure("ACTIVITY_REGISTRATION_DUPLICATE", 409));
  app.edit();
  await app.save();
  assert.match(text(app.dialog(copy.edit)), /失败：ACTIVITY_REGISTRATION_DUPLICATE/);
  assert.equal(app.counts().reads, 1);
});

test("同一帧连点只发送一次删除，提交期间保留报名上下文", async (t) => {
  const app = await mount(t);
  let finish!: (result: client.AdminApiResult<unknown>) => void;
  app.setMutation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const dialog = app.remove();
  (dialog.props.onConfirm as () => void)();
  (dialog.props.onConfirm as () => void)();
  await setImmediate();
  assert.equal(app.counts().mutations, 1);
  const parent = app.dialog(copy.title);
  assert.ok(parent);
  (parent.props.onClose as () => void)();
  assert.ok(app.dialog(copy.title));
  assert.ok(app.signals[0]);
  finish(ok({ deleted: true }));
  await setImmediate();
  assert.equal(app.dialog(copy.delete), undefined);
});

test("保存期间禁用输入，连点只写入一次并保留编辑上下文", async (t) => {
  const app = await mount(t);
  let finish!: (result: client.AdminApiResult<unknown>) => void;
  app.setMutation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  app.edit();
  const first = app.save();
  const second = app.save();
  await setImmediate();
  assert.equal(app.counts().mutations, 1);
  const dialog = app.dialog(copy.edit);
  assert.ok(dialog);
  for (const name of ["name", "phone", "issueType"]) {
    assert.equal(find(dialog, (element) => element.props.name === name)?.props.disabled, true);
  }
  (dialog.props.onClose as () => void)();
  assert.ok(app.dialog(copy.edit));
  finish(ok(structuredClone(app.registration)));
  await Promise.all([first, second]);
  assert.equal(app.dialog(copy.edit), undefined);
});
