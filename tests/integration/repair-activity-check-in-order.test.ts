import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { repairActivityStaffService } from "../../src/features/repair-activities/repair-activity-staff-service";
import { permissionsForRoles } from "../../src/lib/auth/permissions";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import type { AuthorizedActor } from "../../src/types/contracts";
import { integrationTestsEnabled } from "./db-guard";

const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;

const ACTIVITY_ID = "e7a80000-0000-4000-8000-000000000001";
const USER_ID = "e7a80000-0000-4000-8000-000000000002";
const PROFILE_ID = "e7a80000-0000-4000-8000-000000000003";
const PREFIX = "CHECKIN_ORDER_358";

let actor: AuthorizedActor;
const registrationIds: string[] = [];

async function cleanup() {
  const db = getDb();
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: USER_ID },
        { targetType: "RepairActivity", targetId: ACTIVITY_ID },
        { targetType: "RepairActivityRegistration", targetId: { in: registrationIds } },
      ],
    },
  });
  await db.repairActivityAttendance.deleteMany({ where: { activityId: ACTIVITY_ID } });
  await db.repairActivityRegistration.deleteMany({ where: { activityId: ACTIVITY_ID } });
  await db.repairActivity.deleteMany({ where: { id: ACTIVITY_ID } });
  await db.memberProfile.deleteMany({ where: { id: PROFILE_ID } });
  await db.user.deleteMany({ where: { id: USER_ID } });
  registrationIds.length = 0;
}

before(async () => {
  if (!enabled) return;
  await cleanup();
  const db = getDb();
  const now = new Date();
  const hour = 60 * 60 * 1000;
  await db.user.create({
    data: {
      id: USER_ID,
      status: "ACTIVE",
      displayName: `${PREFIX} 管理员`,
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.memberProfile.create({
    data: {
      id: PROFILE_ID,
      userId: USER_ID,
      realName: `${PREFIX} 管理员`,
      status: "ACTIVE",
      joinedAt: now,
      createdAt: now,
    },
  });
  await db.repairActivity.create({
    data: {
      id: ACTIVITY_ID,
      title: PREFIX,
      // 签到窗口在活动开始前 30 分钟开放（issue #367），留出 10 分钟。
      activityAt: new Date(now.getTime() + 10 * 60 * 1000),
      capacity: 20,
      signupOpensAt: new Date(now.getTime() - hour),
      signupClosesAt: new Date(now.getTime() + 24 * hour),
      createdBy: USER_ID,
      createdAt: now,
      updatedAt: now,
    },
  });
  for (let index = 0; index < 3; index += 1) {
    const id = randomUUID();
    const phone = `1393580${String(index).padStart(4, "0")}`;
    registrationIds.push(id);
    await db.repairActivityRegistration.create({
      data: {
        id,
        activityId: ACTIVITY_ID,
        name: `${PREFIX} 客户${index + 1}`,
        phone,
        phoneLast4: phone.slice(-4),
        issueType: "CLEAN_ONLY",
        status: "REGISTERED",
        createdAt: now,
        updatedAt: now,
      },
    });
  }
  actor = {
    actorType: "USER",
    userId: USER_ID,
    userStatus: "ACTIVE",
    permissions: permissionsForRoles(["ADMIN"]),
    requestId: `req_${PREFIX}`,
  };
  await repairActivityStaffService.markAttendance(ACTIVITY_ID, actor);
});

after(async () => {
  if (!enabled) return;
  try {
    await cleanup();
  } finally {
    await disconnectDb();
  }
});

dbTest("批量签到按提交顺序保存 checkInOrder，刷新后队列仍按序号排列（issue #358）", async () => {
  const db = getDb();
  const [first, second, third] = registrationIds as [string, string, string];
  const result = await repairActivityStaffService.checkIn(
    ACTIVITY_ID,
    [third, first, second],
    actor,
  );
  assert.deepEqual(
    result.checkedIn.map((row) => row.id),
    [third, first, second],
  );
  assert.deepEqual(
    result.checkedIn.map((row) => row.checkInOrder),
    [0, 1, 2],
  );

  let board = await repairActivityStaffService.getBoard(ACTIVITY_ID, actor);
  assert.deepEqual(
    board.queue.map((row) => row.id),
    [third, first, second],
  );

  // 幂等重试（全部已 CHECKED_IN）不得重排或改写已有序号。
  const retried = await repairActivityStaffService.checkIn(
    ACTIVITY_ID,
    [first, third, second],
    actor,
  );
  assert.deepEqual(
    retried.checkedIn.map((row) => row.checkInOrder),
    [1, 0, 2],
  );
  board = await repairActivityStaffService.getBoard(ACTIVITY_ID, actor);
  assert.deepEqual(
    board.queue.map((row) => row.id),
    [third, first, second],
  );

  await repairActivityStaffService.withdraw(ACTIVITY_ID, first, actor);
  const withdrawn = await db.repairActivityRegistration.findUniqueOrThrow({
    where: { id: first },
  });
  assert.equal(withdrawn.checkInOrder, null, "撤回后清空入队顺序");

  await repairActivityStaffService.checkIn(ACTIVITY_ID, [first], actor);
  const rechecked = await db.repairActivityRegistration.findUniqueOrThrow({
    where: { id: first },
  });
  assert.equal(rechecked.checkInOrder, 3, "重新签到排到本场新的最大序号之后");
  board = await repairActivityStaffService.getBoard(ACTIVITY_ID, actor);
  assert.deepEqual(
    board.queue.map((row) => row.id),
    [third, second, first],
  );
});
