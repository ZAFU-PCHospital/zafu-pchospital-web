import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import type { ReactElement, ReactNode } from "react";
import { clientDom, element, mountClient, React, text } from "../support/react-client";

import { AdminListToolbar } from "../../src/components/admin/AdminListToolbar";
import { AdminListEnd } from "../../src/components/admin/useAdminList";
import type { MemberTableContext } from "../../src/components/admin/member-table-spec";
import type { RepairTableContext } from "../../src/components/admin/repair-table-spec";
import { adminCopy } from "../../src/config/admin";
import { clearAdminCache } from "../../src/features/admin/admin-client";
import { invalidateClientSession } from "../../src/lib/auth/client-session";

type Domain = "members" | "repairs";
type Selection = NonNullable<Parameters<typeof AdminListToolbar>[0]["selection"]>;

async function panel(t: TestContext, domain: Domain) {
  const dom = clientDom();
  const location = new URL(`http://localhost/admin/${domain}`);
  Object.assign(dom.window, {
    location,
    history: {
      state: null,
      replaceState: (_state: unknown, _title: string, url: string) => {
        location.href = new URL(url, location).href;
      },
      pushState: (_state: unknown, _title: string, url: string) => {
        location.href = new URL(url, location).href;
      },
    },
  });
  t.mock.method(React, "useMemo", <T>(compute: () => T, deps: readonly unknown[]) => {
    const ref = React.useRef<{ deps: readonly unknown[]; value: T } | null>(null);
    if (!ref.current || deps.some((value, i) => !Object.is(value, ref.current!.deps[i])))
      ref.current = { deps, value: compute() };
    return ref.current.value;
  });
  const ids = ["first-page-success", "second-page-failure"];
  const requests: Record<string, unknown>[] = [];
  const reads: number[] = [];
  let response = Response.json({
    success: true,
    data: {
      succeeded: [ids[0]],
      failed: [{ [domain === "members" ? "memberId" : "recordId"]: ids[1], message: "请重试" }],
    },
  });
  let readFailure = false;
  let readGate: Promise<void> | undefined;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), location);
    if (url.pathname === "/api/v1/me")
      return Response.json({
        success: true,
        data: {
          userId: "batch-admin",
          sessionId: "batch-session",
          roles: ["ADMIN"],
          permissions: [],
          expiresAt: "2099-01-01T00:00:00Z",
          accountAccess: { state: "READY", destination: "/admin" },
        },
      });
    if (init?.method === "POST") {
      requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return response.clone();
    }
    if (url.pathname === "/api/v1/repair-categories")
      return Response.json({ success: true, data: [] });
    assert.equal(url.pathname, `/api/v1/admin/${domain}`);
    const page = Number(url.searchParams.get("page") || 1);
    reads.push(page);
    await readGate;
    if (readFailure)
      return Response.json(
        { success: false, error: { code: "READ_FAILED", message: "刷新失败" } },
        { status: 500 },
      );
    return Response.json({
      success: true,
      data: [{ id: ids[page - 1] }],
      meta: { pagination: { page, pageSize: 1, total: 2, totalPages: 2 } },
    });
  });
  invalidateClientSession();
  clearAdminCache();
  const { MemberAdminPanel } = await import("../../src/components/admin/MemberAdminPanel");
  const { RepairAdminPanel } = await import("../../src/components/admin/RepairAdminPanel");
  const mounted = mountClient(t, domain === "members" ? MemberAdminPanel : RepairAdminPanel);
  t.after(() => {
    mounted.unmount();
    dom.restore();
    clearAdminCache();
    invalidateClientSession();
  });
  const view = () => mounted.view();
  const settle = async () => {
    await setImmediate();
    view();
  };
  const selection = () =>
    element(view(), (e) => e.type === AdminListToolbar).props.selection as Selection;
  const table = () =>
    element(view(), (e) => Boolean(e.props.renderContext)) as ReactElement<{
      items: { id: string }[];
      renderContext: MemberTableContext | RepairTableContext;
    }>;
  const checked = () => {
    const context = table().props.renderContext;
    return "rows" in context
      ? table()
          .props.items.filter((item) => context.rows.checkboxProps(item.id).checked)
          .map((item) => item.id)
      : context.selected;
  };
  const click = (label: string) => {
    const tools = selection().renderTools(() => {});
    const actions = element(tools, (e) => Boolean(e.props.actions)).props.actions as ReactNode;
    const button = element(actions, (e) => text(e) === label);
    assert.equal(button.props.disabled, false, `${label} 应可操作`);
    (button.props.onClick as () => void)();
    view();
  };
  view();
  await settle();
  (element(view(), (e) => e.type === AdminListEnd).props.onLoadMore as () => void)();
  await settle();
  const tools = selection().renderTools(() => {});
  (
    element(tools, (e) => typeof e.props.onSelectAll === "function").props.onSelectAll as (
      checked: boolean,
    ) => void
  )(true);
  assert.deepEqual(checked(), ids);
  return {
    ids,
    requests,
    reads,
    view,
    settle,
    selection,
    checked,
    loaded: () => table().props.items.map((item) => item.id),
    async run(action: string) {
      click(action);
      if (action === adminCopy.repairs.batch.reject) {
        const input = element(view(), (e) => e.type === "input" && e.props.maxLength === 2000);
        (input.props.onChange as (e: unknown) => void)({
          currentTarget: { value: "补充维修说明" },
        });
        const submit = element(view(), (e) => text(e) === adminCopy.repairs.batch.rejectSubmit);
        (submit.props.onClick as () => void)();
        view();
      }
      await settle();
    },
    failRead() {
      readFailure = true;
    },
    holdRead() {
      let release!: () => void;
      readGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    respond(data: unknown, status = 200) {
      response = Response.json(
        status === 200
          ? { success: true, data }
          : { success: false, error: { code: "BATCH_FAILED", message: "操作失败" } },
        { status },
      );
    },
  };
}

