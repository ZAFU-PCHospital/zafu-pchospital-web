import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { memberService } from "../../src/features/members/member-service";
import { AppError } from "../../src/lib/api/errors";
import { permissionsForRoles } from "../../src/lib/auth/permissions";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import type { AuthorizedActor } from "../../src/types/contracts";
import { integrationTestsEnabled } from "./db-guard";

/**
 * 就地编辑的乐观锁集成测试（真实 GreatSQL）。
 *
 * 这条链路的关键不变量只有一条：**编辑成功后必须拿到新的 `version`**。
 * 就地编辑允许连续改同一行的两个字段（先改学号、再改班级），第二次提交用的是第一次
 * 返回的版本号 —— 如果 PATCH 不返回新版本，界面只能猜或者整表重取，
 * 而整表重取会把无限下翻出来的几页缩回第一页。
 *
 * 隔离方式沿用 M6 约定：独立 UUID 段 `e8000000-…` + realName 前缀 "M8 "。
 */
/* 集成测试的统一闸门：指向非测试库时**在加载阶段就抛错**（`db-guard.ts` 里写了两次
   实际事故）。未开启时返回 false，各文件照常走 test.skip。 */
const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;

const ACTOR_USER_ID = "e8000000-0000-4000-8000-000000000001";
const PREFIX = "M8 ";

const ADMIN_ACTOR: AuthorizedActor = {
  actorType: "USER",
  userId: ACTOR_USER_ID,
  userStatus: "ACTIVE",
  permissions: permissionsForRoles(["ADMIN"]),
  requestId: "req_m8_inline_edit_integration",
};

before(async () => {
  if (!enabled) return;
  await cleanup();
  const now = new Date();
  await getDb().user.create({
    data: {
      id: ACTOR_USER_ID,
      status: "ACTIVE",
      displayName: "M8 Inline Edit Admin",
      createdAt: now,
      updatedAt: now,
    },
  });
});

after(async () => {
  if (!enabled) return;
  await cleanup();
  await disconnectDb();
});

/** 按外键依赖顺序清理本文件产生的数据（审计日志对 User 是 Restrict 外键，必须先删）。 */
async function cleanup(): Promise<void> {
  const db = getDb();
  const profiles = await db.memberProfile.findMany({
    where: { realName: { startsWith: PREFIX } },
    select: { id: true, userId: true },
  });
  const profileIds = profiles.map((row) => row.id);
  const userIds = [...new Set([ACTOR_USER_ID, ...profiles.map((row) => row.userId)])];
  await db.auditLog.deleteMany({
    where: {
      OR: [{ actorUserId: { in: userIds } }, { targetId: { in: [...userIds, ...profileIds] } }],
    },
  });
  await db.accountProvision.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { memberProfileId: { in: profileIds } }] },
  });
  await db.authSession.deleteMany({ where: { userId: { in: userIds } } });
  await db.passwordCredential.deleteMany({ where: { userId: { in: userIds } } });
  await db.userRole.deleteMany({ where: { userId: { in: userIds } } });
  await db.userIdentity.deleteMany({ where: { userId: { in: userIds } } });
  await db.userSkill.deleteMany({ where: { memberProfileId: { in: profileIds } } });
  await db.memberProfile.deleteMany({ where: { id: { in: profileIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
}

let seq = 0;
async function createMember() {
  seq += 1;
  const serial = `${Date.now()}`.slice(-5) + String(seq).padStart(3, "0");
  const result = await memberService.create(
    {
      realName: `${PREFIX}就地编辑`,
      qq: `8${serial}`.slice(0, 11),
      phone: `137${serial}`.slice(0, 11),
      studentId: `I${serial}`,
      className: "M8 原班级",
      idempotencyKey: randomUUID(),
    },
    ADMIN_ACTOR,
  );
  const entry = await memberService.list(
    { page: 1, pageSize: 1, query: result.member.realName },
    ADMIN_ACTOR,
  );
  return { id: result.member.id, version: entry.items[0].version };
}

dbTest("编辑返回新的 version：连续改同一行的两个字段都能成功", async () => {
  const created = await createMember();

  const afterStudentId = await memberService.update(
    created.id,
    { studentId: "20260002", version: created.version },
    ADMIN_ACTOR,
  );
  assert.equal(afterStudentId.studentId, "20260002");
  assert.equal(
    afterStudentId.version,
    created.version + 1,
    "编辑成功必须返回自增后的版本号，否则就地编辑的第二次提交必然 409",
  );

  // 第二次提交用**上一次返回的**版本号：这正是就地编辑连续改一行的路径。
  const afterClassName = await memberService.update(
    created.id,
    { className: "M8 新班级", version: afterStudentId.version },
    ADMIN_ACTOR,
  );
  assert.equal(afterClassName.className, "M8 新班级");
  assert.equal(afterClassName.version, created.version + 2);
});

dbTest("旧版本号再提交必须冲突（乐观锁没有被返回值绕过）", async () => {
  const created = await createMember();
  const updated = await memberService.update(
    created.id,
    { className: "M8 第一次", version: created.version },
    ADMIN_ACTOR,
  );
  await assert.rejects(
    () =>
      memberService.update(
        created.id,
        { className: "M8 抢写", version: created.version },
        ADMIN_ACTOR,
      ),
    (error: unknown) =>
      error instanceof AppError && error.code === "MEMBER_PROFILE_VERSION_CONFLICT",
  );
  // 冲突之后用最新版本仍可继续编辑（界面拿到 409 后应重新取一次这一行）。
  const retried = await memberService.update(
    created.id,
    { className: "M8 重试成功", version: updated.version },
    ADMIN_ACTOR,
  );
  assert.equal(retried.className, "M8 重试成功");
});

dbTest("清空字段：提交空串归一成 null，不是空字符串", async () => {
  const created = await createMember();
  const cleared = await memberService.update(
    created.id,
    { studentId: "", className: "   ", version: created.version },
    ADMIN_ACTOR,
  );
  // 就地编辑把空单元格编辑成空值时走的就是这条路：界面上仍显示占位符 `—`。
  assert.equal(cleared.studentId, null);
  assert.equal(cleared.className, null);
});
