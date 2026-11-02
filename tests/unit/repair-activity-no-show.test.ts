import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../src/lib/api/errors";
import {
  customerBlockStatus,
  isCustomerBlockActive,
  isNoShowCandidate,
  normalizeCustomerName,
} from "../../src/features/repair-activities/repair-activity-no-show";

test("客户姓名按 NFKC、去空白、大小写归一", () => {
  assert.equal(normalizeCustomerName(" 王 浩 "), "王浩");
  assert.equal(normalizeCustomerName("ＡＢＣ"), "abc");
  assert.equal(normalizeCustomerName("张三\u3000"), "张三");
});

test("no-show 候选：只有活动结束仍未签到才算", () => {
  const activityEnd = new Date("2026-10-30T16:00:00.000Z");
  const before = new Date(activityEnd.getTime() - 1);
  const after = new Date(activityEnd.getTime() + 1);
  assert.equal(isNoShowCandidate({ status: "REGISTERED", deletedAt: null, activityEnd }), true);
  assert.equal(
    isNoShowCandidate({ status: "REGISTERED", deletedAt: before, activityEnd }),
    false,
    "结束前删除是取消",
  );
  assert.equal(
    isNoShowCandidate({ status: "REGISTERED", deletedAt: after, activityEnd }),
    true,
    "结束后删除仍保留未到场事实",
  );
  for (const status of ["CHECKED_IN", "SERVED"]) {
    assert.equal(isNoShowCandidate({ status, deletedAt: null, activityEnd }), false, status);
  }
});

test("封锁状态：有效、已解除、已到期", () => {
  const now = new Date("2026-11-02T12:00:00.000Z");
  const future = new Date("2027-09-01T00:00:00.000Z");
  const past = new Date("2026-10-01T00:00:00.000Z");
  const active = { blockedUntil: future, liftedAt: null };
  assert.equal(customerBlockStatus(active, now), "ACTIVE");
  assert.equal(isCustomerBlockActive(active, now), true);
  assert.equal(customerBlockStatus({ ...active, liftedAt: now }, now), "LIFTED");
  assert.equal(customerBlockStatus({ blockedUntil: past, liftedAt: null }, now), "EXPIRED");
  assert.equal(isCustomerBlockActive(null, now), false);
});

test("客户被拦截使用稳定的 403 错误码", () => {
  assert.equal(new AppError("ACTIVITY_CUSTOMER_BLOCKED", "blocked").status, 403);
});
