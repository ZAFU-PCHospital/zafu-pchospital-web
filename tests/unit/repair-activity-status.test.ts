import assert from "node:assert/strict";
import test from "node:test";

import {
  activityEndExclusive,
  assertActivityTimeRules,
  assertValidIssueType,
  canAcceptNewRegistration,
  canCancelRegistration,
  canEditIssueType,
  canShowPublicQueue,
  deriveRepairActivityStatus,
  remainingCapacity,
  RepairActivityIssueType,
  RepairActivityStatus,
  repairActivityIssueTypeLabels,
  repairActivityStatusLabels,
} from "../../src/features/repair-activities/repair-activity-validation";
import {
  memberRepairActivityStatusLabels,
  repairActivitiesPage,
} from "../../src/config/repair-activities";
import { memberRepairActivityStatusBadgeClass } from "../../src/components/repair-activities/activity-status-badge";
import { startOfShanghaiDay } from "../../src/lib/academic-term";
import { AppError } from "../../src/lib/api/errors";

const base = {
  activityAt: new Date("2026-10-01T06:00:00.000Z"), // 上海 14:00
  signupOpensAt: new Date("2026-09-20T00:00:00.000Z"),
  signupClosesAt: new Date("2026-10-01T05:00:00.000Z"), // 活动前 1h
  capacity: 10,
};

test("派生状态：未开始 / 报名中 / 已报满 / 报名截止 / 已结束", () => {
  assert.equal(
    deriveRepairActivityStatus({
      ...base,
      now: new Date("2026-09-19T23:59:59.999Z"),
      effectiveRegistrationCount: 0,
    }),
    "UPCOMING",
  );
  assert.equal(
    deriveRepairActivityStatus({
      ...base,
      now: new Date("2026-09-20T00:00:00.000Z"),
      effectiveRegistrationCount: 0,
    }),
    "OPEN",
  );
  assert.equal(
    deriveRepairActivityStatus({
      ...base,
      now: new Date("2026-09-25T12:00:00.000Z"),
      effectiveRegistrationCount: 10,
    }),
    "FULL",
  );
  assert.equal(
    deriveRepairActivityStatus({
      ...base,
      now: new Date("2026-10-01T05:00:00.000Z"),
      effectiveRegistrationCount: 3,
    }),
    "CLOSED",
  );
  assert.equal(
    deriveRepairActivityStatus({
      ...base,
      now: new Date("2026-10-01T16:00:00.000Z"), // 上海 10-02 00:00，活动当天已结束
      effectiveRegistrationCount: 3,
    }),
    "ENDED",
  );
});

test("优先级：已结束压过报名截止与报满", () => {
  assert.equal(
    deriveRepairActivityStatus({
      ...base,
      now: new Date("2026-10-01T17:00:00.000Z"), // 上海 10-02 01:00
      effectiveRegistrationCount: 10,
    }),
    "ENDED",
  );
});

test("成员端状态文案：CLOSED 显示可出勤，公开页仍为报名截止（issue #239）", () => {
  assert.equal(memberRepairActivityStatusLabels.CLOSED, "可出勤");
  assert.equal(repairActivityStatusLabels.CLOSED, "报名截止");
  assert.equal(Object.values(memberRepairActivityStatusLabels).includes("报名截止"), false);
  assert.deepEqual(
    Object.keys(memberRepairActivityStatusLabels).sort(),
    [...RepairActivityStatus].sort(),
    "成员端状态文案必须覆盖全部五态",
  );
  assert.ok(memberRepairActivityStatusBadgeClass("CLOSED").includes("admin-tag--accent"));
  assert.equal(memberRepairActivityStatusBadgeClass("OPEN").includes("admin-tag--accent"), false);
});

test("软删释放名额后 FULL 回到 OPEN", () => {
  const duringWindow = new Date("2026-09-25T12:00:00.000Z");
  assert.equal(
    deriveRepairActivityStatus({
      ...base,
      now: duringWindow,
      effectiveRegistrationCount: 10,
    }),
    "FULL",
  );
  assert.equal(
    deriveRepairActivityStatus({
      ...base,
      now: duringWindow,
      effectiveRegistrationCount: 9,
    }),
    "OPEN",
  );
});

