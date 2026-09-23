import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../src/lib/api/errors";
import {
  ariaSortOf,
  cycleSortRule,
  listQueryParams,
  parseListQuery,
  sortDirectionOf,
  sortParam,
  sortRules,
} from "../../src/lib/api/list-query";
import {
  defaultNumeric,
  findField,
  initialColumnVisibility,
  isFieldSortable,
  sortableFields,
} from "../../src/lib/table/field-spec";
import { MAX_SORT_RULES } from "../../src/types/table";
import type { FieldSpec, TableViewSpec } from "../../src/types/table";

const SORTABLE = ["joinedAt", "realName", "approvedRepairCount"] as const;

function isValidationFailure(error: unknown): boolean {
  return error instanceof AppError && error.code === "VALIDATION_FAILED";
}

test("排序参数：默认升序、支持多字段、忽略空段", () => {
  assert.deepEqual(sortRules(null, SORTABLE), []);
  assert.deepEqual(sortRules("", SORTABLE), []);
  assert.deepEqual(sortRules("joinedAt", SORTABLE), [{ field: "joinedAt", direction: "asc" }]);
  assert.deepEqual(sortRules("joinedAt:desc", SORTABLE), [
    { field: "joinedAt", direction: "desc" },
  ]);
  assert.deepEqual(sortRules("joinedAt:desc, realName:asc", SORTABLE), [
    { field: "joinedAt", direction: "desc" },
    { field: "realName", direction: "asc" },
  ]);
  // 尾部逗号（前端拼接时的常见残留）不该让整条查询失败。
  assert.deepEqual(sortRules("joinedAt:desc,", SORTABLE), [
    { field: "joinedAt", direction: "desc" },
  ]);
});

test("排序参数：白名单以外的字段一律拒绝，不透传给查询", () => {
  assert.throws(() => sortRules("passwordHash:asc", SORTABLE), isValidationFailure);
  assert.throws(() => sortRules("joinedAt:asc,qq:desc", SORTABLE), isValidationFailure);
});

test("排序参数：非法方向拒绝；同一字段重复出现只保留第一条", () => {
  assert.throws(() => sortRules("joinedAt:up", SORTABLE), isValidationFailure);
  assert.deepEqual(sortRules("joinedAt:desc,joinedAt:asc", SORTABLE), [
    { field: "joinedAt", direction: "desc" },
  ]);
});

test("排序参数：超过上限拒绝，而不是静默截断", () => {
  assert.equal(MAX_SORT_RULES, 3);
  const atLimit = "joinedAt:asc,realName:asc,approvedRepairCount:asc";
  assert.equal(sortRules(atLimit, SORTABLE).length, MAX_SORT_RULES);
  // 第四个**不同**字段：重复字段走的是「只保留第一条」，不会触发上限。
  assert.throws(
    () => sortRules(`${atLimit},status:asc`, [...SORTABLE, "status"]),
    isValidationFailure,
  );
});

test("排序参数：拼装与解析互为逆运算", () => {
  const rules = [
    { field: "joinedAt", direction: "desc" as const },
    { field: "realName", direction: "asc" as const },
  ];
  assert.equal(sortParam(rules), "joinedAt:desc,realName:asc");
  assert.deepEqual(sortRules(sortParam(rules), SORTABLE), rules);
  assert.equal(sortParam([]), null);
});

test("表头点击是「未排序 → 升序 → 降序 → 未排序」三态循环", () => {
  let rules = cycleSortRule([], "joinedAt");
  assert.deepEqual(rules, [{ field: "joinedAt", direction: "asc" }]);
  rules = cycleSortRule(rules, "joinedAt");
  assert.deepEqual(rules, [{ field: "joinedAt", direction: "desc" }]);
  // 第三下回到「不排序」：服务端默认顺序是列表的正常状态，必须有入口退回去。
  rules = cycleSortRule(rules, "joinedAt");
  assert.deepEqual(rules, []);
});

test("表头点击：不影响其它列的排序，凑满上限后不再新增", () => {
  const existing = [
    { field: "joinedAt", direction: "desc" as const },
    { field: "realName", direction: "asc" as const },
  ];
  const after = cycleSortRule(existing, "approvedRepairCount");
  assert.equal(after.length, 3);
  assert.deepEqual(after.slice(0, 2), existing);
  // 已到上限：第四次点击不新增字段，也不挤掉已设好的排序。
  assert.deepEqual(cycleSortRule(after, "status"), after);
});

test("aria-sort 只表达状态，未排序时省略属性", () => {
  const rules = [{ field: "joinedAt", direction: "desc" as const }];
  assert.equal(sortDirectionOf(rules, "joinedAt"), "desc");
  assert.equal(sortDirectionOf(rules, "realName"), null);
  assert.equal(ariaSortOf(rules, "joinedAt"), "descending");
  assert.equal(ariaSortOf([{ field: "joinedAt", direction: "asc" }], "joinedAt"), "ascending");
  assert.equal(ariaSortOf(rules, "realName"), undefined);
});

test("查询串：空关键字不写参数，排序按契约格式拼装", () => {
  const params = listQueryParams({
    page: 2,
    pageSize: 20,
    query: "   ",
    sort: [{ field: "joinedAt", direction: "desc" }],
  });
  assert.equal(params.get("page"), "2");
  assert.equal(params.get("pageSize"), "20");
  assert.equal(params.has("query"), false);
  assert.equal(params.get("sort"), "joinedAt:desc");
});

