import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { ReactNode } from "react";

import {
  ActivityTicketCard,
  type ActivityTicketCopy,
} from "../../src/components/repair-activities/ActivityTicketCard";
import { ActivityTicketCardShell } from "../../src/components/repair-activities/ActivityTicketCardShell";
import { formatShanghaiTimeRange } from "../../src/components/repair-activities/activity-format";
import { repairActivitiesPage } from "../../src/config/repair-activities";
import { bodyNullableIsoDate } from "../../src/features/repair-activities/repair-activity-http";
import { publicActivitySegmentWheres } from "../../src/features/repair-activities/repair-activity-public-query";
import type { RepairActivityPublicView } from "../../src/features/repair-activities/repair-activity-service";
import {
  assertActivityStaffOpen,
  assertActivityTimeRules,
  assertValidLocation,
  canOperateActivityStaff,
  canShowPublicQueue,
  deriveRepairActivityStatus,
  REPAIR_ACTIVITY_DEFAULT_DURATION_MINUTES,
  REPAIR_ACTIVITY_LOCATION_MAX_LENGTH,
} from "../../src/features/repair-activities/repair-activity-validation";
import { AppError } from "../../src/lib/api/errors";

const require = createRequire(import.meta.url);
const React = require("react") as typeof import("react");
(globalThis as unknown as { React: typeof React }).React = React;

type Props = { children?: ReactNode };

function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (React.isValidElement<Props>(node)) {
    if (typeof node.type === "function") {
      return text((node.type as (props: Props) => ReactNode)(node.props));
    }
    return text(node.props.children);
  }
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  return "";
}

const copy: ActivityTicketCopy = {
  activityAt: repairActivitiesPage.activityAt,
  location: repairActivitiesPage.location,
  capacity: repairActivitiesPage.capacity,
  remainingShort: repairActivitiesPage.remainingShort,
  endedHint: repairActivitiesPage.endedHint,
};

/** 上海 10-24 10:00 开始、12:00 结束；报名窗口在开始前 1 小时截止。 */
function activityView(overrides: Partial<RepairActivityPublicView> = {}): RepairActivityPublicView {
  return {
    id: "activity-1",
    title: "秋季义务维修",
    location: "学 3-301 活动室",
    activityAt: "2026-10-24T02:00:00Z",
    endsAt: "2026-10-24T04:00:00Z",
    capacity: 10,
    signupOpensAt: "2026-10-20T00:00:00Z",
    signupClosesAt: "2026-10-24T01:00:00Z",
    status: "CLOSED",
    registeredCount: 2,
    remaining: 8,
    ...overrides,
  };
}

const timeBase = {
  activityAt: new Date("2026-10-24T02:00:00Z"),
  signupOpensAt: new Date("2026-10-20T00:00:00Z"),
  signupClosesAt: new Date("2026-10-24T01:00:00Z"),
  capacity: 10,
  effectiveRegistrationCount: 0,
};

test("默认结束时间 = 开始 + 120 分钟，常量只有一处", () => {
  assert.equal(REPAIR_ACTIVITY_DEFAULT_DURATION_MINUTES, 120);
});

test("时间区间：同日只显示一次日期，跨天两端都显示，缺结束时间返回 null", () => {
  assert.equal(
    formatShanghaiTimeRange("2026-10-24T02:00:00Z", "2026-10-24T04:00:00Z"),
    "2026/10/24 10:00–12:00",
  );
  assert.equal(
    formatShanghaiTimeRange("2026-10-24T14:00:00Z", "2026-10-24T17:00:00Z"),
    "2026/10/24 22:00 — 2026/10/25 01:00",
  );
  assert.equal(formatShanghaiTimeRange("2026-10-24T02:00:00Z", null), null);
  assert.equal(formatShanghaiTimeRange("2026-10-24T02:00:00Z", undefined), null);
  assert.equal(formatShanghaiTimeRange("not-a-date", "2026-10-24T04:00:00Z"), null);
});

test("报名卡在同一张卡上展示名称、起止时间与地点", () => {
  const card = ActivityTicketCard({ activity: activityView(), copy });
  assert.equal(card.type, ActivityTicketCardShell);

  const props = card.props as {
    activity: RepairActivityPublicView;
    meta: ReactNode;
    footer: ReactNode;
  };
  assert.equal(props.activity.title, "秋季义务维修");

  const meta = text(props.meta);
  assert.ok(meta.includes("2026/10/24 10:00–12:00"));
  assert.ok(meta.includes("地点"));
  assert.ok(meta.includes("学 3-301 活动室"));
  assert.equal(text(props.footer).includes("已结束"), false);
});

test("缺地点 / 结束时间时对应信息不渲染，时间退回只显示开始时刻", () => {
  const card = ActivityTicketCard({
    activity: activityView({ location: null, endsAt: null }),
    copy,
  });
  const meta = text((card.props as { meta: ReactNode }).meta);
  assert.equal(meta.includes("地点"), false);
  assert.equal(meta.includes("–"), false);
  assert.ok(meta.includes("10:00"));
  assert.equal(meta.includes("12:00"), false);
});

