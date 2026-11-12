import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { clientDom, element, elements, mountClient, React, text } from "../support/react-client";

import { RepairAdminPanel } from "../../src/components/admin/RepairAdminPanel";
import { AdminTable } from "../../src/components/admin/AdminTable";
import { AdminListToolbar } from "../../src/components/admin/AdminListToolbar";
import { AdminListEnd } from "../../src/components/admin/useAdminList";
import { AdminToast } from "../../src/components/admin/AdminToast";
import { RepairReviewDialog } from "../../src/components/admin/RepairReviewDialog";
import { AdminModal } from "../../src/components/admin/AdminModal";
import { adminCopy } from "../../src/config/admin";
import type { RepairTableContext } from "../../src/components/admin/repair-table-spec";
import { clearAdminCache } from "../../src/features/admin/admin-client";
import { getClientSession, invalidateClientSession } from "../../src/lib/auth/client-session";
import type { RepairView } from "../../src/types/contracts";

async function panel(t: TestContext, canReview = true, batchFailure = false) {
  const dom = clientDom();
  const detail = new dom.Node();
  const focused: { id: string; options?: FocusOptions }[] = [];
  Object.assign(dom.document, {
    getElementById: (id: string) => ({
      focus: (options?: FocusOptions) => {
        focused.push({ id, options });
        detail.focus();
      },
    }),
  });
  Object.assign(dom.window, {
    location: {
      href: "http://localhost/admin/repairs",
      pathname: "/admin/repairs",
      search: "",
      hash: "",
    },
    history: { replaceState() {}, pushState() {} },
  });
  t.mock.method(React, "useMemo", <T>(compute: () => T, deps: readonly unknown[]) => {
    const ref = React.useRef<{ deps: readonly unknown[]; value: T } | null>(null);
    if (!ref.current || deps.some((value, index) => !Object.is(value, ref.current!.deps[index])))
      ref.current = { deps, value: compute() };
    return ref.current.value;
  });
  const records = ["one", "two", "three"].map(
    (id) =>
      ({
        id,
        member: { id: `member-${id}`, name: id },
        status: "PENDING",
        version: 3,
      }) as RepairView,
  );
  const reads: number[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/v1/admin/repairs/batch-reviews" && batchFailure)
      return Response.json(
        { success: false, error: { code: "VALIDATION_FAILED", message: "批量退回失败测试" } },
        { status: 400 },
      );
    if (url.pathname === "/api/v1/me")
      return Response.json({
        success: true,
        data: {
          userId: "review-admin",
          sessionId: "review-session",
          roles: ["ADMIN"],
          permissions: canReview ? ["repair:review"] : [],
          expiresAt: "2099-01-01T00:00:00Z",
          accountAccess: { state: "READY", destination: "/admin" },
        },
      });
    if (url.pathname === "/api/v1/repair-categories")
      return Response.json({ success: true, data: [] });
    assert.equal(url.pathname, "/api/v1/admin/repairs");
    const page = Number(url.searchParams.get("page"));
    reads.push(page);
    return Response.json({
      success: true,
      data: page === 1 ? records.slice(0, 2) : records.slice(2),
      meta: { pagination: { page, pageSize: 2, total: 3, totalPages: 2 } },
    });
  });
  clearAdminCache();
  invalidateClientSession();
  await getClientSession();
  const mounted = mountClient(t, () => RepairAdminPanel({ canReview }));
  t.after(() => {
    mounted.unmount();
    clearAdminCache();
    invalidateClientSession();
    dom.restore();
  });
  const table = () =>
    element(mounted.view(), (e) => e.type === AdminTable).props as unknown as React.ComponentProps<
      typeof AdminTable<RepairView, RepairTableContext>
    >;
  const toolbar = () =>
    element(mounted.view(), (e) => e.type === AdminListToolbar).props as Parameters<
      typeof AdminListToolbar
    >[0];
  const end = () =>
    element(mounted.view(), (e) => e.type === AdminListEnd).props as Parameters<
      typeof AdminListEnd
    >[0];
  const dialog = () =>
    element(mounted.view(), (e) => e.type === RepairReviewDialog).props as Parameters<
      typeof RepairReviewDialog
    >[0];
  for (let attempt = 0; attempt < 10; attempt++) {
    const tree = mounted.view();
    if (elements(tree, (e) => e.type === AdminTable).length) break;
    await setImmediate();
  }
  assert.equal(table().items.length, 2);
  end().onLoadMore();
  await setImmediate();
  assert.equal(table().items.length, 3);
  return {
    ...dom,
    detail,
    focused,
    reads,
    table,
    toolbar,
    end,
    dialog,
    view: mounted.view,
    select(ids: string[]) {
      for (const id of ids) table().renderContext.onToggleSelected(id, true);
      mounted.view();
    },
    review(id: string, label: string) {
      const props = table();
      const index = props.items.findIndex((item) => item.id === id);
      const field = props.spec.fields.find((item) => item.key === "actions")!;
      const actions = field.render!(props.items[index], index, props.renderContext);
      const button = element(actions, (e) => text(e.props.children as React.ReactNode) === label);
      assert.equal(Boolean(button.props.disabled), false);
      (button.props.onClick as () => void)();
      mounted.view();
    },
  };
}