test("服务端解析：分页沿用既有校验，缺省排序用服务端默认值", () => {
  const parsed = parseListQuery(
    new URLSearchParams("page=3&pageSize=50&query=%E5%BC%A0%E4%B8%89"),
    {
      sortable: SORTABLE,
      defaultSort: [{ field: "joinedAt", direction: "desc" }],
    },
  );
  assert.deepEqual(parsed, {
    page: 3,
    pageSize: 50,
    query: "张三",
    sort: [{ field: "joinedAt", direction: "desc" }],
  });

  // 用户点过表头：以用户的选择为准，默认排序不参与合并。
  const explicit = parseListQuery(new URLSearchParams("sort=realName:asc"), {
    sortable: SORTABLE,
    defaultSort: [{ field: "joinedAt", direction: "desc" }],
  });
  assert.deepEqual(explicit.sort, [{ field: "realName", direction: "asc" }]);
  assert.equal(explicit.page, 1);
});

test("服务端解析：分页非法值继承既有错误码", () => {
  assert.throws(
    () => parseListQuery(new URLSearchParams("pageSize=500"), { sortable: SORTABLE }),
    isValidationFailure,
  );
  assert.throws(
    () => parseListQuery(new URLSearchParams("page=0"), { sortable: SORTABLE }),
    isValidationFailure,
  );
});

test("客户端拼装与服务端解析对同一份规则的理解一致", () => {
  const rules = [
    { field: "approvedRepairCount", direction: "desc" as const },
    { field: "realName", direction: "asc" as const },
  ];
  const params = listQueryParams({ page: 1, pageSize: 20, query: "李", sort: rules });
  const parsed = parseListQuery(params, { sortable: SORTABLE });
  assert.deepEqual(parsed.sort, rules);
  assert.equal(parsed.query, "李");
});

test("查询串拼装：空值不写、固定筛选按原样、列级条件一条一个参数", () => {
  const params = listQueryParams(
    { page: 2, pageSize: 20, query: "   ", sort: [] },
    {
      fixed: { status: "ACTIVE", role: "" },
      filters: [
        { field: "studentId", op: "contains", value: "2023" },
        // 值里带冒号：只切前两个冒号是**解析**侧的规则，这里要保证编码后原样送达。
        { field: "className", op: "contains", value: "计科:2101" },
      ],
    },
  );

  // 空白关键字不写：`query=`（空串）与「没填关键字」是两件事。
  assert.equal(params.has("query"), false);
  assert.equal(params.get("page"), "2");
  // 固定筛选里空串的那个不写，有值的原样。
  assert.equal(params.get("role"), null);
  assert.equal(params.get("status"), "ACTIVE");
  // 排序为空时不写 `sort`（服务端据此用该表的默认顺序）。
  assert.equal(params.get("sort"), null);
  // 列级条件：重复参数（不是逗号分隔），且能安全往返。
  assert.deepEqual(params.getAll("filter"), [
    "studentId:contains:2023",
    "className:contains:计科:2101",
  ]);
  assert.equal(new URL(`http://x/?${params}`).searchParams.getAll("filter").length, 2);
});

/* ------------------------------------------------------------- 字段默认行为 */

type Row = { id: string; joinedAt: string; note: string | null };

const SPEC: TableViewSpec<Row> = {
  id: "unit",
  title: "单元测试表",
  rowKey: (row) => row.id,
  fields: [
    { key: "joinedAt", label: "加入时间", kind: "date", width: 96, render: (row) => row.joinedAt },
    { key: "note", label: "备注", kind: "text", width: 120, render: (row) => row.note },
    { key: "id", label: "记录 ID", kind: "readonly", width: 200, render: (row) => row.id },
    {
      key: "secret",
      label: "内部标识",
      kind: "text",
      width: 100,
      hidden: true,
      render: () => null,
    },
  ],
};

test("数值与日期默认右对齐，文本与只读标识符不右对齐", () => {
  assert.equal(defaultNumeric("number"), true);
  assert.equal(defaultNumeric("date"), true);
  assert.equal(defaultNumeric("datetime"), true);
  // 学号、记录 ID 这类「看起来像数字的标识符」是对比用的，不是量，左对齐。
  assert.equal(defaultNumeric("text"), false);
  assert.equal(defaultNumeric("readonly"), false);
  assert.equal(defaultNumeric("multiSelect"), false);
});

test("可排序性：只读字段默认关闭，可在 spec 里显式打开或关闭", () => {
  const fields = new Map(SPEC.fields.map((field) => [field.key, field]));
  assert.equal(isFieldSortable(fields.get("joinedAt") as FieldSpec<Row>), true);
  assert.equal(isFieldSortable(fields.get("id") as FieldSpec<Row>), false);
  assert.equal(isFieldSortable({ ...(fields.get("id") as FieldSpec<Row>), sortable: true }), true);
  assert.equal(
    isFieldSortable({ ...(fields.get("note") as FieldSpec<Row>), sortable: false }),
    false,
  );
  // 白名单就是「表头能点什么」与「服务端接受什么」的同一份来源。
  assert.deepEqual(sortableFields(SPEC), ["joinedAt", "note", "secret"]);
});

test("列显隐的初始状态覆盖全部字段（含默认隐藏项）", () => {
  assert.deepEqual(initialColumnVisibility(SPEC), {
    joinedAt: true,
    note: true,
    id: true,
    secret: false,
  });
});

test("按 key 取字段：命中返回定义，未命中返回 undefined", () => {
  assert.equal(findField(SPEC, "note")?.label, "备注");
  assert.equal(findField(SPEC, "missing"), undefined);
});
