import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../src/lib/api/errors";
import {
  MEMBER_DEFAULT_ORDER_BY,
  MEMBER_SORTABLE,
  memberOrderBy,
} from "../../src/features/members/member-sort";
import { memberListInput } from "../../src/features/members/member-http";

/**
 * 成员列表排序的参考链路（P0）。
 *
 * 覆盖三段：URL 参数解析（白名单）、规则到 `orderBy` 的映射、
 * 以及「分页稳定性」这条最容易漏的约束 —— 主排序键重复时必须仍有确定名次。
 */

function isValidationFailure(error: unknown): boolean {
  return error instanceof AppError && error.code === "VALIDATION_FAILED";
}

test("没有排序参数时沿用服务端默认顺序（拖动顺序优先），且返回的是副本", () => {
  // 默认顺序 = 管理员拖出来的 `sortOrder`（第九轮验收），再按创建时间与 id 兜底。
  const expected = [{ sortOrder: "asc" }, { createdAt: "desc" }, { id: "desc" }];
  const orderBy = memberOrderBy(undefined);
  assert.deepEqual(orderBy, expected);
  assert.deepEqual(memberOrderBy([]), expected);
  // 副本：默认顺序是导出的常量，调用方改返回值不该污染后续请求。
  orderBy.push({ realName: "asc" });
  assert.deepEqual(MEMBER_DEFAULT_ORDER_BY, expected);
});

test("排序规则映射到列，并永远补上 id 兜底", () => {
  assert.deepEqual(memberOrderBy([{ field: "realName", direction: "asc" }]), [
    { realName: "asc" },
    { id: "desc" },
  ]);
  assert.deepEqual(
    memberOrderBy([
      { field: "status", direction: "asc" },
      { field: "joinedAt", direction: "desc" },
    ]),
    [{ status: "asc" }, { joinedAt: "desc" }, { id: "desc" }],
  );
});

test("白名单外的字段在映射层也被拒绝（纵深防御）", () => {
  assert.throws(
    () => memberOrderBy([{ field: "passwordHash", direction: "asc" }]),
    isValidationFailure,
  );
  // 聚合出来的「维修次数」不是列，不能直接排序 —— 它必须报错，而不是被当成列名透传。
  assert.throws(
    () => memberOrderBy([{ field: "approvedRepairCount", direction: "desc" }]),
    isValidationFailure,
  );
});

test("路由入参：sort 走白名单解析，其余筛选项行为不变", () => {
  const input = memberListInput(
    new URLSearchParams("query=%E5%BC%A0%E4%B8%89&status=ACTIVE&sort=joinedAt:desc"),
    2,
    20,
  );
  assert.deepEqual(input, {
    page: 2,
    pageSize: 20,
    query: "张三",
    status: "ACTIVE",
    role: undefined,
    sort: [{ field: "joinedAt", direction: "desc" }],
    // 列级筛选是另一个参数（`filter`，可重复）：没有条件时是空数组，不是 undefined。
    filters: [],
  });
});

test("路由入参：非法 sort 直接 400，不透传到 Repository", () => {
  assert.throws(
    () => memberListInput(new URLSearchParams("sort=passwordHash:asc"), 1, 20),
    isValidationFailure,
  );
  assert.throws(
    () => memberListInput(new URLSearchParams("sort=joinedAt:sideways"), 1, 20),
    isValidationFailure,
  );
});

test("路由入参：没有 sort 时给空数组（由 Repository 决定默认顺序）", () => {
  const input = memberListInput(new URLSearchParams(), 1, 20);
  assert.deepEqual(input.sort, []);
  // 空数组 = 用户没点过表头 ⇒ 走服务端默认顺序（拖动顺序优先）。
  assert.deepEqual(memberOrderBy(input.sort), [
    { sortOrder: "asc" },
    { createdAt: "desc" },
    { id: "desc" },
  ]);
});

test("白名单与前端可选列一致：只包含可比较的标量列", () => {
  assert.deepEqual(
    [...MEMBER_SORTABLE],
    ["realName", "nickname", "studentId", "className", "status", "joinedAt"],
  );
  // 关联列与聚合列不得进入白名单：前者没有标量可比较，后者需要 JOIN 聚合。
  for (const unsupported of ["skills", "roles", "contacts", "approvedRepairCount"]) {
    assert.equal((MEMBER_SORTABLE as readonly string[]).includes(unsupported), false);
  }
});
