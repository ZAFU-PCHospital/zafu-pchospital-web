import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import { element, mountClient } from "../support/react-client";

import { RepairReviewDialog } from "../../src/components/admin/RepairReviewDialog";
import { ConfirmDialog } from "../../src/components/ui/ConfirmDialog";
import { clearAdminCache } from "../../src/features/admin/admin-client";
import { invalidateClientSession } from "../../src/lib/auth/client-session";
import type { RepairView } from "../../src/types/contracts";

const record = {
  id: "pending-record",
  member: { id: "member", name: "审核测试成员" },
  repairDate: "2026-11-02",
  deviceModel: "测试机型",
  status: "PENDING",
  version: 3,
} as RepairView;

function dialog(t: TestContext, decision: "APPROVED" | "REJECTED") {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const saved: RepairView[] = [];
  let release: (() => void) | undefined;
  let failure = false;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith("/api/v1/me"))
      return Response.json({
        success: true,
        data: {
          userId: "review-admin",
          sessionId: "review-session",
          roles: ["ADMIN"],
          permissions: ["repair:review"],
          expiresAt: "2099-01-01T00:00:00Z",
          accountAccess: { state: "READY", destination: "/admin" },
        },
      });
    assert.equal(init?.method, "POST");
    writes.push({ path: String(input), body: JSON.parse(String(init.body)) });
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return failure
      ? Response.json(
          { success: false, error: { code: "REPAIR_STATE_CONFLICT", message: "记录状态已变化" } },
          { status: 409 },
        )
      : Response.json({ success: true, data: { ...record, status: decision, version: 4 } });
  });
  invalidateClientSession();
  clearAdminCache();
  const mounted = mountClient(t, () =>
    RepairReviewDialog({
      record,
      decision,
      onClose: () => {},
      onReviewed: (item) => saved.push(item),
    }),
  );
  t.after(() => {
    mounted.unmount();
    clearAdminCache();
    invalidateClientSession();
  });
  const props = () =>
    element(mounted.view(), (e) => e.type === ConfirmDialog).props as Parameters<
      typeof ConfirmDialog
    >[0];
  return {
    writes,
    saved,
    props,
    note(value: string) {
      const input = element(mounted.view(), (e) => e.type === "textarea");
      (input.props.onChange as (event: unknown) => void)({ currentTarget: { value } });
    },
    input: () => element(mounted.view(), (e) => e.type === "textarea"),
    async submit() {
      props().onConfirm();
      await setImmediate();
    },
    async finish(fail = false) {
      failure = fail;
      release!();
      await setImmediate();
    },
    view: mounted.view,
  };
}

test("列表通过需确认；重复点击只提交一次，成功返回服务端版本", async (t) => {
  const view = dialog(t, "APPROVED");
  assert.equal(view.writes.length, 0);
  const confirm = view.props().onConfirm;
  confirm();
  confirm();
  await setImmediate();
  assert.equal(view.writes.length, 1);
  assert.equal(view.props().busy, true);
  assert.equal(view.writes[0].path, "/api/v1/admin/repairs/pending-record/reviews");
  assert.equal(view.writes[0].body.decision, "APPROVED");
  assert.ok(view.writes[0].body.idempotencyKey);
  assert.equal(view.writes[0].body.note, undefined);
  await view.finish();
  assert.equal(view.saved[0].status, "APPROVED");
  assert.equal(view.saved[0].version, 4);
});

test("列表退回拒绝空白理由；失败保留输入，重试复用幂等键", async (t) => {
  const view = dialog(t, "REJECTED");
  view.note("  ");
  assert.equal(view.props().confirmDisabled, true);
  await view.submit();
  assert.equal(view.writes.length, 0);
  view.note("  请补充故障描述  ");
  assert.equal(view.input().props.maxLength, 2000);
  assert.equal(view.props().confirmDisabled, false);
  await view.submit();
  assert.equal(view.input().props.disabled, true);
  assert.equal(view.writes[0].body.note, "请补充故障描述");
  await view.finish(true);
  assert.equal(view.saved.length, 0);
  assert.equal(view.input().props.value, "  请补充故障描述  ");
  assert.match(
    String(element(view.view(), (e) => e.props.role === "alert").props.children),
    /记录状态已变化/,
  );
  await view.submit();
  assert.equal(view.writes[1].body.idempotencyKey, view.writes[0].body.idempotencyKey);
  await view.finish();
  assert.equal(view.saved[0].status, "REJECTED");
});
