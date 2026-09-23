import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { JoinApplicationTableContext } from "../../src/components/admin/join-application-table-spec";
import type { JoinApplicationStatus, JoinApplicationSummary } from "../../src/types/contracts";

/**
 * 招募报名表迁移到内核后的 **DOM 契约测试**。
 *
 * 「迁移前后 DOM 等价」是这次改造唯一不能妥协的约束（`AGENTS.md`：除明确要改的那一处，
 * 其它像素不该移动）。因此这里把迁移前那张表的标记逐项固定下来：列的顺序与文案、
 * `data-label`、内容列类名、空值行、脱敏联系方式的拼接方式、状态标签的三档样式。
 *
 * 用 `react-dom/server` 渲染，不需要 jsdom（项目没装）。
 *
 * 全局 `React`：`tsconfig` 的 `jsx` 是 `preserve`，`tsx` 跑测试走**经典**运行时，
 * 组件源码里因此没有 `import React`。必须先挂全局、再动态 import。
 */
(globalThis as unknown as { React: typeof React }).React = React;

type Modules = {
  AdminTable: typeof import("../../src/components/admin/AdminTable").AdminTable;
  spec: typeof import("../../src/components/admin/join-application-table-spec").joinApplicationTableSpec;
  emptyText: typeof import("../../src/components/admin/join-application-table-spec").joinApplicationEmptyText;
  formatDateTime: typeof import("../../src/components/admin/join-application-table-spec").formatDateTime;
  statusClass: typeof import("../../src/components/admin/join-application-table-spec").statusClass;
  admin: typeof import("../../src/config/admin");
};

let cached: Modules | null = null;
async function load(): Promise<Modules> {
  if (cached) return cached;
  const [table, spec, admin] = await Promise.all([
    import("../../src/components/admin/AdminTable"),
    import("../../src/components/admin/join-application-table-spec"),
    import("../../src/config/admin"),
  ]);
  cached = {
    AdminTable: table.AdminTable,
    spec: spec.joinApplicationTableSpec,
    emptyText: spec.joinApplicationEmptyText,
    formatDateTime: spec.formatDateTime,
    statusClass: spec.statusClass,
    admin,
  };
  return cached;
}

const noop = () => {};

function application(
  id: string,
  status: JoinApplicationStatus,
  overrides: Partial<JoinApplicationSummary> = {},
): JoinApplicationSummary {
  return {
    id,
    status,
    provisionStatus: "NOT_REQUIRED",
    lastReviewedAt: null,
    ticketNo: `RC-2026-${id}`,
    recruitmentCycle: "2026 秋",
    realName: `报名人${id}`,
    qqMasked: "123****89",
    phoneMasked: "138****1234",
    submittedAt: "2026-09-23T05:00:00.000Z",
    ...overrides,
  };
}

async function render(items: JoinApplicationSummary[]): Promise<string> {
  const { AdminTable, spec, emptyText } = await load();
  return renderToStaticMarkup(
    // 泛型要显式给：`createElement` 推不出 spec 与 items 的类型。
    createElement(AdminTable<JoinApplicationSummary, JoinApplicationTableContext>, {
      spec,
      items,
      emptyText,
      renderContext: { onDetail: noop },
      rowProps: (item: JoinApplicationSummary) => ({ "data-row-id": item.id }),
    }),
  );
}

test("表头：8 列，顺序与文案照抄迁移前；「报名编号」是内容列", async () => {
  const { admin } = await load();
  const copy = admin.adminCopy.recruitment;
  const html = await render([application("A", "SUBMITTED")]);

  const headers = [...html.matchAll(/<th scope="col"([^>]*)>([\s\S]*?)<\/th>/g)];
  assert.deepEqual(
    headers.map((match) => match[2]),
    [
      copy.table.ticketNo,
      copy.table.realName,
      copy.table.cycle,
      copy.table.contacts,
      copy.table.status,
      copy.table.provision,
      copy.table.submittedAt,
      copy.table.actions,
    ],
  );
  assert.ok(headers[0][1].includes("admin-table__grow"), "「报名编号」表头丢了 admin-table__grow");
  // 表头 + 单元格，各一次。
  assert.equal(html.split("admin-table__grow").length - 1, 2);
});

