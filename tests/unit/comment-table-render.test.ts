import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { CommentTableContext } from "../../src/components/admin/comment-table-spec";
import type { AdminCommentEntry } from "../../src/types/contracts";

/**
 * 评论表迁移到内核后的 **DOM 契约测试**。
 *
 * 「迁移前后 DOM 等价」是这次改造唯一不能妥协的约束（`AGENTS.md`：操作前后除明确要改的
 * 那一处，其它像素不该移动）。因此这里不测「组件能不能跑」，而是把迁移前那张表的标记
 * 逐项固定下来：列的顺序与表头文案、每个单元格的 `data-label`、类名、空值占位、
 * 行内控件的无障碍名称、两种状态标签，以及**不该出现的 `admin-table__num` / `colgroup` /
 * 排序按钮**。
 *
 * 用 `react-dom/server` 渲染，不需要 jsdom，也不需要浏览器 —— 断言优先于截图（§8.1）。
 *
 * 为什么要挂一个全局 `React`：`tsconfig` 的 `jsx` 是 `preserve`（Next 自己用自动运行时
 * 编译），而 `tsx` 跑测试时走的是**经典**运行时，组件源码里因此没有 `import React`。
 * 这里先把它挂到全局，再**动态**加载组件 —— 静态 import 会在赋值之前执行，来不及。
 * 好处是不必为了测试去改 `tsconfig`、`package.json`，或往公共组件里塞一个用不到的 import。
 */
(globalThis as unknown as { React: typeof React }).React = React;

type AdminConfig = typeof import("../../src/config/admin");

type Modules = {
  AdminTable: typeof import("../../src/components/admin/AdminTable").AdminTable;
  commentTableSpec: typeof import("../../src/components/admin/comment-table-spec").commentTableSpec;
  admin: AdminConfig;
};

let cached: Modules | null = null;
async function load(): Promise<Modules> {
  if (cached) return cached;
  const [table, spec, admin] = await Promise.all([
    import("../../src/components/admin/AdminTable"),
    import("../../src/components/admin/comment-table-spec"),
    import("../../src/config/admin"),
  ]);
  cached = { AdminTable: table.AdminTable, commentTableSpec: spec.commentTableSpec, admin };
  return cached;
}

/** 迁移前的表头顺序与文案（面板里那七个 `<th>` 逐字抄下来的顺序）。 */
function legacyLabels(modules: Modules): string[] {
  const table = modules.admin.adminCopy.comments.table;
  return [
    table.body,
    table.author,
    table.record,
    table.meta,
    table.createdAt,
    table.state,
    table.actions,
  ];
}

