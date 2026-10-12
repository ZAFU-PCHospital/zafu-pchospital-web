import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { POST as POST_CHECK_IN } from "../../src/app/api/v1/member/repair-activities/[id]/check-in/route";
import { POST as POST_ATTENDANCE } from "../../src/app/api/v1/member/repair-activities/[id]/attendance/route";
import { POST as POST_SERVE } from "../../src/app/api/v1/member/repair-activities/[id]/serve/route";
import { POST as POST_WITHDRAW } from "../../src/app/api/v1/member/repair-activities/[id]/withdraw/route";
import { GET as GET_PHONE } from "../../src/app/api/v1/member/repair-activities/[id]/registrations/[registrationId]/phone/route";
import { POST as POST_REGISTRATION } from "../../src/app/api/v1/repair-activities/[id]/registrations/route";
import { repairActivityStaffService } from "../../src/features/repair-activities/repair-activity-staff-service";
import { resetRateLimitsForTests } from "../../src/lib/api/rate-limit";
import { permissionsForRoles } from "../../src/lib/auth/permissions";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import type { AuthorizedActor } from "../../src/types/contracts";
import { integrationTestsEnabled } from "./db-guard";
import { callRoute, sessionCookie } from "./http-harness";

/* 集成测试的统一闸门：指向非测试库时**在加载阶段就抛错**（`db-guard.ts` 里写了两次
   实际事故）。未开启时返回 false，各文件照常走 test.skip。 */
const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;

/**
 * 成员接待台「签到入队 / 撤回」的集成测试（issue #79-3，真实 GreatSQL）。
 *
 * 前端为批量签到加了二次确认（纯客户端），本条链路仍必须打到真实路由才有意义：
 * 出勤校验（403）→ 签到入队（REGISTERED → CHECKED_IN）→ 撤回（CHECKED_IN →
 * REGISTERED，清空 checkedInAt）→ 已接待不可撤回（409）；以及「非本活动报名 404」。
 * 状态与审计必须同时对齐 —— 服务层用事务写状态 + `appendAuditLog`，只查状态无法
 * 发现审计漏写。
 *
 * 独立的 UUID 段 `e7900000-…` 与标题前缀 "REG79 " —— 清理一律按这两者限定，
 * 绝不触碰库里已有的活动与报名（那是开发者/生产同源的开发数据）。
 */
const ACTIVITY_ID = "e7900000-0000-4000-8000-000000000001";
const ACTIVITY_TITLE = "REG79 工作台集成测试活动";
const STAFF_USER_ID = "e7900000-0000-4000-8000-000000000002";
const STAFF_PROFILE_ID = "e7900000-0000-4000-8000-000000000003";
/** 兜底分类：seed 里已有 SYSTEM，这里只防「未跑 seed 的空库」把用例误判成失败。 */
const SYSTEM_CATEGORY_ID = "e7900000-0000-4000-8000-000000000004";
/** 另一个活动（「非本活动报名」用例用）。 */
const OTHER_ACTIVITY_ID = "e7900000-0000-4000-8000-000000000005";
/** 未标记出勤的接待员（出勤校验 403 用例用）。 */
const ABSENT_STAFF_USER_ID = "e7900000-0000-4000-8000-000000000006";
const ABSENT_STAFF_PROFILE_ID = "e7900000-0000-4000-8000-000000000007";

/** 失败信封里的错误码（`apiFailure` 的 `error.code`）。 */
function errorCodeOf(json: Record<string, unknown>): string | undefined {
  return (json.error as { code?: string } | undefined)?.code;
}

/**
 * 清理本文件产生的全部行。
 *
 * 顺序由外键决定：审计 / 时间线是 RESTRICT 子表，维修记录与报名是父表；
 * 两位接待员的用户行还被审计引用、sessionCookie 建的会话 / 凭据 / 角色是
 * RESTRICT 子表，都必须在删除用户之前清掉。
 */
