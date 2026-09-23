import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { memberService } from "../../src/features/members/member-service";
import { permissionsForRoles } from "../../src/lib/auth/permissions";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import type { AuthorizedActor } from "../../src/types/contracts";
import type { FilterRule } from "../../src/lib/api/list-filter";

/**
 * 列级筛选的集成测试（真实 GreatSQL）。
 *
 * 单元测试证明了「条件 → `where` 片段」的映射；这里证明**数据库真的按这个条件筛**，
 * 尤其是日期边界：`lte=今天` 必须命中今天创建的成员 —— 这也是最容易写错的一条
 * （写成 `lte: new Date("今天")` 会把当天 08:00 之后的记录全排除，界面上表现为
 * 「筛同一天得到 0 条」）。
 *
 * 隔离方式沿用 M6 约定：独立 UUID 段 `ea000000-…` + realName 前缀 "M9 "。
 */
const enabled = process.env.RUN_DB_TESTS === "1" || process.env.npm_lifecycle_event === "test:db";
const dbTest = enabled ? test : test.skip;

const ACTOR_USER_ID = "ea000000-0000-4000-8000-000000000001";
const PREFIX = "M9 ";

const ADMIN_ACTOR: AuthorizedActor = {
  actorType: "USER",
  userId: ACTOR_USER_ID,
  userStatus: "ACTIVE",
  permissions: permissionsForRoles(["ADMIN"]),
  requestId: "req_m9_filter_integration",
};

/** 上海自然日 `YYYY-MM-DD`（与 `lib/api/date-filter.ts` 的口径一致）。 */
function shanghaiDay(offsetDays = 0): string {
  const at = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(at);
}

before(async () => {
  if (!enabled) return;
  await cleanup();
  const now = new Date();
  await getDb().user.create({
    data: {
      id: ACTOR_USER_ID,
      status: "ACTIVE",
      displayName: "M9 Filter Admin",
      createdAt: now,
      updatedAt: now,
    },
  });
  // **只造一次**：下面每个用例的断言都按「本文件恰好造了 3 个人」来数。
  // 每个用例各造一次会让成员越积越多，断言就会莫名其妙地失败（自己踩过）。
  await seed();
});

after(async () => {
  if (!enabled) return;
  await cleanup();
  await disconnectDb();
});

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
async function createMember(label: string, className: string) {
  seq += 1;
  const serial = `${Date.now()}`.slice(-5) + String(seq).padStart(3, "0");
  const result = await memberService.create(
    {
      realName: `${PREFIX}${label}`,
      qq: `9${serial}`.slice(0, 11),
      phone: `136${serial}`.slice(0, 11),
      studentId: `${PREFIX.trim()}${label}`,
      className,
      idempotencyKey: randomUUID(),
    },
    ADMIN_ACTOR,
  );
  return result.member;
}

function listBy(filters: FilterRule[], query?: string) {
  return memberService.list({ page: 1, pageSize: 50, query, filters }, ADMIN_ACTOR);
}

/**
 * 本文件造的三个人：两个在一班、一个在二班，学号前缀各不相同。
 * 注意每人的 `studentId` 是 `M9甲A` 这种**唯一**值，便于用 contains 精确定位。
 */
async function seed() {
  await createMember("甲A", "M9 一班");
  await createMember("乙B", "M9 一班");
  await createMember("丙C", "M9 二班");
}

dbTest("文本条件：contains 命中，逐列独立生效", async () => {
  const byStudentId = await listBy([{ field: "studentId", op: "contains", value: "甲A" }]);
  assert.equal(byStudentId.pagination.total, 1);
  assert.equal(byStudentId.items[0].realName, `${PREFIX}甲A`);

  const byClassName = await listBy([{ field: "className", op: "contains", value: "M9 一班" }]);
  assert.equal(byClassName.pagination.total, 2);

  const byRealName = await listBy([{ field: "realName", op: "contains", value: "丙C" }]);
  assert.equal(byRealName.pagination.total, 1);
});

dbTest("枚举条件：eq 与 neq 都生效", async () => {
  const active = await listBy([{ field: "status", op: "eq", value: "ACTIVE" }], PREFIX.trim());
  assert.equal(active.pagination.total, 3, "三个都是在册状态");
  const revoked = await listBy([{ field: "status", op: "neq", value: "ACTIVE" }], PREFIX.trim());
  assert.equal(revoked.pagination.total, 0, "neq ACTIVE 不该命中在册成员");
});

dbTest("日期条件：lte=今天 必须命中今天创建的成员（结束日含全天）", async () => {
  const today = shanghaiDay();
  const upToToday = await listBy([{ field: "joinedAt", op: "lte", value: today }], PREFIX.trim());
  assert.equal(
    upToToday.pagination.total,
    3,
    "写成「当天 00:00」的实现会漏掉当天 08:00 之后创建的记录 —— 正是这条断言在守",
  );

  const fromToday = await listBy([{ field: "joinedAt", op: "gte", value: today }], PREFIX.trim());
  assert.equal(fromToday.pagination.total, 3);

  const upToYesterday = await listBy(
    [{ field: "joinedAt", op: "lte", value: shanghaiDay(-1) }],
    PREFIX.trim(),
  );
  assert.equal(upToYesterday.pagination.total, 0, "昨天及以前不该包含今天创建的成员");
});

dbTest("同一字段的 gte + lte 组成区间，且与关键字搜索可以同时生效", async () => {
  const today = shanghaiDay();
  const range = await listBy(
    [
      { field: "joinedAt", op: "gte", value: today },
      { field: "joinedAt", op: "lte", value: today },
    ],
    PREFIX.trim(),
  );
  assert.equal(range.pagination.total, 3, "同一天的闭区间应当命中当天创建的全部记录");

  // 列级筛选是「逐列条件」，`query` 是跨列关键字 —— 两者是 AND。
  const both = await listBy([{ field: "studentId", op: "contains", value: "甲A" }], PREFIX.trim());
  assert.equal(both.pagination.total, 1);
  const mismatch = await listBy([{ field: "studentId", op: "contains", value: "甲A" }], "乙B");
  assert.equal(mismatch.pagination.total, 0, "关键字与列级条件应当同时生效（AND）");
});

dbTest("多个不同列的条件是 AND，不是 OR", async () => {
  const and = await listBy([
    { field: "className", op: "contains", value: "M9 一班" },
    { field: "studentId", op: "contains", value: "甲A" },
  ]);
  assert.equal(and.pagination.total, 1, "两个条件同时满足的只有一个人");
});
