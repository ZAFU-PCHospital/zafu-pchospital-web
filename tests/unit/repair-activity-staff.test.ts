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
  CHECK_IN_LEAD_MS,
  checkInOpensAt,
  mapIssueTypeToCategoryCode,
  shanghaiCalendarDay,
  sortQueueByCheckedInAt,
  validateCheckInIssueTypeUpdates,
} from "../../src/features/repair-activities/repair-activity-validation";
import { AppError } from "../../src/lib/api/errors";

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

test("签到窗口：活动开始前 30 分钟开放，早 1 秒拒绝（issue #367）", () => {
  const activityAt = new Date("2026-10-08T02:30:00.000Z");
  // 报名截止远早于活动（3 天前），窗口不再跟随报名截止。
  const activity = {
    signupClosesAt: new Date("2026-10-05T02:00:00.000Z"),
    activityAt,
  };
  const opensAt = new Date(activityAt.getTime() - CHECK_IN_LEAD_MS);
  assert.equal(opensAt.toISOString(), "2026-10-08T02:00:00.000Z");
  assert.equal(checkInOpensAt(activityAt).toISOString(), opensAt.toISOString());
  assert.equal(checkInOpensAt(activityAt.toISOString()).toISOString(), opensAt.toISOString());

  // 恰好开放时刻：可操作。
  assert.equal(canOperateActivityStaff(activity, opensAt), true);
  assert.doesNotThrow(() => assertActivityStaffOpen(activity, opensAt));
  assert.equal(canOperateActivityStaff(activity, new Date(opensAt.getTime() + 1)), true);

  // 早 1 秒：拒绝，且提示里带具体开放时刻。
  const before = new Date(opensAt.getTime() - 1);
  assert.equal(canOperateActivityStaff(activity, before), false);
  assert.throws(() => assertActivityStaffOpen(activity, before), {
    code: "ACTIVITY_NOT_OPEN",
    status: 409,
  });
  assert.throws(
    () => assertActivityStaffOpen(activity, before),
    (error: unknown) =>
      error instanceof AppError &&
      error.message.includes("签到尚未开放") &&
      error.message.includes("2026/10/08 10:00"),
  );
});

test("报名截止早于窗口：截止后不再提前开放，仍等到活动前 30 分钟", () => {
  const activityAt = new Date("2026-10-08T02:30:00.000Z");
  const activity = { signupClosesAt: new Date("2026-10-05T02:00:00.000Z"), activityAt };
  // 报名截止那一刻、以及截止后一小时，都不再等于「可操作」。
  assert.equal(canOperateActivityStaff(activity, activity.signupClosesAt), false);
  assert.equal(
    canOperateActivityStaff(activity, new Date(activity.signupClosesAt.getTime() + 3_600_000)),
    false,
  );
});

test("报名截止晚于窗口起点：窗口仍按活动开始前 30 分钟，不受截止影响", () => {
  const activityAt = new Date("2026-10-08T02:30:00.000Z");
  // 截止 = 活动开始前 10 分钟，晚于窗口起点。
  const activity = { signupClosesAt: new Date(activityAt.getTime() - 10 * 60_000), activityAt };
  const opensAt = new Date(activityAt.getTime() - CHECK_IN_LEAD_MS);
  assert.equal(canOperateActivityStaff(activity, opensAt), true);
});

test("活动结束上界：上海次日零点起关闭，包括已有出勤的请求重放", () => {
  const activityAt = new Date("2026-10-23T10:30:00.000Z");
  const activity = { activityAt };
  const opensAt = new Date(activityAt.getTime() - CHECK_IN_LEAD_MS);
  const end = new Date("2026-10-23T16:00:00.000Z");
  assert.equal(canOperateActivityStaff(activity, opensAt), true);
  assert.equal(canOperateActivityStaff(activity, new Date(end.getTime() - 1)), true);
  for (const now of [end, new Date(end.getTime() + 1)]) {
    assert.equal(canOperateActivityStaff(activity, now), false);
    assert.throws(() => assertActivityStaffOpen(activity, now), {
      code: "ACTIVITY_ENDED",
      status: 404,
    });
  }
});

test("活动有 endsAt 时，操作窗口终点仍是活动当日 24:00，不随 endsAt 提前关闭", () => {
  const activityAt = new Date("2026-10-23T10:30:00.000Z");
  // endsAt 早于当日 24:00；窗口上界只认 activityEndExclusive。
  const activity = { activityAt, endsAt: new Date("2026-10-23T12:00:00.000Z") };
  assert.equal(canOperateActivityStaff(activity, new Date("2026-10-23T15:59:59.000Z")), true);
  assert.equal(canOperateActivityStaff(activity, new Date("2026-10-23T16:00:00.000Z")), false);
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

test("同一签到时间按 checkInOrder；历史空值排后并按 id 稳定", () => {
  const at = new Date("2026-09-25T10:00:00.000Z");
  const earlier = new Date("2026-09-25T09:00:00.000Z");
  const rows = [
    { id: "c", checkedInAt: at, checkInOrder: null },
    { id: "a", checkedInAt: at, checkInOrder: 2 },
    { id: "b", checkedInAt: at, checkInOrder: 0 },
    { id: "d", checkedInAt: at, checkInOrder: null },
    { id: "early", checkedInAt: earlier, checkInOrder: 99 },
  ];
  assert.deepEqual(
    sortQueueByCheckedInAt(rows).map((r) => r.id),
    ["early", "b", "a", "c", "d"],
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
