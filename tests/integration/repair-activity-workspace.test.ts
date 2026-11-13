import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { before, after } from "node:test";
import { GET as SUMMARY } from "../../src/app/api/v1/admin/repair-activities/[id]/route";
import { GET as REGISTRATIONS } from "../../src/app/api/v1/admin/repair-activities/[id]/registrations/route";
import { GET as BOARD } from "../../src/app/api/v1/member/repair-activities/[id]/board/route";
import { POST as CHECK_IN } from "../../src/app/api/v1/member/repair-activities/[id]/check-in/route";
import { POST as WITHDRAW } from "../../src/app/api/v1/member/repair-activities/[id]/withdraw/route";
import { POST as SERVE } from "../../src/app/api/v1/member/repair-activities/[id]/serve/route";
import { GET as BLACKLIST } from "../../src/app/api/v1/admin/repair-activities/customer-blacklist/route";
import { getDb, disconnectDb } from "../../src/lib/db/client";
import { integrationTestsEnabled } from "./db-guard";
import { callRoute, sessionCookie } from "./http-harness";

const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;
const activityId = randomUUID();
const ids = [randomUUID(), randomUUID(), randomUUID()];
const profileId = randomUUID();
const registrationId = randomUUID();
let adminCookie = "",
  memberCookie = "",
  outsiderCookie = "";

