import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tableField, tableQueryOptions, tableSortLabel } from "../../src/config/table-queries";
import {
  readTableParams,
  shareableTableParams,
  emptyTableQuery,
  tableRequestParams,
} from "../../src/lib/table/query-state";
import { tableQueryInput } from "../../src/features/admin/table-http";
import { parseFilters } from "../../src/lib/api/list-filter";
import { auditTableQuery } from "../../src/lib/table/audit-query";

test("查询状态：仅日期/枚举和受控排序可分享，敏感文本不进入 URL 或审计", () => {
  const options = tableQueryOptions("join-applications");
  const value = {
    ...emptyTableQuery({
      query: "真实姓名 123456",
      status: "INTERVIEW_PASSED",
      recruitmentCycle: "私人文字",
    }),
    sort: [{ field: "approvedAt", direction: "desc" as const }],
    filters: [
      { field: "realName", op: "contains" as const, value: "私人姓名" },
      { field: "approvedAt", op: "gte" as const, value: "2026-10-01" },
    ],
    groupBy: "status",
  };
  const shared = shareableTableParams(value, options);
  assert.equal(shared.has("query"), false);
  assert.equal(shared.has("recruitmentCycle"), false);
  assert.deepEqual(shared.getAll("filter"), ["approvedAt:gte:2026-10-01"]);
  const restored = readTableParams(
    shared,
    { query: "", status: "", recruitmentCycle: "" },
    options,
  );
  assert.deepEqual(restored.sort, value.sort);
  assert.equal(restored.fixed.query, "");
  assert.equal(restored.groupBy, "status");
  const input = tableQueryInput(tableRequestParams(value, 3), "join-applications");
  assert.equal(input.page, 3);
  assert.equal(input.pageSize, 20);
  assert.equal(input.filters.length, 2);
  const audit = JSON.stringify(auditTableQuery({ ...input, query: value.fixed.query }));
  assert.equal(audit.includes("私人姓名"), false);
  assert.equal(audit.includes("真实姓名"), false);
  assert.deepEqual(emptyTableQuery({ query: "", status: "" }), {
    fixed: { query: "", status: "" },
    sort: [],
    filters: [],
    groupBy: "",
  });
});

test("查询白名单：非法字段、方向、分组和原型键受控拒绝", () => {
  for (const query of [
    "sort=passwordHash:asc",
    "sort=createdAt:sql",
    "groupBy=actorUserId",
    "filter=__proto__:eq:x",
    "filter=action:gte:x",
  ]) {
    assert.throws(() => tableQueryInput(new URLSearchParams(query), "audit"), {
      code: "VALIDATION_FAILED",
    });
  }
  assert.throws(() => parseFilters(["constructor:eq:x"], { status: ["eq"] }), {
    code: "VALIDATION_FAILED",
  });
});

test("复合成员列明确区分创建人排序与任一参与人筛选", async () => {
  assert.equal(tableSortLabel("repairs", "memberName"), "创建成员实名");
  assert.equal(tableField("repairs", "memberName").label, "参与成员姓名");
  (globalThis as unknown as { React: typeof React }).React = React;
  const { AdminTableQuery } = await import("../../src/components/admin/AdminTableQuery");
  const html = renderToStaticMarkup(
    React.createElement(AdminTableQuery, {
      value: {
        ...emptyTableQuery({ query: "" }),
        sort: [{ field: "memberName", direction: "asc" }],
        filters: [{ field: "memberName", op: "contains", value: "参与者" }],
      },
      options: tableQueryOptions("repairs"),
      quick: [],
      refreshing: false,
      onChange() {},
      onClear() {},
    }),
  );
  assert.match(html, /创建成员实名/);
  assert.match(html, /参与成员姓名/);
});

test("共用查询界面：搜索默认收起，条件与排序摘要来自已提交查询", async () => {
  (globalThis as unknown as { React: typeof React }).React = React;
  const { AdminTableQuery } = await import("../../src/components/admin/AdminTableQuery");
  const html = renderToStaticMarkup(
    React.createElement(AdminTableQuery, {
      value: {
        ...emptyTableQuery({ query: "" }),
        sort: [{ field: "approvedAt", direction: "desc" }],
        filters: [{ field: "status", op: "eq", value: "INTERVIEW_PASSED" }],
      },
      options: tableQueryOptions("join-applications"),
      quick: [{ key: "query", label: "关键词" }],
      ready: false,
      refreshing: false,
      onChange() {},
      onClear() {},
    }),
  );
  assert.match(html, /method="post"/);
  assert.match(html, /<fieldset[^>]*disabled/);
  assert.match(html, /重置查询/);
  assert.match(html, /高级/);
  assert.match(html, /搜索/);
  assert.match(html, /hidden=""/);
  assert.match(html, /通过时间/);
  assert.match(html, /面试通过/);
  assert.match(html, /清除筛选/);
  // 筛选卡片不再出现；工具栏不把条件包回 `.admin-filters` 大卡片。
  assert.doesNotMatch(html, /admin-filters/);
  assert.doesNotMatch(html, /链接保留排序|仅保留在当前页面/);
});

test("维修状态页签：桌面页签与窄屏选择器同源，条件可逐项查看和移除", async () => {
  (globalThis as unknown as { React: typeof React }).React = React;
  const { AdminTableQuery } = await import("../../src/components/admin/AdminTableQuery");
  const html = renderToStaticMarkup(
    React.createElement(AdminTableQuery, {
      value: {
        ...emptyTableQuery({ query: "", status: "PENDING", categoryId: "cat-1" }),
      },
      options: tableQueryOptions("repairs"),
      quick: [
        { key: "query", label: "机主姓名 / 内容 / 备注 / 成员", placeholder: "搜索维修记录" },
        {
          key: "status",
          label: "审核状态",
          options: [
            { value: "DRAFT", label: "草稿" },
            { value: "PENDING", label: "待审核" },
            { value: "APPROVED", label: "已通过" },
            { value: "REJECTED", label: "已退回" },
          ],
        },
        {
          key: "categoryId",
          label: "故障分类",
          options: [{ value: "cat-1", label: "软件问题" }],
        },
      ],
      statusTabs: {
        key: "status",
        label: "审核状态",
        options: [
          { value: "PENDING", label: "待审核" },
          { value: "APPROVED", label: "已通过" },
          { value: "REJECTED", label: "已退回" },
          { value: "DRAFT", label: "草稿" },
        ],
      },
      refreshing: false,
      onChange() {},
      onClear() {},
    }),
  );

  assert.match(html, /role="group" aria-label="审核状态"/);
  for (const label of ["全部", "待审核", "已通过", "已退回", "草稿"]) {
    assert.ok(html.includes(`>${label}<`), `状态页签缺少「${label}」`);
  }
  assert.match(html, /aria-pressed="true"[^>]*>待审核</);
  assert.ok(html.includes('<option value="DRAFT">草稿</option>'), "窄屏选择器要带同一组状态");
  // 页签字段不再重复出现在「更多筛选」里，按钮只保留非状态字段。
  assert.equal((html.match(/>更多筛选</g) ?? []).length, 1);
  assert.ok(html.includes("审核状态：待审核"));
  assert.ok(html.includes("故障分类：软件问题"));
  assert.ok(html.includes("查看完整条件"));
  assert.ok(html.includes("移除 审核状态：待审核"));
});