for (const [domain, actions] of [
  ["members", [adminCopy.members.batch.enable, adminCopy.members.batch.disable]],
  ["repairs", [adminCopy.repairs.batch.approve, adminCopy.repairs.batch.reject]],
] as const) {
  for (const action of actions) {
    test(`${action}：部分成功保留后续页失败项，重试仅提交失败项，全部成功才完成`, async (t) => {
      const m = await panel(t, domain);
      const release = m.holdRead();
      await m.run(action);
      assert.equal(m.selection().disabled, true, "刷新期间禁止改变批次");
      assert.deepEqual(m.checked(), [m.ids[1]]);
      release();
      await m.settle();
      assert.deepEqual(m.loaded(), m.ids, "刷新保留已加载的第二页");
      assert.deepEqual(m.checked(), [m.ids[1]]);
      assert.equal(m.selection().count, 1);
      assert.equal(m.selection().completed, 0);
      assert.equal(m.selection().disabled, false);
      assert.ok(text(m.view()).includes("请重试"));
      assert.deepEqual(m.reads, [1, 2, 1, 2]);

      m.respond({ succeeded: [m.ids[1]], failed: [] });
      await m.run(action);
      const key = domain === "members" ? "memberIds" : "recordIds";
      assert.deepEqual(
        m.requests.map((request) => request[key]),
        [m.ids, [m.ids[1]]],
      );
      assert.deepEqual(m.checked(), []);
      assert.equal(m.selection().completed, 1);
      assert.equal(m.selection().count, 0);
    });
  }

  test(`${domain}：全部失败、请求失败和刷新失败都保留失败项`, async (t) => {
    const m = await panel(t, domain);
    const action = actions[0];
    const idKey = domain === "members" ? "memberId" : "recordId";
    m.respond({ succeeded: [], failed: m.ids.map((id) => ({ [idKey]: id, message: "失败" })) });
    await m.run(action);
    assert.deepEqual(m.checked(), m.ids);
    assert.equal(m.selection().completed, 0);
    m.respond(null, 500);
    await m.run(action);
    assert.deepEqual(m.checked(), m.ids);
    assert.equal(m.selection().completed, 0);
    m.failRead();
    m.respond({ succeeded: [m.ids[0]], failed: [{ [idKey]: m.ids[1], message: "失败" }] });
    await m.run(action);
    assert.deepEqual(m.loaded(), m.ids);
    assert.deepEqual(m.checked(), [m.ids[1]]);
    assert.equal(m.selection().completed, 0);
    assert.ok(text(m.view()).includes("刷新失败"));
  });
}
