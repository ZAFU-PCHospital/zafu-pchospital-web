import assert from "node:assert/strict";
import test from "node:test";

import { repairListInput } from "../../src/features/repairs/repair-http";
import {
  REPAIR_DEFAULT_ORDER_BY,
  REPAIR_SORTABLE,
  repairOrderBy,
} from "../../src/features/repairs/repair-sort";
import { AppError } from "../../src/lib/api/errors";

/**
 * 维修记录排序的参考链路（与 `member-sort.test.ts` 同一形状）。
 *
 * 额外钉住一条最容易写错的映射：**关联列按名字排，不是按外键 id**。
 * `{ memberProfileId: "asc" }` 在类型上也说得通，但排出来是 UUID 顺序 ——
 * 看着「排了」，实际对使用者毫无意义。
 */

function isValidationFailure(error: unknown): boolean {
  return error instanceof AppError && error.code === "VALIDATION_FAILED";
}

test("没有排序参数时用服务端默认顺序（维修日期倒序），且返回副本", () => {
  const expected = [{ repairDate: "desc" }, { createdAt: "desc" }, { id: "desc" }];
  const orderBy = repairOrderBy(undefined);
  assert.deepEqual(orderBy, expected);
  assert.deepEqual(repairOrderBy([]), expected);
  orderBy.push({ status: "asc" });
  assert.deepEqual(REPAIR_DEFAULT_ORDER_BY, expected, "默认顺序常量不该被调用方改到");
});

test("排序映射：标量列直接映射，并永远补 id 兜底", () => {
  assert.deepEqual(repairOrderBy([{ field: "durationMinutes", direction: "asc" }]), [
    { durationMinutes: "asc" },
    { id: "desc" },
  ]);
  assert.deepEqual(
    repairOrderBy([
      { field: "status", direction: "asc" },
      { field: "repairDate", direction: "desc" },
    ]),
    [{ status: "asc" }, { repairDate: "desc" }, { id: "desc" }],
  );
});

test("排序映射：关联列按**名字**排，不按外键 id", () => {
  assert.deepEqual(repairOrderBy([{ field: "memberName", direction: "asc" }]), [
    { memberProfile: { realName: "asc" } },
    { id: "desc" },
  ]);
  assert.deepEqual(repairOrderBy([{ field: "categoryName", direction: "desc" }]), [
    { category: { name: "desc" } },
    { id: "desc" },
  ]);
});

test("白名单外的字段在映射层也被拒绝（纵深防御）", () => {
  assert.throws(
    () => repairOrderBy([{ field: "memberProfileId", direction: "asc" }]),
    isValidationFailure,
  );
  assert.throws(() => repairOrderBy([{ field: "content", direction: "asc" }]), isValidationFailure);
  assert.throws(
    () => repairOrderBy([{ field: "passwordHash", direction: "asc" }]),
    isValidationFailure,
  );
});

test("路由入参：sort 走白名单解析，其余筛选行为不变", () => {
  const input = repairListInput(
    new URLSearchParams("status=APPROVED&result=COMPLETED&isDifficult=true&sort=repairDate:asc"),
    2,
    20,
  );
  assert.equal(input.page, 2);
  assert.equal(input.pageSize, 20);
  assert.equal(input.status, "APPROVED");
  assert.equal(input.result, "COMPLETED");
  assert.equal(input.isDifficult, true);
  assert.deepEqual(input.sort, [{ field: "repairDate", direction: "asc" }]);
});

test("路由入参：非法 sort 直接 400，不透传到 Repository", () => {
  assert.throws(
    () => repairListInput(new URLSearchParams("sort=content:asc"), 1, 20),
    isValidationFailure,
  );
  assert.throws(
    () => repairListInput(new URLSearchParams("sort=repairDate:sideways"), 1, 20),
    isValidationFailure,
  );
});

test("白名单只含可比较的标量列与关联名字列", () => {
  assert.deepEqual(
    [...REPAIR_SORTABLE],
    [
      "repairDate",
      "durationMinutes",
      "status",
      "result",
      "memberName",
      "categoryName",
      "createdAt",
    ],
  );
  // 长文本与一对多关系不得进入白名单。
  for (const unsupported of ["content", "remark", "photos", "reviews", "memberProfileId"]) {
    assert.equal((REPAIR_SORTABLE as readonly string[]).includes(unsupported), false);
  }
});
