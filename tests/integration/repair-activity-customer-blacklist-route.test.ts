import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import {
  GET as listRoute,
  POST as blockRoute,
} from "../../src/app/api/v1/admin/repair-activities/customer-blacklist/route";
import { POST as liftRoute } from "../../src/app/api/v1/admin/repair-activities/customer-blacklist/[blockId]/lift/route";
import { POST as exemptRoute } from "../../src/app/api/v1/admin/repair-activities/no-show-events/[eventId]/exempt/route";
import { syncCurrentYearNoShows } from "../../src/features/repair-activities/repair-activity-customer-service";
import { getDb, disconnectDb } from "../../src/lib/db/client";
import { integrationTestsEnabled } from "./db-guard";
import { callRoute, sessionCookie } from "./http-harness";

const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;
const PREFIX = "NO_SHOW_ROUTE_335";
const BASE = "http://localhost/api/v1/admin/repair-activities";

let adminId = "";
let memberId = "";
let activityId = "";
let registrationId = "";
let adminCookie = "";
let memberCookie = "";
const phone = "13933500999";

async function cleanup() {
  const db = getDb();
  const staleActivities = await db.repairActivity.findMany({
    where: {
      OR: [{ title: { startsWith: PREFIX } }, ...(activityId ? [{ id: activityId }] : [])],
    },
    select: { id: true },
  });
  const staleActivityIds = staleActivities.map((activity) => activity.id);
  const events = staleActivityIds.length
    ? await db.repairActivityNoShowEvent.findMany({
        where: { activityId: { in: staleActivityIds } },
        select: { id: true },
      })
    : [];
  const blocks = await db.repairActivityCustomerBlock.findMany({
    where: { phone },
    select: { id: true },
  });
  const targetIds = [...events, ...blocks].map((row) => row.id);
  if (targetIds.length > 0) {
    await db.auditLog.deleteMany({
      where: {
        targetType: { in: ["RepairActivityCustomerBlock", "RepairActivityNoShowEvent"] },
        targetId: { in: targetIds },
      },
    });
  }
  if (adminId) {
    await db.auditLog.deleteMany({ where: { actorUserId: adminId } });
  }
  if (events.length > 0) {
    await db.repairActivityNoShowEvent.deleteMany({
      where: { id: { in: events.map((event) => event.id) } },
    });
  }
  await db.repairActivityCustomerBlock.deleteMany({ where: { phone } });
  if (staleActivityIds.length > 0) {
    await db.repairActivityRegistration.deleteMany({
      where: { activityId: { in: staleActivityIds } },
    });
    await db.repairActivity.deleteMany({ where: { id: { in: staleActivityIds } } });
  }
  for (const userId of [adminId, memberId]) {
    if (!userId) continue;
    await db.authSession.deleteMany({ where: { userId } });
    await db.passwordCredential.deleteMany({ where: { userId } });
    await db.userRole.deleteMany({ where: { userId } });
    await db.user.deleteMany({ where: { id: userId } });
  }
}

