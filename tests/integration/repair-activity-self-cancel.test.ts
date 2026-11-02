import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, beforeEach, test } from "node:test";

import { POST as cancelRoute } from "../../src/app/api/v1/repair-activities/[id]/registrations/[regId]/cancel/route";
import { repairActivityService } from "../../src/features/repair-activities/repair-activity-service";
import { AppError } from "../../src/lib/api/errors";
import { resetRateLimitsForTests } from "../../src/lib/api/rate-limit";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import type { PublicRequestContext } from "../../src/types/contracts";
import { integrationTestsEnabled } from "./db-guard";
import { callRoute } from "./http-harness";

const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;
const PREFIX = "SELF345 ";
const HOUR = 60 * 60 * 1000;

const context: PublicRequestContext = {
  requestId: "req_self345",
  ipAddress: "127.0.0.1",
  userAgent: "integration-self345",
};

function registerInput(name: string, phone: string) {
  return {
    name,
    phone,
    issueType: "CLEAN_ONLY" as const,
    consentAccepted: true,
  };
}

async function cleanupFixtures(): Promise<void> {
  const db = getDb();
  const activities = await db.repairActivity.findMany({
    where: { title: { startsWith: PREFIX } },
    select: { id: true },
  });
  const activityIds = activities.map((row) => row.id);
  if (activityIds.length === 0) return;
  const registrations = await db.repairActivityRegistration.findMany({
    where: { activityId: { in: activityIds } },
    select: { id: true },
  });
  await db.auditLog.deleteMany({
    where: {
      targetType: "RepairActivityRegistration",
      targetId: { in: registrations.map((row) => row.id) },
    },
  });
  await db.repairActivityRegistration.deleteMany({ where: { activityId: { in: activityIds } } });
  await db.repairActivity.deleteMany({ where: { id: { in: activityIds } } });
}

async function createActivity(capacity = 1): Promise<string> {
  const now = new Date();
  const id = randomUUID();
  await getDb().repairActivity.create({
    data: {
      id,
      title: `${PREFIX}${id.slice(0, 8)}`,
      capacity,
      activityAt: new Date(now.getTime() + 3 * HOUR),
      signupOpensAt: new Date(now.getTime() - HOUR),
      signupClosesAt: new Date(now.getTime() + HOUR),
      createdAt: now,
      updatedAt: now,
    },
  });
  return id;
}

async function register(activityId: string, name: string, phone: string) {
  const created = await repairActivityService.register(
    activityId,
    registerInput(name, phone),
    context,
  );
  const lookup = await repairActivityService.lookup(activityId, { name, phone }, context);
  return { id: created.id, editToken: lookup.editToken };
}

function rejectsWith(code: string) {
  return (error: unknown) => error instanceof AppError && error.code === code;
}

beforeEach(async () => {
  if (!enabled) return;
  await cleanupFixtures();
  resetRateLimitsForTests();
});

after(async () => {
  if (!enabled) return;
  try {
    await cleanupFixtures();
  } finally {
    await disconnectDb();
  }
});

dbTest("自助取消：活动开始前软删、审计、释放名额并允许同设备重新报名", async () => {
  const activityId = await createActivity(1);
  const name = "自助取消客户";
  const phone = "13800000011";
  const created = await register(activityId, name, phone);

  // 报名截止后、活动开始前仍可取消。
  await getDb().repairActivity.update({
    where: { id: activityId },
    data: { signupClosesAt: new Date(Date.now() - 1_000) },
  });
  const result = await repairActivityService.cancelRegistration(
    activityId,
    created.id,
    { name, phone, editToken: created.editToken },
    context,
  );
  assert.deepEqual(result, { cancelled: true });
  assert.equal(
    await getDb().repairActivityRegistration.count({
      where: { activityId, deletedAt: null },
    }),
    0,
  );
  const row = await getDb().repairActivityRegistration.findUniqueOrThrow({
    where: { id: created.id },
  });
  assert.ok(row.deletedAt);
  assert.equal(
    await getDb().auditLog.count({
      where: {
        action: "repair_activity.registration_cancelled",
        targetType: "RepairActivityRegistration",
        targetId: created.id,
      },
    }),
    1,
  );

  // 重新报名仍受正常报名窗口约束；把窗口恢复后再验证设备解锁。
  await getDb().repairActivity.update({
    where: { id: activityId },
    data: { signupClosesAt: new Date(Date.now() + HOUR) },
  });
  const again = await repairActivityService.register(
    activityId,
    registerInput(name, phone),
    context,
    { registrationId: created.id },
  );
  assert.notEqual(again.id, created.id, "取消后同一设备可重新报名");
  // 响应丢失后的重试：同 token 再取消已删除行应幂等成功，不新增审计。
  assert.deepEqual(
    await repairActivityService.cancelRegistration(
      activityId,
      created.id,
      { name, phone, editToken: created.editToken },
      context,
    ),
    { cancelled: true },
  );
  assert.equal(
    await getDb().auditLog.count({
      where: {
        action: "repair_activity.registration_cancelled",
        targetType: "RepairActivityRegistration",
        targetId: created.id,
      },
    }),
    1,
  );
});

