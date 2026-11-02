import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { shanghaiAcademicYearRange } from "../../src/lib/academic-term";
import { permissionsForRoles } from "../../src/lib/auth/permissions";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import {
  repairActivityCustomerService,
  syncCurrentYearNoShows,
} from "../../src/features/repair-activities/repair-activity-customer-service";
import { repairActivityService } from "../../src/features/repair-activities/repair-activity-service";
import { activityEndExclusive } from "../../src/features/repair-activities/repair-activity-validation";
import { AppError } from "../../src/lib/api/errors";
import type { AuthorizedActor } from "../../src/types/contracts";
import { integrationTestsEnabled } from "./db-guard";

const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;
const PREFIX = "NO_SHOW_335";
const NOW = new Date("2026-11-02T12:00:00.000Z");

let adminId = "";
let actor: AuthorizedActor;
const activityIds: string[] = [];
const phones: string[] = [];

function phone(index: number): string {
  const value = `1390000${String(index).padStart(4, "0")}`;
  phones.push(value);
  return value;
}

async function createActivity(input: {
  activityAt: Date;
  signupOpensAt: Date;
  signupClosesAt: Date;
  capacity?: number;
  title?: string;
}) {
  const id = randomUUID();
  activityIds.push(id);
  await getDb().repairActivity.create({
    data: {
      id,
      title: `${PREFIX} ${input.title ?? id.slice(0, 8)}`,
      activityAt: input.activityAt,
      capacity: input.capacity ?? 20,
      signupOpensAt: input.signupOpensAt,
      signupClosesAt: input.signupClosesAt,
      createdBy: adminId,
      createdAt: NOW,
      updatedAt: NOW,
    },
  });
  return id;
}

async function createRegistration(
  activityId: string,
  input: {
    name: string;
    phone: string;
    status: "REGISTERED" | "CHECKED_IN" | "SERVED";
    checkedInAt?: Date | null;
    servedAt?: Date | null;
    deletedAt?: Date | null;
  },
) {
  const id = randomUUID();
  await getDb().repairActivityRegistration.create({
    data: {
      id,
      activityId,
      name: input.name,
      phone: input.phone,
      phoneLast4: input.phone.slice(-4),
      issueType: "OTHER",
      status: input.status,
      checkedInAt: input.checkedInAt ?? null,
      servedAt: input.servedAt ?? null,
      deletedAt: input.deletedAt ?? null,
      createdAt: NOW,
      updatedAt: NOW,
    },
  });
  return id;
}

async function createEndedActivity() {
  const activityAt = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000);
  return createActivity({
    activityAt,
    signupOpensAt: new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000),
    signupClosesAt: new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000),
    title: "历史未到场",
  });
}

before(async () => {
  if (!enabled) return;
  adminId = randomUUID();
  await getDb().user.create({
    data: {
      id: adminId,
      status: "ACTIVE",
      displayName: `${PREFIX} 管理员`,
      createdAt: NOW,
      updatedAt: NOW,
    },
  });
  actor = {
    actorType: "USER",
    userId: adminId,
    userStatus: "ACTIVE",
    permissions: permissionsForRoles(["ADMIN"]),
    requestId: "req_no_show_335",
  };
});

after(async () => {
  if (!enabled) return;
  try {
    const db = getDb();
    await db.auditLog.deleteMany({
      where: {
        OR: [
          { actorUserId: adminId },
          { targetType: "RepairActivityCustomerBlock" },
          { targetType: "RepairActivityNoShowEvent" },
        ],
      },
    });
    await db.repairActivityNoShowEvent.deleteMany({ where: { activityId: { in: activityIds } } });
    await db.repairActivityCustomerBlock.deleteMany({ where: { phone: { in: phones } } });
    await db.repairActivityRegistration.deleteMany({ where: { activityId: { in: activityIds } } });
    await db.repairActivity.deleteMany({ where: { id: { in: activityIds } } });
    await db.user.deleteMany({ where: { id: adminId } });
  } finally {
    await disconnectDb();
  }
});