test("ENDED 按结束时间判定；缺结束时间回退活动日次日 00:00（上海）", () => {
  assert.equal(
    deriveRepairActivityStatus({
      ...timeBase,
      endsAt: new Date("2026-10-24T04:00:00Z"),
      now: new Date("2026-10-24T03:59:59.999Z"),
    }),
    "CLOSED",
  );
  assert.equal(
    deriveRepairActivityStatus({
      ...timeBase,
      endsAt: new Date("2026-10-24T04:00:00Z"),
      now: new Date("2026-10-24T04:00:00.000Z"),
    }),
    "ENDED",
  );
  // 历史活动：结束时间缺失，仍按活动日次日 00:00（上海 10-25 00:00 = 10-24T16:00Z）
  assert.equal(
    deriveRepairActivityStatus({
      ...timeBase,
      endsAt: null,
      now: new Date("2026-10-24T15:59:59.999Z"),
    }),
    "CLOSED",
  );
  assert.equal(
    deriveRepairActivityStatus({
      ...timeBase,
      endsAt: null,
      now: new Date("2026-10-24T16:00:00.000Z"),
    }),
    "ENDED",
  );
  // 结束时间非法按缺失处理，不会把活动立刻判成已结束
  assert.equal(
    deriveRepairActivityStatus({
      ...timeBase,
      endsAt: "not-a-date",
      now: new Date("2026-10-24T03:00:00.000Z"),
    }),
    "CLOSED",
  );
});

test("成员接待窗口不变：结束时间到了仍可接待到当日 24:00（上海）", () => {
  const window = { signupClosesAt: "2026-10-24T01:00:00Z", activityAt: "2026-10-24T02:00:00Z" };
  // 结束时间（上海 12:00）之后、活动日 24:00 之前
  const afterEndsAt = new Date("2026-10-24T05:00:00Z");
  assert.equal(canOperateActivityStaff(window, afterEndsAt), true);
  assert.doesNotThrow(() => assertActivityStaffOpen(window, afterEndsAt));

  const dayOver = new Date("2026-10-24T16:00:00Z");
  assert.equal(canOperateActivityStaff(window, dayOver), false);
  assert.throws(
    () => assertActivityStaffOpen(window, dayOver),
    (error) => error instanceof AppError && error.code === "ACTIVITY_ENDED",
  );
});

test("公开排队随结束时间隐藏，缺结束时间回退活动日次日 00:00", () => {
  const activity = { activityAt: "2026-10-24T02:00:00Z", endsAt: "2026-10-24T04:00:00Z" };
  assert.equal(canShowPublicQueue(activity, new Date("2026-10-24T03:59:59.999Z")), true);
  assert.equal(canShowPublicQueue(activity, new Date("2026-10-24T04:00:00.000Z")), false);

  const legacy = { activityAt: "2026-10-24T02:00:00Z", endsAt: null };
  assert.equal(canShowPublicQueue(legacy, new Date("2026-10-24T15:59:59.999Z")), true);
  assert.equal(canShowPublicQueue(legacy, new Date("2026-10-24T16:00:00.000Z")), false);
});

test("时间校验新增 activityAt < endsAt，endsAt 为空时跳过", () => {
  assert.doesNotThrow(() =>
    assertActivityTimeRules({ ...timeBase, endsAt: new Date("2026-10-24T04:00:00Z") }),
  );
  assert.doesNotThrow(() => assertActivityTimeRules({ ...timeBase, endsAt: null }));
  assert.doesNotThrow(() => assertActivityTimeRules(timeBase));

  for (const endsAt of [
    new Date("2026-10-24T02:00:00Z"), // 等于开始
    new Date("2026-10-24T01:00:00Z"), // 早于开始
  ]) {
    assert.throws(
      () => assertActivityTimeRules({ ...timeBase, endsAt }),
      (error) => error instanceof AppError && error.code === "VALIDATION_FAILED",
    );
  }
});

test("地点校验：选填、去首尾空格、上限 120", () => {
  assert.equal(assertValidLocation(undefined), null);
  assert.equal(assertValidLocation(null), null);
  assert.equal(assertValidLocation("   "), null);
  assert.equal(assertValidLocation("  学 3-301 活动室 "), "学 3-301 活动室");
  const longest = "地".repeat(REPAIR_ACTIVITY_LOCATION_MAX_LENGTH);
  assert.equal(assertValidLocation(longest), longest);
  assert.throws(
    () => assertValidLocation(`${longest}地`),
    (error) => error instanceof AppError && error.code === "VALIDATION_FAILED",
  );
});

test("PATCH 结束时间三态：缺字段保持原值、null 清空、字符串解析", () => {
  assert.equal(bodyNullableIsoDate({}, "endsAt"), undefined);
  assert.equal(bodyNullableIsoDate({ title: "x" }, "endsAt"), undefined);
  assert.equal(bodyNullableIsoDate({ endsAt: null }, "endsAt"), null);
  assert.equal(
    bodyNullableIsoDate({ endsAt: "2026-10-24T04:00:00Z" }, "endsAt")?.toISOString(),
    "2026-10-24T04:00:00.000Z",
  );
  assert.throws(
    () => bodyNullableIsoDate({ endsAt: "" }, "endsAt"),
    (error) => error instanceof AppError && error.code === "VALIDATION_FAILED",
  );
});

