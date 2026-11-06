import assert from "node:assert/strict";
import test from "node:test";
import {
  bodyCheckInIssueTypeUpdates,
  bodyRegistrationIds,
} from "../../src/features/repair-activities/repair-activity-http";

import {
  canCheckInRegistration,
  canOperateActivityStaff,
  assertActivityStaffOpen,
  canServeRegistration,
  canWithdrawRegistration,
  mapIssueTypeToCategoryCode,
  shanghaiCalendarDay,
  sortQueueByCheckedInAt,
  validateCheckInIssueTypeUpdates,
} from "../../src/features/repair-activities/repair-activity-validation";

test("签到类型更新：兼容缺省 / 空数组，按规范化后的本批 ID 校验", () => {
  const ids = bodyRegistrationIds({ registrationIds: [" a ", "", "a", "b"] });
  assert.deepEqual(bodyCheckInIssueTypeUpdates({}, ids), []);
  assert.deepEqual(bodyCheckInIssueTypeUpdates({ issueTypeUpdates: [] }, ids), []);
  assert.deepEqual(
    bodyCheckInIssueTypeUpdates(
      {
        issueTypeUpdates: [
          { registrationId: " a ", issueType: "CLEAN_ONLY" },
          { registrationId: "b", issueType: "OTHER" },
        ],
      },
      ids,
    ),
    [
      { registrationId: "a", issueType: "CLEAN_ONLY" },
      { registrationId: "b", issueType: "OTHER" },
    ],
  );
});

test("签到类型更新：拒绝非法形状、类型、重复、夹带与超限；Service 共用校验", () => {
  for (const value of [
    null,
    "x",
    {},
    [null],
    [[]],
    ["x"],
    [{}],
    [{ registrationId: 1, issueType: "OTHER" }],
    [{ registrationId: " ", issueType: "OTHER" }],
    [{ registrationId: "c", issueType: "OTHER" }],
    [{ registrationId: "a", issueType: "INVALID" }],
    [{ registrationId: "a", issueType: null }],
    [
      { registrationId: "a", issueType: "OTHER" },
      { registrationId: "a", issueType: "CLEAN_ONLY" },
    ],
    Array(3).fill({ registrationId: "a", issueType: "OTHER" }),
  ]) {
    assert.throws(() => validateCheckInIssueTypeUpdates(value, ["a", "b"]), {
      code: "VALIDATION_FAILED",
    });
    assert.throws(() => bodyCheckInIssueTypeUpdates({ issueTypeUpdates: value }, ["a", "b"]), {
      code: "VALIDATION_FAILED",
    });
  }
  assert.throws(
    () =>
      validateCheckInIssueTypeUpdates(
        [],
        Array.from({ length: 101 }, (_, i) => String(i)),
      ),
    { code: "VALIDATION_FAILED" },
  );
});

test("报名截止闸门：截止前禁止出勤、签到与接待，截止时刻起开放", () => {
  const deadline = new Date("2026-10-08T02:00:00.000Z");
  const activity = { signupClosesAt: deadline, activityAt: deadline };
  const before = new Date(deadline.getTime() - 1);
  assert.equal(canOperateActivityStaff(activity, before), false);
  assert.throws(() => assertActivityStaffOpen(activity, before), {
    code: "ACTIVITY_NOT_OPEN",
    status: 409,
  });
  assert.equal(
    canOperateActivityStaff(
      { signupClosesAt: deadline.toISOString(), activityAt: deadline },
      deadline,
    ),
    true,
  );
  assert.doesNotThrow(() => assertActivityStaffOpen(activity, deadline));
  assert.equal(canOperateActivityStaff(activity, new Date(deadline.getTime() + 1)), true);
});

test("活动结束上界：上海次日零点起关闭，包括已有出勤的请求重放", () => {
  const activity = {
    activityAt: new Date("2026-10-23T10:30:00.000Z"),
    signupClosesAt: new Date("2026-10-23T04:00:00.000Z"),
  };
  const end = new Date("2026-10-23T16:00:00.000Z");
  // 报名截止后、活动尚未开始也仍可操作。
  assert.equal(canOperateActivityStaff(activity, activity.signupClosesAt), true);
  assert.equal(canOperateActivityStaff(activity, new Date(end.getTime() - 1)), true);
  for (const now of [end, new Date(end.getTime() + 1)]) {
    assert.equal(canOperateActivityStaff(activity, now), false);
    assert.throws(() => assertActivityStaffOpen(activity, now), {
      code: "ACTIVITY_ENDED",
      status: 404,
    });
  }
});

