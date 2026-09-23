import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { memberService } from "../../src/features/members/member-service";
import { AppError } from "../../src/lib/api/errors";
import { permissionsForRoles } from "../../src/lib/auth/permissions";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import type { AuthorizedActor } from "../../src/types/contracts";
import type { SortRule } from "../../src/types/table";
import { integrationTestsEnabled } from "./db-guard";

/**
 * 成员列表排序的集成测试（真实 GreatSQL）。
 *
 * 单元测试只能证明「规则到 orderBy 的映射是对的」，证明不了**数据库真的按这个顺序返回**，
 * 也证明不了分页是否稳定。这里补上这两件事：
 *
 * 1. `realName` 升序 / 降序在真实查询里生效（而不是被前端假排序掩盖）；
 * 2. **主排序键重复时逐页读取不重复、不遗漏** —— 这是排序与无限下翻共存的前提：
 *    成员表是「往下滚动接下一页」，主键重复而没有 tiebreaker 时，MySQL 每次返回的
 *    名次都可能不同，`skip`/`take` 就会把同一行读两次、把另一行漏掉。
 *
 * 隔离方式沿用 M6 的约定：独立 UUID 段 `e7000000-…` + realName 前缀 "M7 "，
 * 清理一律按这两者限定，绝不触碰库里已有的真实开发数据。
 */
/* 集成测试的统一闸门：指向非测试库时**在加载阶段就抛错**（`db-guard.ts` 里写了两次
   实际事故）。未开启时返回 false，各文件照常走 test.skip。 */
const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;

const ACTOR_USER_ID = "e7000000-0000-4000-8000-000000000001";
const PREFIX = "M7 ";

const ADMIN_ACTOR: AuthorizedActor = {
  actorType: "USER",
  userId: ACTOR_USER_ID,
  userStatus: "ACTIVE",
  permissions: permissionsForRoles(["ADMIN"]),
  requestId: "req_m7_sort_integration",
};

before(async () => {
  if (!enabled) return;
  await cleanup();
  const now = new Date();
  await getDb().user.create({
    data: {
      id: ACTOR_USER_ID,
      status: "ACTIVE",
      displayName: "M7 Sort Admin",
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
async function createMember(label: string) {
  seq += 1;
  const serial = `${Date.now()}`.slice(-5) + String(seq).padStart(3, "0");
  const result = await memberService.create(
    {
      realName: `${PREFIX}${label}`,
      qq: `7${serial}`.slice(0, 11),
      phone: `138${serial}`.slice(0, 11),
      studentId: `T${serial}`,
      className: "M7 排序测试班",
      idempotencyKey: randomUUID(),
    },
    ADMIN_ACTOR,
  );
  return result.member;
}

function listBy(sort: SortRule[], page = 1, pageSize = 50, query: string = PREFIX) {
  return memberService.list({ page, pageSize, query, sort }, ADMIN_ACTOR);
}

dbTest("排序在真实查询里生效：realName 升序与降序互为逆序", async () => {
  await createMember("排序 A");
  await createMember("排序 B");
  await createMember("排序 C");

  const asc = await listBy([{ field: "realName", direction: "asc" }]);
  assert.deepEqual(
    asc.items.map((item) => item.realName),
    [`${PREFIX}排序 A`, `${PREFIX}排序 B`, `${PREFIX}排序 C`],
  );

  const desc = await listBy([{ field: "realName", direction: "desc" }]);
  assert.deepEqual(
    desc.items.map((item) => item.realName),
    [`${PREFIX}排序 C`, `${PREFIX}排序 B`, `${PREFIX}排序 A`],
  );

  // 两次查询的行集合必须一致（排序只改变顺序，不改变命中集合）。
  assert.deepEqual(
    [...asc.items.map((item) => item.id)].sort(),
    [...desc.items.map((item) => item.id)].sort(),
  );
  assert.equal(asc.pagination.total, 3);
});

dbTest("分页稳定性：主排序键重复时逐页读取不重复、不遗漏", async () => {
  // 三条同名记录：realName 完全相同时，名次只能由 tiebreaker（id）决定。
  //
  // 实测说明（别把它当成熟度更高的保证）：**把 `memberOrderBy` 里的 tiebreaker 去掉，
  // 这个用例在当前数据量下依然是绿的** —— 小表上 InnoDB 的返回顺序恰好稳定。
  // 真正守住 tiebreaker 的是单元测试（`memberOrderBy` 必须补 `{ id: "desc" }`，
  // 去掉即红）。这里保留它作为端到端护栏：一旦排序链路被改坏到能读重 / 漏行，
  // 它会先叫；但它证明不了「没有 tiebreaker 也安全」。
  await createMember("同名");
  await createMember("同名");
  await createMember("同名");

  const seen: string[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const result = await listBy(
      [{ field: "realName", direction: "asc" }],
      page,
      1,
      `${PREFIX}同名`,
    );
    if (result.items.length === 0) break;
    seen.push(...result.items.map((item) => item.id));
    if (page >= result.pagination.totalPages) break;
  }

  assert.equal(seen.length, 3, "逐页读取应当恰好读到三行");
  assert.equal(new Set(seen).size, 3, "同一行被读到了两次：分页缺 tiebreaker");
});

dbTest("回归：不传 sort 时保持原默认顺序（新成员在前）", async () => {
  const first = await createMember("顺序 1");
  const second = await createMember("顺序 2");

  const result = await memberService.list({ page: 1, pageSize: 50, query: PREFIX }, ADMIN_ACTOR);
  const ids = result.items.map((item) => item.id);
  assert.ok(
    ids.indexOf(second.id) < ids.indexOf(first.id),
    "默认顺序应当是 createdAt desc（新成员在前）",
  );
});

dbTest("纵深防御：白名单外的字段在服务层被拒绝，不会透传成列名", async () => {
  await assert.rejects(
    () =>
      memberService.list(
        {
          page: 1,
          pageSize: 20,
          sort: [{ field: "approvedRepairCount", direction: "desc" }],
        },
        ADMIN_ACTOR,
      ),
    (error: unknown) => error instanceof AppError && error.code === "VALIDATION_FAILED",
  );
});
