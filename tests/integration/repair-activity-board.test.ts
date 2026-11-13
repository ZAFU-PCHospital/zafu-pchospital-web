import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { POST as POST_CHECK_IN } from "../../src/app/api/v1/member/repair-activities/[id]/check-in/route";
import { GET as GET_BOARD } from "../../src/app/api/v1/member/repair-activities/[id]/board/route";
import { POST as POST_ATTENDANCE } from "../../src/app/api/v1/member/repair-activities/[id]/attendance/route";
import { POST as POST_SERVE } from "../../src/app/api/v1/member/repair-activities/[id]/serve/route";
import { POST as POST_WITHDRAW } from "../../src/app/api/v1/member/repair-activities/[id]/withdraw/route";
import { GET as GET_PHONE } from "../../src/app/api/v1/member/repair-activities/[id]/registrations/[registrationId]/phone/route";
import { POST as POST_REGISTRATION } from "../../src/app/api/v1/repair-activities/[id]/registrations/route";
import { repairActivityStaffService } from "../../src/features/repair-activities/repair-activity-staff-service";
import { repairActivityService } from "../../src/features/repair-activities/repair-activity-service";
import { resetRateLimitsForTests } from "../../src/lib/api/rate-limit";
import { shanghaiToday } from "../../src/lib/shanghai-date";
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
 * 成员接待台「签到入队 / 撤回」的集成测试（-3，真实 GreatSQL）。
 *
 * 前端为批量签到加了二次确认（纯客户端），本条链路仍必须打到真实路由才有意义：
 * 出勤校验（403）→ 签到入队（REGISTERED → CHECKED_IN）→ 撤回（CHECKED_IN →
 * REGISTERED，清空 checkedInAt）→ 已接待不可撤回（409）；以及「非本活动报名 404」。
 * 状态与审计必须同时对齐 —— 服务层用事务写状态 + `appendAuditLog`，只查状态无法
 * 发现审计漏写。
 *
 *  起签到 / 撤回收紧为 `activity:admin`（成员调路由 = 403），看板按
 * `canAdmin` 决定是否下发「待签到」并给出角色开关；本文件补上这两条的服务端断言。
 *
 *  起看板向管理员下发 `attendanceMembers`（出勤名单：排序 / 展示名回退 /
 * 成员恒空数组），同样在本文件钉住。
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
/** 未标记出勤的接待员（普通成员视角：读电话、成员 403 用例用）。 */
const ABSENT_STAFF_USER_ID = "e7900000-0000-4000-8000-000000000006";
const ABSENT_STAFF_PROFILE_ID = "e7900000-0000-4000-8000-000000000007";
/** 未标记出勤的管理员（签到 / 撤回收紧为 activity:admin 后的出勤 403 用例用）。 */
const ABSENT_ADMIN_USER_ID = "e7900000-0000-4000-8000-000000000008";
const ABSENT_ADMIN_PROFILE_ID = "e7900000-0000-4000-8000-000000000009";
/** 出勤名单用例：签到时间早于接待员的第二位出勤成员（排序 / 名字解析用）。 */
const EARLY_USER_ID = "e7900000-0000-4000-8000-000000000010";
const EARLY_PROFILE_ID = "e7900000-0000-4000-8000-000000000011";

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
  // 接待台动作的审计以活动为 target，直接按 actor 兜底清一次（四位接待账号）。
  await db.auditLog.deleteMany({
    where: {
      actorUserId: {
        in: [STAFF_USER_ID, ABSENT_STAFF_USER_ID, ABSENT_ADMIN_USER_ID, EARLY_USER_ID],
      },
    },
  });

  await db.repairActivityRegistration.deleteMany({ where: { activityId: { in: activityIds } } });
  await db.repairActivityAttendance.deleteMany({ where: { activityId: { in: activityIds } } });
  if (recordIds.length > 0) {
    // 参与行先于记录删除：接待落单的记录带创建人参与行。
    await db.repairRecordParticipant.deleteMany({ where: { repairRecordId: { in: recordIds } } });
    await db.repairRecord.deleteMany({ where: { id: { in: recordIds } } });
  }
  await db.repairActivity.deleteMany({ where: { id: { in: activityIds } } });
  await db.memberProfile.deleteMany({
    where: {
      id: {
        in: [STAFF_PROFILE_ID, ABSENT_STAFF_PROFILE_ID, ABSENT_ADMIN_PROFILE_ID, EARLY_PROFILE_ID],
      },
    },
  });
  await db.authSession.deleteMany({
    where: { userId: { in: [STAFF_USER_ID, ABSENT_STAFF_USER_ID, ABSENT_ADMIN_USER_ID] } },
  });
  await db.passwordCredential.deleteMany({
    where: { userId: { in: [STAFF_USER_ID, ABSENT_STAFF_USER_ID, ABSENT_ADMIN_USER_ID] } },
  });
  await db.userRole.deleteMany({
    where: { userId: { in: [STAFF_USER_ID, ABSENT_STAFF_USER_ID, ABSENT_ADMIN_USER_ID] } },
  });
  await db.user.deleteMany({
    where: {
      id: { in: [STAFF_USER_ID, ABSENT_STAFF_USER_ID, ABSENT_ADMIN_USER_ID, EARLY_USER_ID] },
    },
  });
}

