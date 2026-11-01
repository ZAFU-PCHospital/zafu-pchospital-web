import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { GET as GET_PREFILL } from "../../src/app/api/v1/member/repair-activities/[id]/registrations/[registrationId]/prefill/route";
import { POST as POST_RECORD } from "../../src/app/api/v1/member/repair-activities/[id]/registrations/[registrationId]/record/route";
import { repairActivityStaffService } from "../../src/features/repair-activities/repair-activity-staff-service";
import { localRepairPhotoStorage } from "../../src/features/repairs/repair-photo-storage";
import { AppError, type ApiErrorCode } from "../../src/lib/api/errors";
import { permissionsForRoles } from "../../src/lib/auth/permissions";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import type { AuthorizedActor, RepairView } from "../../src/types/contracts";
import { integrationTestsEnabled } from "./db-guard";
import { callRoute, sessionCookie } from "./http-harness";

const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;

/**
 * 活动接待「不落草稿、提交即建单」的集成测试（真实 GreatSQL）。
 *
 * 覆盖：serve 只占登记行（不建维修单）→ 看板「待补建」/ 全局拦截 →
 * 预填（仅接待者本人、完整电话 + 分类映射 + 审计）→ 提交即建单（校验 / 关联 /
 * 参与人 / 时间线 / 审计 / 幂等 / 并发）→ 撤销接待（仅未建单）→ 路由接线。
 *
 * 独立的 UUID 段 `e7a00000-…` 与姓名前缀 "SERVE221 " —— 清理一律按这两者限定。
 */
const ACTIVITY_ID = "e7a00000-0000-4000-8000-000000000001";
const OTHER_ACTIVITY_ID = "e7a00000-0000-4000-8000-000000000002";
const ACTIVITY_TITLE = "SERVE221 接待补单集成测试活动";
const STAFF_USER_ID = "e7a00000-0000-4000-8000-000000000003";
const STAFF_PROFILE_ID = "e7a00000-0000-4000-8000-000000000004";
const ADMIN_USER_ID = "e7a00000-0000-4000-8000-000000000005";
const ADMIN_PROFILE_ID = "e7a00000-0000-4000-8000-000000000006";
const OTHER_USER_ID = "e7a00000-0000-4000-8000-000000000007";
const OTHER_PROFILE_ID = "e7a00000-0000-4000-8000-000000000008";
const SYSTEM_CATEGORY_ID = "e7a00000-0000-4000-8000-000000000009";
const INACTIVE_USER_ID = "e7a00000-0000-4000-8000-00000000000a";
const INACTIVE_PROFILE_ID = "e7a00000-0000-4000-8000-00000000000b";
const DELETED_USER_ID = "e7a00000-0000-4000-8000-00000000000c";
const DELETED_PROFILE_ID = "e7a00000-0000-4000-8000-00000000000d";
const PREFIX = "SERVE221";

let activityAt = new Date();
let createdSystemCategory = false;
let seq = 0;
let uploadTestRoot = "";

const staffActor: AuthorizedActor = {
  actorType: "USER",
  userId: STAFF_USER_ID,
  userStatus: "ACTIVE",
  permissions: permissionsForRoles(["MEMBER"]),
  requestId: "req_serve221_staff",
};
const adminActor: AuthorizedActor = {
  actorType: "USER",
  userId: ADMIN_USER_ID,
  userStatus: "ACTIVE",
  permissions: permissionsForRoles(["ADMIN"]),
  requestId: "req_serve221_admin",
};
const otherActor: AuthorizedActor = {
  actorType: "USER",
  userId: OTHER_USER_ID,
  userStatus: "ACTIVE",
  permissions: permissionsForRoles(["MEMBER"]),
  requestId: "req_serve221_other",
};

async function expectCode(run: () => Promise<unknown>, code: ApiErrorCode): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assert.equal(error instanceof AppError, true, `期望 AppError，实际 ${String(error)}`);
    assert.equal((error as AppError).code, code);
    return true;
  });
}