type SegmentRow = {
  id: string;
  deletedAt: Date | null;
  activityAt: Date;
  endsAt: Date | null;
};

type WhereInput = {
  deletedAt?: null;
  OR?: WhereInput[];
  activityAt?: { gte?: Date; lt?: Date };
  endsAt?: null | { lte?: Date; gt?: Date };
};

/** 按 SQL 语义求值：NULL 与时间比较不成立（`ends_at <= ?` 对 NULL 行为 NULL）。 */
function matchesWhere(where: WhereInput, row: SegmentRow): boolean {
  if (where.deletedAt === null && row.deletedAt !== null) return false;
  const branches = where.OR;
  if (!branches) return true;
  return branches.some((branch) => matchesBranch(branch, row));
}

function matchesBranch(branch: WhereInput, row: SegmentRow): boolean {
  if (branch.endsAt === null && row.endsAt !== null) return false;
  const endsAt = branch.endsAt;
  if (endsAt && typeof endsAt === "object") {
    if (row.endsAt === null) return false;
    if (endsAt.lte && !(row.endsAt.getTime() <= endsAt.lte.getTime())) return false;
    if (endsAt.gt && !(row.endsAt.getTime() > endsAt.gt.getTime())) return false;
  }
  const activityAt = branch.activityAt;
  if (activityAt) {
    if (row.activityAt === null) return false;
    if (activityAt.gte && !(row.activityAt.getTime() >= activityAt.gte.getTime())) return false;
    if (activityAt.lt && !(row.activityAt.getTime() < activityAt.lt.getTime())) return false;
  }
  return true;
}

test("公开列表分段：结束时间已过即归入已结束段，历史活动仍按活动日次日零点", () => {
  // 上海 2026-10-24 14:00；今日零点（上海）为 2026-10-23T16:00:00Z
  const now = new Date("2026-10-24T06:00:00.000Z");
  const { active, ended } = publicActivitySegmentWheres(now);
  const rows: SegmentRow[] = [
    {
      id: "ended-by-endsAt",
      deletedAt: null,
      activityAt: new Date("2026-10-24T02:00:00Z"), // 上海 10:00
      endsAt: new Date("2026-10-24T04:00:00Z"), // 上海 12:00，已过
    },
    {
      id: "ongoing",
      deletedAt: null,
      activityAt: new Date("2026-10-24T02:00:00Z"),
      endsAt: new Date("2026-10-24T08:00:00Z"), // 上海 16:00，未到
    },
    {
      id: "later-today",
      deletedAt: null,
      activityAt: new Date("2026-10-25T02:00:00Z"),
      endsAt: new Date("2026-10-25T04:00:00Z"),
    },
    {
      id: "legacy-today",
      deletedAt: null,
      activityAt: new Date("2026-10-24T02:00:00Z"),
      endsAt: null,
    },
    {
      id: "legacy-yesterday",
      deletedAt: null,
      activityAt: new Date("2026-10-23T02:00:00Z"), // 上海 10-23 10:00
      endsAt: null,
    },
    {
      id: "deleted",
      deletedAt: new Date("2026-10-20T00:00:00Z"),
      activityAt: new Date("2026-10-24T02:00:00Z"),
      endsAt: new Date("2026-10-24T08:00:00Z"),
    },
  ];

  const isActive = (row: SegmentRow) => matchesWhere(active as WhereInput, row);
  const isEnded = (row: SegmentRow) => matchesWhere(ended as WhereInput, row);

  assert.equal(isEnded(rows[0]), true, "结束时间已过、自然日未结束 → 已结束段");
  assert.equal(isActive(rows[0]), false);
  assert.equal(isActive(rows[1]), true, "进行中 → 未结束段");
  assert.equal(isActive(rows[2]), true);
  assert.equal(isActive(rows[3]), true, "历史活动当天仍属未结束");
  assert.equal(isEnded(rows[4]), true, "历史活动过了活动日 → 已结束段");
  assert.equal(isActive(rows[5]), false, "软删活动不进任何一段");
  assert.equal(isEnded(rows[5]), false);

  for (const row of rows) {
    if (row.deletedAt) continue;
    assert.equal(isActive(row) !== isEnded(row), true, `${row.id} 必须恰好落在一段里`);
    // 分段口径必须与派生状态一致：ENDED 的判定就是分段里的「已结束」。
    const status = deriveRepairActivityStatus({
      now,
      activityAt: row.activityAt,
      endsAt: row.endsAt,
      signupOpensAt: new Date("2026-10-01T00:00:00Z"),
      signupClosesAt: new Date("2026-10-20T00:00:00Z"),
      effectiveRegistrationCount: 0,
      capacity: 10,
    });
    assert.equal(isEnded(row), status === "ENDED", `${row.id} 分段与 ENDED 判定必须一致`);
  }
});
