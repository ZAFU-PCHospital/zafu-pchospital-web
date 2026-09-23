import assert from "node:assert/strict";
import test from "node:test";

import { memberListInput } from "../../src/features/members/member-http";
import { MEMBER_FILTERABLE } from "../../src/features/members/member-filter-fields";
import { memberFilterWhere } from "../../src/features/members/member-filter";
import { AppError } from "../../src/lib/api/errors";
import {
  MAX_FILTER_RULES,
  addFilterRule,
  filterParamValues,
  filterSignature,
  isCompleteFilterRule,
  parseFilters,
  removeFilterRule,
  updateFilterRule,
} from "../../src/lib/api/list-filter";
import type { FilterRule } from "../../src/lib/api/list-filter";

/**
 * 列级筛选的参考链路（成员表）。
 *
 * 重点钉三件事：
 * 1. **白名单**（字段 / 运算符 / 空值 / 条数）—— 用户输入绝不透传成查询条件；
 * 2. **客户端拼装 ↔ 服务端解析一致** —— 用 `filterParamValues` 拼出来的参数，
 *    必须能被 `parseFilters` 原样解析回去（含值里带冒号的情况）；
 * 3. **日期边界**：`lte` 必须是「次日 00:00 排他上界」，而不是「当天 00:00」——
 *    后者会把当天 08:00 之后的记录全排除，界面上表现为「筛同一天得到 0 条」。
 */

function isValidationFailure(error: unknown): boolean {
  return error instanceof AppError && error.code === "VALIDATION_FAILED";
}

test("解析：格式、白名单与运算符都校验", () => {
  assert.deepEqual(parseFilters([], MEMBER_FILTERABLE), []);
  assert.deepEqual(parseFilters(["studentId:contains:2026"], MEMBER_FILTERABLE), [
    { field: "studentId", op: "contains", value: "2026" },
  ]);
  // 值里允许出现冒号：只切前两个。
  assert.deepEqual(parseFilters(["className:contains:计科:2101"], MEMBER_FILTERABLE), [
    { field: "className", op: "contains", value: "计科:2101" },
  ]);
  assert.throws(() => parseFilters(["studentId:2026"], MEMBER_FILTERABLE), isValidationFailure);
  assert.throws(() => parseFilters(["qq:contains:1"], MEMBER_FILTERABLE), isValidationFailure);
  // `studentId` 只支持 contains，用 eq 必须被拒。
  assert.throws(() => parseFilters(["studentId:eq:2026"], MEMBER_FILTERABLE), isValidationFailure);
  assert.throws(
    () => parseFilters(["studentId:contains:   "], MEMBER_FILTERABLE),
    isValidationFailure,
  );
});

test("解析：同一字段的不同运算符是合法的（区间），完全相同的条件去重", () => {
  const rules = parseFilters(
    ["joinedAt:gte:2026-09-01", "joinedAt:lte:2026-09-30"],
    MEMBER_FILTERABLE,
  );
  assert.deepEqual(rules, [
    { field: "joinedAt", op: "gte", value: "2026-09-01" },
    { field: "joinedAt", op: "lte", value: "2026-09-30" },
  ]);
  assert.equal(parseFilters(["status:eq:ACTIVE", "status:eq:ACTIVE"], MEMBER_FILTERABLE).length, 1);
});

test("解析：超过上限拒绝，而不是截断", () => {
  const five: string[] = [];
  for (let index = 0; index < MAX_FILTER_RULES; index += 1) {
    five.push(`studentId:contains:v${index}`);
  }
  assert.equal(parseFilters(five, MEMBER_FILTERABLE).length, MAX_FILTER_RULES);
  assert.throws(
    () => parseFilters([...five, "className:contains:x"], MEMBER_FILTERABLE),
    isValidationFailure,
  );
});