dbTest("历史 no-show：只计入结束且未签到，软删口径与身份键正确", async () => {
  const activityId = await createEndedActivity();
  const end = activityEndExclusive(
    (await getDb().repairActivity.findUniqueOrThrow({ where: { id: activityId } })).activityAt,
  );
  const active = await createRegistration(activityId, {
    name: "张三",
    phone: phone(1),
    status: "REGISTERED",
  });
  const canceled = await createRegistration(activityId, {
    name: "李四",
    phone: phone(2),
    status: "REGISTERED",
    deletedAt: new Date(end.getTime() - 60_000),
  });
  const deletedAfterEnd = await createRegistration(activityId, {
    name: "王五",
    phone: phone(3),
    status: "REGISTERED",
    deletedAt: new Date(end.getTime() + 60_000),
  });
  await createRegistration(activityId, {
    name: "赵六",
    phone: phone(4),
    status: "CHECKED_IN",
    checkedInAt: new Date(end.getTime() - 60_000),
  });
  await createRegistration(activityId, {
    name: "钱七",
    phone: phone(5),
    status: "SERVED",
    checkedInAt: new Date(end.getTime() - 60_000),
    servedAt: new Date(end.getTime() - 30_000),
  });
  // 同名不同手机：必须是两个客户，不能按姓名合并。
  await createRegistration(activityId, {
    name: "张三",
    phone: phone(6),
    status: "REGISTERED",
  });
  // 未结束活动不产生 no-show。
  const futureId = await createActivity({
    activityAt: new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000),
    signupOpensAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
    signupClosesAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
  });
  await createRegistration(futureId, {
    name: "孙八",
    phone: phone(7),
    status: "REGISTERED",
  });

  await syncCurrentYearNoShows({ now: NOW });
  const events = await getDb().repairActivityNoShowEvent.findMany({
    where: { activityId },
    select: { registrationId: true, nameNormalized: true, phone: true, state: true },
  });
  assert.equal(events.length, 3, "应只有张三、王五、同名张三三个未到场事件");
  assert.ok(events.some((event) => event.registrationId === active));
  assert.ok(events.some((event) => event.registrationId === deletedAfterEnd));
  assert.ok(!events.some((event) => event.registrationId === canceled));
  assert.ok(events.every((event) => event.state === "CONFIRMED"));

  const year = shanghaiAcademicYearRange(NOW);
  const blocks = await getDb().repairActivityCustomerBlock.findMany({
    where: { phone: { in: phones } },
    select: { phone: true, blockedUntil: true, source: true },
  });
  assert.equal(blocks.length, 3, "三个不同姓名+手机组合各一条封锁");
  assert.ok(blocks.every((block) => block.blockedUntil.getTime() === year.endExclusive.getTime()));
  assert.ok(blocks.every((block) => block.source === "AUTO"));

  const list = await repairActivityCustomerService.list(actor, NOW);
  assert.equal(list.blocks.filter((block) => block.status === "ACTIVE").length, 3);
  assert.equal(list.events.length, 3);
});

dbTest("豁免会解除自动封锁；再次未到场会重新封锁", async () => {
  const activityId = await createEndedActivity();
  const registrationId = await createRegistration(activityId, {
    name: "周九",
    phone: phone(8),
    status: "REGISTERED",
  });
  await syncCurrentYearNoShows({ now: NOW });
  const event = await getDb().repairActivityNoShowEvent.findUniqueOrThrow({
    where: { registrationId },
  });
  let block = await getDb().repairActivityCustomerBlock.findUniqueOrThrow({
    where: { nameNormalized_phone: { nameNormalized: "周九", phone: phones.at(-1)! } },
  });
  assert.equal(block.liftedAt, null);

  await repairActivityCustomerService.exempt(event.id, "已联系说明", actor, NOW);
  block = await getDb().repairActivityCustomerBlock.findUniqueOrThrow({ where: { id: block.id } });
  assert.ok(block.liftedAt);
  const list = await repairActivityCustomerService.list(actor, NOW);
  assert.equal(list.blocks.find((item) => item.id === block.id)?.status, "LIFTED");

  const secondActivity = await createEndedActivity();
  await createRegistration(secondActivity, {
    name: "周九",
    phone: phones.at(-1)!,
    status: "REGISTERED",
  });
  const later = new Date(NOW.getTime() + 60_000);
  await syncCurrentYearNoShows({ now: later });
  block = await getDb().repairActivityCustomerBlock.findUniqueOrThrow({ where: { id: block.id } });
  assert.equal(block.liftedAt, null, "新 no-show 应重新激活封锁");
});

dbTest("管理员人工加入/解除；新报名被拦，解除后放行；全部写审计", async () => {
  const actualNow = new Date();
  const activityId = await createActivity({
    activityAt: new Date(actualNow.getTime() + 24 * 60 * 60 * 1000),
    signupOpensAt: new Date(actualNow.getTime() - 60 * 60 * 1000),
    signupClosesAt: new Date(actualNow.getTime() + 60 * 60 * 1000),
    title: "人工封锁报名测试",
  });
  const customer = { name: "吴十", phone: phone(9) };
  await repairActivityCustomerService.block(
    { ...customer, reason: "多次联系不上" },
    actor,
    actualNow,
  );

  await assert.rejects(
    () =>
      repairActivityService.register(
        activityId,
        {
          name: customer.name,
          phone: customer.phone,
          issueType: "OTHER",
          consentAccepted: true,
        },
        { requestId: "req_no_show_register" },
      ),
    (error) => error instanceof AppError && error.code === "ACTIVITY_CUSTOMER_BLOCKED",
  );

  const block = await getDb().repairActivityCustomerBlock.findUniqueOrThrow({
    where: { nameNormalized_phone: { nameNormalized: customer.name, phone: customer.phone } },
  });
  await repairActivityCustomerService.lift(block.id, "已联系确认", actor, actualNow);
  const created = await repairActivityService.register(
    activityId,
    {
      name: customer.name,
      phone: customer.phone,
      issueType: "OTHER",
      consentAccepted: true,
    },
    { requestId: "req_no_show_register_retry" },
  );
  assert.equal(created.name, customer.name);
  assert.ok(
    (await getDb().auditLog.count({
      where: {
        action: "repair_activity.customer_unblocked",
        requestId: actor.requestId,
      },
    })) >= 1,
  );
});