test("边界：opensAt 瞬间为 OPEN；closesAt 瞬间为 CLOSED；activityAt 当天仍非 ENDED、次日 00:00（上海）起 ENDED", () => {
  assert.equal(
    deriveRepairActivityStatus({
      ...base,
      now: base.signupOpensAt,
      effectiveRegistrationCount: 0,
    }),
    "OPEN",
  );
  assert.equal(
    deriveRepairActivityStatus({
      ...base,
      now: base.signupClosesAt,
      effectiveRegistrationCount: 0,
    }),
    "CLOSED",
  );
  // 活动当天（上海 10-01）含 23:59 仍按报名窗口判定（已截止），不是 ENDED。
  assert.equal(
    deriveRepairActivityStatus({
      ...base,
      now: new Date("2026-10-01T15:59:59.999Z"), // 上海 10-01 23:59:59.999
      effectiveRegistrationCount: 0,
    }),
    "CLOSED",
  );
  assert.equal(
    deriveRepairActivityStatus({
      ...base,
      now: new Date("2026-10-01T16:00:00.000Z"), // 上海 10-02 00:00
      effectiveRegistrationCount: 0,
    }),
    "ENDED",
  );
});

test("跨月：上海 10-31 的活动到 11-01 00:00（上海）才 ENDED", () => {
  const crossMonthBase = {
    activityAt: new Date("2026-10-31T06:00:00.000Z"), // 上海 10-31 14:00
    signupOpensAt: new Date("2026-10-20T00:00:00.000Z"),
    signupClosesAt: new Date("2026-10-31T05:00:00.000Z"),
    capacity: 10,
  };
  assert.equal(
    deriveRepairActivityStatus({
      ...crossMonthBase,
      now: new Date("2026-10-31T15:59:59.999Z"), // 上海 10-31 23:59:59.999
      effectiveRegistrationCount: 0,
    }),
    "CLOSED",
  );
  assert.equal(
    deriveRepairActivityStatus({
      ...crossMonthBase,
      now: new Date("2026-10-31T16:00:00.000Z"), // 上海 11-01 00:00
      effectiveRegistrationCount: 0,
    }),
    "ENDED",
  );
});

test("跨年：上海 12-31 的活动到次年 01-01 00:00（上海）才 ENDED", () => {
  const crossYearBase = {
    activityAt: new Date("2026-12-31T06:00:00.000Z"), // 上海 12-31 14:00
    signupOpensAt: new Date("2026-12-20T00:00:00.000Z"),
    signupClosesAt: new Date("2026-12-31T05:00:00.000Z"),
    capacity: 10,
  };
  assert.equal(
    deriveRepairActivityStatus({
      ...crossYearBase,
      now: new Date("2026-12-31T15:59:59.999Z"), // 上海 12-31 23:59:59.999
      effectiveRegistrationCount: 0,
    }),
    "CLOSED",
  );
  assert.equal(
    deriveRepairActivityStatus({
      ...crossYearBase,
      now: new Date("2026-12-31T16:00:00.000Z"), // 上海 2027-01-01 00:00
      effectiveRegistrationCount: 0,
    }),
    "ENDED",
  );
});

test("activityAt 恰为上海 00:00：仍取该自然日，次日 00:00（上海）起 ENDED", () => {
  // 上海 2026-10-01 00:00 = 2026-09-30T16:00:00Z；排他上界为 2026-10-01T16:00:00Z。
  const midnightBase = {
    activityAt: new Date("2026-09-30T16:00:00.000Z"),
    signupOpensAt: new Date("2026-09-20T00:00:00.000Z"),
    signupClosesAt: new Date("2026-09-30T15:00:00.000Z"),
    capacity: 10,
  };
  assert.equal(
    activityEndExclusive(midnightBase.activityAt).toISOString(),
    "2026-10-01T16:00:00.000Z",
  );
  assert.equal(
    deriveRepairActivityStatus({
      ...midnightBase,
      now: new Date("2026-10-01T15:59:59.999Z"), // 上海 10-01 23:59:59.999
      effectiveRegistrationCount: 0,
    }),
    "CLOSED",
  );
  assert.equal(
    deriveRepairActivityStatus({
      ...midnightBase,
      now: new Date("2026-10-01T16:00:00.000Z"), // 上海 10-02 00:00
      effectiveRegistrationCount: 0,
    }),
    "ENDED",
  );
});