test("没有声明列宽 → 不输出 colgroup；空列表整行合并 8 列", async () => {
  const { admin } = await load();
  const html = await render([application("A", "SUBMITTED")]);
  assert.equal(html.includes("<colgroup"), false);
  assert.equal(html.includes("style="), false);

  const empty = await render([]);
  // 大小写由 React 决定，断言不去管它。
  assert.match(empty, /<td class="admin-table__empty" colspan="8">/i);
  assert.ok(empty.includes(admin.adminShared.empty));
});

test("常规行：data-label、脱敏联系方式、提交时间逐项对齐", async () => {
  const { admin, formatDateTime } = await load();
  const copy = admin.adminCopy.recruitment;
  const html = await render([application("A", "SUBMITTED")]);

  for (const label of [
    copy.table.ticketNo,
    copy.table.realName,
    copy.table.cycle,
    copy.table.contacts,
    copy.table.status,
    copy.table.provision,
    copy.table.submittedAt,
    copy.table.actions,
  ]) {
    assert.ok(html.includes(`data-label="${label}"`), `缺少 data-label="${label}"`);
  }

  // 报名编号用 `<code>`（它是报名人对号用的稳定标识）。
  assert.ok(html.includes("<code>RC-2026-A</code>"));
  assert.ok(html.includes("报名人A"));
  assert.ok(html.includes("2026 秋"));
  // QQ 明文 + 手机号跟在同一个 `<span class="repair-table__flags">` 里，中间不隔换行。
  assert.ok(html.includes('123****89<span class="repair-table__flags">138****1234</span>'));
  // 提交时间带年份（报名跨批次，同一条列表可能横跨一年）。
  const submitted = formatDateTime("2026-09-23T05:00:00.000Z");
  assert.ok(html.includes(submitted));
  assert.match(submitted, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  // 账号发放按既有文案显示。
  assert.ok(html.includes(admin.provisionStatusLabels.NOT_REQUIRED));
  // 唯一的动作是「详情」。
  assert.ok(html.includes(copy.action.detail));
});

test("状态标签三档：已通过 / 未通过与撤回（中性灰）/ 其余（待处理）", async () => {
  const { admin, statusClass } = await load();
  const labels = admin.joinApplicationStatusLabels;

  const html = await render([
    application("P", "INTERVIEW_PASSED"),
    application("R", "INTERVIEW_REJECTED"),
    application("W", "WITHDRAWN"),
    application("S", "SUBMITTED"),
  ]);

  // 样式判定本身（面板原来的 `statusClass` 搬到了 spec 文件里，行为逐字照抄）。
  assert.equal(statusClass("INTERVIEW_PASSED"), "repair-tag repair-tag--approved");
  assert.equal(statusClass("INTERVIEW_REJECTED"), "admin-tag admin-tag--muted");
  assert.equal(statusClass("WITHDRAWN"), "admin-tag admin-tag--muted");
  assert.equal(statusClass("SUBMITTED"), "repair-tag repair-tag--pending");
  assert.equal(statusClass("INTERVIEW_PENDING"), "repair-tag repair-tag--pending");

  // 三种样式都出现在标记里，且各自带着对应的状态文案。
  assert.ok(
    html.includes(
      `<span class="repair-tag repair-tag--approved">${labels.INTERVIEW_PASSED}</span>`,
    ),
  );
  assert.ok(
    html.includes(`<span class="admin-tag admin-tag--muted">${labels.INTERVIEW_REJECTED}</span>`),
  );
  assert.ok(html.includes(`<span class="admin-tag admin-tag--muted">${labels.WITHDRAWN}</span>`));
  assert.ok(html.includes(`<span class="repair-tag repair-tag--pending">${labels.SUBMITTED}</span>`));
});

test("账号发放的四种状态都按既有文案显示", async () => {
  const { admin } = await load();
  const labels = admin.provisionStatusLabels;
  const html = await render([
    application("1", "INTERVIEW_PASSED", { provisionStatus: "PENDING" }),
    application("2", "INTERVIEW_PASSED", { provisionStatus: "SUCCEEDED" }),
    application("3", "INTERVIEW_PASSED", { provisionStatus: "FAILED" }),
    application("4", "INTERVIEW_PASSED", { provisionStatus: "NOT_REQUIRED" }),
  ]);

  for (const label of [labels.PENDING, labels.SUCCEEDED, labels.FAILED, labels.NOT_REQUIRED]) {
    // 文案可能重复（例如两项都是「—」），因此只要求出现。
    assert.ok(html.includes(label), `账号发放列缺少文案「${label}」`);
  }
});