test("签到矩阵：仅 REGISTERED 可签到", () => {
  assert.equal(canCheckInRegistration("REGISTERED"), true);
  assert.equal(canCheckInRegistration("CHECKED_IN"), false);
  assert.equal(canCheckInRegistration("SERVED"), false);
  assert.equal(canCheckInRegistration("UNKNOWN"), false);
});

test("撤回矩阵：仅 CHECKED_IN 可撤回；SERVED 不可", () => {
  assert.equal(canWithdrawRegistration("CHECKED_IN"), true);
  assert.equal(canWithdrawRegistration("REGISTERED"), false);
  assert.equal(canWithdrawRegistration("SERVED"), false);
});

test("接待矩阵：仅 CHECKED_IN 可接待", () => {
  assert.equal(canServeRegistration("CHECKED_IN"), true);
  assert.equal(canServeRegistration("REGISTERED"), false);
  assert.equal(canServeRegistration("SERVED"), false);
});

test("故障类型 → 分类 code 映射", () => {
  assert.equal(mapIssueTypeToCategoryCode("CLEAN_PASTE"), "COOLING_CLEANING");
  assert.equal(mapIssueTypeToCategoryCode("CLEAN_ONLY"), "COOLING_CLEANING");
  assert.equal(mapIssueTypeToCategoryCode("SOFTWARE_SYSTEM"), "SYSTEM");
  assert.equal(mapIssueTypeToCategoryCode("OTHER"), "OTHER_FAULT");
});

test("排队序按 checkedInAt ASC；null 排最后", () => {
  const rows = [
    { id: "c", checkedInAt: new Date("2026-09-25T10:00:00.000Z") },
    { id: "a", checkedInAt: new Date("2026-09-25T08:00:00.000Z") },
    { id: "b", checkedInAt: new Date("2026-09-25T09:00:00.000Z") },
    { id: "n", checkedInAt: null },
  ];
  assert.deepEqual(
    sortQueueByCheckedInAt(rows).map((r) => r.id),
    ["a", "b", "c", "n"],
  );
  // 不改原数组
  assert.equal(rows[0].id, "c");
});

test("同一签到时间按提交顺序排列，历史记录按 ID 保持稳定", () => {
  const checkedInAt = new Date("2026-09-25T08:00:00.000Z");
  const rows = [
    { id: "c", checkedInAt, checkInOrder: 1 },
    { id: "b", checkedInAt, checkInOrder: 0 },
    { id: "a", checkedInAt, checkInOrder: null },
  ];
  assert.deepEqual(
    sortQueueByCheckedInAt(rows).map((row) => row.id),
    ["a", "b", "c"],
  );
});

test("出勤闸门语义：未出勤操作码为 ACTIVITY_ATTENDANCE_REQUIRED（403）", async () => {
  const { ApiErrorCode, defaultStatusFor } = await importErrorStatus();
  assert.ok((ApiErrorCode as readonly string[]).includes("ACTIVITY_ATTENDANCE_REQUIRED"));
  assert.equal(defaultStatusFor("ACTIVITY_ATTENDANCE_REQUIRED"), 403);
  assert.equal(defaultStatusFor("ACTIVITY_REGISTRATION_STATE_INVALID"), 409);
});

test("全局接单拦截错误码 ACTIVITY_SERVE_PENDING（409，issue #221）", async () => {
  const { ApiErrorCode, defaultStatusFor } = await importErrorStatus();
  assert.ok((ApiErrorCode as readonly string[]).includes("ACTIVITY_SERVE_PENDING"));
  assert.equal(defaultStatusFor("ACTIVITY_SERVE_PENDING"), 409);
});

test("activityAt 转上海日历日", () => {
  // 2026-09-25 16:00 UTC = 2026-09-26 00:00 CST
  assert.equal(shanghaiCalendarDay(new Date("2026-09-25T16:00:00.000Z")), "2026-09-26");
  // 同日白天
  assert.equal(shanghaiCalendarDay(new Date("2026-09-25T06:00:00.000Z")), "2026-09-25");
});

/** 从 errors 模块读出状态映射（避免导出私有 defaultStatus）。 */
async function importErrorStatus() {
  const mod = await import("../../src/lib/api/errors");
  const { AppError, ApiErrorCode } = mod;
  function defaultStatusFor(code: (typeof ApiErrorCode)[number]): number {
    return new AppError(code, "x").status;
  }
  return { ApiErrorCode, defaultStatusFor };
}