async function cleanupFixtures(): Promise<void> {
  const db = getDb();
  const activityIds = [ACTIVITY_ID, OTHER_ACTIVITY_ID];
  const registrations = await db.repairActivityRegistration.findMany({
    where: { activityId: { in: activityIds } },
    select: { id: true, repairRecordId: true },
  });
  const registrationIds = registrations.map((row) => row.id);
  // 落单记录以 `memberProfileId = 接待员` 限定，够窄且不依赖报名上的回链。
  const records = await db.repairRecord.findMany({
    where: {
      memberProfileId: STAFF_PROFILE_ID,
      createRequestKey: { startsWith: "activity-serve:" },
    },
    select: { id: true },
  });
  const recordIds = [
    ...new Set([
      ...records.map((row) => row.id),
      ...registrations.flatMap((row) => (row.repairRecordId ? [row.repairRecordId] : [])),
    ]),
  ];

  if (recordIds.length > 0) {
    await db.repairTimelineEvent.deleteMany({ where: { repairRecordId: { in: recordIds } } });
    await db.auditLog.deleteMany({
      where: { targetType: "RepairRecord", targetId: { in: recordIds } },
    });
  }
  if (registrationIds.length > 0) {
    await db.auditLog.deleteMany({
      where: { targetType: "RepairActivityRegistration", targetId: { in: registrationIds } },
    });
  }
  const attendanceIds = (
    await db.repairActivityAttendance.findMany({
      where: { activityId: { in: activityIds } },
      select: { id: true },
    })
  ).map((row) => row.id);
  if (attendanceIds.length > 0) {
    await db.auditLog.deleteMany({
      where: { targetType: "RepairActivityAttendance", targetId: { in: attendanceIds } },
    });
  }
  // 接待台动作的审计以活动为 target，直接按 actor 兜底清一次（两位接待员）。
  await db.auditLog.deleteMany({
    where: { actorUserId: { in: [STAFF_USER_ID, ABSENT_STAFF_USER_ID] } },
  });

  await db.repairActivityRegistration.deleteMany({ where: { activityId: { in: activityIds } } });
  await db.repairActivityAttendance.deleteMany({ where: { activityId: { in: activityIds } } });
  if (recordIds.length > 0) {
    await db.repairRecord.deleteMany({ where: { id: { in: recordIds } } });
  }
  await db.repairActivity.deleteMany({ where: { id: { in: activityIds } } });
  await db.memberProfile.deleteMany({
    where: { id: { in: [STAFF_PROFILE_ID, ABSENT_STAFF_PROFILE_ID] } },
  });
  await db.authSession.deleteMany({
    where: { userId: { in: [STAFF_USER_ID, ABSENT_STAFF_USER_ID] } },
  });
  await db.passwordCredential.deleteMany({
    where: { userId: { in: [STAFF_USER_ID, ABSENT_STAFF_USER_ID] } },
  });
  await db.userRole.deleteMany({
    where: { userId: { in: [STAFF_USER_ID, ABSENT_STAFF_USER_ID] } },
  });
  await db.user.deleteMany({ where: { id: { in: [STAFF_USER_ID, ABSENT_STAFF_USER_ID] } } });
}

/**
 * 活动建在「报名窗口内、名额未满」——只有 OPEN 才报得上名。
 * 两位接待员各有 ACTIVE 成员档案：`activity:staff` 的动作都要求「用户 ↔ 成员档案」。
 * 另一个活动带一条报名：用来验证「非本活动报名」按 404 拒绝。
 */