dbTest("自助取消：并发双请求幂等成功且只写一条审计", async () => {
  const activityId = await createActivity();
  const name = "并发取消客户";
  const phone = "13800000015";
  const created = await register(activityId, name, phone);
  const input = { name, phone, editToken: created.editToken };

  const results = await Promise.allSettled([
    repairActivityService.cancelRegistration(activityId, created.id, input, context),
    repairActivityService.cancelRegistration(activityId, created.id, input, context),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    2,
    "已软删行的并发重试应全部幂等成功",
  );
  assert.equal(
    await getDb().repairActivityRegistration.count({
      where: { activityId, deletedAt: null },
    }),
    0,
  );
  const audits = await getDb().auditLog.findMany({
    where: {
      action: "repair_activity.registration_cancelled",
      targetType: "RepairActivityRegistration",
      targetId: created.id,
    },
  });
  assert.equal(audits.length, 1);
  const summary = JSON.stringify(audits[0]!.beforeSummary);
  assert.equal(summary.includes(phone), false, "审计不能包含完整手机号");
  assert.ok(summary.includes("138****0015"), "审计保留脱敏手机号");
});

dbTest("自助取消：活动开始后或已签到/已接待时拒绝", async () => {
  const activityId = await createActivity();
  const started = await register(activityId, "已开始客户", "13800000012");
  await getDb().repairActivity.update({
    where: { id: activityId },
    data: { activityAt: new Date(Date.now() - 60_000) },
  });
  await assert.rejects(
    () =>
      repairActivityService.cancelRegistration(
        activityId,
        started.id,
        { name: "已开始客户", phone: "13800000012", editToken: started.editToken },
        context,
      ),
    rejectsWith("ACTIVITY_REGISTRATION_STATE_INVALID"),
  );

  const checkedInActivity = await createActivity();
  const checkedIn = await register(checkedInActivity, "已签到客户", "13800000013");
  await getDb().repairActivityRegistration.update({
    where: { id: checkedIn.id },
    data: { status: "CHECKED_IN", checkedInAt: new Date() },
  });
  await assert.rejects(
    () =>
      repairActivityService.cancelRegistration(
        checkedInActivity,
        checkedIn.id,
        { name: "已签到客户", phone: "13800000013", editToken: checkedIn.editToken },
        context,
      ),
    rejectsWith("ACTIVITY_REGISTRATION_STATE_INVALID"),
  );

  const servedActivity = await createActivity();
  const served = await register(servedActivity, "已接待客户", "13800000016");
  await getDb().repairActivityRegistration.update({
    where: { id: served.id },
    data: { status: "SERVED", checkedInAt: new Date(), servedAt: new Date() },
  });
  await assert.rejects(
    () =>
      repairActivityService.cancelRegistration(
        servedActivity,
        served.id,
        { name: "已接待客户", phone: "13800000016", editToken: served.editToken },
        context,
      ),
    rejectsWith("ACTIVITY_REGISTRATION_STATE_INVALID"),
  );
});

dbTest("自助取消路由：姓名、手机号或 token 不匹配时拒绝，匹配时返回 200", async () => {
  const activityId = await createActivity();
  const name = "路由取消客户";
  const phone = "13800000014";
  const created = await register(activityId, name, phone);
  const routePath = `http://localhost/api/v1/repair-activities/${activityId}/registrations/${created.id}/cancel`;

  const wrong = await callRoute(cancelRoute, routePath, {
    method: "POST",
    params: { id: activityId, regId: created.id },
    body: { name, phone: "13800000099", editToken: created.editToken },
  });
  assert.equal(wrong.status, 404);
  assert.equal((wrong.json.error as { code?: string }).code, "ACTIVITY_REGISTRATION_NOT_FOUND");

  const wrongToken = await callRoute(cancelRoute, routePath, {
    method: "POST",
    params: { id: activityId, regId: created.id },
    body: { name, phone, editToken: "bad-token" },
  });
  assert.equal(wrongToken.status, 403);
  assert.equal((wrongToken.json.error as { code?: string }).code, "ACTIVITY_EDIT_TOKEN_INVALID");

  const wrongName = await callRoute(cancelRoute, routePath, {
    method: "POST",
    params: { id: activityId, regId: created.id },
    body: { name: "另一个人", phone, editToken: created.editToken },
  });
  assert.equal(wrongName.status, 404);
  assert.equal((wrongName.json.error as { code?: string }).code, "ACTIVITY_REGISTRATION_NOT_FOUND");

  const ok = await callRoute(cancelRoute, routePath, {
    method: "POST",
    params: { id: activityId, regId: created.id },
    body: { name, phone, editToken: created.editToken },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual(ok.json.data, { cancelled: true });
});