async function cleanupFixtures(): Promise<void> {
  const db = getDb();
  const activityIds = [ACTIVITY_ID, OTHER_ACTIVITY_ID];
  const profileIds = [
    STAFF_PROFILE_ID,
    ADMIN_PROFILE_ID,
    OTHER_PROFILE_ID,
    INACTIVE_PROFILE_ID,
    DELETED_PROFILE_ID,
  ];
  const userIds = [STAFF_USER_ID, ADMIN_USER_ID, OTHER_USER_ID, INACTIVE_USER_ID, DELETED_USER_ID];
  const registrations = await db.repairActivityRegistration.findMany({
    where: { activityId: { in: activityIds } },
    select: { id: true, repairRecordId: true },
  });
  const registrationIds = registrations.map((row) => row.id);
  const records = await db.repairRecord.findMany({
    where: {
      OR: [
        { memberProfileId: { in: profileIds } },
        { createRequestKey: { startsWith: "serve221-" } },
      ],
    },
    select: { id: true },
  });
  const recordIds = [
    ...new Set([
      ...records.map((row) => row.id),
      ...registrations.flatMap((row) => (row.repairRecordId ? [row.repairRecordId] : [])),
    ]),
  ];
  const attendanceIds = (
    await db.repairActivityAttendance.findMany({
      where: { activityId: { in: activityIds } },
      select: { id: true },
    })
  ).map((row) => row.id);

  await db.notification.deleteMany({
    where: { OR: [{ repairRecordId: { in: recordIds } }] },
  });
  await db.repairFavorite.deleteMany({ where: { repairRecordId: { in: recordIds } } });
  await db.commentMention.deleteMany({ where: { comment: { repairRecordId: { in: recordIds } } } });
  await db.repairComment.deleteMany({ where: { repairRecordId: { in: recordIds } } });
  await db.repairTimelineEvent.deleteMany({ where: { repairRecordId: { in: recordIds } } });
  await db.repairReview.deleteMany({ where: { repairRecordId: { in: recordIds } } });
  await db.repairRecordParticipant.deleteMany({ where: { repairRecordId: { in: recordIds } } });
  await db.repairPhoto.deleteMany({ where: { repairRecordId: { in: recordIds } } });
  await db.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await db.auditLog.deleteMany({
    where: { targetType: "RepairRecord", targetId: { in: recordIds } },
  });
  await db.auditLog.deleteMany({
    where: { targetType: "RepairActivityRegistration", targetId: { in: registrationIds } },
  });
  await db.auditLog.deleteMany({
    where: { targetType: "RepairActivityAttendance", targetId: { in: attendanceIds } },
  });
  await db.repairActivityRegistration.deleteMany({ where: { activityId: { in: activityIds } } });
  await db.repairActivityAttendance.deleteMany({ where: { activityId: { in: activityIds } } });
  await db.repairRecord.deleteMany({ where: { id: { in: recordIds } } });
  await db.repairActivity.deleteMany({ where: { id: { in: activityIds } } });
  if (createdSystemCategory) {
    await db.repairCategory.deleteMany({ where: { id: SYSTEM_CATEGORY_ID } });
    createdSystemCategory = false;
  }
  await db.authSession.deleteMany({ where: { userId: { in: userIds } } });
  await db.userRole.deleteMany({ where: { userId: { in: userIds } } });
  await db.userIdentity.deleteMany({ where: { userId: { in: userIds } } });
  await db.passwordCredential.deleteMany({ where: { userId: { in: userIds } } });
  await db.memberProfile.deleteMany({ where: { id: { in: profileIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
}

async function prepareFixtures(): Promise<void> {
  await cleanupFixtures();
  const db = getDb();
  const now = new Date();
  const hour = 60 * 60 * 1000;
  // 接待/补单发生在活动当天：预填日期必须 ≤ 今天才能通过提交校验。
  activityAt = new Date(now.getTime());
  for (const [userId, displayName] of [
    [STAFF_USER_ID, `${PREFIX} 接待员`],
    [ADMIN_USER_ID, `${PREFIX} 管理员`],
    [OTHER_USER_ID, `${PREFIX} 其他成员`],
    [INACTIVE_USER_ID, `${PREFIX} 停用成员`],
    [DELETED_USER_ID, `${PREFIX} 软删成员`],
  ] as const) {
    await db.user.create({
      data: { id: userId, status: "ACTIVE", displayName, createdAt: now, updatedAt: now },
    });
  }
  for (const [profileId, userId, realName, nickname, status, deletedAt] of [
    [STAFF_PROFILE_ID, STAFF_USER_ID, `${PREFIX} 接待员`, null, "ACTIVE", null],
    [ADMIN_PROFILE_ID, ADMIN_USER_ID, `${PREFIX} 管理员`, `${PREFIX} 管理员昵称`, "ACTIVE", null],
    [OTHER_PROFILE_ID, OTHER_USER_ID, `${PREFIX} 其他成员`, null, "ACTIVE", null],
    [INACTIVE_PROFILE_ID, INACTIVE_USER_ID, `${PREFIX} 停用成员`, null, "DISABLED", null],
    [DELETED_PROFILE_ID, DELETED_USER_ID, `${PREFIX} 软删成员`, null, "ACTIVE", now],
  ] as const) {
    await db.memberProfile.create({
      data: {
        id: profileId,
        userId,
        realName,
        nickname,
        status,
        deletedAt,
        joinedAt: now,
        createdAt: now,
      },
    });
  }
  for (const [id, title] of [
    [ACTIVITY_ID, ACTIVITY_TITLE],
    [OTHER_ACTIVITY_ID, `${ACTIVITY_TITLE}（另一场）`],
  ] as const) {
    await db.repairActivity.create({
      data: {
        id,
        title,
        activityAt,
        capacity: 100,
        signupOpensAt: new Date(now.getTime() - 24 * hour),
        signupClosesAt: new Date(now.getTime() - hour),
        createdAt: now,
        updatedAt: now,
      },
    });
  }
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
    createdSystemCategory = true;
  }
}

/** 直接建一条已签到（CHECKED_IN）的报名，跳过公开报名限流。 */
async function checkedInRegistration(
  name = `${PREFIX} 客户`,
  activityId = ACTIVITY_ID,
  extra: { deviceModel?: string | null } = {},
) {
  seq += 1;
  const phone = `1390888${String(2000 + seq).padStart(4, "0")}`.slice(0, 11);
  return getDb().repairActivityRegistration.create({
    data: {
      id: randomUUID(),
      activityId,
      name,
      phone,
      phoneLast4: phone.slice(-4),
      issueType: "SOFTWARE_SYSTEM",
      status: "CHECKED_IN",
      checkedInAt: new Date(),
      deviceModel: extra.deviceModel === undefined ? "SERVE221 测试机型" : extra.deviceModel,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

function fieldsFromPrefill(prefill: {
  repairDate: string;
  categoryId: string | null;
  name: string;
  phone: string;
  deviceModel: string | null;
}) {
  return {
    repairDate: prefill.repairDate,
    durationMinutes: 30,
    categoryId: prefill.categoryId,
    ownerName: prefill.name,
    ownerPhone: prefill.phone,
    deviceModel: prefill.deviceModel,
    remark: `${PREFIX} 补单`,
    result: "COMPLETED" as const,
    participantIds: [],
  };
}

async function serveAndRecord(
  registrationId: string,
  actor: AuthorizedActor = staffActor,
): Promise<RepairView> {
  await repairActivityStaffService.serve(ACTIVITY_ID, registrationId, actor);
  const prefill = await repairActivityStaffService.getServePrefill(
    ACTIVITY_ID,
    registrationId,
    actor,
  );
  return repairActivityStaffService.createServeRecord(
    ACTIVITY_ID,
    registrationId,
    { idempotencyKey: `serve221-${randomUUID()}`, fields: fieldsFromPrefill(prefill) },
    actor,
  );
}

before(async () => {
  if (!enabled) return;
  uploadTestRoot = await mkdtemp(join(tmpdir(), "serve221-photos-"));
  process.env.UPLOAD_PATH = uploadTestRoot;
  await prepareFixtures();
  const db = getDb();
  await repairActivityStaffService.markAttendance(ACTIVITY_ID, staffActor);
  await repairActivityStaffService.markAttendance(ACTIVITY_ID, adminActor);
  await repairActivityStaffService.markAttendance(OTHER_ACTIVITY_ID, staffActor);

  // 固定排序与过滤夹具：接待员早到、管理员其次；停用 / 软删成员也「出勤」但不进入候选。
  const now = new Date();
  await db.repairActivityAttendance.update({
    where: {
      activityId_memberProfileId: { activityId: ACTIVITY_ID, memberProfileId: STAFF_PROFILE_ID },
    },
    data: { checkedInAt: new Date(now.getTime() - 2 * 60 * 60 * 1000) },
  });
  await db.repairActivityAttendance.update({
    where: {
      activityId_memberProfileId: { activityId: ACTIVITY_ID, memberProfileId: ADMIN_PROFILE_ID },
    },
    data: { checkedInAt: new Date(now.getTime() - 60 * 60 * 1000) },
  });
  await db.repairActivityAttendance.createMany({
    data: [
      {
        id: "e7a00000-0000-4000-8000-00000000000e",
        activityId: ACTIVITY_ID,
        memberProfileId: INACTIVE_PROFILE_ID,
        checkedInAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
      },
      {
        id: "e7a00000-0000-4000-8000-00000000000f",
        activityId: ACTIVITY_ID,
        memberProfileId: DELETED_PROFILE_ID,
        checkedInAt: new Date(now.getTime() - 4 * 60 * 60 * 1000),
      },
    ],
  });
});

after(async () => {
  if (!enabled) return;
  try {
    await cleanupFixtures();
  } finally {
    if (uploadTestRoot) await rm(uploadTestRoot, { recursive: true, force: true });
    await disconnectDb();
  }
});

dbTest("接待只占登记行：不建维修单，看板待补建，跨活动再次接待被拦截", async () => {
  const db = getDb();
  const registration = await checkedInRegistration();
  const served = await repairActivityStaffService.serve(ACTIVITY_ID, registration.id, staffActor);
  assert.equal(served.registration.repairRecordId, null, "接待不再创建维修草稿");
  assert.equal(served.registration.status, "SERVED");
  const row = await db.repairActivityRegistration.findUniqueOrThrow({
    where: { id: registration.id },
  });
  assert.equal(row.servedByMemberProfileId, STAFF_PROFILE_ID);
  assert.ok(row.servedAt);
  assert.equal(row.repairRecordId, null);
  assert.equal(
    await db.repairRecord.count({ where: { memberProfileId: STAFF_PROFILE_ID } }),
    0,
    "接待动作本身不落维修单",
  );

  const board = await repairActivityStaffService.getBoard(ACTIVITY_ID, staffActor);
  const servedRow = board.served.find((item) => item.id === registration.id);
  assert.ok(servedRow);
  assert.equal(servedRow.recordStatus, null);
  assert.equal(servedRow.canRevert, true);
  assert.equal(servedRow.canFill, true);
  assert.deepEqual(board.pendingServeRegistration, {
    registrationId: registration.id,
    name: registration.name,
    activityId: ACTIVITY_ID,
    activityTitle: ACTIVITY_TITLE,
  });

  const adminBoard = await repairActivityStaffService.getBoard(ACTIVITY_ID, adminActor);
  const adminRow = adminBoard.served.find((item) => item.id === registration.id);
  assert.ok(adminRow);
  assert.equal(adminRow.canRevert, true, "管理员可撤销他人未建单的接待");
  assert.equal(adminRow.canFill, false, "管理员不代填");
  assert.equal(adminBoard.pendingServeRegistration, null, "拦截按当前操作者本人判定");

  const otherRegistration = await checkedInRegistration(`${PREFIX} 另一场客户`, OTHER_ACTIVITY_ID);
  await expectCode(
    () => repairActivityStaffService.serve(OTHER_ACTIVITY_ID, otherRegistration.id, staffActor),
    "ACTIVITY_SERVE_PENDING",
  );
  const untouched = await db.repairActivityRegistration.findUniqueOrThrow({
    where: { id: otherRegistration.id },
  });
  assert.equal(untouched.status, "CHECKED_IN", "被拦截时目标报名状态不变");

  // 收尾：撤销本用例的待补建接待，避免全局拦截影响后续用例。
  await repairActivityStaffService.revertServe(ACTIVITY_ID, registration.id, staffActor);
  assert.equal(
    (await repairActivityStaffService.getBoard(ACTIVITY_ID, staffActor)).pendingServeRegistration,
    null,
  );
});

dbTest("继续填写预填：仅接待者本人，完整电话 + 分类映射 + 审计；建单后失效", async () => {
  const db = getDb();
  const registration = await checkedInRegistration(`${PREFIX} 预填客户`);
  await repairActivityStaffService.serve(ACTIVITY_ID, registration.id, staffActor);

  const prefill = await repairActivityStaffService.getServePrefill(
    ACTIVITY_ID,
    registration.id,
    staffActor,
  );
  assert.equal(prefill.phone, registration.phone, "接待者本人拿到完整电话");
  assert.equal(prefill.name, registration.name);
  assert.equal(prefill.deviceModel, "SERVE221 测试机型");
  assert.ok(prefill.categoryId, "故障类型映射到启用中的分类");
  assert.equal(prefill.activityTitle, ACTIVITY_TITLE);
  assert.deepEqual(
    prefill.participantOptions.map((option) => option.id),
    [STAFF_PROFILE_ID, ADMIN_PROFILE_ID],
    "候选按出勤时间升序，且排除停用 / 软删除成员",
  );
  assert.deepEqual(
    prefill.participantOptions.map((option) => option.id).sort(),
    [STAFF_PROFILE_ID, ADMIN_PROFILE_ID].sort(),
    "参与人候选只含本场出勤成员",
  );
  assert.equal(
    prefill.participantOptions.some((option) => option.id === INACTIVE_PROFILE_ID),
    false,
    "出勤但已停用的成员不进入候选",
  );
  assert.equal(
    prefill.participantOptions.some((option) => option.id === DELETED_PROFILE_ID),
    false,
    "出勤但已软删除的成员不进入候选",
  );
  const staffOption = prefill.participantOptions.find((option) => option.id === STAFF_PROFILE_ID);
  assert.deepEqual(staffOption, {
    id: STAFF_PROFILE_ID,
    name: `${PREFIX} 接待员`,
    realName: `${PREFIX} 接待员`,
    nickname: null,
  });
  const adminOption = prefill.participantOptions.find((option) => option.id === ADMIN_PROFILE_ID);
  assert.equal(adminOption?.name, `${PREFIX} 管理员昵称`, "展示名优先取昵称");
  assert.equal(adminOption?.realName, `${PREFIX} 管理员`);
  assert.equal(adminOption?.nickname, `${PREFIX} 管理员昵称`);
  assert.equal(
    prefill.participantOptions.some((option) => option.id === OTHER_PROFILE_ID),
    false,
    "未出勤成员不得进入候选",
  );
  assert.deepEqual(Object.keys(adminOption ?? {}).sort(), ["id", "name", "nickname", "realName"]);
  assert.equal(
    /phone|qq|studentId|className/i.test(JSON.stringify(prefill.participantOptions)),
    false,
    "候选不携带联系方式或学籍字段",
  );
  const activity = await db.repairActivity.findUniqueOrThrow({ where: { id: ACTIVITY_ID } });
  assert.match(prefill.repairDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(activity.activityAt);
  const audit = await db.auditLog.findFirstOrThrow({
    where: {
      action: "repair_activity.registration_phone.viewed",
      targetId: registration.id,
    },
  });
  assert.equal(audit.actorUserId, STAFF_USER_ID);

  await expectCode(
    () => repairActivityStaffService.getServePrefill(ACTIVITY_ID, registration.id, otherActor),
    "FORBIDDEN",
  );
  await expectCode(
    () => repairActivityStaffService.getServePrefill(ACTIVITY_ID, registration.id, adminActor),
    "FORBIDDEN",
  );

  await repairActivityStaffService.createServeRecord(
    ACTIVITY_ID,
    registration.id,
    { idempotencyKey: `serve221-${randomUUID()}`, fields: fieldsFromPrefill(prefill) },
    staffActor,
  );
  await expectCode(
    () => repairActivityStaffService.getServePrefill(ACTIVITY_ID, registration.id, staffActor),
    "ACTIVITY_REGISTRATION_STATE_INVALID",
  );
});

dbTest("活动接待建单：参与人必须是本场出勤成员（服务端强制）", async () => {
  const db = getDb();
  const registration = await checkedInRegistration(`${PREFIX} 出勤校验客户`);
  await repairActivityStaffService.serve(ACTIVITY_ID, registration.id, staffActor);
  const prefill = await repairActivityStaffService.getServePrefill(
    ACTIVITY_ID,
    registration.id,
    staffActor,
  );
  const rejectedKey = `serve221-${randomUUID()}`;
  await expectCode(
    () =>
      repairActivityStaffService.createServeRecord(
        ACTIVITY_ID,
        registration.id,
        {
          idempotencyKey: rejectedKey,
          fields: { ...fieldsFromPrefill(prefill), participantIds: [OTHER_PROFILE_ID] },
        },
        staffActor,
      ),
    "VALIDATION_FAILED",
  );
  assert.equal(
    (
      await db.repairActivityRegistration.findUniqueOrThrow({
        where: { id: registration.id },
      })
    ).repairRecordId,
    null,
    "服务端拒绝时不得占用接待登记",
  );
  assert.equal(
    await db.repairRecord.count({ where: { createRequestKey: rejectedKey } }),
    0,
    "服务端拒绝时不得落维修单",
  );

  const record = await repairActivityStaffService.createServeRecord(
    ACTIVITY_ID,
    registration.id,
    {
      idempotencyKey: `serve221-${randomUUID()}`,
      fields: { ...fieldsFromPrefill(prefill), participantIds: [ADMIN_PROFILE_ID] },
    },
    staffActor,
  );
  assert.deepEqual(
    record.participants.map((participant) => participant.id),
    [STAFF_PROFILE_ID, ADMIN_PROFILE_ID],
    "本场出勤的额外参与人可以正常落单",
  );
});

dbTest("提交即建单：校验 / 关联 / 参与人 / 时间线 / 审计 / 幂等 / 并发", async () => {
  const db = getDb();
  const registration = await checkedInRegistration(`${PREFIX} 建单客户`);
  await repairActivityStaffService.serve(ACTIVITY_ID, registration.id, staffActor);
  const prefill = await repairActivityStaffService.getServePrefill(
    ACTIVITY_ID,
    registration.id,
    staffActor,
  );
  const key = `serve221-${randomUUID()}`;

  await expectCode(
    () =>
      repairActivityStaffService.createServeRecord(
        ACTIVITY_ID,
        registration.id,
        { idempotencyKey: key, fields: { ...fieldsFromPrefill(prefill), durationMinutes: null } },
        staffActor,
      ),
    "REPAIR_SUBMISSION_INCOMPLETE",
  );
  assert.equal(
    (
      await db.repairActivityRegistration.findUniqueOrThrow({
        where: { id: registration.id },
      })
    ).repairRecordId,
    null,
    "校验失败不占用登记",
  );

  const record = await repairActivityStaffService.createServeRecord(
    ACTIVITY_ID,
    registration.id,
    { idempotencyKey: key, fields: fieldsFromPrefill(prefill) },
    staffActor,
  );
  assert.equal(record.status, "PENDING");
  assert.equal(record.ownerName, prefill.name);
  assert.equal(record.ownerPhone, prefill.phone);
  assert.equal(record.deviceModel, prefill.deviceModel);
  assert.deepEqual(
    record.participants.map((item) => item.id),
    [STAFF_PROFILE_ID],
    "创建人恒有一行参与记录",
  );
  assert.equal(
    (
      await db.repairActivityRegistration.findUniqueOrThrow({
        where: { id: registration.id },
      })
    ).repairRecordId,
    record.id,
  );
  const timeline = await db.repairTimelineEvent.findFirstOrThrow({
    where: { repairRecordId: record.id, eventType: "SUBMITTED" },
  });
  assert.equal((timeline.summary as { source?: string }).source, "repair_activity_serve");
  assert.equal((timeline.summary as { registrationId?: string }).registrationId, registration.id);
  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: "repair.created_from_activity_serve", targetId: record.id },
  });
  assert.equal(audit.actorUserId, STAFF_USER_ID);

  const board = await repairActivityStaffService.getBoard(ACTIVITY_ID, staffActor);
  assert.equal(board.pendingServeRegistration, null, "建单后解除拦截");
  const servedRow = board.served.find((item) => item.id === registration.id);
  assert.equal(servedRow?.recordStatus, "PENDING");
  assert.equal(servedRow?.canRevert, false);
  assert.equal(servedRow?.canFill, false);

  const retry = await repairActivityStaffService.createServeRecord(
    ACTIVITY_ID,
    registration.id,
    { idempotencyKey: key, fields: fieldsFromPrefill(prefill) },
    staffActor,
  );
  assert.equal(retry.id, record.id, "同一幂等键重试返回原记录");
  assert.equal(await db.repairRecord.count({ where: { id: { in: [record.id] } } }), 1);
  await expectCode(
    () =>
      repairActivityStaffService.createServeRecord(
        ACTIVITY_ID,
        registration.id,
        { idempotencyKey: `serve221-${randomUUID()}`, fields: fieldsFromPrefill(prefill) },
        staffActor,
      ),
    "ACTIVITY_REGISTRATION_STATE_INVALID",
  );

  // 并发：两条不同幂等键同时提交，只允许一条成功建单。
  const raced = await checkedInRegistration(`${PREFIX} 并发客户`);
  await repairActivityStaffService.serve(ACTIVITY_ID, raced.id, staffActor);
  const racedPrefill = await repairActivityStaffService.getServePrefill(
    ACTIVITY_ID,
    raced.id,
    staffActor,
  );
  const beforeRace = await db.repairRecord.count({
    where: { memberProfileId: STAFF_PROFILE_ID },
  });
  const results = await Promise.allSettled(
    [0, 1].map((n) =>
      repairActivityStaffService.createServeRecord(
        ACTIVITY_ID,
        raced.id,
        {
          idempotencyKey: `serve221-race-${n}-${randomUUID()}`,
          fields: fieldsFromPrefill(racedPrefill),
        },
        staffActor,
      ),
    ),
  );
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(
    await db.repairRecord.count({ where: { memberProfileId: STAFF_PROFILE_ID } }),
    beforeRace + 1,
    "并发只多出一条记录",
  );
});

dbTest("撤销接待：仅未建单可用；本人 / 管理员权限；建单后拒绝", async () => {
  const db = getDb();
  const registration = await checkedInRegistration(`${PREFIX} 撤销客户`);
  await repairActivityStaffService.serve(ACTIVITY_ID, registration.id, staffActor);

  await expectCode(
    () => repairActivityStaffService.revertServe(ACTIVITY_ID, registration.id, otherActor),
    "FORBIDDEN",
  );
  const reverted = await repairActivityStaffService.revertServe(
    ACTIVITY_ID,
    registration.id,
    staffActor,
  );
  assert.equal(reverted.registration.status, "CHECKED_IN");
  assert.equal(reverted.registration.servedAt, null);
  const row = await db.repairActivityRegistration.findUniqueOrThrow({
    where: { id: registration.id },
  });
  assert.equal(row.servedByMemberProfileId, null);
  assert.equal(
    (await repairActivityStaffService.getBoard(ACTIVITY_ID, staffActor)).pendingServeRegistration,
    null,
  );
  const audit = await db.auditLog.findFirstOrThrow({
    where: {
      action: "repair_activity.registration_serve_reverted",
      targetId: registration.id,
    },
  });
  assert.equal(audit.actorUserId, STAFF_USER_ID);

  // 管理员可撤销他人未建单的接待。
  await repairActivityStaffService.serve(ACTIVITY_ID, registration.id, staffActor);
  const byAdmin = await repairActivityStaffService.revertServe(
    ACTIVITY_ID,
    registration.id,
    adminActor,
  );
  assert.equal(byAdmin.registration.status, "CHECKED_IN");

  // 已建单后不可撤销。
  const record = await serveAndRecord(registration.id);
  assert.equal(record.status, "PENDING");
  await expectCode(
    () => repairActivityStaffService.revertServe(ACTIVITY_ID, registration.id, staffActor),
    "ACTIVITY_REGISTRATION_STATE_INVALID",
  );
  assert.ok(await db.repairRecord.findFirst({ where: { id: record.id } }));
});

dbTest("旧 serve 草稿过渡：仍可撤销并删除草稿；已提交的拒绝（#221 审查）", async () => {
  const db = getDb();
  const registration = await checkedInRegistration(`${PREFIX} 旧草稿客户`);
  await repairActivityStaffService.serve(ACTIVITY_ID, registration.id, staffActor);
  const now = new Date();
  const recordId = randomUUID();
  await db.repairRecord.create({
    data: {
      id: recordId,
      memberProfileId: STAFF_PROFILE_ID,
      status: "DRAFT",
      createRequestKey: `activity-serve:${registration.id}`,
      repairDate: new Date(),
      durationMinutes: null,
      categoryId: null,
      ownerName: registration.name,
      ownerPhone: registration.phone,
      deviceModel: registration.deviceModel,
      result: "COMPLETED",
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.repairRecordParticipant.create({
    data: {
      id: randomUUID(),
      repairRecordId: recordId,
      memberProfileId: STAFF_PROFILE_ID,
      createdAt: now,
    },
  });
  await db.repairActivityRegistration.update({
    where: { id: registration.id },
    data: { repairRecordId: recordId },
  });

  const newDisplay = await localRepairPhotoStorage.put({
    bytes: Uint8Array.from([1]),
    mimeType: "image/webp",
  });
  const newThumb = await localRepairPhotoStorage.put({
    bytes: Uint8Array.from([2]),
    mimeType: "image/webp",
  });
  const legacyDisplay = await localRepairPhotoStorage.put({
    bytes: Uint8Array.from([3]),
    mimeType: "image/png",
  });
  const deletedDisplay = await localRepairPhotoStorage.put({
    bytes: Uint8Array.from([4]),
    mimeType: "image/webp",
  });
  const deletedThumb = await localRepairPhotoStorage.put({
    bytes: Uint8Array.from([5]),
    mimeType: "image/webp",
  });
  const photoRow = {
    repairRecordId: recordId,
    originalName: null,
    mimeType: "image/webp",
    sizeBytes: 1,
    sha256Digest: Buffer.alloc(32),
    uploadedByUserId: STAFF_USER_ID,
    createdAt: now,
  };
  await db.repairPhoto.createMany({
    data: [
      {
        ...photoRow,
        id: randomUUID(),
        storageKey: newDisplay.storageKey,
        thumbnailKey: newThumb.storageKey,
        sortOrder: 0,
      },
      {
        ...photoRow,
        id: randomUUID(),
        storageKey: legacyDisplay.storageKey,
        sortOrder: 1,
      },
      {
        ...photoRow,
        id: randomUUID(),
        storageKey: deletedDisplay.storageKey,
        thumbnailKey: deletedThumb.storageKey,
        sortOrder: 2,
        deletedAt: now,
      },
    ],
  });
  const photoKeys = [
    newDisplay.storageKey,
    newThumb.storageKey,
    legacyDisplay.storageKey,
    deletedDisplay.storageKey,
    deletedThumb.storageKey,
  ];

  await expectCode(
    () => repairActivityStaffService.revertServe(ACTIVITY_ID, registration.id, otherActor),
    "FORBIDDEN",
  );
  await localRepairPhotoStorage.open(newThumb.storageKey);
  assert.equal(
    await db.repairPhoto.count({ where: { repairRecordId: recordId } }),
    3,
    "事务回滚时不能删除照片行或文件",
  );

  const board = await repairActivityStaffService.getBoard(ACTIVITY_ID, staffActor);
  const row = board.served.find((item) => item.id === registration.id);
  assert.equal(row?.recordStatus, "DRAFT");
  assert.equal(row?.canRevert, true, "旧草稿过渡期保留撤销入口");
  assert.equal(row?.canFill, false);

  const reverted = await repairActivityStaffService.revertServe(
    ACTIVITY_ID,
    registration.id,
    staffActor,
  );
  assert.equal(reverted.registration.status, "CHECKED_IN");
  assert.equal(reverted.deletedRecordId, recordId);
  assert.equal(await db.repairRecord.count({ where: { id: recordId } }), 0);
  assert.equal(await db.repairPhoto.count({ where: { repairRecordId: recordId } }), 0);
  for (const key of photoKeys) {
    await assert.rejects(
      () => localRepairPhotoStorage.open(key),
      { code: "ENOENT" },
      `撤销接待后应删除 ${key}`,
    );
  }
  const audit = await db.auditLog.findFirstOrThrow({
    where: {
      action: "repair_activity.registration_serve_reverted",
      targetId: registration.id,
    },
  });
  assert.equal((audit.afterSummary as { deletedRecordId?: string }).deletedRecordId, recordId);

  // 已提交的旧记录不允许按「撤销接待」删除。
  await repairActivityStaffService.serve(ACTIVITY_ID, registration.id, staffActor);
  const submittedId = randomUUID();
  await db.repairRecord.create({
    data: {
      id: submittedId,
      memberProfileId: STAFF_PROFILE_ID,
      status: "PENDING",
      createRequestKey: `activity-serve:${registration.id}-submitted`,
      repairDate: new Date(),
      durationMinutes: 30,
      categoryId: null,
      ownerName: registration.name,
      ownerPhone: registration.phone,
      deviceModel: registration.deviceModel,
      result: "COMPLETED",
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.repairActivityRegistration.update({
    where: { id: registration.id },
    data: { repairRecordId: submittedId },
  });
  await expectCode(
    () => repairActivityStaffService.revertServe(ACTIVITY_ID, registration.id, staffActor),
    "ACTIVITY_REGISTRATION_STATE_INVALID",
  );
  assert.ok(await db.repairRecord.findFirst({ where: { id: submittedId } }));

  // 收尾：解除关联、删除测试记录并恢复登记，避免影响后续用例。
  await db.repairActivityRegistration.update({
    where: { id: registration.id },
    data: { repairRecordId: null },
  });
  await db.repairRecord.delete({ where: { id: submittedId } });
  await repairActivityStaffService.revertServe(ACTIVITY_ID, registration.id, staffActor);
});

dbTest("分类映射降级：映射不到启用分类时预填为空，提交需补选", async () => {
  const db = getDb();
  const registration = await checkedInRegistration(`${PREFIX} 分类客户`);
  await db.repairCategory.updateMany({ where: { code: "SYSTEM" }, data: { isActive: false } });
  try {
    await repairActivityStaffService.serve(ACTIVITY_ID, registration.id, staffActor);
    const prefill = await repairActivityStaffService.getServePrefill(
      ACTIVITY_ID,
      registration.id,
      staffActor,
    );
    assert.equal(prefill.categoryId, null, "映射不到启用分类时留空，由成员补选");
    await expectCode(
      () =>
        repairActivityStaffService.createServeRecord(
          ACTIVITY_ID,
          registration.id,
          { idempotencyKey: `serve221-${randomUUID()}`, fields: fieldsFromPrefill(prefill) },
          staffActor,
        ),
      "REPAIR_SUBMISSION_INCOMPLETE",
    );
  } finally {
    await db.repairCategory.updateMany({ where: { code: "SYSTEM" }, data: { isActive: true } });
    // 收尾：撤销待补建接待，避免拦截后续用例。
    await repairActivityStaffService
      .revertServe(ACTIVITY_ID, registration.id, staffActor)
      .catch(() => undefined);
  }
});

dbTest("路由接线：预填 GET 与提交 POST（同源 / 幂等头 / 201）", async () => {
  const registration = await checkedInRegistration(`${PREFIX} 路由客户`);
  await repairActivityStaffService.serve(ACTIVITY_ID, registration.id, staffActor);
  const cookie = await sessionCookie(STAFF_USER_ID, "MEMBER");
  const params = { id: ACTIVITY_ID, registrationId: registration.id };

  const prefill = await callRoute(
    GET_PREFILL,
    `http://localhost/api/v1/member/repair-activities/${ACTIVITY_ID}/registrations/${registration.id}/prefill`,
    { params, headers: { cookie } },
  );
  assert.equal(prefill.status, 200, JSON.stringify(prefill.json));
  const prefillData = prefill.json.data as {
    phone: string;
    repairDate: string;
    categoryId: string | null;
    name: string;
    deviceModel: string | null;
    participantOptions: Array<{ id: string; name: string; realName: string | null }>;
  };
  assert.equal(prefillData.phone, registration.phone);
  assert.deepEqual(
    prefillData.participantOptions.map((option) => option.id).sort(),
    [STAFF_PROFILE_ID, ADMIN_PROFILE_ID].sort(),
    "路由信封同样只下发出勤候选",
  );

  const body = fieldsFromPrefill(prefillData);
  const crossOrigin = await callRoute(
    POST_RECORD,
    `http://localhost/api/v1/member/repair-activities/${ACTIVITY_ID}/registrations/${registration.id}/record`,
    {
      method: "POST",
      params,
      headers: {
        cookie,
        origin: "https://other.invalid",
        "idempotency-key": `serve221-${randomUUID()}`,
      },
      body,
    },
  );
  assert.equal(crossOrigin.status, 403);
  const missingKey = await callRoute(
    POST_RECORD,
    `http://localhost/api/v1/member/repair-activities/${ACTIVITY_ID}/registrations/${registration.id}/record`,
    { method: "POST", params, headers: { cookie }, body },
  );
  assert.equal(missingKey.status, 400);

  const created = await callRoute(
    POST_RECORD,
    `http://localhost/api/v1/member/repair-activities/${ACTIVITY_ID}/registrations/${registration.id}/record`,
    {
      method: "POST",
      params,
      headers: { cookie, "idempotency-key": `serve221-${randomUUID()}` },
      body,
    },
  );
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal((created.json.data as { status: string }).status, "PENDING");
});
