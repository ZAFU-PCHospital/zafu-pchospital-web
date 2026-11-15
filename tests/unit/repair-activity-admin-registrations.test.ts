import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "mysql://unused";
process.env.AUTH_SECRET ??= "test-auth-secret-for-admin-registrations";
process.env.INVITE_CODE_PEPPER ??= "test-invite-code-pepper";
process.env.PII_AUDIT_PEPPER ??= "test-pii-audit-pepper";

import { repairActivityService } from "../../src/features/repair-activities/repair-activity-service";
import {
  canRemoveActivityRegistration,
  repairActivityRegistrationStatusLabels,
} from "../../src/features/repair-activities/repair-activity-validation";
import { adminCopy } from "../../src/config/admin";
import type { AuthorizedActor } from "../../src/types/contracts";

const ACTIVITY_ID = "activity-admin-registrations";
const CREATED_AT = new Date("2026-10-28T06:00:00Z");

function actor(permissions: AuthorizedActor["permissions"]): AuthorizedActor {
  return {
    actorType: "USER",
    userId: "admin",
    userStatus: "ACTIVE",
    requestId: "req_admin_registrations",
    permissions,
  };
}

function row(id: string, name: string, status: string, deletedAt: Date | null = null) {
  return {
    id,
    activityId: ACTIVITY_ID,
    name,
    phone: "13800138000",
    issueType: "CLEAN_ONLY",
    deviceModel: null,
    status,
    createdAt: CREATED_AT,
    deletedAt,
  };
}

test("管理端名单返回全部报名，并按有效同名报名标记，不把删除历史算入同名", async (t) => {
  const rows = [
    row("active-wang-1", "王同学", "REGISTERED"),
    row("active-wang-2", "王同学", "CHECKED_IN"),
    row("deleted-wang", "王同学", "REGISTERED", new Date("2026-10-28T05:00:00Z")),
    row("active-li", "李同学", "REGISTERED"),
    row("deleted-li", "李同学", "REGISTERED", new Date("2026-10-28T05:10:00Z")),
    row("active-zhang", "张同学", "SERVED"),
  ];
  const db = {
    repairActivity: {
      findFirst: async () => ({
        id: ACTIVITY_ID,
        deletedAt: null,
        activityAt: new Date("2099-01-01"),
      }),
    },
    repairActivityRegistration: { findMany: async () => rows },
  };
  const globalDb = globalThis as unknown as { __pcHospitalDb?: unknown };
  const previous = globalDb.__pcHospitalDb;
  globalDb.__pcHospitalDb = db;
  t.after(() => {
    globalDb.__pcHospitalDb = previous;
  });

  const result = await repairActivityService.listRegistrations(
    ACTIVITY_ID,
    actor(["activity:admin"]),
  );

  assert.deepEqual(
    result.map((registration) => registration.id),
    rows.map((registration) => registration.id),
    "删除历史随名单返回，由后台默认折叠展示",
  );
  assert.equal(result.filter((registration) => !registration.deletedAt).length, 4);
  assert.equal(result.filter((registration) => registration.deletedAt).length, 2);
  assert.deepEqual(
    result.map((registration) => [registration.id, registration.hasSameNameActive]),
    [
      ["active-wang-1", true],
      ["active-wang-2", true],
      ["deleted-wang", false],
      ["active-li", false],
      ["deleted-li", false],
      ["active-zhang", false],
    ],
  );
  assert.equal(
    result.find((registration) => registration.id === "deleted-wang")?.deletedAt,
    "2026-10-28T05:00:00.000Z",
  );
});

test("没有 activity:admin 权限不能读取报名名单", async () => {
  await assert.rejects(() => repairActivityService.listRegistrations(ACTIVITY_ID, actor([])), {
    code: "FORBIDDEN",
  });
});

test("报名状态与删除状态都有中文文案", () => {
  assert.deepEqual(repairActivityRegistrationStatusLabels, {
    REGISTERED: "报名成功",
    CHECKED_IN: "已签到",
    SERVED: "已接待",
  });
  assert.equal(adminCopy.repairActivities.registrations.deleted, "已删除");
  assert.equal(adminCopy.repairActivities.registrations.deletedHistory.includes("{count}"), true);
  assert.equal(adminCopy.repairActivities.registrations.sameNameHint.includes("同名"), true);
});

test("删除截止点与活动上海自然日一致", () => {
  const activityAt = new Date("2026-11-15T06:00:00Z");
  assert.equal(canRemoveActivityRegistration(activityAt, new Date("2026-11-10T06:00:00Z")), true);
  assert.equal(
    canRemoveActivityRegistration(activityAt, new Date("2026-11-15T15:59:59.999Z")),
    true,
  );
  assert.equal(
    canRemoveActivityRegistration(activityAt, new Date("2026-11-15T16:00:00.000Z")),
    false,
  );
});
