import assert from "node:assert/strict";
import { after, test } from "node:test";

import { repairQueryService } from "../../src/features/repairs/repair-query-service";
import { AppError } from "../../src/lib/api/errors";
import { permissionsForRoles } from "../../src/lib/auth/permissions";
import { disconnectDb } from "../../src/lib/db/client";
import type { AuthorizedActor } from "../../src/types/contracts";
import type { SortRule } from "../../src/types/table";
import { integrationTestsEnabled } from "./db-guard";

/**
 * 维修记录排序的集成测试（真实 GreatSQL）。
 *
 * 与 `member-sort.test.ts` 不同，这里**不造任何数据** —— 排序读的是共享的开发库，
 * 只做只读断言。这有两个好处：不碰别人的数据；而且「同名状态 / 同一天」这类重复值
 * 在真实数据里本来就有，正好用来验分页稳定性（tiebreaker）。
 *
 * 只读 + `repair:review` 权限：`list()` 里那条 `activeMemberForUser` 只对**非审核者**执行，
 * 因此这里不需要在库里建任何用户或成员档案。
 *
 * **这套用例的强度取决于库里现有的数据量**（它不做种子数据）：单调性断言在只有几条
 * 记录时是宽松的护栏，真正把「白名单 → 映射 → orderBy」钉死的是
 * `tests/unit/repair-sort.test.ts`。等这个库有了成规模的维修记录，这里的断言会自然变严。
 */
/* 集成测试的统一闸门：指向非测试库时**在加载阶段就抛错**（`db-guard.ts` 里写了两次
   实际事故）。未开启时返回 false，各文件照常走 test.skip。 */
const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;

const ADMIN_ACTOR: AuthorizedActor = {
  actorType: "USER",
  userId: "e9000000-0000-4000-8000-000000000001",
  userStatus: "ACTIVE",
  permissions: permissionsForRoles(["ADMIN"]),
  requestId: "req_m9_repair_sort_integration",
};

after(async () => {
  if (!enabled) return;
  await disconnectDb();
});

function listBy(sort: SortRule[], page = 1, pageSize = 50) {
  return repairQueryService.list({ page, pageSize, sort }, ADMIN_ACTOR);
}

dbTest("排序真的生效：维修日期升序（草稿没有日期，MySQL 把它们排在最前）", async () => {
  const { items } = await listBy([{ field: "repairDate", direction: "asc" }]);
  assert.ok(items.length > 1, "开发库里应当有多条维修记录");
  const dates = items.map((item) => item.repairDate);
  const firstDated = dates.findIndex((value) => value !== null);
  assert.equal(
    dates.slice(firstDated).some((value) => value === null),
    false,
    "升序里 null 应当集中在最前（MySQL 语义），不该夹在中间",
  );
  for (let index = firstDated + 1; index < dates.length; index += 1) {
    const previous = dates[index - 1] as string;
    const current = dates[index] as string;
    assert.ok(previous <= current, `第 ${index} 条日期 ${current} 小于前一条 ${previous}`);
  }
});

dbTest("排序真的生效：时长降序（没填时长的排最后）", async () => {
  const { items } = await listBy([{ field: "durationMinutes", direction: "desc" }]);
  const minutes = items.map((item) => item.durationMinutes);
  const lastDated = minutes.reduce<number>(
    (last, value, index) => (value !== null ? index : last),
    -1,
  );
  assert.equal(
    minutes.slice(0, lastDated + 1).some((value) => value === null),
    false,
    "降序里 null 应当集中在最后",
  );
  for (let index = 1; index <= lastDated; index += 1) {
    const previous = minutes[index - 1] as number;
    const current = minutes[index] as number;
    assert.ok(previous >= current, `第 ${index} 条时长 ${current} 大于前一条 ${previous}`);
  }
});

dbTest("排序不改变命中集合：换排序后总数与 id 集合都不变", async () => {
  const byDefault = await listBy([]);
  const byStatus = await listBy([{ field: "status", direction: "asc" }]);
  assert.equal(byStatus.pagination.total, byDefault.pagination.total, "排序只改顺序，不该改总数");
  assert.deepEqual(
    [...byStatus.items.map((item) => item.id)].sort(),
    [...byDefault.items.map((item) => item.id)].sort(),
    "第一页的 id 集合应当一致（排序不是筛选）",
  );
});

dbTest("分页稳定性：状态列重复值极多，逐页读取仍不重复、不遗漏", async () => {
  // `status` 只有四个取值，重复值必然很多 —— 正是 tiebreaker 缺失时会出问题的场景。
  // 每页取 1 条、逐页走：开发库里记录还少，这个用例现在只走两三页，**数据长起来会自动变强**。
  const sort: SortRule[] = [{ field: "status", direction: "asc" }];
  const first = await listBy(sort, 1, 1);
  const pages = Math.min(first.pagination.totalPages, 8);
  const seen: string[] = [];
  for (let page = 1; page <= pages; page += 1) {
    const result = await listBy(sort, page, 1);
    seen.push(...result.items.map((item) => item.id));
  }
  assert.equal(new Set(seen).size, seen.length, "同一行被读到了两次：分页缺 tiebreaker");
  assert.equal(seen.length, Math.min(first.pagination.total, pages));
});

dbTest("纵深防御：白名单外的字段在服务层被拒绝（长文本 / 外键 id）", async () => {
  for (const field of ["content", "memberProfileId", "passwordHash"]) {
    await assert.rejects(
      () => listBy([{ field, direction: "asc" }]),
      (error: unknown) => error instanceof AppError && error.code === "VALIDATION_FAILED",
      `${field} 不该被接受`,
    );
  }
});