before(async () => {
  if (!enabled) return;
  await cleanup();
  const db = getDb();
  adminId = randomUUID();
  memberId = randomUUID();
  activityId = randomUUID();
  const now = new Date();
  await db.user.createMany({
    data: [
      {
        id: adminId,
        status: "ACTIVE",
        displayName: `${PREFIX} 管理员`,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: memberId,
        status: "ACTIVE",
        displayName: `${PREFIX} 成员`,
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
  await db.repairActivity.create({
    data: {
      id: activityId,
      title: `${PREFIX} 活动`,
      activityAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
      capacity: 10,
      signupOpensAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
      signupClosesAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    },
  });
  registrationId = randomUUID();
  await db.repairActivityRegistration.create({
    data: {
      id: registrationId,
      activityId,
      name: "路由测试客户",
      phone,
      phoneLast4: phone.slice(-4),
      issueType: "OTHER",
      status: "REGISTERED",
      createdAt: now,
      updatedAt: now,
    },
  });
  await syncCurrentYearNoShows({ now });
  adminCookie = await sessionCookie(adminId, "ADMIN");
  memberCookie = await sessionCookie(memberId, "MEMBER");
});

after(async () => {
  if (!enabled) return;
  try {
    await cleanup();
  } finally {
    await disconnectDb();
  }
});

dbTest("黑名单路由：未登录 401、普通成员 403、同源校验 403", async () => {
  const listUrl = `${BASE}/customer-blacklist`;
  const anonymous = await callRoute(listRoute, listUrl);
  assert.equal(anonymous.status, 401);

  const member = await callRoute(listRoute, listUrl, {
    headers: { cookie: memberCookie },
  });
  assert.equal(member.status, 403);

  const crossOrigin = await callRoute(blockRoute, listUrl, {
    method: "POST",
    headers: { cookie: adminCookie, origin: "http://evil.example" },
    body: { name: "路由测试客户", phone, reason: "同源测试" },
  });
  assert.equal(crossOrigin.status, 403);
});

dbTest("黑名单路由：人工加入、解除、豁免的状态码与响应", async () => {
  const created = await callRoute(blockRoute, `${BASE}/customer-blacklist`, {
    method: "POST",
    headers: { cookie: adminCookie },
    body: { name: "路由测试客户", phone, reason: "人工封锁测试" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.success, true);
  const blockId = (created.json.data as { id: string }).id;

  const listed = await callRoute(listRoute, `${BASE}/customer-blacklist`, {
    headers: { cookie: adminCookie },
  });
  assert.equal(listed.status, 200);
  const view = listed.json.data as {
    blocks: { id: string; status: string; source: string; reason: string }[];
    events: { id: string; state: string; registrationId: string }[];
  };
  assert.equal(view.blocks.find((block) => block.id === blockId)?.source, "MANUAL");
  assert.equal(view.blocks.find((block) => block.id === blockId)?.reason, "人工封锁测试");

  const eventId = view.events.find((event) => event.registrationId === registrationId)?.id;
  assert.ok(eventId);
  const exempted = await callRoute(exemptRoute, `${BASE}/no-show-events/${eventId}/exempt`, {
    method: "POST",
    headers: { cookie: adminCookie },
    body: { note: "路由豁免测试" },
    params: { eventId: eventId as string },
  });
  assert.equal(exempted.status, 200);
  assert.equal(exempted.json.success, true);

  const lifted = await callRoute(liftRoute, `${BASE}/customer-blacklist/${blockId}/lift`, {
    method: "POST",
    headers: { cookie: adminCookie },
    body: { reason: "路由解除测试" },
    params: { blockId },
  });
  assert.equal(lifted.status, 200);
  assert.equal(lifted.json.success, true);
});

dbTest("黑名单路由：成员写操作 403、缺字段 400、不存在资源 404", async () => {
  const memberBlockId = randomUUID();
  const memberLift = await callRoute(
    liftRoute,
    `${BASE}/customer-blacklist/${memberBlockId}/lift`,
    {
      method: "POST",
      headers: { cookie: memberCookie },
      body: { reason: "成员越权" },
      params: { blockId: memberBlockId },
    },
  );
  assert.equal(memberLift.status, 403);

  const memberEventId = randomUUID();
  const memberExempt = await callRoute(
    exemptRoute,
    `${BASE}/no-show-events/${memberEventId}/exempt`,
    {
      method: "POST",
      headers: { cookie: memberCookie },
      body: { note: "成员越权" },
      params: { eventId: memberEventId },
    },
  );
  assert.equal(memberExempt.status, 403);

  for (const body of [
    { phone, reason: "缺姓名" },
    { name: "缺手机客户", reason: "缺手机" },
    { name: "缺原因客户", phone },
  ]) {
    const missing = await callRoute(blockRoute, `${BASE}/customer-blacklist`, {
      method: "POST",
      headers: { cookie: adminCookie },
      body,
    });
    assert.equal(missing.status, 400);
    assert.equal(missing.json.success, false);
  }

  const missingBlockId = randomUUID();
  const missingBlock = await callRoute(
    liftRoute,
    `${BASE}/customer-blacklist/${missingBlockId}/lift`,
    {
      method: "POST",
      headers: { cookie: adminCookie },
      body: { reason: "不存在" },
      params: { blockId: missingBlockId },
    },
  );
  assert.equal(missingBlock.status, 404);

  const missingEventId = randomUUID();
  const missingEvent = await callRoute(
    exemptRoute,
    `${BASE}/no-show-events/${missingEventId}/exempt`,
    {
      method: "POST",
      headers: { cookie: adminCookie },
      body: { note: "不存在" },
      params: { eventId: missingEventId },
    },
  );
  assert.equal(missingEvent.status, 404);
});
