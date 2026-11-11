import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { JoinApplicationTableContext } from "../../src/components/admin/join-application-table-spec";
import type { JoinApplicationStatus, JoinApplicationSummary } from "../../src/types/contracts";

/** 验证表格的列顺序、单元格内容与可访问性标记。 */
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
    approvedAt: null,
    admittedDepartment: null,
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

async function render(items: JoinApplicationSummary[], busy = false): Promise<string> {
  const { AdminTable, spec, emptyText } = await load();
  return renderToStaticMarkup(
    // 泛型要显式给：`createElement` 推不出 spec 与 items 的类型。
    createElement(AdminTable<JoinApplicationSummary, JoinApplicationTableContext>, {
      spec,
      items,
      emptyText,
      renderContext: { onDetail: noop, onApprove: noop, busy },
      rowProps: (item: JoinApplicationSummary) => ({ "data-row-id": item.id }),
    }),
  );
}

test("表头：10 列，顺序与文案照抄迁移前；「报名编号」是内容列", async () => {
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
      "面试时间",
      "通过时间",
      copy.table.actions,
    ],
  );
  assert.ok(headers[0][1].includes("admin-table__grow"), "「报名编号」表头丢了 admin-table__grow");
  // 表头 + 单元格，各一次。
  assert.equal(html.split("admin-table__grow").length - 1, 2);
});

test("没有声明列宽 → 不输出 colgroup；空列表整行合并 10 列", async () => {
  const { admin } = await load();
  const html = await render([application("A", "SUBMITTED")]);
  assert.equal(html.includes("<colgroup"), false);
  assert.equal(html.includes("style="), false);

  const empty = await render([]);
  // 大小写由 React 决定，断言不去管它。
  assert.match(empty, /<td class="admin-table__empty" colspan="10">/i);
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
  // 两个行内动作：「详情」始终可点；「通过」对可审核状态可点。
  assert.ok(html.includes(copy.action.detail));
  assert.ok(html.includes(copy.action.approve));
  assert.match(
    html,
    new RegExp(`<button(?![^>]*disabled)[^>]*><span>${copy.action.approve}</span></button>`),
    "可审核状态（SUBMITTED）的「通过」不应置灰",
  );
});

test("「通过」按钮常驻：不可审核状态置灰、提交中（busy）整体置灰", async () => {
  const { admin } = await load();
  const copy = admin.adminCopy.recruitment;
  const disabledApprove = `<button[^>]*disabled[^>]*><span>${copy.action.approve}</span></button>`;

  // 已通过 / 未通过 / 已撤回：按钮仍在（宽度不跳），但置灰。
  const decided = await render([
    application("P", "INTERVIEW_PASSED"),
    application("R", "INTERVIEW_REJECTED"),
    application("W", "WITHDRAWN"),
  ]);
  assert.equal(
    decided.split(new RegExp(disabledApprove)).length - 1,
    3,
    "三个不可审核状态都应有置灰的「通过」按钮",
  );
  assert.equal(decided.includes(`<span>${copy.action.approve}</span>`), true, "按钮本身应常驻");

  // 有请求在途：可审核状态也置灰，防连点。
  const busyHtml = await render([application("S", "SUBMITTED")], true);
  assert.match(busyHtml, new RegExp(disabledApprove), "busy 时「通过」应置灰");
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

  // 三种样式都出现在标记里，且各自带着对应的状态文案；外层 admin-tags 让卡片布局不拉伸徽章。
  assert.ok(
    html.includes(
      `<span class="admin-tags"><span class="repair-tag repair-tag--approved">${labels.INTERVIEW_PASSED}</span></span>`,
    ),
  );
  assert.ok(
    html.includes(
      `<span class="admin-tags"><span class="admin-tag admin-tag--muted">${labels.INTERVIEW_REJECTED}</span></span>`,
    ),
  );
  assert.ok(
    html.includes(
      `<span class="admin-tags"><span class="admin-tag admin-tag--muted">${labels.WITHDRAWN}</span></span>`,
    ),
  );
  assert.ok(
    html.includes(
      `<span class="admin-tags"><span class="repair-tag repair-tag--pending">${labels.SUBMITTED}</span></span>`,
    ),
  );
});

test("账号发放的四种状态都按既有文案显示，失败用危险色", async () => {
  const { admin } = await load();
  const labels = admin.provisionStatusLabels;
  const html = await render([
    application("1", "INTERVIEW_PASSED", { provisionStatus: "PENDING" }),
    application("2", "INTERVIEW_PASSED", { provisionStatus: "SUCCEEDED" }),
    application("3", "INTERVIEW_PASSED", { provisionStatus: "FAILED" }),
    application("4", "INTERVIEW_PASSED", { provisionStatus: "NOT_REQUIRED" }),
  ]);

  const expected = [
    ["PENDING", "admin-tag"],
    ["SUCCEEDED", "admin-tag admin-tag--accent"],
    ["FAILED", "admin-tag admin-tag--danger"],
    ["NOT_REQUIRED", "admin-tag admin-tag--muted"],
  ] as const;
  for (const [status, className] of expected) {
    assert.ok(
      html.includes(
        `<span class="admin-tags"><span class="${className}">${labels[status]}</span></span>`,
      ),
      `账号发放「${labels[status]}」的徽章样式不对`,
    );
  }
});