test("activityEndExclusive 与 startOfShanghaiDay 等价：结束上界 = 上海当日零点 + 24h", () => {
  const instants = [
    "2026-03-08T00:00:00.000Z", // 美东夏令时切换日，上海仍固定 UTC+8
    "2026-09-30T15:59:59.999Z", // 上海 09-30 23:59
    "2026-09-30T16:00:00.000Z", // 上海 10-01 00:00
    "2026-10-01T06:00:00.000Z", // 上海 10-01 14:00
    "2026-10-31T16:00:00.000Z", // 上海 11-01 00:00
    "2026-12-31T16:00:00.000Z", // 上海 2027-01-01 00:00
  ];
  for (const iso of instants) {
    const activityAt = new Date(iso);
    assert.equal(
      activityEndExclusive(activityAt).getTime(),
      startOfShanghaiDay(activityAt).getTime() + 24 * 60 * 60 * 1000,
      iso,
    );
  }
});

test("已结束查询边界：now >= activityEndExclusive(activityAt) 等价于 activityAt < startOfShanghaiDay(now)", () => {
  const activities = [
    "2026-09-30T15:59:59.999Z", // 上海 09-30 23:59
    "2026-09-30T16:00:00.000Z", // 上海 10-01 00:00
    "2026-10-01T06:00:00.000Z", // 上海 10-01 14:00
  ];
  const nows = [
    "2026-10-01T15:59:59.999Z", // 上海 10-01 23:59:59.999
    "2026-10-01T16:00:00.000Z", // 上海 10-02 00:00
    "2026-10-02T00:00:00.000Z",
  ];
  for (const activityIso of activities) {
    for (const nowIso of nows) {
      const activityAt = new Date(activityIso);
      const now = new Date(nowIso);
      const endedByHelper = now.getTime() >= activityEndExclusive(activityAt).getTime();
      const endedByQuery = activityAt.getTime() < startOfShanghaiDay(now).getTime();
      assert.equal(endedByHelper, endedByQuery, `${activityIso} @ ${nowIso}`);
    }
  }
});

test("公开排队：活动开始后、上海次日零点前显示", () => {
  const activity = { activityAt: new Date("2026-10-23T10:30:00.000Z") }; // 上海 18:30
  assert.equal(canShowPublicQueue(activity, new Date("2026-10-23T10:29:59.999Z")), false);
  assert.equal(canShowPublicQueue(activity, activity.activityAt), true);
  assert.equal(canShowPublicQueue(activity, new Date("2026-10-23T15:59:59.999Z")), true);
  assert.equal(canShowPublicQueue(activity, new Date("2026-10-23T16:00:00.000Z")), false);
  assert.equal(canShowPublicQueue({ activityAt: "not-a-date" }), false);
  assert.equal(
    canShowPublicQueue(
      { activityAt: "2026-10-23T10:30:00.000Z" },
      new Date("2026-10-23T10:30:00.000Z"),
    ),
    true,
  );
});

test("仅 OPEN 可新报", () => {
  assert.equal(canAcceptNewRegistration("OPEN"), true);
  for (const status of ["UPCOMING", "FULL", "CLOSED", "ENDED"] as const) {
    assert.equal(canAcceptNewRegistration(status), false, status);
  }
});

test("改类型：REGISTERED 且未 ENDED 才允许（截止后活动前仍可）", () => {
  assert.equal(
    canEditIssueType({ registrationStatus: "REGISTERED", activityStatus: "OPEN" }),
    true,
  );
  assert.equal(
    canEditIssueType({ registrationStatus: "REGISTERED", activityStatus: "CLOSED" }),
    true,
  );
  assert.equal(
    canEditIssueType({ registrationStatus: "REGISTERED", activityStatus: "UPCOMING" }),
    true,
  );
  assert.equal(
    canEditIssueType({ registrationStatus: "REGISTERED", activityStatus: "FULL" }),
    true,
  );
  assert.equal(
    canEditIssueType({ registrationStatus: "REGISTERED", activityStatus: "ENDED" }),
    false,
  );
  assert.equal(
    canEditIssueType({ registrationStatus: "CHECKED_IN", activityStatus: "OPEN" }),
    false,
  );
  assert.equal(canEditIssueType({ registrationStatus: "SERVED", activityStatus: "CLOSED" }), false);
});