function comment(overrides: Partial<AdminCommentEntry> = {}): AdminCommentEntry {
  return {
    id: "c-1",
    body: "重装之后键盘失灵了",
    author: { id: "u-1", name: "张三" },
    record: { id: "r-1", memberName: "李四", repairDate: "2026-09-01", status: "APPROVED" },
    parentCommentId: null,
    replyCount: 2,
    mentionCount: 1,
    createdAt: "2026-09-23T02:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

/** 单元格渲染用到的运行时值；删除按钮的禁用态与两个回调就是全部。 */
function contextOf(busy = false): CommentTableContext {
  return { busy, onOpenRecord: () => {}, onRemove: () => {} };
}

function render(
  modules: Modules,
  items: AdminCommentEntry[],
  extra: Record<string, unknown> = {},
): string {
  return renderToStaticMarkup(
    createElement(modules.AdminTable<AdminCommentEntry, CommentTableContext>, {
      spec: modules.commentTableSpec,
      items,
      renderContext: contextOf(),
      emptyText: modules.admin.adminShared.empty,
      ...extra,
    }),
  );
}

/** 取某个 `<td>` 的完整标记（按 `data-label` 定位），用于断言单元格内部结构。 */
function cellOf(html: string, label: string): string {
  const start = html.indexOf(`data-label="${label}"`);
  assert.notEqual(start, -1, `找不到 data-label="${label}" 的单元格`);
  const open = html.lastIndexOf("<td", start);
  const end = html.indexOf("</td>", start);
  return html.slice(open, end + "</td>".length);
}

test("表名与列宽：迁移前这张表没有列宽，内核因此不该输出 colgroup", async () => {
  const modules = await load();
  const html = render(modules, [comment()]);
  assert.ok(html.includes('class="admin-table-wrap"'), "外层容器应当是 admin-table-wrap");
  assert.ok(html.includes('class="admin-table"'), "表格应当是 admin-table");
  // 关键回归点：面板从来没接过 `useColumnResize`，列宽由浏览器按内容分配。
  // 一旦冒出 `<colgroup>`，列宽就从「按内容分配」变成固定宽度，布局会变。
  assert.equal(html.includes("<colgroup>"), false, "不该输出 colgroup");
  assert.equal(html.includes("<col "), false, "不该输出 col");
});

test("表头：顺序与文案逐列一致，且只有「评论内容」列是内容列", async () => {
  const modules = await load();
  const html = render(modules, [comment()]);
  const headers = [...html.matchAll(/<th scope="col"([^>]*)>(.*?)<\/th>/g)];
  assert.deepEqual(
    headers.map((match) => match[1]),
    [' class="admin-table__grow"', "", "", "", "", "", ""],
    "只有第一列（评论内容）带 admin-table__grow，其余表头不带任何类名",
  );
  assert.deepEqual(
    headers.map((match) => match[2]),
    legacyLabels(modules),
  );
  // `data-label` 是 ≤1100px 卡片式降级时每个值前面的字段名，少一个就会在移动端丢信息。
  for (const label of legacyLabels(modules)) {
    assert.ok(html.includes(`data-label="${label}"`), `缺少 data-label="${label}"`);
  }
});

test("单元格：类名与迁移前一致（内容列 grow，其余列没有类名）", async () => {
  const modules = await load();
  const html = render(modules, [comment()]);
  // `admin-table__grow` 恰好两处：表头与单元格（吸收剩余宽度 + 允许换行）。
  assert.equal([...html.matchAll(/admin-table__grow/g)].length, 2);
  assert.ok(
    html.includes(
      `<td data-label="${modules.admin.adminCopy.comments.table.body}" class="admin-table__grow">`,
    ),
  );
  // 迁移前这些类一个都没有：内核按字段类型默认给的右对齐类会给「发表时间」多出一层
  // 字样（spec 里已显式 `numeric: false`），空值样式类则说明渲染分支被改写了。
  assert.equal(html.includes("admin-table__num"), false, "迁移前没有任何列右对齐");
  assert.equal(html.includes("admin-cell__muted"), false, "迁移前空值没有 muted 类");
});

test("单元格内容：正文 span、作者名、所属记录的日期与状态、回复 / 提及两枚计数", async () => {
  const modules = await load();
  const table = modules.admin.adminCopy.comments.table;
  const copy = modules.admin.adminCopy.comments;
  const item = comment();
  const html = render(modules, [item]);

  assert.ok(
    html.includes(`<span class="admin-comment__body">${item.body}</span>`),
    "正文必须包在 admin-comment__body 里（它负责换行与最大高度）",
  );
  assert.ok(cellOf(html, table.author).includes(`>${item.author.name}<`), "作者列显示成员姓名");
  // 所属记录：姓名 + 副行「维修日期 · 审核状态」，两个占位与分隔符都要照抄。
  assert.equal(
    cellOf(html, table.record),
    `<td data-label="${table.record}">李四<span class="repair-table__flags">2026-09-01 · 已通过</span></td>`,
  );
  // 两枚计数是两段文本，中间是 ` · `（文案里的 `{count}` 由组件替换）。
  assert.equal(
    cellOf(html, table.meta),
    `<td data-label="${table.meta}">${copy.meta.replies.replace("{count}", "2")} · ${copy.meta.mentions.replace("{count}", "1")}</td>`,
  );
  // 时间是 `Asia/Shanghai` 的 `MM-DD HH:mm`（表格列窄，不显示年份）。
  assert.equal(
    cellOf(html, table.createdAt),
    `<td data-label="${table.createdAt}">09/23 10:00</td>`,
  );
});

test("空值：所属记录没有维修日期时显示 —（adminShared.none），不是空串", async () => {
  const modules = await load();
  const { adminShared } = modules.admin;
  const html = render(modules, [
    comment({ record: { id: "r-2", memberName: "赵六", repairDate: null, status: "PENDING" } }),
  ]);
  assert.ok(
    html.includes(`<span class="repair-table__flags">${adminShared.none} · 待审核</span>`),
    `空日期必须显示 ${adminShared.none}`,
  );
});

test("状态列：未删除是结果标签，已删除是中性标签（两个文案成对出现）", async () => {
  const modules = await load();
  const copy = modules.admin.adminCopy.comments;
  const table = copy.table;
  const active = render(modules, [comment()]);
  assert.equal(
    cellOf(active, table.state),
    `<td data-label="${table.state}"><span class="repair-tag repair-tag--result">${copy.activeTag}</span></td>`,
  );
  const removed = render(modules, [comment({ deletedAt: "2026-09-25T02:00:00.000Z" })]);
  assert.equal(
    cellOf(removed, table.state),
    `<td data-label="${table.state}"><span class="admin-tag admin-tag--muted">${copy.deletedTag}</span></td>`,
    "软删除后评论仍在库里，界面必须能看见「已删除」这个状态",
  );
});

test("操作列：「所属记录」是文字按钮，删除是图标按钮 + 不可见标签", async () => {
  const modules = await load();
  const copy = modules.admin.adminCopy.comments;
  const html = render(modules, [comment()]);
  const actions = cellOf(html, copy.table.actions);
  assert.ok(actions.includes('<span class="admin-actions">'), "行内控件必须在 admin-actions 里");
  // 两个按钮都是 ghost 变体的 `.btn`：迁移前后类名一致。
  assert.equal([...actions.matchAll(/class="btn btn--ghost"/g)].length, 2);
  // 「所属记录」按钮的可见文字就是无障碍名称（它没有 aria-label / title）。
  assert.ok(actions.includes(`<span>${copy.action.record}</span>`), "缺少「所属记录」入口");
  // 删除按钮只留图标，无障碍名称来自 `sr-only` 文本 —— 迁移后必须仍是这一份文案。
  assert.ok(
    actions.includes(`<span class="sr-only">${copy.action.remove}</span>`),
    "删除按钮缺少不可见的无障碍名称",
  );
  assert.ok(actions.includes('aria-hidden="true"'), "图标是装饰性的，必须 aria-hidden");
  // 未删除的行可以删：按钮不是禁用态。
  assert.equal(actions.includes("disabled"), false, "未删除的评论应当可以删除");
});

test("操作列：请求在飞或已删除时删除按钮禁用（避免连点产生两次软删除）", async () => {
  const modules = await load();
  const copy = modules.admin.adminCopy.comments;
  const busy = render(modules, [comment()], { renderContext: contextOf(true) });
  assert.ok(cellOf(busy, copy.table.actions).includes("disabled"), "删除请求在飞时按钮应当禁用");
  const removed = render(modules, [comment({ deletedAt: "2026-09-25T02:00:00.000Z" })]);
  assert.ok(cellOf(removed, copy.table.actions).includes("disabled"), "已删除的评论不能再删一次");
  // 「所属记录」入口在两种情况下都保持可用（删除是评论的事，看记录不受影响）。
  assert.equal(
    [...cellOf(removed, copy.table.actions).matchAll(/disabled/g)].length,
    1,
    "只该禁用删除按钮",
  );
});

test("空列表：整行占满 7 列的空态单元格", async () => {
  const modules = await load();
  const html = render(modules, []);
  // `react-dom/server` 保留 JSX 的属性名 `colSpan`（浏览器解析时会归一成 colspan）。
  assert.ok(
    html.includes(
      `<td class="admin-table__empty" colSpan="7">${modules.admin.adminShared.empty}</td>`,
    ),
    "空态必须是占满 7 列的单行单元格",
  );
});

test("读屏标题与排序：caption 保留，未接排序时既不渲染按钮也没有 aria-sort", async () => {
  const modules = await load();
  const html = render(modules, [comment()]);
  assert.ok(
    html.includes(`<caption class="sr-only">${modules.admin.adminCopy.comments.title}</caption>`),
    "缺少读屏用的表名",
  );
  // 评论接口没有 `sort` 参数，面板不传 `onSortChange` ⇒ 内核不渲染任何排序控件，
  // `<th aria-sort>` 也不会出现（迁移前的表头里本来就没有它）。
  assert.equal(html.includes("admin-th__sort"), false, "不该渲染排序按钮");
  assert.equal(html.includes("aria-sort"), false, "不该出现 aria-sort");
});

test("多行：行序照抄传入顺序，两种状态的标签各自独立", async () => {
  const modules = await load();
  const copy = modules.admin.adminCopy.comments;
  const html = render(modules, [
    comment(),
    comment({ id: "c-2", deletedAt: "2026-09-25T02:00:00.000Z" }),
  ]);
  // 只数数据行：`<thead>` 里那一个 `<tr>` 不算。
  const body = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
  assert.equal([...body.matchAll(/<tr>/g)].length, 2, "两行数据应当渲染两行");
  assert.ok(html.includes(copy.activeTag) && html.includes(copy.deletedTag));
  assert.ok(html.indexOf(copy.activeTag) < html.indexOf(copy.deletedTag), "行序应当是传入顺序");
});