/**
 * 活动建在「报名窗口内、名额未满」——只有 OPEN 才报得上名。
 * 三位接待账号各有 ACTIVE 成员档案：`activity:staff` 的动作都要求「用户 ↔ 成员档案」。
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
    [ABSENT_ADMIN_USER_ID, "REG79 未出勤管理员"],
  ] as const) {
    await db.user.create({
      data: { id: userId, status: "ACTIVE", displayName, createdAt: now, updatedAt: now },
    });
  }
  for (const [profileId, userId, realName] of [
    [STAFF_PROFILE_ID, STAFF_USER_ID, "REG79 接待员"],
    [ABSENT_STAFF_PROFILE_ID, ABSENT_STAFF_USER_ID, "REG79 未出勤接待员"],
    [ABSENT_ADMIN_PROFILE_ID, ABSENT_ADMIN_USER_ID, "REG79 未出勤管理员"],
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
let absentAdminCookie = "";

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
    data: { activityAt: new Date(), signupClosesAt: new Date(Date.now() - 1_000) },
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
    data: { activityAt: new Date(), signupClosesAt: new Date(Date.now() - 1_000) },
  });
  // 主接待员先标记出勤（幂等）；「未出勤 403」用例用另两位未出勤账号（成员 / 管理员）。
  await repairActivityStaffService.markAttendance(ACTIVITY_ID, staffActor);
  staffCookie = await sessionCookie(STAFF_USER_ID, "ADMIN");
  absentCookie = await sessionCookie(ABSENT_STAFF_USER_ID, "MEMBER");
  absentAdminCookie = await sessionCookie(ABSENT_ADMIN_USER_ID, "ADMIN");
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
  const initialQueue = (await repairActivityService.getPublicQueue(ACTIVITY_ID)).waitingCount!;
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
  assert.equal(
    (await repairActivityService.getPublicQueue(ACTIVITY_ID)).waitingCount,
    initialQueue + 2,
  );
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
  assert.equal(
    (await repairActivityService.getPublicQueue(ACTIVITY_ID)).waitingCount,
    initialQueue + 1,
  );
  // 签到 / 撤回收紧为 activity:admin，普通成员调用一律 403。
  const memberActor = { ...staffActor, permissions: permissionsForRoles(["MEMBER"]) };
  await assert.rejects(
    () => repairActivityStaffService.checkIn(ACTIVITY_ID, [first.id], memberActor),
    { code: "FORBIDDEN" },
  );
  await assert.rejects(
    () => repairActivityStaffService.withdraw(ACTIVITY_ID, first.id, memberActor),
    { code: "FORBIDDEN" },
  );
  // 成员仍可接待：serve 保持 activity:staff。 起接待只占登记行，不建草稿。
  await repairActivityStaffService.checkIn(ACTIVITY_ID, [first.id], staffActor);
  const served = await repairActivityStaffService.serve(ACTIVITY_ID, first.id, memberActor);
  assert.equal(
    (await repairActivityService.getPublicQueue(ACTIVITY_ID)).waitingCount,
    initialQueue + 1,
  );
  assert.equal(served.registration.repairRecordId, null, "接待不再创建维修草稿");
  const prefill = await repairActivityStaffService.getServePrefill(
    ACTIVITY_ID,
    first.id,
    memberActor,
  );
  assert.ok(prefill.categoryId, "故障类型应映射到启用中的分类");
  const record = await repairActivityStaffService.createServeRecord(
    ACTIVITY_ID,
    first.id,
    {
      idempotencyKey: `activity-serve:${first.id}`,
      fields: {
        repairDate: shanghaiToday(),
        durationMinutes: 30,
        categoryId: prefill.categoryId,
        ownerName: prefill.name,
        ownerPhone: prefill.phone,
        deviceModel: prefill.deviceModel,
        remark: "REG79 补单",
        result: "COMPLETED",
        participantIds: [],
      },
    },
    memberActor,
  );
  assert.equal(record.status, "PENDING");
  assert.equal(record.category?.id, prefill.categoryId);
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
  const absent = await postCheckIn([row.id], absentAdminCookie, updates);
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
    await assert.rejects(() => repairActivityStaffService.markAttendance(ACTIVITY_ID, staffActor), {
      code: "MEMBER_REQUIRED",
    });
  } finally {
    await db.memberProfile.update({ where: { id: STAFF_PROFILE_ID }, data: { status: "ACTIVE" } });
  }
  const activity = await db.repairActivity.findUniqueOrThrow({ where: { id: ACTIVITY_ID } });
  await db.repairActivity.update({
    where: { id: ACTIVITY_ID },
    data: {
      activityAt: new Date(Date.now() + 86_400_000),
      signupClosesAt: new Date(Date.now() + 60_000),
    },
  });
  try {
    assert.equal(
      errorCodeOf((await postCheckIn([row.id], staffCookie, updates)).json),
      "ACTIVITY_NOT_OPEN",
    );
  } finally {
    await db.repairActivity.update({
      where: { id: ACTIVITY_ID },
      data: { activityAt: activity.activityAt, signupClosesAt: activity.signupClosesAt },
    });
  }
  assert.deepEqual(
    await db.repairActivityRegistration.findUniqueOrThrow({ where: { id: row.id } }),
    row,
  );
  assert.equal(await db.auditLog.count({ where: { actorUserId: STAFF_USER_ID } }), auditCount);
});

dbTest("看板按角色下发：canAdmin 决定待签到与写权限，成员签到 / 撤回 403", async () => {
  const row = await checkInFixture();
  const adminBoard = await repairActivityStaffService.getBoard(ACTIVITY_ID, staffActor);
  assert.equal(adminBoard.canAdmin, true);
  assert.ok(adminBoard.eligible.some((item) => item.id === row.id));

  // 服务层：成员拿到的看板 canAdmin=false 且 eligible 恒为空（待签到不下发）。
  const memberActor = { ...staffActor, permissions: permissionsForRoles(["MEMBER"]) };
  const memberBoard = await repairActivityStaffService.getBoard(ACTIVITY_ID, memberActor);
  assert.equal(memberBoard.canAdmin, false);
  assert.deepEqual(memberBoard.eligible, []);

  // 路由层：成员读看板 200，信封里同样不下发待签到。
  const memberBoardRoute = await callRoute(
    GET_BOARD,
    `http://localhost/api/v1/member/repair-activities/${ACTIVITY_ID}/board`,
    { params: { id: ACTIVITY_ID }, headers: { cookie: absentCookie } },
  );
  assert.equal(memberBoardRoute.status, 200, JSON.stringify(memberBoardRoute.json));
  const memberBoardData = memberBoardRoute.json.data as {
    canAdmin: boolean;
    eligible: unknown[];
  };
  assert.equal(memberBoardData.canAdmin, false);
  assert.deepEqual(memberBoardData.eligible, []);

  // 路由层：普通成员（activity:staff、未出勤）签到 / 撤回先撞权限 = 403 FORBIDDEN。
  for (const result of [
    await postCheckIn([row.id], absentCookie),
    await postWithdraw(row.id, absentCookie),
  ]) {
    assert.equal(result.status, 403, JSON.stringify(result.json));
    assert.equal(errorCodeOf(result.json), "FORBIDDEN");
  }
  const saved = await getDb().repairActivityRegistration.findUniqueOrThrow({
    where: { id: row.id },
  });
  assert.equal(saved.status, "REGISTERED");
  assert.equal(saved.checkedInAt, null);
});

dbTest("看板合并读取：复用管理员计数和本人出勤，成员不读取待签到资料", async (t) => {
  const db = getDb();
  const row = await checkInFixture();
  await checkInFixture({ status: "CHECKED_IN" });
  const foreignServed = await checkInFixture({ status: "SERVED" });
  const count = await db.repairActivityRegistration.count({
    where: {
      activityId: ACTIVITY_ID,
      deletedAt: null,
      status: { in: ["REGISTERED", "CHECKED_IN", "SERVED"] },
    },
  });
  const registrationRead: NonNullable<
    Parameters<typeof db.repairActivityRegistration.findMany>[0]
  >[] = [];
  const calls = { count: 0, self: 0, attendance: 0 };
  // Query extension 只计数，所有 query(args) 仍走真实 GreatSQL，不替换读取结果。
  const observed = db.$extends({
    query: {
      repairActivityRegistration: {
        findMany({ args, query }) {
          registrationRead.push(args);
          return query(args);
        },
        count({ args, query }) {
          calls.count++;
          return query(args);
        },
      },
      repairActivityAttendance: {
        findUnique({ args, query }) {
          calls.self++;
          return query(args);
        },
        findMany({ args, query }) {
          calls.attendance++;
          return query(args);
        },
      },
    },
  });
  const holder = globalThis as unknown as { __pcHospitalDb?: typeof db };
  holder.__pcHospitalDb = observed as unknown as typeof db;
  t.after(() => {
    holder.__pcHospitalDb = db;
  });
  const admin = await repairActivityStaffService.getBoard(ACTIVITY_ID, staffActor);
  assert.equal(registrationRead.length, 1);
  assert.deepEqual(calls, { count: 0, self: 0, attendance: 1 });
  assert.equal(admin.activity.registeredCount, count);
  assert.ok(admin.eligible.some((item) => item.id === row.id));
  assert.equal(admin.attended, true);
  assert.equal(
    admin.attendanceCheckedInAt,
    admin.attendanceMembers.find((item) => item.memberProfileId === STAFF_PROFILE_ID)!.checkedInAt,
  );

  const member = await repairActivityStaffService.getBoard(ACTIVITY_ID, {
    ...staffActor,
    permissions: permissionsForRoles(["MEMBER"]),
  });
  assert.equal(registrationRead.length, 2);
  const filter = registrationRead[1]!.where!;
  // 成员在库层只取排队 + 本人接待，不再按「CHECKED_IN / SERVED」整体读取。
  assert.equal(filter.status, undefined);
  assert.deepEqual((filter as { OR?: unknown }).OR, [
    { status: "CHECKED_IN" },
    { status: "SERVED", servedByMemberProfileId: STAFF_PROFILE_ID },
  ]);
  assert.deepEqual(calls, { count: 1, self: 1, attendance: 1 });
  assert.equal(member.activity.registeredCount, count);
  assert.equal(member.attendanceCheckedInAt, admin.attendanceCheckedInAt);
  assert.deepEqual(member.eligible, []);
  assert.deepEqual(member.attendanceMembers, []);
  assert.deepEqual(member.queue, admin.queue);
  // 没有接待归属的 SERVED 不下发给成员；成员列表是管理员全量的子集且都属于本人。
  assert.equal(
    member.served.some((item) => item.id === foreignServed.id),
    false,
    "未记录接待者的已接待记录不得下发给成员",
  );
  assert.ok(
    member.served.every((item) => admin.served.some((full) => full.id === item.id)),
    "成员列表只能是管理员全量的子集",
  );
  if (member.served.length > 0) {
    const owners = await db.repairActivityRegistration.findMany({
      where: { id: { in: member.served.map((item) => item.id) } },
      select: { servedByMemberProfileId: true },
    });
    assert.ok(
      owners.every((item) => item.servedByMemberProfileId === STAFF_PROFILE_ID),
      "成员拿到的已接待记录必须都是本人接待",
    );
  }
});

dbTest("出勤成员名单：管理员按签到时间升序拿到展示名，成员不下发（issue #107）", async () => {
  const db = getDb();
  const now = new Date();
  // 第二位出勤成员：昵称优先于实名的解析路径；档案刻意置为 REVOKED ——
  // 名单口径是「出勤记录」而非「当前有效成员」，与管理端 `attendedCount` 计数一致
  // （数据行保留，界面据此还原历史场次）。
  await db.user.create({
    data: {
      id: EARLY_USER_ID,
      status: "ACTIVE",
      displayName: "REG79 早到账号名",
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.memberProfile.create({
    data: {
      id: EARLY_PROFILE_ID,
      userId: EARLY_USER_ID,
      realName: "REG79 早到实名",
      nickname: "REG79 早到昵称",
      status: "REVOKED",
      joinedAt: now,
      createdAt: now,
    },
  });
  await db.repairActivityAttendance.create({
    data: {
      id: randomUUID(),
      activityId: ACTIVITY_ID,
      memberProfileId: EARLY_PROFILE_ID,
      checkedInAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    },
  });

  // 服务层：早到成员在前；名字走 `nickname → realName` 回退链（昵称存在时压过实名，
  // 账号 displayName 永不外泄）；行形状钉死为三键，不带任何身份字段。
  const board = await repairActivityStaffService.getBoard(ACTIVITY_ID, staffActor);
  assert.deepEqual(
    board.attendanceMembers.map((row) => row.name),
    ["REG79 早到昵称", "REG79 接待员"],
  );
  assert.equal(board.attendanceMembers[0].memberProfileId, EARLY_PROFILE_ID);
  assert.ok(
    board.attendanceMembers[0].checkedInAt < board.attendanceMembers[1].checkedInAt,
    "ISO 字符串应可直接字典序比较（同为 UTC Z 格式）",
  );
  assert.deepEqual(Object.keys(board.attendanceMembers[0]).sort(), [
    "checkedInAt",
    "memberProfileId",
    "name",
  ]);
  assert.equal(JSON.stringify(board).includes("REG79 早到账号名"), false);

  // 路由层：管理员信封带回同一名单；成员（activity:staff）读到空数组。
  const adminRoute = await callRoute(
    GET_BOARD,
    `http://localhost/api/v1/member/repair-activities/${ACTIVITY_ID}/board`,
    { params: { id: ACTIVITY_ID }, headers: { cookie: staffCookie } },
  );
  assert.equal(adminRoute.status, 200, JSON.stringify(adminRoute.json));
  const adminData = adminRoute.json.data as {
    attendanceMembers: Array<{ memberProfileId: string; name: string; checkedInAt: string }>;
  };
  assert.deepEqual(
    adminData.attendanceMembers.map((row) => row.name),
    ["REG79 早到昵称", "REG79 接待员"],
  );
  const memberRoute = await callRoute(
    GET_BOARD,
    `http://localhost/api/v1/member/repair-activities/${ACTIVITY_ID}/board`,
    { params: { id: ACTIVITY_ID }, headers: { cookie: absentCookie } },
  );
  assert.equal(memberRoute.status, 200, JSON.stringify(memberRoute.json));
  assert.deepEqual(
    (memberRoute.json.data as { attendanceMembers: unknown[] }).attendanceMembers,
    [],
  );
  const memberActor = { ...staffActor, permissions: permissionsForRoles(["MEMBER"]) };
  assert.deepEqual(
    (await repairActivityStaffService.getBoard(ACTIVITY_ID, memberActor)).attendanceMembers,
    [],
  );
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
  // 收尾：撤销这次未建单的接待，避免全局拦截影响后续用例。
  await repairActivityStaffService.revertServe(ACTIVITY_ID, registrationId, staffActor);
});

dbTest("未标记出勤：管理员签到 / 撤回 403 ACTIVITY_ATTENDANCE_REQUIRED，报名状态不变", async () => {
  const registrationId = await signUpRegistration("REG79 丁", "13900000024");

  for (const result of [
    await postCheckIn([registrationId], absentAdminCookie),
    await postWithdraw(registrationId, absentAdminCookie),
  ]) {
    assert.equal(result.status, 403, JSON.stringify(result.json));
    assert.equal(errorCodeOf(result.json), "ACTIVITY_ATTENDANCE_REQUIRED");
  }

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

dbTest("活动签到窗口未开放：出勤、签到、接待均拒绝，已有出勤也不可绕过", async () => {
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
          activityAt: new Date(Date.now() + 86_400_000),
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
        activityAt: activity.activityAt,
        capacity: activity.capacity,
      },
    });
  }
});

dbTest("活动结束：三项写入及幂等重放拒绝，历史看板与撤回误签到保留", async () => {
  const db = getDb();
  const registration = await checkInFixture();
  assert.equal((await postCheckIn([registration.id])).status, 200);
  const beforeRow = await db.repairActivityRegistration.findUniqueOrThrow({
    where: { id: registration.id },
  });
  const attendance = await db.repairActivityAttendance.findMany({
    where: { activityId: ACTIVITY_ID },
    orderBy: { id: "asc" },
  });
  const auditCount = await db.auditLog.count({ where: { actorUserId: STAFF_USER_ID } });
  const recordCount = await db.repairRecord.count({ where: { memberProfileId: STAFF_PROFILE_ID } });
  const activity = await db.repairActivity.findUniqueOrThrow({ where: { id: ACTIVITY_ID } });
  const repeated = await repairActivityStaffService.markAttendance(ACTIVITY_ID, staffActor);
  assert.equal(
    repeated.checkedInAt,
    attendance.find((row) => row.memberProfileId === STAFF_PROFILE_ID)!.checkedInAt.toISOString(),
    "窗口内重复出勤保留原时间",
  );
  assert.equal(await db.auditLog.count({ where: { actorUserId: STAFF_USER_ID } }), auditCount);
  try {
    const yesterday = new Date(Date.now() - 86_400_000);
    await db.repairActivity.update({
      where: { id: ACTIVITY_ID },
      data: {
        activityAt: yesterday,
        signupClosesAt: new Date(yesterday.getTime() - 3_600_000),
        signupOpensAt: new Date(yesterday.getTime() - 7_200_000),
      },
    });
    for (const [route, action, body, cookie] of [
      [POST_ATTENDANCE, "attendance", {}, absentCookie],
      [POST_ATTENDANCE, "attendance", {}, staffCookie],
      [POST_CHECK_IN, "check-in", { registrationIds: [registration.id] }, staffCookie],
      [POST_SERVE, "serve", { registrationId: registration.id }, staffCookie],
    ] as const) {
      const result = await callRoute(
        route,
        `http://localhost/api/v1/member/repair-activities/${ACTIVITY_ID}/${action}`,
        { method: "POST", body, params: { id: ACTIVITY_ID }, headers: { cookie } },
      );
      assert.equal(result.status, 404, `${action}: ${JSON.stringify(result.json)}`);
      assert.equal(errorCodeOf(result.json), "ACTIVITY_ENDED");
    }
    assert.deepEqual(
      await db.repairActivityAttendance.findMany({
        where: { activityId: ACTIVITY_ID },
        orderBy: { id: "asc" },
      }),
      attendance,
      "不得新增出勤或重写原出勤时间",
    );
    assert.deepEqual(
      await db.repairActivityRegistration.findUniqueOrThrow({ where: { id: registration.id } }),
      beforeRow,
    );
    assert.equal(await db.auditLog.count({ where: { actorUserId: STAFF_USER_ID } }), auditCount);
    assert.equal(
      await db.repairRecord.count({ where: { memberProfileId: STAFF_PROFILE_ID } }),
      recordCount,
    );
    const board = await callRoute(
      GET_BOARD,
      `http://localhost/api/v1/member/repair-activities/${ACTIVITY_ID}/board`,
      { params: { id: ACTIVITY_ID }, headers: { cookie: staffCookie } },
    );
    assert.equal(board.status, 200);
    const data = board.json.data as {
      activity: { status: string };
      attended: boolean;
      queue: { id: string }[];
    };
    assert.equal(data.activity.status, "ENDED");
    assert.equal(data.attended, true);
    assert.ok(data.queue.some((row) => row.id === registration.id));
    const withdrawn = await postWithdraw(registration.id);
    assert.equal(withdrawn.status, 200);
    assert.equal((withdrawn.json.data as { status: string }).status, "REGISTERED");
  } finally {
    await db.repairActivity.update({
      where: { id: ACTIVITY_ID },
      data: {
        activityAt: activity.activityAt,
        signupOpensAt: activity.signupOpensAt,
        signupClosesAt: activity.signupClosesAt,
      },
    });
  }
});

dbTest("成员「已接待」只含本人接待；管理员仍看本场全部（issue #207）", async () => {
  const db = getDb();
  const makeServed = async (profileId: string, name: string, offsetMs: number) => {
    const row = await checkInFixture({ status: "SERVED" });
    return db.repairActivityRegistration.update({
      where: { id: row.id },
      data: {
        name,
        servedAt: new Date(Date.now() + offsetMs),
        servedByMemberProfileId: profileId,
      },
    });
  };
  // 两位其他成员先各接待一位客户；随后再让本成员接待一位（同时验证空态与本人视图）。
  const staffServed = await makeServed(STAFF_PROFILE_ID, "REG79 管理员接待的客户", -3000);
  const otherServed = await makeServed(
    ABSENT_ADMIN_PROFILE_ID,
    "REG79 另一位管理员接待的客户",
    -2000,
  );
  const queued = await checkInFixture({ status: "CHECKED_IN" });

  const memberActor: AuthorizedActor = {
    actorType: "USER",
    userId: ABSENT_STAFF_USER_ID,
    userStatus: "ACTIVE",
    permissions: permissionsForRoles(["MEMBER"]),
    requestId: "req_reg79_member_served",
  };

  const emptyBoard = await repairActivityStaffService.getBoard(ACTIVITY_ID, memberActor);
  assert.equal(emptyBoard.canAdmin, false);
  assert.deepEqual(emptyBoard.served, [], "本人没有接待记录时为空数组（前端显示空态）");
  const emptyJson = JSON.stringify(emptyBoard);
  assert.equal(emptyJson.includes(staffServed.id), false, "他人接待记录不得出现在成员响应");
  assert.equal(emptyJson.includes(otherServed.id), false);
  assert.ok(
    emptyBoard.queue.some((row) => row.id === queued.id),
    "排队不受已接待过滤影响",
  );

  const mine = await makeServed(ABSENT_STAFF_PROFILE_ID, "REG79 本人接待的客户", -1000);
  const memberBoard = await repairActivityStaffService.getBoard(ACTIVITY_ID, memberActor);
  assert.deepEqual(
    memberBoard.served.map((row) => row.id),
    [mine.id],
    "成员只看本人接待，且计数与列表同源",
  );
  assert.equal(memberBoard.served.length, 1);
  // 增量路径与完整兼容路径遵守同一成员可见范围；live 不下发低频明细。
  const live = await repairActivityStaffService.getLiveBoard(ACTIVITY_ID, memberActor);
  assert.equal(live.servedCount, 1);
  assert.equal(live.attendanceCount, null);
  assert.equal("served" in live, false);
  assert.equal("attendanceMembers" in live, false);
  assert.equal(JSON.stringify(live).includes(otherServed.id), false);
  assert.deepEqual(
    (await repairActivityStaffService.getServedBoard(ACTIVITY_ID, memberActor)).served,
    memberBoard.served,
  );
  assert.ok(memberBoard.queue.some((row) => row.id === queued.id));

  const adminBoard = await repairActivityStaffService.getBoard(ACTIVITY_ID, staffActor);
  assert.equal(adminBoard.canAdmin, true);
  // 同文件早前的用例也会留下 SERVED 夹具，这里只核对本用例的三条及其相对顺序。
  assert.deepEqual(
    adminBoard.served
      .map((row) => row.id)
      .filter((id) => [mine.id, otherServed.id, staffServed.id].includes(id)),
    [mine.id, otherServed.id, staffServed.id],
    "管理员仍按 servedAt 倒序查看本场全部接待",
  );
  const adminLive = await repairActivityStaffService.getLiveBoard(ACTIVITY_ID, staffActor);
  assert.equal(adminLive.servedCount, adminBoard.served.length);
  assert.equal(adminLive.attendanceCount, adminBoard.attendanceMembers.length);
  assert.deepEqual(adminLive.eligible, adminBoard.eligible);
  assert.deepEqual(adminLive.queue, adminBoard.queue);
  assert.deepEqual(
    (await repairActivityStaffService.getAttendanceBoard(ACTIVITY_ID, staffActor))
      .attendanceMembers,
    adminBoard.attendanceMembers,
  );
  await assert.rejects(
    () => repairActivityStaffService.getAttendanceBoard(ACTIVITY_ID, memberActor),
    (error: unknown) => (error as { code: string }).code === "FORBIDDEN",
  );
});

dbTest("board 增量 Route：视图校验、成员权限、私有缓存与原信封", async () => {
  const route = async (view: string, cookie = staffCookie) => {
    const response = await GET_BOARD(
      new Request(
        `http://localhost/api/v1/member/repair-activities/${ACTIVITY_ID}/board?view=${view}`,
        { headers: { cookie } },
      ),
      { params: Promise.resolve({ id: ACTIVITY_ID }) },
    );
    return { status: response.status, headers: response.headers, json: await response.json() };
  };
  for (const view of ["live", "served", "attendance", "full"]) {
    const result = await route(view);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "private, no-store");
    assert.equal(result.json.success, true);
    assert.ok(result.json.meta);
  }
  const denied = await route("attendance", absentCookie);
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("cache-control"), "private, no-store");
  const invalid = await route("unknown");
  assert.equal(invalid.status, 400);
});