test("批量退回失败在窗口内显示错误并恢复按钮", async (t) => {
  const ui = await panel(t, true, true);
  ui.select(["one"]);
  const tools = ui.toolbar().selection!.renderTools(() => {});
  const batch = element(tools, (el) => !!el.props.actions);
  const button = element(
    batch.props.actions as React.ReactNode,
    (el) => text(el.props.children as React.ReactNode) === adminCopy.repairs.batch.reject,
  );
  (button.props.onClick as () => void)();
  const modal = () => element(ui.view(), (el) => el.type === AdminModal);
  const input = element(modal().props.children as React.ReactNode, (el) => el.type === "input");
  (input.props.onChange as (event: unknown) => void)({ currentTarget: { value: "退回原因" } });
  const submit = element(
    modal().props.children as React.ReactNode,
    (el) => text(el.props.children as React.ReactNode) === adminCopy.repairs.batch.rejectSubmit,
  );
  (submit.props.onClick as () => void)();
  await setImmediate();
  assert.equal(modal().props.error, "批量退回失败测试");
  const retry = element(
    modal().props.children as React.ReactNode,
    (el) => text(el.props.children as React.ReactNode) === adminCopy.repairs.batch.rejectSubmit,
  );
  assert.equal(retry.props.disabled, false);
});

test("维修列表：行内审核打开弹层，应用服务端快照并保留已加载页与其它选择，焦点回到详情", async (t) => {
  const m = await panel(t);
  m.select(["one", "three"]);
  const before = m.table().items;
  const completed = m.toolbar().selection!.completed;
  m.review("one", "通过");
  assert.equal(m.dialog().record.id, "one");
  assert.equal(m.dialog().decision, "APPROVED");
  const saved = { ...before[0], status: "APPROVED", version: 9 } as RepairView;
  m.dialog().onReviewed(saved);
  const after = m.table();
  m.flushFrames();
  assert.deepEqual(after.items[0], saved);
  assert.strictEqual(after.items[1], before[1]);
  assert.strictEqual(after.items[2], before[2]);
  assert.deepEqual(after.renderContext.selected, ["three"]);
  assert.equal(m.toolbar().selection!.completed, completed);
  assert.equal(m.end().loaded, 3);
  assert.equal(m.end().pagination!.page, 2);
  assert.deepEqual(m.reads, [1, 2]);
  assert.equal(elements(m.view(), (e) => e.type === RepairReviewDialog).length, 0);
  assert.deepEqual(m.focused, [{ id: "repair-detail-one", options: { preventScroll: true } }]);
  assert.equal(m.document.activeElement, m.detail);
  const toast = element(m.view(), (e) => e.type === AdminToast).props.toast as { text: string };
  assert.equal(toast.text, "已审核通过。");
});

test("维修列表：最后一条勾选记录单条退回成功后发出退出选择态信号", async (t) => {
  const m = await panel(t);
  m.select(["three"]);
  const completed = m.toolbar().selection!.completed!;
  m.review("three", "退回");
  assert.equal(m.dialog().decision, "REJECTED");
  m.dialog().onReviewed({ ...m.dialog().record, status: "REJECTED", version: 4 });
  assert.deepEqual(m.table().renderContext.selected, []);
  assert.equal(m.toolbar().selection!.completed, completed + 1);
});

test("维修列表：取消审核保留勾选；审核未勾选行不结束选择态", async (t) => {
  const m = await panel(t);
  m.select(["three"]);
  const completed = m.toolbar().selection!.completed;
  m.review("three", "退回");
  m.dialog().onClose();
  assert.deepEqual(m.table().renderContext.selected, ["three"]);
  assert.equal(m.table().items[2].status, "PENDING");
  m.review("one", "通过");
  m.dialog().onReviewed({ ...m.dialog().record, status: "APPROVED", version: 4 });
  assert.deepEqual(m.table().renderContext.selected, ["three"]);
  assert.equal(m.toolbar().selection!.completed, completed);
});

test("维修列表：无审核权限时不能打开单条审核弹层", async (t) => {
  const m = await panel(t, false);
  const context = m.table().renderContext;
  assert.equal(context.canReview, false);
  context.onReview(m.table().items[0], "APPROVED");
  assert.equal(elements(m.view(), (e) => e.type === RepairReviewDialog).length, 0);
});
