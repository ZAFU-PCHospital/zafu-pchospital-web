import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyTableQuery } from "../../src/lib/table/query-state";
import {
  applyQuickFields,
  clearFilterConditions,
  removeAdvancedFilter,
  splitQuickFields,
  withFixedValue,
} from "../../src/lib/table/quick-query";

test("搜索与状态页签字段不进入「更多筛选」", () => {
  const quick = [
    { key: "recruitmentCycle", label: "招募批次", maxLength: 32 },
    { key: "query", label: "关键词" },
    {
      key: "status",
      label: "审核状态",
      options: [{ value: "PENDING", label: "待审核" }],
    },
  ] as const;

  const { search, fields } = splitQuickFields(quick, "status");
  assert.equal(search?.key, "query");
  assert.deepEqual(
    fields.map((field) => field.key),
    ["recruitmentCycle"],
  );
});

test("更多筛选只写本面板字段，并去掉首尾空白", () => {
  const value = emptyTableQuery({ query: "林", status: "PENDING", categoryId: "" });
  const next = applyQuickFields(value, [{ key: "categoryId", label: "故障分类" }], {
    categoryId: "  软件问题  ",
  });

  assert.deepEqual(next.fixed, { query: "林", status: "PENDING", categoryId: "软件问题" });
  assert.deepEqual(next.filters, value.filters);
});

test("状态切换与单项移除只改对应条件", () => {
  const value = {
    ...emptyTableQuery({ query: "林", status: "PENDING" }),
    filters: [
      { field: "status", op: "eq" as const, value: "PENDING" },
      { field: "createdAt", op: "gte" as const, value: "2026-10-01" },
    ],
  };

  const status = withFixedValue(value, "status", "");
  assert.equal(status.fixed.query, "林");
  assert.equal(status.fixed.status, "");
  assert.deepEqual(status.filters, value.filters);

  const removed = removeAdvancedFilter(value, 0);
  assert.deepEqual(removed.filters, [{ field: "createdAt", op: "gte", value: "2026-10-01" }]);
  assert.equal(removed.fixed.status, "PENDING");
});

test("清除筛选保留排序与分组，重置查询由页面完整 reset 处理", () => {
  const value = {
    ...emptyTableQuery({ query: "林", status: "PENDING" }),
    sort: [{ field: "createdAt", direction: "desc" as const }],
    filters: [{ field: "status", op: "eq" as const, value: "PENDING" }],
    groupBy: "status",
  };

  const cleared = clearFilterConditions(value);
  assert.deepEqual(cleared.fixed, { query: "", status: "" });
  assert.deepEqual(cleared.filters, []);
  assert.deepEqual(cleared.sort, value.sort);
  assert.equal(cleared.groupBy, "status");
});
