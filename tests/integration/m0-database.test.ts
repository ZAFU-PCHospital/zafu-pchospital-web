import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { inviteCodeService } from "../../src/features/invitations/invite-code-service";
import { joinApplicationService } from "../../src/features/recruitment/join-application-service";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import { permissionsForRoles } from "../../src/lib/auth/permissions";

const enabled = process.env.RUN_DB_TESTS === "1" || process.env.npm_lifecycle_event === "test:db";
const dbTest = enabled ? test : test.skip;
const adminId = "10000000-0000-4000-8000-000000000001";

before(async () => {
  if (!enabled) return;
  const db = getDb();
  await db.auditLog.deleteMany();
  await db.accountProvision.deleteMany();
  await db.inviteCodeRedemption.deleteMany();
  await db.inviteCode.deleteMany();
  await db.joinApplicationReview.deleteMany();
  await db.joinApplication.deleteMany();
  await db.passwordCredential.deleteMany();
  await db.userRole.deleteMany();
  await db.memberProfile.deleteMany();
  await db.userIdentity.deleteMany();
  await db.user.deleteMany();
  await db.user.create({
    data: {
      id: adminId,
      status: "ACTIVE",
      displayName: "M0 Admin",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
});

after(async () => {
  if (enabled) await disconnectDb();
});

const adminActor = {
  actorType: "USER" as const,
  userId: adminId,
  userStatus: "ACTIVE" as const,
  permissions: permissionsForRoles(["ADMIN"]),
  requestId: "req_m0_test",
};

dbTest("基础角色 Seed 重复语义保持幂等", async () => {
  const db = getDb();
  for (let run = 0; run < 2; run += 1) {
    await db.role.upsert({
      where: { code: "MEMBER" },
      update: { name: "成员" },
      create: {
        id: "00000000-0000-4000-8000-000000000001",
        code: "MEMBER",
        name: "成员",
        createdAt: new Date(),
      },
    });
    await db.role.upsert({
      where: { code: "ADMIN" },
      update: { name: "管理员" },
      create: {
        id: "00000000-0000-4000-8000-000000000002",
        code: "ADMIN",
        name: "管理员",
        createdAt: new Date(),
      },
    });
  }
  assert.equal(await db.role.count({ where: { code: { in: ["MEMBER", "ADMIN"] } } }), 2);
});

dbTest("重复报名返回原回执且不重复写入", async () => {
  const suffix = randomUUID().replace(/\D/g, "").slice(0, 5).padEnd(5, "1");
  const input = {
    recruitmentCycle: `M0-${randomUUID().slice(0, 8)}`,
    realName: "测试报名者",
    qq: `6${suffix}12345`.slice(0, 10),
    phone: `139${suffix.padEnd(8, "2")}`.slice(0, 11),
    privacyConsent: true,
  };
  const first = await joinApplicationService.submit(input, { requestId: "req_join_1" });
  const replay = await joinApplicationService.submit(input, { requestId: "req_join_2" });
  assert.equal(replay.id, first.id);
  assert.equal(replay.duplicate, true);
  assert.equal(
    await getDb().joinApplication.count({ where: { recruitmentCycle: input.recruitmentCycle } }),
    1,
  );
});

dbTest("面试通过重复执行不创建重复账号、档案或角色", async () => {
  const input = {
    recruitmentCycle: `REVIEW-${randomUUID().slice(0, 8)}`,
    realName: "测试成员",
    qq: `7${Date.now()}`.slice(0, 10),
    phone: `138${String(Date.now()).slice(-8)}`,
    privacyConsent: true,
  };
  const receipt = await joinApplicationService.submit(input, { requestId: "req_review_submit" });
  const review = {
    applicationId: receipt.id,
    result: "PASSED" as const,
    interviewedAt: new Date().toISOString(),
    idempotencyKey: `join-${receipt.id}`,
  };
  await joinApplicationService.review(review, adminActor);
  await joinApplicationService.review(review, adminActor);
  const provision = await getDb().accountProvision.findUniqueOrThrow({
    where: { sourceType_sourceId: { sourceType: "JOIN_APPLICATION", sourceId: receipt.id } },
  });
  assert.equal(provision.status, "SUCCEEDED");
  assert.equal(await getDb().memberProfile.count({ where: { userId: provision.userId! } }), 1);
  assert.equal(
    await getDb().userRole.count({ where: { userId: provision.userId!, revokedAt: null } }),
    1,
  );
});

dbTest("同一码可限次复用且 10 个并发请求不会超卖最后一个名额", async () => {
  const created = await inviteCodeService.create({ maxUses: 1 }, adminActor);
  const attempts = Array.from({ length: 10 }, (_, index) =>
    inviteCodeService.redeem(
      {
        code: created.plainCode,
        idempotencyKey: `redeem-${randomUUID()}`,
        realName: `并发成员${index}`,
        qq: `8${String(Date.now() + index).slice(-9)}`,
        phone: `137${String(Date.now() + index).slice(-8)}`,
        password: `M0-Test-Password-${index}`,
      },
      { requestId: `req_redeem_${index}` },
    ),
  );
  const settled = await Promise.allSettled(attempts);
  assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
  const stored = await getDb().inviteCode.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.usedCount, 1);
  assert.equal(
    await getDb().inviteCodeRedemption.count({ where: { inviteCodeId: created.id } }),
    1,
  );
  assert.equal(
    await getDb().accountProvision.count({
      where: { sourceType: "INVITE_REDEMPTION", status: "SUCCEEDED" },
    }),
    1,
  );
});

dbTest("管理员不能把最大次数调低到 usedCount 以下，也不能直接写 usedCount", async () => {
  const created = await inviteCodeService.create({ maxUses: 2 }, adminActor);
  await assert.rejects(() => inviteCodeService.update(created.id, { maxUses: 0 }, adminActor));
  const stored = await getDb().inviteCode.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.usedCount, 0);
  assert.equal(stored.maxUses, 2);
});
