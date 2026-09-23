import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { InviteCodeTableContext } from "../../src/components/admin/invite-code-table-spec";
import type { InviteCodeAdminView } from "../../src/types/contracts";

/**
 * 邀请码表迁移到内核后的 **DOM 契约测试**。
 *
 * 「迁移前后 DOM 等价」是这次改造唯一不能妥协的约束（`AGENTS.md`：除明确要改的那一处，
 * 其它像素不该移动）。因此这里不测「组件能不能跑」，而是把迁移前那张表的标记逐项固定下来：
 * 列的顺序与文案、`data-label`、类名、空值行、状态标签、按钮的禁用态。
 *
 * 两类断言：
 *
 * 1. **常规行**：由 spec 推导，与迁移前的 `<td>` 逐项对齐；
 * 2. **`renderRow` 整行接管**：邀请码的「调整策略」把中间四列合成一个 `colSpan` 表单，
 *    内核要保证「接管这一行的格子」的同时 `<tr>` 属性（`data-row-id`）与列宽照旧。
 *    接管那一行本身是面板里的内联 JSX（依赖表单状态），SSR 渲染不到，因此这里测的是
 *    **机制**：给一个返回节点的 `renderRow`，看格子被换掉、`<tr>` 属性还在；
 *    给一个返回 `null` 的，看它老老实实走逐列渲染。
 *
 * 用 `react-dom/server` 渲染，不需要 jsdom（项目没装）。
 *
 * 全局 `React`：`tsconfig` 的 `jsx` 是 `preserve`，`tsx` 跑测试走**经典**运行时，
 * 组件源码里因此没有 `import React`。必须先挂全局、再动态 import。
 */
(globalThis as unknown as { React: typeof React }).React = React;

type Modules = {
  AdminTable: typeof import("../../src/components/admin/AdminTable").AdminTable;
  spec: typeof import("../../src/components/admin/invite-code-table-spec").inviteCodeTableSpec;
  emptyText: typeof import("../../src/components/admin/invite-code-table-spec").inviteCodeEmptyText;
  formatDateTime: typeof import("../../src/components/admin/invite-code-table-spec").formatDateTime;
  admin: typeof import("../../src/config/admin");
};

let cached: Modules | null = null;
async function load(): Promise<Modules> {
  if (cached) return cached;
  const [table, spec, admin] = await Promise.all([
    import("../../src/components/admin/AdminTable"),
    import("../../src/components/admin/invite-code-table-spec"),
    import("../../src/config/admin"),
  ]);
  cached = {
    AdminTable: table.AdminTable,
    spec: spec.inviteCodeTableSpec,
    emptyText: spec.inviteCodeEmptyText,
    formatDateTime: spec.formatDateTime,
    admin,
  };
  return cached;
}

const noop = () => {};
const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/** 迁移前的样本数据：一条长期有效且未绑定，一条已撤销、绑了两个号。 */
const ACTIVE: InviteCodeAdminView = {
  id: "ic-active",
  displayPrefix: "AB12CD34",
  status: "ACTIVE",
  activeFrom: null,
  expiresAt: null,
  maxUses: 10,
  usedCount: 3,
  boundQqMasked: null,
  boundPhoneMasked: null,
  createdAt: "2026-09-23T05:00:00.000Z",
  revokedAt: null,
};

const REVOKED: InviteCodeAdminView = {
  id: "ic-revoked",
  displayPrefix: "EF56GH78",
  status: "REVOKED",
  activeFrom: "2026-09-01T00:00:00.000Z",
  expiresAt: "2026-10-01T00:00:00.000Z",
  maxUses: 5,
  usedCount: 5,
  boundQqMasked: "123****89",
  boundPhoneMasked: "138****1234",
  createdAt: "2026-09-01T00:00:00.000Z",
  revokedAt: "2026-09-10T00:00:00.000Z",
};

async function render(
  items: InviteCodeAdminView[],
  options: { renderRow?: (item: InviteCodeAdminView) => React.ReactNode } = {},
): Promise<string> {
  const { AdminTable, spec, emptyText } = await load();
  return renderToStaticMarkup(
    // 泛型要显式给：`createElement` 的签名推不出 spec 与 items 的类型，
    // 不写就会退化成 `TableViewSpec<unknown, unknown>`（照 `admin-table-render.test.ts` 的写法）。
    createElement(AdminTable<InviteCodeAdminView, InviteCodeTableContext>, {
      spec,
      items,
      emptyText,
      renderContext: { busy: false, onEditPolicy: noop, onRevoke: noop },
      rowProps: (item: InviteCodeAdminView) => ({ "data-row-id": item.id }),
      renderRow: options.renderRow
        ? (item: InviteCodeAdminView) => options.renderRow?.(item) ?? null
        : undefined,
    }),
  );
}

test("表头：7 列，顺序与文案照抄迁移前；「生效区间」是内容列", async () => {
  const { admin } = await load();
  const copy = admin.adminCopy.inviteCodes;
  const html = await render([ACTIVE]);

  const headers = [...html.matchAll(/<th scope="col"([^>]*)>([\s\S]*?)<\/th>/g)];
  assert.deepEqual(
    headers.map((match) => match[2]),
    [
      copy.table.prefix,
      copy.table.status,
      copy.table.window,
      copy.table.usage,
      copy.table.binding,
      copy.table.createdAt,
      copy.table.actions,
    ],
  );
  // 内容列让这一列吸收剩余宽度（表头与单元格**各一次**，就这两处）。
  assert.ok(headers[2][1].includes("admin-table__grow"), "「生效区间」表头丢了 admin-table__grow");
  assert.equal(countOf(html, "admin-table__grow"), 2);
});