async function prepareFixtures(): Promise<void> {
  await cleanupFixtures();
  const db = getDb();
  const now = new Date();
  const hour = 60 * 60 * 1000;
  for (const [userId, displayName] of [
    [STAFF_USER_ID, "REG79 接待员"],
    [ABSENT_STAFF_USER_ID, "REG79 未出勤接待员"],
  ] as const) {
    await db.user.create({
      data: { id: userId, status: "ACTIVE", displayName, createdAt: now, updatedAt: now },
    });
  }
  for (const [profileId, userId, realName] of [
    [STAFF_PROFILE_ID, STAFF_USER_ID, "REG79 接待员"],
    [ABSENT_STAFF_PROFILE_ID, ABSENT_STAFF_USER_ID, "REG79 未出勤接待员"],
  ] as const) {
    await db.memberProfile.create({
      data: { id: profileId, userId, realName, status: "ACTIVE", joinedAt: now, createdAt: now },
    });
  }
  await db.repairActivity.create({
    data: {
      id: ACTIVITY_ID,
      title: ACTIVITY_TITLE,
      activityAt: new Date(now.getTime() + 7 * 24 * hour),
      capacity: 100,
      signupOpensAt: new Date(now.getTime() - hour),
      signupClosesAt: new Date(now.getTime() + 24 * hour),
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.repairActivity.create({
    data: {
      id: OTHER_ACTIVITY_ID,
      title: "REG79 非本活动",
      activityAt: new Date(now.getTime() + 8 * 24 * hour),
      capacity: 5,
      signupOpensAt: new Date(now.getTime() - hour),
      signupClosesAt: new Date(now.getTime() + 24 * hour),
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.repairActivityRegistration.create({
    data: {
      id: randomUUID(),
      activityId: OTHER_ACTIVITY_ID,
      name: "REG79 别处报名",
      phone: "13900000029",
      phoneLast4: "0029",
      issueType: "CLEAN_ONLY",
      status: "REGISTERED",
      createdAt: now,
    },
  });
  const system = await db.repairCategory.findFirst({ where: { code: "SYSTEM" } });
  if (!system) {
    await db.repairCategory.create({
      data: {
        id: SYSTEM_CATEGORY_ID,
        code: "SYSTEM",
        name: "系统问题",
        sortOrder: 90,
        createdAt: now,
      },
    });
  }
}

const staffActor: AuthorizedActor = {
  actorType: "USER",
  userId: STAFF_USER_ID,
  userStatus: "ACTIVE",
  permissions: permissionsForRoles(["ADMIN"]),
  requestId: "req_reg79_staff",
};

let staffCookie = "";
let absentCookie = "";

function signup(body: Record<string, unknown>) {
  return callRoute(
    POST_REGISTRATION,
    `http://localhost/api/v1/repair-activities/${ACTIVITY_ID}/registrations`,
    { method: "POST", body, params: { id: ACTIVITY_ID } },
  );
}

function postCheckIn(registrationIds: string[], cookie = staffCookie, issueTypeUpdates?: unknown) {
  return callRoute(
    POST_CHECK_IN,
    `http://localhost/api/v1/member/repair-activities/${ACTIVITY_ID}/check-in`,
    {
      method: "POST",
      body: { registrationIds, ...(issueTypeUpdates === undefined ? {} : { issueTypeUpdates }) },
      params: { id: ACTIVITY_ID },
      headers: { cookie },
    },
  );
}

function postWithdraw(registrationId: string, cookie = staffCookie) {
  return callRoute(
    POST_WITHDRAW,
    `http://localhost/api/v1/member/repair-activities/${ACTIVITY_ID}/withdraw`,
    {
      method: "POST",
      body: { registrationId },
      params: { id: ACTIVITY_ID },
      headers: { cookie },
    },
  );
}

/** 走公开报名路由建一条报名；返回 id。 */
async function signUpRegistration(name: string, phone: string): Promise<string> {
  await getDb().repairActivity.update({
    where: { id: ACTIVITY_ID },
    data: { signupClosesAt: new Date(Date.now() + 60_000) },
  });
  const created = await signup({
    name,
    phone,
    issueType: "SOFTWARE_SYSTEM",
    consentAccepted: true,
  });
  assert.equal(created.status, 201, `报名应成功：${JSON.stringify(created.json)}`);
  await getDb().repairActivity.update({
    where: { id: ACTIVITY_ID },
    data: { signupClosesAt: new Date(Date.now() - 1_000) },
  });
  return (created.json.data as { id: string }).id;
}

before(async () => {
  if (!enabled) return;
  // 报名路由按 IP 限流 10 次/分钟：本文件所有请求都来自同一个 "unknown" IP 桶，
  // 文件内累计不能超过 10 次，先清一次避免与其它用例相互挤占。
  resetRateLimitsForTests();
  await prepareFixtures();
  await getDb().repairActivity.update({
    where: { id: ACTIVITY_ID },
    data: { signupClosesAt: new Date(Date.now() - 1_000) },
  });
  // 主接待员先标记出勤（幂等）；「未出勤 403」用例用另一位接待员。
  await repairActivityStaffService.markAttendance(ACTIVITY_ID, staffActor);
  staffCookie = await sessionCookie(STAFF_USER_ID, "ADMIN");
  absentCookie = await sessionCookie(ABSENT_STAFF_USER_ID, "MEMBER");
});

after(async () => {
  if (!enabled) return;
  await cleanupFixtures();
  await disconnectDb();
});

/** 直接建立隔离报名，避免新校验用例消耗公开报名的 IP 限流额度。 */
let checkInFixtureNumber = 100;
async function checkInFixture(
  extra: { activityId?: string; status?: string; deletedAt?: Date; issueType?: string } = {},
) {
  const phone = `1390000${String(checkInFixtureNumber++).padStart(4, "0")}`;
  return getDb().repairActivityRegistration.create({
    data: {
      id: randomUUID(),
      activityId: ACTIVITY_ID,
      name: "REG79 类型核对",
      phone,
      phoneLast4: phone.slice(-4),
      issueType: "CLEAN_ONLY",
      status: "REGISTERED",
      deviceModel: "REG79 测试机型",
      createdAt: new Date(),
      ...extra,
    },
  });
}

dbTest("电话按需读取：普通成员未出勤可查看，默认看板脱敏，明文不进审计", async () => {
  const db = getDb();
  for (const status of ["REGISTERED", "CHECKED_IN", "SERVED"]) {
    const row = await checkInFixture({ status });
    const requestId = `req_phone_${status}`;
    const response = await GET_PHONE(
      new Request(
        `http://localhost/api/v1/member/repair-activities/${ACTIVITY_ID}/registrations/${row.id}/phone`,
        {
          headers: { cookie: absentCookie, "x-request-id": requestId },
        },
      ),
      { params: Promise.resolve({ id: ACTIVITY_ID, registrationId: row.id }) },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const json = await response.json();
    assert.deepEqual(json.data, { phone: row.phone });
    assert.equal(json.meta.requestId, requestId);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { requestId, action: "repair_activity.registration_phone.viewed", targetId: row.id },
    });
    assert.equal(audit.actorUserId, ABSENT_STAFF_USER_ID);
    assert.deepEqual(audit.afterSummary, { activityId: ACTIVITY_ID });
    assert.equal(JSON.stringify(audit).includes(row.phone), false);
    const board = await repairActivityStaffService.getBoard(ACTIVITY_ID, staffActor);
    const visible = [...board.eligible, ...board.queue, ...board.served].find(
      (item) => item.id === row.id,
    );
    assert.ok(visible);
    assert.ok(visible.phoneMasked.includes("****"));
    assert.equal(JSON.stringify(board).includes(row.phone), false);
    assert.equal("phone" in visible, false);
  }
});

dbTest("电话读取拒绝未登录、无权限、无有效成员及跨活动 / 无效报名，不留成功审计", async () => {
  const db = getDb();
  const own = await checkInFixture();
  const phoneRoute = (registrationId: string, cookie = absentCookie, id = ACTIVITY_ID) =>
    callRoute(
      GET_PHONE,
      `http://localhost/api/v1/member/repair-activities/${id}/registrations/${registrationId}/phone`,
      {
        params: { id, registrationId },
        headers: { cookie },
      },
    );
  const unauthenticated = await phoneRoute(own.id, "");
  assert.equal(unauthenticated.status, 401);
  assert.equal(errorCodeOf(unauthenticated.json), "UNAUTHENTICATED");
  await assert.rejects(
    repairActivityStaffService.getRegistrationPhone(ACTIVITY_ID, own.id, {
      ...staffActor,
      permissions: [],
    }),
    { code: "FORBIDDEN" },
  );
  await assert.rejects(
    repairActivityStaffService.getRegistrationPhone(ACTIVITY_ID, own.id, {
      ...staffActor,
      userStatus: "DISABLED",
    }),
    { code: "FORBIDDEN" },
  );
  await db.memberProfile.update({
    where: { id: ABSENT_STAFF_PROFILE_ID },
    data: { deletedAt: new Date() },
  });
  try {
    const noMember = await phoneRoute(own.id);
    assert.equal(noMember.status, 403);
  } finally {
    await db.memberProfile.update({
      where: { id: ABSENT_STAFF_PROFILE_ID },
      data: { deletedAt: null },
    });
  }
  const unavailable = [
    await checkInFixture({ activityId: OTHER_ACTIVITY_ID }),
    await checkInFixture({ deletedAt: new Date() }),
    await checkInFixture({ status: "CANCELLED" }),
  ];
  for (const registrationId of [randomUUID(), ...unavailable.map((row) => row.id)]) {
    const result = await phoneRoute(registrationId);
    assert.equal(result.status, 404);
    assert.equal(errorCodeOf(result.json), "ACTIVITY_REGISTRATION_NOT_FOUND");
  }
  const noActivity = await phoneRoute(own.id, absentCookie, randomUUID());
  assert.equal(noActivity.status, 404);
  assert.equal(errorCodeOf(noActivity.json), "ACTIVITY_NOT_FOUND");
  assert.equal(
    await db.auditLog.count({
      where: {
        action: "repair_activity.registration_phone.viewed",
        targetId: { in: [own.id, ...unavailable.map((row) => row.id)] },
      },
    }),
    0,
  );
  // 无效状态夹具不留给后续「报满」用例，避免它们被计入该用例的容量。
  await db.repairActivityRegistration.deleteMany({
    where: { id: { in: unavailable.map((row) => row.id) } },
  });
});

dbTest("核对后批量签到：新类型与标签、成员审计、撤回保留类型、接待分类贯通", async () => {
  const db = getDb();
  const first = await checkInFixture();
  const second = await checkInFixture();
  const result = await postCheckIn([first.id, second.id], staffCookie, [
    { registrationId: first.id, issueType: "SOFTWARE_SYSTEM" },
    { registrationId: second.id, issueType: "OTHER" },
  ]);
  assert.equal(result.status, 200, JSON.stringify(result.json));
  const rows = (
    result.json.data as {
      checkedIn: Array<{ issueType: string; issueTypeLabel: string; checkedInAt: string }>;
    }
  ).checkedIn;
  assert.equal(rows[0].issueType, "SOFTWARE_SYSTEM");
  assert.equal(rows[0].issueTypeLabel, "软件 / 系统问题");
  assert.equal(rows[1].issueType, "OTHER");
  assert.equal(rows[0].checkedInAt, rows[1].checkedInAt);
  const saved = await db.repairActivityRegistration.findUniqueOrThrow({ where: { id: first.id } });
  assert.equal(saved.issueType, "SOFTWARE_SYSTEM");
  assert.equal(saved.status, "CHECKED_IN");
  assert.equal(saved.checkedInAt?.toISOString(), rows[0].checkedInAt);
  const audits = await db.auditLog.findMany({
    where: {
      action: "repair_activity.registration_issue_type_updated",
      targetId: { in: [first.id, second.id] },
    },
  });
  assert.equal(audits.length, 2);
  const audit = audits.find((row) => row.targetId === first.id)!;
  assert.equal(audit.actorType, "USER");
  assert.equal(audit.actorUserId, STAFF_USER_ID);
  assert.deepEqual(audit.beforeSummary, { issueType: "CLEAN_ONLY" });
  assert.deepEqual(audit.afterSummary, { issueType: "SOFTWARE_SYSTEM" });
  assert.equal(
    (await repairActivityStaffService.getBoard(ACTIVITY_ID, staffActor)).queue.find(
      (row) => row.id === first.id,
    )?.issueType,
    "SOFTWARE_SYSTEM",
  );
  const withdrawn = await postWithdraw(first.id);
  assert.equal(withdrawn.status, 200);
  assert.equal((withdrawn.json.data as { issueType: string }).issueType, "SOFTWARE_SYSTEM");
  const memberActor = { ...staffActor, permissions: permissionsForRoles(["MEMBER"]) };
  await repairActivityStaffService.checkIn(ACTIVITY_ID, [first.id], memberActor);
  const served = await repairActivityStaffService.serve(ACTIVITY_ID, first.id, memberActor);
  const record = await db.repairRecord.findUniqueOrThrow({
    where: { id: served.repairRecordId },
    include: { category: true },
  });
  assert.equal(record.category?.code, "SYSTEM");
  assert.equal(record.deviceModel, first.deviceModel);
  await db.repairRecord.update({ where: { id: record.id }, data: { deletedAt: new Date() } });
});

dbTest("签到重试：相同类型 / 无更新幂等；不同类型整批回滚，不重复类型审计", async () => {
  const db = getDb();
  const row = await checkInFixture();
  const updates = [{ registrationId: row.id, issueType: "OTHER" }];
  assert.equal((await postCheckIn([row.id], staffCookie, updates)).status, 200);
  const saved = await db.repairActivityRegistration.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal((await postCheckIn([row.id], staffCookie, updates)).status, 200);
  assert.equal((await postCheckIn([row.id])).status, 200);
  assert.deepEqual(
    await db.repairActivityRegistration.findUniqueOrThrow({ where: { id: row.id } }),
    saved,
  );
  assert.equal(
    await db.auditLog.count({
      where: { action: "repair_activity.registration_issue_type_updated", targetId: row.id },
    }),
    1,
  );
  const fresh = await checkInFixture();
  const count = await db.auditLog.count({ where: { actorUserId: STAFF_USER_ID } });
  const conflict = await postCheckIn([fresh.id, row.id], staffCookie, [
    { registrationId: fresh.id, issueType: "SOFTWARE_SYSTEM" },
    { registrationId: row.id, issueType: "CLEAN_PASTE" },
  ]);
  assert.equal(conflict.status, 409);
  assert.equal(errorCodeOf(conflict.json), "ACTIVITY_REGISTRATION_STATE_INVALID");
  assert.deepEqual(
    await db.repairActivityRegistration.findUniqueOrThrow({ where: { id: fresh.id } }),
    fresh,
  );
  assert.deepEqual(
    await db.repairActivityRegistration.findUniqueOrThrow({ where: { id: row.id } }),
    saved,
  );
  assert.equal(await db.auditLog.count({ where: { actorUserId: STAFF_USER_ID } }), count);
});

dbTest("空 updates / 显式相同类型保留当前值，不产生类型变更审计", async () => {
  const db = getDb();
  const row = await checkInFixture({ issueType: "SOFTWARE_SYSTEM" });
  const unchanged = await checkInFixture();
  const result = await postCheckIn([row.id, unchanged.id], staffCookie, []);
  assert.equal(result.status, 200);
  assert.equal(
    (await db.repairActivityRegistration.findUniqueOrThrow({ where: { id: row.id } })).issueType,
    "SOFTWARE_SYSTEM",
  );
  const same = await checkInFixture();
  assert.equal(
    (
      await postCheckIn([same.id], staffCookie, [
        { registrationId: same.id, issueType: same.issueType },
      ])
    ).status,
    200,
  );
  assert.equal(
    await db.auditLog.count({
      where: {
        action: "repair_activity.registration_issue_type_updated",
        targetId: { in: [row.id, unchanged.id, same.id] },
      },
    }),
    0,
  );
});

dbTest("批量无效客户：不存在 / 跨活动 / 软删 / 已接待均回滚前面的状态、类型与审计", async () => {
  const db = getDb();
  for (const invalid of [
    { id: randomUUID(), code: "ACTIVITY_REGISTRATION_NOT_FOUND" },
    {
      id: (await checkInFixture({ activityId: OTHER_ACTIVITY_ID })).id,
      code: "ACTIVITY_REGISTRATION_NOT_FOUND",
    },
    {
      id: (await checkInFixture({ deletedAt: new Date() })).id,
      code: "ACTIVITY_REGISTRATION_NOT_FOUND",
    },
    {
      id: (await checkInFixture({ status: "SERVED" })).id,
      code: "ACTIVITY_REGISTRATION_STATE_INVALID",
    },
  ]) {
    const valid = await checkInFixture();
    const count = await db.auditLog.count({ where: { actorUserId: STAFF_USER_ID } });
    const result = await postCheckIn([valid.id, invalid.id], staffCookie, [
      { registrationId: valid.id, issueType: "OTHER" },
    ]);
    assert.equal(errorCodeOf(result.json), invalid.code);
    assert.deepEqual(
      await db.repairActivityRegistration.findUniqueOrThrow({ where: { id: valid.id } }),
      valid,
    );
    assert.equal(await db.auditLog.count({ where: { actorUserId: STAFF_USER_ID } }), count);
  }
});

dbTest("并发类型签到：只有第一份提交生效，第二份不能覆盖已入队客户", async () => {
  const db = getDb();
  const row = await checkInFixture();
  const results = await Promise.all(
    ["OTHER", "SOFTWARE_SYSTEM"].map((issueType) =>
      postCheckIn([row.id], staffCookie, [{ registrationId: row.id, issueType }]),
    ),
  );
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const winner = results.find((result) => result.status === 200)!;
  const saved = await db.repairActivityRegistration.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(
    saved.issueType,
    (winner.json.data as { checkedIn: Array<{ issueType: string }> }).checkedIn[0].issueType,
  );
  assert.equal(
    await db.auditLog.count({
      where: { action: "repair_activity.registration_issue_type_updated", targetId: row.id },
    }),
    1,
  );
});

dbTest("真实签到路由拒绝错误 updates，权限 / 出勤 / 截止闸门不允许写类型", async () => {
  const db = getDb();
  const row = await checkInFixture();
  const second = await checkInFixture();
  const updates = [{ registrationId: row.id, issueType: "OTHER" }];
  const auditCount = await db.auditLog.count({ where: { actorUserId: STAFF_USER_ID } });
  for (const invalid of [
    null,
    {},
    "x",
    [null],
    [{ registrationId: row.id, issueType: "BAD" }],
    [{ registrationId: randomUUID(), issueType: "OTHER" }],
    [...updates, ...updates],
    Array(3).fill(updates[0]),
  ]) {
    const result = await postCheckIn([row.id, second.id], staffCookie, invalid);
    assert.equal(result.status, 400, JSON.stringify(result.json));
    assert.equal(errorCodeOf(result.json), "VALIDATION_FAILED");
  }
  const absent = await postCheckIn([row.id], absentCookie, updates);
  assert.equal(errorCodeOf(absent.json), "ACTIVITY_ATTENDANCE_REQUIRED");
  assert.equal((await postCheckIn([row.id], "", updates)).status, 401);
  await assert.rejects(
    () =>
      repairActivityStaffService.checkIn(
        ACTIVITY_ID,
        [row.id],
        { ...staffActor, permissions: [] },
        [{ registrationId: row.id, issueType: "OTHER" }],
      ),
    { code: "FORBIDDEN" },
  );
  await db.memberProfile.update({ where: { id: STAFF_PROFILE_ID }, data: { status: "REVOKED" } });
  try {
    await assert.rejects(
      () =>
        repairActivityStaffService.checkIn(ACTIVITY_ID, [row.id], staffActor, [
          { registrationId: row.id, issueType: "OTHER" },
        ]),
      { code: "MEMBER_REQUIRED" },
    );
  } finally {
    await db.memberProfile.update({ where: { id: STAFF_PROFILE_ID }, data: { status: "ACTIVE" } });
  }
  const activity = await db.repairActivity.findUniqueOrThrow({ where: { id: ACTIVITY_ID } });
  await db.repairActivity.update({
    where: { id: ACTIVITY_ID },
    data: { signupClosesAt: new Date(Date.now() + 60_000) },
  });
  try {
    assert.equal(
      errorCodeOf((await postCheckIn([row.id], staffCookie, updates)).json),
      "ACTIVITY_NOT_OPEN",
    );
  } finally {
    await db.repairActivity.update({
      where: { id: ACTIVITY_ID },
      data: { signupClosesAt: activity.signupClosesAt },
    });
  }
  assert.deepEqual(
    await db.repairActivityRegistration.findUniqueOrThrow({ where: { id: row.id } }),
    row,
  );
  assert.equal(await db.auditLog.count({ where: { actorUserId: STAFF_USER_ID } }), auditCount);
});

dbTest("签到入队成功：状态与 checkedInAt 落库，签到审计记录本次 registrationIds", async () => {
  const registrationId = await signUpRegistration("REG79 甲", "13900000021");

  const checkedIn = await postCheckIn([registrationId]);
  assert.equal(checkedIn.status, 200, JSON.stringify(checkedIn.json));
  const data = checkedIn.json.data as {
    checkedIn: Array<{ id: string; status: string; checkedInAt: string | null }>;
  };
  assert.equal(data.checkedIn.length, 1);
  assert.equal(data.checkedIn[0].id, registrationId);
  assert.equal(data.checkedIn[0].status, "CHECKED_IN");
  assert.ok(data.checkedIn[0].checkedInAt, "签到后应记录入队时间");

  const row = await getDb().repairActivityRegistration.findUniqueOrThrow({
    where: { id: registrationId },
  });
  assert.equal(row.status, "CHECKED_IN");
  assert.ok(row.checkedInAt);

  const audits = await getDb().auditLog.findMany({
    where: {
      action: "repair_activity.registrations_checked_in",
      actorUserId: STAFF_USER_ID,
      targetId: ACTIVITY_ID,
    },
  });
  assert.ok(
    audits.some((audit) => {
      const ids =
        (audit.afterSummary as { registrationIds?: string[] } | null)?.registrationIds ?? [];
      return ids.includes(registrationId);
    }),
    "签到审计应带上本次的 registrationIds",
  );
});

dbTest("撤回后回到待签到：状态、checkedInAt 与出勤 / 签到 / 撤回三条审计对齐", async () => {
  const registrationId = await signUpRegistration("REG79 乙", "13900000022");
  const checkedIn = await postCheckIn([registrationId]);
  assert.equal(checkedIn.status, 200, JSON.stringify(checkedIn.json));

  const withdrawn = await postWithdraw(registrationId);
  assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.json));
  const data = withdrawn.json.data as {
    id: string;
    status: string;
    checkedInAt: string | null;
    servedAt: string | null;
  };
  assert.equal(data.status, "REGISTERED");
  assert.equal(data.checkedInAt, null);
  assert.equal(data.servedAt, null);

  const row = await getDb().repairActivityRegistration.findUniqueOrThrow({
    where: { id: registrationId },
  });
  assert.equal(row.status, "REGISTERED");
  assert.equal(row.checkedInAt, null);

  const db = getDb();
  // 1. 出勤审计（before 里标记出勤时写入）。
  const attendanceAudit = await db.auditLog.findFirst({
    where: {
      action: "repair_activity.attendance_marked",
      actorUserId: STAFF_USER_ID,
      targetType: "RepairActivityAttendance",
    },
  });
  assert.ok(attendanceAudit, "出勤审计应存在");
  assert.equal(
    (attendanceAudit.afterSummary as { activityId?: string } | null)?.activityId,
    ACTIVITY_ID,
  );
  // 2. 签到审计：本次 registrationIds 包含这条。
  const checkInAudits = await db.auditLog.findMany({
    where: {
      action: "repair_activity.registrations_checked_in",
      actorUserId: STAFF_USER_ID,
      targetId: ACTIVITY_ID,
    },
  });
  assert.ok(
    checkInAudits.some((audit) => {
      const ids =
        (audit.afterSummary as { registrationIds?: string[] } | null)?.registrationIds ?? [];
      return ids.includes(registrationId);
    }),
    "签到审计应包含本条报名",
  );
  // 3. 撤回审计：before/after 与状态变化对齐。
  const withdrawAudit = await db.auditLog.findFirst({
    where: {
      action: "repair_activity.registration_withdrawn",
      targetType: "RepairActivityRegistration",
      targetId: registrationId,
    },
  });
  assert.ok(withdrawAudit, "撤回审计应存在");
  assert.deepEqual(withdrawAudit.beforeSummary, { status: "CHECKED_IN" });
  assert.deepEqual(withdrawAudit.afterSummary, {
    status: "REGISTERED",
    memberProfileId: STAFF_PROFILE_ID,
  });
});

dbTest("SERVED 不可撤回：409 ACTIVITY_REGISTRATION_STATE_INVALID，状态保持 SERVED", async () => {
  const registrationId = await signUpRegistration("REG79 丙", "13900000023");
  const checkedIn = await postCheckIn([registrationId]);
  assert.equal(checkedIn.status, 200, JSON.stringify(checkedIn.json));
  await repairActivityStaffService.serve(ACTIVITY_ID, registrationId, staffActor);

  const withdrawn = await postWithdraw(registrationId);
  assert.equal(withdrawn.status, 409, JSON.stringify(withdrawn.json));
  assert.equal(errorCodeOf(withdrawn.json), "ACTIVITY_REGISTRATION_STATE_INVALID");

  const row = await getDb().repairActivityRegistration.findUniqueOrThrow({
    where: { id: registrationId },
  });
  assert.equal(row.status, "SERVED", "被拒绝的撤回不应改动状态");
});

dbTest("未标记出勤：403 ACTIVITY_ATTENDANCE_REQUIRED，报名状态不变", async () => {
  const registrationId = await signUpRegistration("REG79 丁", "13900000024");

  const result = await postCheckIn([registrationId], absentCookie);
  assert.equal(result.status, 403, JSON.stringify(result.json));
  assert.equal(errorCodeOf(result.json), "ACTIVITY_ATTENDANCE_REQUIRED");

  const row = await getDb().repairActivityRegistration.findUniqueOrThrow({
    where: { id: registrationId },
  });
  assert.equal(row.status, "REGISTERED");
  assert.equal(row.checkedInAt, null);
});

dbTest("非本活动报名：404 ACTIVITY_REGISTRATION_NOT_FOUND", async () => {
  const otherRegistration = await getDb().repairActivityRegistration.findFirstOrThrow({
    where: { activityId: OTHER_ACTIVITY_ID },
    select: { id: true },
  });

  const result = await postCheckIn([otherRegistration.id]);
  assert.equal(result.status, 404, JSON.stringify(result.json));
  assert.equal(errorCodeOf(result.json), "ACTIVITY_REGISTRATION_NOT_FOUND");

  const row = await getDb().repairActivityRegistration.findUniqueOrThrow({
    where: { id: otherRegistration.id },
  });
  assert.equal(row.status, "REGISTERED", "被拒绝的签到不应改动别处的报名");
});

dbTest("报名未截止：出勤、签到、接待均拒绝，已有出勤也不可绕过", async () => {
  const db = getDb();
  const registrationId = await signUpRegistration("REG79 闸门", "13900000025");
  const checkedIn = await postCheckIn([registrationId]);
  assert.equal(checkedIn.status, 200);
  const beforeRow = await db.repairActivityRegistration.findUniqueOrThrow({
    where: { id: registrationId },
  });
  const auditCount = await db.auditLog.count({ where: { actorUserId: STAFF_USER_ID } });
  const activity = await db.repairActivity.findUniqueOrThrow({ where: { id: ACTIVITY_ID } });
  try {
    for (const phase of ["OPEN", "FULL", "UPCOMING"] as const) {
      const count = await db.repairActivityRegistration.count({
        where: { activityId: ACTIVITY_ID, deletedAt: null },
      });
      await db.repairActivity.update({
        where: { id: ACTIVITY_ID },
        data: {
          signupOpensAt: new Date(Date.now() + (phase === "UPCOMING" ? 60_000 : -60_000)),
          signupClosesAt: new Date(Date.now() + 120_000),
          capacity: phase === "FULL" ? count : 100,
        },
      });
      assert.equal(
        (await repairActivityStaffService.getBoard(ACTIVITY_ID, staffActor)).activity.status,
        phase,
      );
      for (const [route, action, body, cookie] of [
        [POST_ATTENDANCE, "attendance", {}, staffCookie],
        [POST_ATTENDANCE, "attendance", {}, absentCookie],
        [POST_CHECK_IN, "check-in", { registrationIds: [registrationId] }, staffCookie],
        [POST_SERVE, "serve", { registrationId }, staffCookie],
      ] as const) {
        const result = await callRoute(
          route,
          `http://localhost/api/v1/member/repair-activities/${ACTIVITY_ID}/${action}`,
          {
            method: "POST",
            body,
            params: { id: ACTIVITY_ID },
            headers: { cookie },
          },
        );
        assert.equal(result.status, 409, `${phase} ${action}: ${JSON.stringify(result.json)}`);
        assert.equal(errorCodeOf(result.json), "ACTIVITY_NOT_OPEN");
      }
    }
    assert.deepEqual(
      await db.repairActivityRegistration.findUniqueOrThrow({
        where: { id: registrationId },
      }),
      beforeRow,
      "被拒绝的操作不得更改报名或生成维修记录",
    );
    assert.equal(
      await db.repairActivityAttendance.count({
        where: { activityId: ACTIVITY_ID, memberProfileId: ABSENT_STAFF_PROFILE_ID },
      }),
      0,
    );
    assert.equal(await db.auditLog.count({ where: { actorUserId: STAFF_USER_ID } }), auditCount);
  } finally {
    await db.repairActivity.update({
      where: { id: ACTIVITY_ID },
      data: {
        signupOpensAt: activity.signupOpensAt,
        signupClosesAt: activity.signupClosesAt,
        capacity: activity.capacity,
      },
    });
  }
});