before(async () => {
  if (!enabled) return;
  const db = getDb(),
    now = new Date();
  for (const [index, id] of ids.entries())
    await db.user.create({
      data: {
        id,
        status: "ACTIVE",
        displayName: `WORKSPACE378 ${index}`,
        createdAt: now,
        updatedAt: now,
      },
    });
  await db.memberProfile.create({
    data: {
      id: profileId,
      userId: ids[1],
      realName: "WORKSPACE378 成员",
      status: "ACTIVE",
      joinedAt: now,
      createdAt: now,
    },
  });
  adminCookie = await sessionCookie(ids[0], "ADMIN");
  memberCookie = await sessionCookie(ids[1], "MEMBER");
  outsiderCookie = await sessionCookie(ids[2], "MEMBER");
  await db.userRole.deleteMany({ where: { userId: ids[2] } });
  await db.repairActivity.create({
    data: {
      id: activityId,
      title: "WORKSPACE378 活动",
      location: "测试现场",
      activityAt: now,
      endsAt: new Date(+now + 7_200_000),
      signupOpensAt: new Date(+now - 86_400_000),
      signupClosesAt: new Date(+now - 1_000),
      capacity: 10,
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.repairActivityRegistration.create({
    data: {
      id: registrationId,
      activityId,
      name: "测试客户",
      phone: "13900000378",
      phoneLast4: "0378",
      issueType: "CLEAN_ONLY",
      status: "REGISTERED",
      createdAt: now,
    },
  });
  await db.repairActivityAttendance.create({
    data: { id: randomUUID(), activityId, memberProfileId: profileId, checkedInAt: now },
  });
});
after(async () => {
  if (!enabled) return;
  const db = getDb();
  await db.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await db.repairActivityRegistration.deleteMany({ where: { activityId } });
  await db.repairActivityAttendance.deleteMany({ where: { activityId } });
  await db.repairActivity.deleteMany({ where: { id: activityId } });
  await db.authSession.deleteMany({ where: { userId: { in: ids } } });
  await db.userRole.deleteMany({ where: { userId: { in: ids } } });
  await db.passwordCredential.deleteMany({ where: { userId: { in: ids } } });
  await db.memberProfile.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await disconnectDb();
});

type Route = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
function read(handler: Route, cookie: string, id = activityId, suffix = "") {
  return callRoute(handler, `http://localhost/api/v1/admin/repair-activities/${id}${suffix}`, {
    params: { id },
    headers: { cookie },
  });
}

dbTest("对象摘要：无档案管理员与活动成员可读，匿名401、无权限403、缺失/删除404", async () => {
  assert.equal((await read(SUMMARY, adminCookie)).status, 200);
  assert.equal((await read(SUMMARY, memberCookie)).status, 200);
  assert.equal((await read(SUMMARY, "")).status, 401);
  assert.equal((await read(SUMMARY, outsiderCookie)).status, 403);
  assert.equal((await read(SUMMARY, outsiderCookie, randomUUID())).status, 403);
  assert.equal((await read(SUMMARY, adminCookie, randomUUID())).status, 404);
  await getDb().repairActivity.update({
    where: { id: activityId },
    data: { deletedAt: new Date() },
  });
  assert.equal((await read(SUMMARY, adminCookie)).status, 404);
  await getDb().repairActivity.update({ where: { id: activityId }, data: { deletedAt: null } });
});

dbTest("对象页页签数据：无档案管理员可读名单/出勤/黑名单，普通成员仅能读现场看板", async () => {
  const registrations = await read(REGISTRATIONS, adminCookie, activityId, "/registrations");
  assert.equal(registrations.status, 200);
  assert.equal((registrations.json.data as { id: string }[])[0].id, registrationId);
  for (const view of ["full", "live", "served", "attendance"]) {
    const response = await read(BOARD, adminCookie, activityId, `/board?view=${view}`);
    assert.equal(response.status, 200, view);
    if (view === "live") {
      const data = response.json.data as {
        canAttend: boolean;
        canAdmin: boolean;
        eligible: unknown[];
      };
      assert.equal(data.canAttend, false);
      assert.equal(data.canAdmin, true);
      assert.equal(data.eligible.length, 1);
    }
    if (view === "attendance")
      assert.equal(
        (response.json.data as { attendanceMembers: unknown[] }).attendanceMembers.length,
        1,
      );
  }
  assert.equal((await read(REGISTRATIONS, memberCookie, activityId, "/registrations")).status, 403);
  assert.equal((await read(BOARD, memberCookie, activityId, "/board?view=attendance")).status, 403);
  assert.equal((await read(BOARD, memberCookie, activityId, "/board?view=live")).status, 200);
  assert.equal((await read(BOARD, outsiderCookie, activityId, "/board?view=live")).status, 403);
  assert.equal(
    (
      await callRoute(
        BLACKLIST,
        "http://localhost/api/v1/admin/repair-activities/customer-blacklist",
        { headers: { cookie: adminCookie } },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await callRoute(
        BLACKLIST,
        "http://localhost/api/v1/admin/repair-activities/customer-blacklist",
        { headers: { cookie: memberCookie } },
      )
    ).status,
    403,
  );
});

dbTest("无档案管理员可签到/撤回，审计保留用户归属；本人接待仍要求有效成员", async () => {
  const invoke = (handler: Route, cookie: string, body: unknown) =>
    callRoute(handler, `http://localhost/api/v1/member/repair-activities/${activityId}`, {
      method: "POST",
      params: { id: activityId },
      headers: { cookie },
      body,
    });
  assert.equal(
    (await invoke(CHECK_IN, memberCookie, { registrationIds: [registrationId] })).status,
    403,
  );
  assert.equal(
    (await invoke(CHECK_IN, adminCookie, { registrationIds: [registrationId] })).status,
    200,
  );
  assert.equal(
    (await getDb().repairActivityRegistration.findUniqueOrThrow({ where: { id: registrationId } }))
      .status,
    "CHECKED_IN",
  );
  assert.equal((await invoke(SERVE, adminCookie, { registrationId })).status, 403);
  assert.equal((await invoke(WITHDRAW, adminCookie, { registrationId })).status, 200);
  assert.equal(
    (await getDb().repairActivityRegistration.findUniqueOrThrow({ where: { id: registrationId } }))
      .status,
    "REGISTERED",
  );
  assert.ok(
    await getDb().auditLog.findFirst({
      where: { actorUserId: ids[0], action: "repair_activity.registrations_checked_in" },
    }),
  );
});
