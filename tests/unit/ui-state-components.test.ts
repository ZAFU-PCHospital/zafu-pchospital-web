import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { hasActiveTableFilters } from "../../src/lib/table/query-state";

const require = createRequire(import.meta.url);

(globalThis as unknown as { React: typeof React }).React = React;

// LoadFailure 依赖 Button → Icon，模块顶层会求值 JSX，必须在全局 React 就绪后再加载。
const { AdminEmptyState } =
  require("../../src/components/admin/AdminEmptyState") as typeof import("../../src/components/admin/AdminEmptyState");
const { AdminListSkeleton } =
  require("../../src/components/admin/AdminListSkeleton") as typeof import("../../src/components/admin/AdminListSkeleton");
const { MemberProfileSkeleton } =
  require("../../src/components/member/MemberProfileSkeleton") as typeof import("../../src/components/member/MemberProfileSkeleton");
const { EmptyState } =
  require("../../src/components/ui/EmptyState") as typeof import("../../src/components/ui/EmptyState");
const { LoadFailure } =
  require("../../src/components/ui/LoadFailure") as typeof import("../../src/components/ui/LoadFailure");

test("空态展示原因与下一步动作", () => {
  const html = renderToStaticMarkup(
    createElement(EmptyState, {
      title: "没有符合筛选条件的数据",
      description: "清除筛选后查看全部",
      action: createElement("button", { type: "button" }, "清除筛选"),
    }),
  );

  assert.ok(html.includes('role="status"'));
  assert.ok(html.includes("没有符合筛选条件的数据"));
  assert.ok(html.includes("清除筛选后查看全部"));
  assert.ok(html.includes(">清除筛选<"));
});

test("加载失败同时提供重试与返回", () => {
  const html = renderToStaticMarkup(
    createElement(LoadFailure, {
      message: "活动列表加载失败，请稍后重试",
      retryLabel: "重新加载",
      onRetry: () => {},
      backHref: "/repair-activities",
      backLabel: "返回活动列表",
    }),
  );

  assert.ok(html.includes('role="alert"'));
  assert.ok(html.includes("活动列表加载失败，请稍后重试"));
  assert.ok(html.includes(">重新加载<"));
  assert.ok(html.includes("返回活动列表"));
  assert.ok(html.includes('href="/repair-activities"'));
});

test("筛选判定只认筛选条件，不把排序 / 分组当筛选", () => {
  assert.equal(
    hasActiveTableFilters({ fixed: { query: "" }, sort: [], filters: [], groupBy: "" }),
    false,
  );
  assert.equal(
    hasActiveTableFilters({ fixed: { query: "x" }, sort: [], filters: [], groupBy: "" }),
    true,
  );
  assert.equal(
    hasActiveTableFilters({
      fixed: { query: "" },
      sort: [{ field: "createdAt", direction: "desc" }],
      filters: [],
      groupBy: "status",
    }),
    false,
  );
});

test("后台空态区分筛选无结果与无数据", () => {
  const filtered = renderToStaticMarkup(
    createElement(AdminEmptyState, {
      filtered: true,
      busy: false,
      onClearFilters: () => {},
      onReload: () => {},
    }),
  );
  assert.ok(filtered.includes("没有符合当前筛选条件的数据"));
  assert.ok(filtered.includes(">清除筛选<"));

  const empty = renderToStaticMarkup(
    createElement(AdminEmptyState, {
      filtered: false,
      busy: false,
      onReload: () => {},
    }),
  );
  assert.ok(empty.includes("暂无数据"));
  assert.ok(empty.includes(">重新加载<"));
});

test("后台列表骨架与真实表格行同高占位", () => {
  const html = renderToStaticMarkup(createElement(AdminListSkeleton, { rows: 4 }));

  assert.ok(html.includes('role="status"'));
  assert.ok(html.includes("admin-skeleton__list"));
  assert.equal((html.match(/admin-skeleton__row/g) ?? []).length, 4);
});

test("个人资料骨架不再复用工作台双列结构", () => {
  const html = renderToStaticMarkup(createElement(MemberProfileSkeleton));

  assert.ok(html.includes("member-workspace__content"));
  assert.ok(html.includes("member-skeleton__avatar"));
  assert.ok(html.includes("member-hero"));
  assert.ok(html.includes("member-metrics"));
  assert.equal(html.includes("member-workspace__main"), false);
  assert.equal(html.includes("member-workspace__aside"), false);
});