test("没有声明列宽 → 不输出 colgroup（迁移前就是这个布局）", async () => {
  const html = await render([ACTIVE]);
  assert.equal(html.includes("<colgroup"), false);
  assert.equal(html.includes("style="), false, "没有列宽就不该写行内宽度");
});

test("空列表：整行合并的「暂无数据」，列数与表头一致", async () => {
  const { admin } = await load();
  const html = await render([]);
  // 大小写由 React 决定（`colSpan` / `colspan` 都见过），断言不去管它。
  assert.match(html, /<td class="admin-table__empty" colspan="7">/i);
  assert.ok(html.includes(admin.adminShared.empty));
});

test("常规行：data-label、类名、状态标签、空值占位逐项对齐", async () => {
  const { admin, formatDateTime } = await load();
  const copy = admin.adminCopy.inviteCodes;
  const html = await render([ACTIVE]);

  // 每个单元格都带 data-label（≤1100px 卡片式降级时它就是字段名）。
  for (const label of [
    copy.table.prefix,
    copy.table.status,
    copy.table.window,
    copy.table.usage,
    copy.table.binding,
    copy.table.createdAt,
    copy.table.actions,
  ]) {
    assert.ok(html.includes(`data-label="${label}"`), `缺少 data-label="${label}"`);
  }

  // 前缀只有明文前 8 位（库里存的是摘要）。
  assert.ok(html.includes("<code>AB12CD34</code>"));
  // 在册状态用「已通过」那枚标签。
  assert.ok(html.includes('<span class="repair-tag repair-tag--approved">'));
  assert.ok(html.includes(admin.inviteCodeStatusLabels.ACTIVE));
  // 生效区间单元格带着 grow 类。
  assert.match(html, /data-label="生效区间" class="admin-table__grow"/);
  // 三段都没有 → 「长期有效」。
  assert.ok(html.includes(copy.window.forever));
  // 使用次数按配置拼，不在这里重排格式。
  assert.ok(html.includes(copy.usage.replace("{used}", "3").replace("{max}", "10")));
  // 没绑任何号 → 统一空值占位，不是空白单元格。
  assert.ok(html.includes(admin.adminShared.none));
  // 创建时间：`MM-DD HH:mm`（上海时区）。
  assert.ok(html.includes(formatDateTime(ACTIVE.createdAt)));
});

/** 按按钮文案取整段 `<button …>…</button>`（不能按文案直接 `indexOf`：状态标签「已撤销」里也有这两个字）。 */
function buttonOf(html: string, text: string): string {
  const buttons = [...html.matchAll(/<button[^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0]);
  // `Button` 把 children 包在 `<span>` 里，因此 `<span>撤销</span>` 是精确锚点
  // （状态标签那个「已撤销」是裸文本，不会误命中）。
  const found = buttons.find((button) => button.includes(`<span>${text}</span>`));
  assert.ok(found, `找不到文案为「${text}」的按钮`);
  return found;
}

test("已撤销的行：撤销按钮禁用，但仍在 DOM 里（不出现/消失）", async () => {
  const { admin, formatDateTime } = await load();
  const copy = admin.adminCopy.inviteCodes;
  const html = await render([REVOKED]);

  // 状态标签换成「待处理」那一枚（已撤销在既有的两枚标签里就是这个）。
  assert.ok(html.includes('<span class="repair-tag repair-tag--pending">'));

  assert.match(buttonOf(html, copy.action.revoke), /disabled/, "已撤销的邀请码不该给出可点的撤销入口");
  // 对照组：「调整策略」不受状态影响，仍然可点。
  assert.doesNotMatch(buttonOf(html, copy.action.policy), /disabled/);
  // 绑定信息脱敏后照原样显示。
  assert.ok(html.includes("QQ 123****89"));
  assert.ok(html.includes("138****1234"));
  // 两端都有值 → 起止都写出来。
  assert.ok(html.includes(copy.window.from.replace("{from}", formatDateTime(REVOKED.activeFrom!))));
  assert.ok(
    html.includes(copy.window.until.replace("{to}", formatDateTime(REVOKED.expiresAt!))),
  );
});

test("renderRow 整行接管：格子被换掉，但 <tr> 属性与列宽照旧", async () => {
  const html = await render([ACTIVE], {
    // 模拟「调整策略」那一行：中间四列合成一个 colSpan 表单。
    renderRow: (item) =>
      createElement(
        React.Fragment,
        null,
        createElement("td", { "data-label": "前缀" }, createElement("code", null, item.displayPrefix)),
        createElement("td", { colSpan: 4 }, "策略表单"),
        createElement("td", { "data-label": "创建时间" }, "时间"),
        createElement("td", { "data-label": "操作" }, "—"),
      ),
  });

  // 属性的字母大小写由 React 决定（JSX 走 `colspan`），断言不去管它。
  assert.match(html, /<td[^>]*colspan="4"[^>]*>策略表单<\/td>/i);
  // 接管的只是格子：`<tr>` 仍然带着 rowProps 给的属性。
  assert.ok(html.includes(`<tr data-row-id="${ACTIVE.id}">`));
  // 接管之后不该再出现逐列渲染的产物（例如状态标签、动作按钮）。
  assert.equal(html.includes("repair-tag"), false);
  assert.equal(html.includes("调整策略"), false);
});

test("renderRow 返回 null：老老实实走逐列渲染", async () => {
  const html = await render([ACTIVE], { renderRow: () => null });
  assert.equal(countOf(html, 'class="admin-table__empty"'), 0);
  assert.ok(html.includes("<code>AB12CD34</code>"), "返回 null 时常规单元格必须照常渲染");
  assert.equal(html.includes("colspan"), false);
});