test("客户端拼装与服务端解析对同一份条件理解一致", () => {
  const rules: FilterRule[] = [
    { field: "status", op: "eq", value: "ACTIVE" },
    { field: "className", op: "contains", value: "计科:2101" },
  ];
  const params = filterParamValues(rules);
  assert.deepEqual(parseFilters(params, MEMBER_FILTERABLE), rules);
  // URL 查询串走一遍百分号编码也不能坏（值里有冒号与中文）。
  const search = new URLSearchParams();
  for (const value of params) search.append("filter", value);
  assert.deepEqual(parseFilters(search.getAll("filter"), MEMBER_FILTERABLE), rules);
});

test("映射：枚举校验取值，文本走 contains", () => {
  assert.deepEqual(memberFilterWhere([{ field: "status", op: "eq", value: "ACTIVE" }]), [
    { status: "ACTIVE" },
  ]);
  assert.deepEqual(memberFilterWhere([{ field: "status", op: "neq", value: "REVOKED" }]), [
    { status: { not: "REVOKED" } },
  ]);
  assert.throws(
    () => memberFilterWhere([{ field: "status", op: "eq", value: "DELETED" }]),
    isValidationFailure,
  );
  assert.deepEqual(memberFilterWhere([{ field: "studentId", op: "contains", value: "2026" }]), [
    { studentId: { contains: "2026" } },
  ]);
  assert.throws(
    () => memberFilterWhere([{ field: "qq", op: "contains", value: "1" }]),
    isValidationFailure,
  );
});

test("映射：日期按上海自然日解释，结束日**包含全天**", () => {
  // 上海 2026-09-22 的 00:00 = UTC 2026-09-21T16:00Z；次日 00:00 = UTC 2026-09-22T16:00Z。
  const [gte] = memberFilterWhere([{ field: "joinedAt", op: "gte", value: "2026-09-22" }]);
  assert.equal(
    (gte.joinedAt as { gte: Date }).gte.toISOString(),
    "2026-09-21T16:00:00.000Z",
    "起始日应当是当天 00:00（含）",
  );
  const [lte] = memberFilterWhere([{ field: "joinedAt", op: "lte", value: "2026-09-22" }]);
  assert.equal(
    (lte.joinedAt as { lt: Date }).lt.toISOString(),
    "2026-09-22T16:00:00.000Z",
    "结束日应当表达为次日 00:00 的排他上界（含全天），不是当天 00:00",
  );
  assert.throws(
    () => memberFilterWhere([{ field: "joinedAt", op: "gte", value: "2026/09/22" }]),
    isValidationFailure,
  );
});

test("路由入参：重复的 filter 参数解析进 filters，其余参数不受影响", () => {
  const search = new URLSearchParams("query=张&status=ACTIVE");
  search.append("filter", "studentId:contains:2026");
  search.append("filter", "joinedAt:gte:2026-09-01");
  const input = memberListInput(search, 1, 20);
  assert.equal(input.query, "张");
  assert.equal(input.status, "ACTIVE");
  assert.deepEqual(input.filters, [
    { field: "studentId", op: "contains", value: "2026" },
    { field: "joinedAt", op: "gte", value: "2026-09-01" },
  ]);
});

test("界面辅助函数：增删改、上限、完整性判断、签名", () => {
  let rules: FilterRule[] = [];
  rules = addFilterRule(rules);
  assert.deepEqual(rules, [{ field: "", op: "eq", value: "" }]);
  rules = updateFilterRule(rules, 0, { field: "studentId", op: "contains", value: "2026" });
  assert.equal(isCompleteFilterRule(rules[0]), true);
  assert.equal(isCompleteFilterRule({ field: "studentId", op: "contains", value: "  " }), false);
  assert.equal(filterSignature(rules), "studentId:contains:2026");

  let many: FilterRule[] = [];
  for (let index = 0; index < MAX_FILTER_RULES + 2; index += 1) many = addFilterRule(many);
  assert.equal(many.length, MAX_FILTER_RULES, "达到上限后不再追加（界面据此禁用按钮）");

  assert.deepEqual(removeFilterRule(rules, 0), []);
});