test("时间校验：opens < closes <= activityAt", () => {
  assert.doesNotThrow(() =>
    assertActivityTimeRules({
      signupOpensAt: new Date("2026-09-01T00:00:00Z"),
      signupClosesAt: new Date("2026-09-10T00:00:00Z"),
      activityAt: new Date("2026-09-10T00:00:00Z"),
    }),
  );
  assert.throws(
    () =>
      assertActivityTimeRules({
        signupOpensAt: new Date("2026-09-10T00:00:00Z"),
        signupClosesAt: new Date("2026-09-10T00:00:00Z"),
        activityAt: new Date("2026-09-11T00:00:00Z"),
      }),
    (error) => error instanceof AppError && error.code === "VALIDATION_FAILED",
  );
  assert.throws(
    () =>
      assertActivityTimeRules({
        signupOpensAt: new Date("2026-09-01T00:00:00Z"),
        signupClosesAt: new Date("2026-09-12T00:00:00Z"),
        activityAt: new Date("2026-09-11T00:00:00Z"),
      }),
    (error) => error instanceof AppError && error.code === "VALIDATION_FAILED",
  );
});

test("剩余名额不为负", () => {
  assert.equal(remainingCapacity(10, 3), 7);
  assert.equal(remainingCapacity(10, 10), 0);
  assert.equal(remainingCapacity(10, 12), 0);
});

test("软删除有效报名后，活动窗口内 FULL 恢复为 OPEN；成员撤回仍不释放名额", () => {
  const now = new Date("2026-09-25T00:00:00.000Z");
  assert.equal(
    deriveRepairActivityStatus({ ...base, capacity: 2, now, effectiveRegistrationCount: 2 }),
    "FULL",
  );
  // 管理软删除使有效报名数从 2 降为 1；成员撤回不在有效状态集合中，也同样不增加有效数。
  assert.equal(
    deriveRepairActivityStatus({ ...base, capacity: 2, now, effectiveRegistrationCount: 1 }),
    "OPEN",
  );
});

test("自助取消只允许活动开始前的 REGISTERED 报名", () => {
  const activityAt = "2026-10-24T10:00:00.000Z";
  assert.equal(
    canCancelRegistration({
      registrationStatus: "REGISTERED",
      activityAt,
      now: new Date("2026-10-24T09:59:59.999Z"),
    }),
    true,
  );
  assert.equal(
    canCancelRegistration({
      registrationStatus: "REGISTERED",
      activityAt,
      now: new Date("2026-10-24T10:00:00.000Z"),
    }),
    false,
    "活动开始时刻起不可再自助取消",
  );
  for (const registrationStatus of ["CHECKED_IN", "SERVED"]) {
    assert.equal(
      canCancelRegistration({
        registrationStatus,
        activityAt,
        now: new Date("2026-10-24T04:00:00.000Z"),
      }),
      false,
      registrationStatus,
    );
  }
});

test("管理报名 PATCH 使用同一 issueType 白名单", () => {
  assert.doesNotThrow(() => assertValidIssueType("CLEAN_ONLY"));
  assert.doesNotThrow(() => assertValidIssueType("SOFTWARE_SYSTEM"));
  assert.throws(
    () => assertValidIssueType("INVALID"),
    (error) => error instanceof AppError && error.code === "VALIDATION_FAILED",
  );
});

test("报名页给出的每个故障类型都被服务端接受，且两处文案一致", () => {
  const options = repairActivitiesPage.issueTypes;
  // 前端选项与服务端白名单/标签是两份数据，很容易只改一处 ——  要求新增
  // 「软件 / 系统问题」时，两边必须同步。
  for (const option of options) {
    assert.equal(assertValidIssueType(option.value), option.value);
    assert.equal(
      repairActivityIssueTypeLabels[option.value as RepairActivityIssueType],
      option.label,
      `故障类型 ${option.value} 的文案在 config 与 validation 里不一致`,
    );
  }
  assert.deepEqual(
    options.map((option) => option.value).sort(),
    [...RepairActivityIssueType].sort(),
    "报名页的故障类型选项与服务端枚举必须逐一对应",
  );
});
