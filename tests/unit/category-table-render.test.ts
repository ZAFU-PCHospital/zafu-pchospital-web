import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { CategoryTableContext } from "../../src/components/admin/category-table-spec";
import type { RepairCategoryAdminView } from "../../src/types/contracts";

/**
 * 故障分类表迁移到内核后的 **DOM 契约测试**。
 *
 * 「迁移前后 DOM 等价」是这次改造唯一不能妥协的约束（`AGENTS.md`：操作前后除明确要改的
 * 那一处，其它像素不该移动）。因此这里不测「组件能不能跑」，而是把迁移前那张表的标记
 * 逐项固定下来：列的顺序、表头文案、每个单元格的 `data-label` 与类名、空值占位、
 * 行内控件的 `aria-label` / `title`、空态、以及**不该出现的 `admin-table__num`**。
 *
 * 手柄列是唯一需要解释的一列，也是**零差异**的一部分：它的可见表头为空、单元格没有
 * 字段名，但原标记里有一句只给读屏的列名 `<span class="sr-only">拖动调整顺序</span>` ——
 * 现在由 `FieldSpec.headLabel` 表达，单元格则**不写** `data-label`
 * （内核只在 `label` 非空时才写这个属性）。下面那两条用例钉住的就是原标记本身。
 *
 * 编辑态那一行（表单跨「说明」+「引用记录」两列）走 `<AdminTable renderRow>` 整行接管 ——
 * 与技能标签表、邀请码表同一处理，因此它的标记与迁移前**逐格一致**（含 `colSpan={2}`）。
 *
 * 用 `react-dom/server` 渲染，不需要 jsdom，也不需要浏览器 —— 断言优先于截图（§8.1）。
 *
 * 为什么要挂一个全局 `React`：`tsconfig` 的 `jsx` 是 `preserve`（Next 自己用自动运行时
 * 编译），而 `tsx` 跑测试时走的是**经典**运行时，组件源码里因此没有 `import React`。
 * 这里先把它挂到全局，再**动态**加载组件 —— 静态 import 会在赋值之前执行，来不及。
 */
(globalThis as unknown as { React: typeof React }).React = React;

type Modules = {
  AdminTable: typeof import("../../src/components/admin/AdminTable").AdminTable;
  categoryTableSpec: typeof import("../../src/components/admin/category-table-spec").categoryTableSpec;
  admin: typeof import("../../src/config/admin");
};

let cached: Modules | null = null;
async function load(): Promise<Modules> {
  if (cached) return cached;
  const [table, spec, admin] = await Promise.all([
    import("../../src/components/admin/AdminTable"),
    import("../../src/components/admin/category-table-spec"),
    import("../../src/config/admin"),
  ]);
  cached = { AdminTable: table.AdminTable, categoryTableSpec: spec.categoryTableSpec, admin };
  return cached;
}

function category(overrides: Partial<RepairCategoryAdminView> = {}): RepairCategoryAdminView {
  return {
    id: "c-1",
    code: "SYSTEM",
    name: "系统重装",
    description: "重装操作系统",
    sortOrder: 1,
    isActive: true,
    usedByRepairCount: 0,
    createdAt: "2026-09-01T02:00:00.000Z",
    ...overrides,
  };
}

/**
 * 运行时上下文。拖动只挂在行首手柄上，DOM 断言不关心交互，形状对得上即可
 * （与 `admin-table-render.test.ts` 里伪造 `useRowDragSort` 的做法一致）。
 */
function contextOf(overrides: Partial<CategoryTableContext> = {}): CategoryTableContext {
  return {
    drag: {
      handleProps: (id: string) => ({ draggable: true, "data-grip-for": id }),
    } as unknown as CategoryTableContext["drag"],
    total: 2,
    busy: false,
    onReorder: () => {},
    onToggle: () => {},
    onEdit: () => {},
    ...overrides,
  };
}

function render(items: RepairCategoryAdminView[], extra: Record<string, unknown> = {}): string {
  assert.ok(cached, "内核模块还没加载");
  return renderToStaticMarkup(
    createElement(cached.AdminTable<RepairCategoryAdminView, CategoryTableContext>, {
      spec: cached.categoryTableSpec,
      items,
      renderContext: contextOf(),
      emptyText: cached.admin.adminShared.empty,
      ...extra,
    }),
  );
}

/** 取手柄列的 `<td>` 标记：这一格没有字段名，因此不能按 `data-label` 定位。 */
function gripCellOf(html: string): string {
  const open = html.indexOf('<td class="admin-table__grip">');
  assert.notEqual(open, -1, "找不到手柄列的单元格");
  return html.slice(open, html.indexOf("</td>", open));
}

/** 取某个 `<td>` 的完整标记（按 `data-label` 定位），用于断言单元格内部结构。 */
function cellOf(html: string, label: string): string {
  const start = html.indexOf(`data-label="${label}"`);
  assert.notEqual(start, -1, `找不到 data-label="${label}" 的单元格`);
  const open = html.lastIndexOf("<td", start);
  const end = html.indexOf("</td>", start);
  return html.slice(open, end);
}

/** 取带某个 `aria-label` 的按钮的开标签（类名、`disabled` 都在里面）。 */
function buttonTagOf(html: string, ariaLabel: string, last = false): string {
  const needle = `aria-label="${ariaLabel}"`;
  const at = last ? html.lastIndexOf(needle) : html.indexOf(needle);
  assert.notEqual(at, -1, `找不到 aria-label="${ariaLabel}" 的按钮`);
  const open = html.lastIndexOf("<button", at);
  return html.slice(open, html.indexOf(">", at) + 1);
}

/**
 * 迁移前那张表的表头内容（含只给读屏的那句），逐字照抄。
 *
 * 手柄列的可见文案是空的，因此这里不是一个空字符串，而是一个 `sr-only` 节点 ——
 * 它由 `FieldSpec.headLabel` 表达（见文件末尾两条测试）。
 */
function legacyHeaders(admin: Modules["admin"]): string[] {
  const table = admin.adminCopy.categories.table;
  const copy = admin.adminCopy.categories;
  return [
    `<span class="sr-only">${copy.action.drag}</span>`,
    table.name,
    table.description,
    table.usage,
    table.state,
    table.actions,
  ];
}

test("表头：列的顺序与文案逐列一致（手柄列是只给读屏的那句列名）", async () => {
  cached = await load();
  const html = render([category()]);
  const headers = [...html.matchAll(/<th scope="col"[^>]*>(.*?)<\/th>/g)].map((match) => match[1]);
  assert.deepEqual(headers, legacyHeaders(cached.admin));
  // 名称列是内容列：表头带 `admin-table__grow`。
  assert.ok(
    html.includes(
      `<th scope="col" class="admin-table__grow">${cached.admin.adminCopy.categories.table.name}</th>`,
    ),
  );
  // 其余四列的表头没有附加类名（与迁移前一致）。
  assert.ok(
    html.includes(`<th scope="col">${cached.admin.adminCopy.categories.table.description}</th>`),
  );
});

/**
 * 手柄列的标记与迁移前**逐字相同**：可见表头为空、但带着一句只给读屏的列名
 * （`FieldSpec.headLabel`），单元格没有字段名因此不写 `data-label`。
 *
 * 迁移当时内核表达不了这两件事，工程上先登记再补内核（而不是在 spec 里发明补丁）；
 * 现在两者都由内核表达，这两条因此是与其余用例同向的**正断言**。
 */
test("手柄列表头：可见为空，但带着只给读屏的列名（与原标记逐字相同）", async () => {
  cached = await load();
  const copy = cached.admin.adminCopy.categories;
  const html = render([category()]);
  assert.ok(
    html.includes(
      `<th scope="col" class="admin-table__grip"><span class="sr-only">${copy.action.drag}</span></th>`,
    ),
    "手柄列表头应当只有一句 sr-only 文案",
  );
  // 像素不动：`sr-only` 是绝对定位 + 裁剪，不参与布局；手柄自己的悬停提示也仍在。
  assert.ok(html.includes(`title="${copy.action.drag}"`));
});

test("手柄格：没有字段名就不写 data-label（不留下一个空属性）", async () => {
  cached = await load();
  const table = cached.admin.adminCopy.categories.table;
  const html = render([category()]);
  const gripCell = gripCellOf(html);
  assert.ok(gripCell.startsWith('<td class="admin-table__grip">'), "手柄格的开标签只该有类名");
  assert.equal(gripCell.includes("data-label"), false, "手柄格不该带空的 data-label");
  assert.equal(html.includes('data-label=""'), false, "全表都不该出现空的 data-label");
  // 有字段名的格子照旧写着。
  assert.ok(cellOf(html, table.name).includes(`data-label="${table.name}"`));
});

test("不输出 colgroup：迁移前这张表就没有列宽", async () => {
  cached = await load();
  const html = render([category()]);
  // 关键回归点：spec 里不声明 `width`，内核因此按浏览器自动分配列宽（`table-layout: auto`）。
  // 冒出 `<colgroup>` 就说明列宽被固定住了，布局会变。
  assert.equal(html.includes("<colgroup>"), false, "不该输出 colgroup");
  assert.equal(html.includes("<col "), false, "不该输出 col");
});

test("单元格：data-label 与类名逐列照抄（内容列只有名称列）", async () => {
  cached = await load();
  const copy = cached.admin.adminCopy.categories;
  const html = render([category()]);

  // 每一列都要有 `data-label`（≤1100px 卡片式降级时每个值前面的字段名）。
  for (const label of legacyHeaders(cached.admin).slice(1)) {
    assert.ok(html.includes(`data-label="${label}"`), `缺少 data-label="${label}"`);
  }
  // 名称列：表头与单元格都带 `admin-table__grow`（吸收剩余宽度、允许换行）。
  assert.equal(
    [...html.matchAll(/admin-table__grow/g)].length,
    2,
    "名称列的表头与单元格都该带 admin-table__grow",
  );
  // 手柄列：表头与单元格都带 `admin-table__grip`。
  assert.equal(
    [...html.matchAll(/admin-table__grip/g)].length,
    2,
    "手柄列的表头与单元格都该带 admin-table__grip",
  );
  const nameCell = cellOf(html, copy.table.name);
  assert.ok(
    nameCell.startsWith("<td ") &&
      nameCell.includes('data-label="名称"') &&
      nameCell.includes('class="admin-table__grow"'),
    "名称列应当是带 admin-table__grow 的「名称」格",
  );
  // 「引用记录」列迁移前没有右对齐：内核按 `number` 类型默认会给 `admin-table__num`，
  // spec 里显式写 `numeric: false` 把它关掉了。
  assert.equal(
    html.includes("admin-table__num"),
    false,
    "这张表任何一列都不该出现 admin-table__num",
  );
});

test("单元格内容：名称、说明、引用计数、状态标签", async () => {
  cached = await load();
  const copy = cached.admin.adminCopy.categories;
  const html = render([category({ usedByRepairCount: 3 })]);
  assert.ok(cellOf(html, copy.table.name).endsWith(">系统重装"), "名称应当原样显示");
  assert.ok(cellOf(html, copy.table.description).endsWith(">重装操作系统"));
  assert.ok(cellOf(html, copy.table.usage).endsWith(">3"), "引用计数应当原样显示");
  // 启用中：通过的绿色标签（与维修记录的状态标签同一套类名）。
  const active = cellOf(html, copy.table.state);
  assert.ok(active.includes('class="repair-tag repair-tag--approved"'));
  assert.ok(active.includes(copy.state.active));
  // 已停用：中性标签。
  const inactive = cellOf(render([category({ isActive: false })]), copy.table.state);
  assert.ok(inactive.includes('class="admin-tag admin-tag--muted"'));
  assert.ok(inactive.includes(copy.state.inactive));
});

test("空值与零值：说明为空显示 `—`，引用计数为 0 显示 `0`（不是占位）", async () => {
  cached = await load();
  const copy = cached.admin.adminCopy.categories;
  const html = render([category({ description: null, usedByRepairCount: 0 })]);
  // 空值统一是 `—`（`adminShared.none`），不是「未填写」一类的噪音文案。
  assert.ok(cellOf(html, copy.table.description).includes(cached.admin.adminShared.none));
  // 计数 0 必须显示 0：它是「有没有人用过」的唯一依据，写成 `—` 就分不清
  // 「没人用过」与「统计不到」了。
  assert.ok(cellOf(html, copy.table.usage).endsWith(">0"), "引用计数为 0 时要显示 0");
});

test("空列表：整行占满 6 列的空态单元格", async () => {
  cached = await load();
  const html = render([]);
  // `react-dom/server` 保留 JSX 的属性名 `colSpan`（浏览器解析时会归一成 colspan）。
  assert.ok(
    html.includes(
      `<td class="admin-table__empty" colSpan="6">${cached.admin.adminShared.empty}</td>`,
    ),
    "空态必须是占满列数的单行单元格",
  );
  assert.ok(
    html.includes(`<caption class="sr-only">${cached.admin.adminCopy.categories.title}</caption>`),
    "缺少读屏用标题",
  );
});

test("拖动排序手柄：类名、title、拖动 props 与图标都在，且是唯一可拖的元素", async () => {
  cached = await load();
  const copy = cached.admin.adminCopy.categories;
  const html = render([category({ id: "c-9" })]);
  const grip = gripCellOf(html);
  assert.ok(grip.includes('class="admin-drag"'), "手柄类名应当是 admin-drag");
  // 手柄对读屏隐藏（`aria-hidden`），它的名字来自列名与 `title`
  // —— 两者写在同一个元素上是自相矛盾的。
  assert.ok(grip.includes('aria-hidden="true"'));
  assert.ok(grip.includes(`title="${copy.action.drag}"`), "手柄缺少拖动提示");
  assert.ok(grip.includes('data-grip-for="c-9"'), "手柄应当挂上这一行的拖动 props");
  assert.ok(grip.includes("<svg"), "手柄里应当是 grip 图标");
  // 整表只有手柄可拖（整行可拖会让表格里的文字选不中）。
  assert.equal([...html.matchAll(/draggable="true"/g)].length, 1);
});

test("操作列：↑ ↓ / 编辑 / 停用（启用）的文案、aria-label 与禁用规则", async () => {
  cached = await load();
  const copy = cached.admin.adminCopy.categories;
  const html = render([category(), category({ id: "c-2" })]);
  assert.ok(
    html.includes('class="admin-actions"') && html.includes('class="admin-actions__group"'),
    "操作列应当是 admin-actions / admin-actions__group 两层",
  );

  // 上移 / 下移只有 `aria-label`（可见内容是 ↑ ↓，对读屏隐藏）。
  const up = buttonTagOf(html, copy.action.moveUp);
  // 两行各有一个下移按钮：要看**最后一行**那一个是否禁用。
  const down = buttonTagOf(html, copy.action.moveDown, true);
  assert.ok(up.includes('class="btn btn--ghost"') && up.includes('type="button"'));
  assert.ok(down.includes('class="btn btn--ghost"'));
  assert.ok(html.includes('<span aria-hidden="true">↑</span>'));
  assert.ok(html.includes('<span aria-hidden="true">↓</span>'));
  // 首行没有上移、末行没有下移：禁用而不是隐藏（按钮消失会让整排横移）。
  assert.ok(up.includes("disabled"), "首行的上移按钮应当禁用");
  assert.ok(down.includes("disabled"), "末行的下移按钮应当禁用");
  assert.equal(
    (html.match(new RegExp(`aria-label="${copy.action.moveUp}"`, "g")) ?? []).length,
    2,
    "两行各有一个上移按钮",
  );

  // 编辑：可见文案就是「编辑」（靠文案取名，没有 aria-label），带 edit 图标。
  const editAt = html.indexOf(`<span>${copy.action.edit}</span>`);
  assert.notEqual(editAt, -1, "缺少编辑按钮");
  const editTag = html.slice(html.lastIndexOf("<button", editAt), html.indexOf(">", editAt) + 1);
  assert.equal(
    editTag.includes("aria-label"),
    false,
    "编辑按钮靠可见文案取名，不该再挂一个 aria-label",
  );

  // 停用 / 启用：文案跟着 `isActive` 走。
  assert.ok(html.includes(`<span>${copy.action.deactivate}</span>`), "启用中的分类应当提供停用");
  const inactiveHtml = render([category({ isActive: false })]);
  assert.ok(
    inactiveHtml.includes(`<span>${copy.action.activate}</span>`),
    "已停用的分类应当提供启用",
  );
});

test("业务规则：被引用过的分类不能删除、只能停用 —— 界面上没有删除入口", async () => {
  cached = await load();
  const copy = cached.admin.adminCopy.categories;
  const used = render([category({ usedByRepairCount: 7 })]);
  const unused = render([category({ usedByRepairCount: 0 })]);

  // 1) 操作列恰好四个按钮：↑ ↓ 编辑 停用/启用。**没有删除**，引用计数多与少都一样 ——
  //    `/admin/repair-categories` 根本没有 DELETE 路由，界面也不给假入口。
  assert.equal(
    [...cellOf(used, copy.table.actions).matchAll(/<button/g)].length,
    4,
    "操作列应当恰好四个按钮",
  );
  for (const html of [used, unused]) {
    assert.equal(html.includes("删除"), false, "界面上不该出现删除入口或删除文案");
    assert.equal(html.includes("remove"), false, "界面上不该出现 remove 类入口");
  }

  // 2) 引用计数照常显示（0 也显示 0）：它是「有没有人用过」的唯一依据。
  assert.ok(cellOf(used, copy.table.usage).endsWith(">7"));
  assert.ok(cellOf(unused, copy.table.usage).endsWith(">0"));

  // 3) 停用 / 启用**不因为引用计数被禁用**（`disabled` 只跟写操作在途有关）：
  //    这条规则不是靠禁用按钮体现的，别顺手加 `disabled`。
  const inactiveHtml = render([category({ isActive: false, usedByRepairCount: 0 })]);
  const activateAt = inactiveHtml.indexOf(`<span>${copy.action.activate}</span>`);
  assert.notEqual(activateAt, -1, "缺少启用按钮");
  const activateTag = inactiveHtml.slice(
    inactiveHtml.lastIndexOf("<button", activateAt),
    inactiveHtml.indexOf(">", activateAt) + 1,
  );
  assert.equal(activateTag.includes("disabled"), false, "停用/启用不该因为引用计数被禁用");

  // 4) 规则本身写在文案里（面板把 `usageNote` 渲染在表格上方）：页面不说这件事，
  //    使用者只能猜「为什么没有删除按钮」。
  assert.ok(copy.usageNote.includes("不能删除") && copy.usageNote.includes("只能停用"));
});

test("整行接管：编辑行由面板自己写 5 个格（含 colSpan=2 的表单），内核不插格子", async () => {
  cached = await load();
  const { adminCopy, adminShared } = cached.admin;
  const copy = adminCopy.categories;
  const table = copy.table;
  const item = category();
  // 这一段与 `CategoryAdminPanel` 的 `renderRow` 逐字对应：编辑是把说明与引用记录两列
  // 合成一个表单（`colSpan={2}`），逐列渲染表达不了，所以迁移前后都由调用方写这些格子。
  // 测试是 `.ts`（JSX 走不了），因此这里用 `createElement` 写，形状与面板一致。
  const html = render([item], {
    // 编辑中的行：面板不给任何行属性（迁移前它也没有拖动语义与类名）。
    rowProps: () => ({}),
    renderRow: (row: RepairCategoryAdminView) =>
      createElement(
        React.Fragment,
        null,
        createElement("td", { className: "admin-table__grip" }, adminShared.none),
        createElement("td", { className: "admin-table__grow", "data-label": table.name }, row.name),
        createElement(
          "td",
          { colSpan: 2 },
          createElement(
            "form",
            {
              className: "admin-form",
              method: "post",
              "aria-label": `${copy.action.edit} ${row.name}`,
            },
            createElement("input", { className: "field__input", name: "name", required: true }),
            createElement("input", { className: "field__input", name: "description" }),
            createElement("button", { type: "submit" }, copy.action.save),
            createElement("button", { type: "button" }, copy.action.cancel),
          ),
        ),
        createElement(
          "td",
          { "data-label": table.state },
          row.isActive ? copy.state.active : copy.state.inactive,
        ),
        createElement("td", { "data-label": table.actions }, adminShared.none),
      ),
  });

  const body = html.slice(html.indexOf("<tbody>"));
  // 6 列的表被 5 个格覆盖（表单那一格占两列），内核不该再补一个第 6 个空 td ——
  // 补了就会多出一个迁移前不存在的格子，列宽与 `data-label` 都会跟着变。
  assert.equal([...body.matchAll(/<td/g)].length, 5, "接管的行应当恰好 5 个单元格");
  assert.ok(body.includes('<td colSpan="2">'), "表单那一格应当跨两列");
  assert.ok(
    body.includes(`aria-label="${copy.action.edit} ${item.name}"`),
    "编辑表单的无障碍名称应当带上分类名",
  );
  assert.ok(body.includes(`<td data-label="${table.actions}">${adminShared.none}</td>`));
  // 名称格仍是纯名称文本（名称输入框在跨列的那一格里），状态格是纯文本（不带标签样式）。
  assert.equal(cellOf(html, table.name).includes("field__input"), false);
  assert.ok(cellOf(html, table.name).endsWith(`>${item.name}`));
  assert.equal(cellOf(html, table.state).includes("repair-tag"), false);
  // 首列与迁移前一样**没有** `data-label`（整行接管跳过了内核的逐列渲染）。
  assert.ok(body.includes(`<td class="admin-table__grip">${adminShared.none}</td>`));
  // 接管的那一行仍然只有一个 `<tr>`，`<tr>` 本身由内核渲染。
  assert.equal([...html.matchAll(/<tr>/g)].length, 2, "表头一行 + 数据一行");
});

test("整行接管返回 null：非编辑行照常走逐列渲染（6 个格、带 data-label）", async () => {
  cached = await load();
  const copy = cached.admin.adminCopy.categories;
  const html = render([category()], { renderRow: () => null });
  assert.equal([...html.matchAll(/<td/g)].length, 6, "逐列渲染应当是 6 个格");
  assert.ok(html.includes(`data-label="${copy.table.description}"`), "逐列渲染才有 data-label");
  assert.equal(html.includes("colSpan"), false, "逐列渲染不该出现跨列单元格");
});

test("排序：不开表头排序（列表顺序由拖动排序维护），因此没有任何排序控件", async () => {
  cached = await load();
  const html = render([category()]);
  assert.equal(html.includes("admin-th__sort"), false, "不传 onSortChange 时不该有排序按钮");
  assert.equal(html.includes("aria-sort"), false, "没有排序时表头不该带 aria-sort");
});

test("行属性：迁移前行上只有拖动类名，没有 data-row-id", async () => {
  cached = await load();
  const html = render([category()], { rowProps: () => ({ className: "" }) });
  // 面板给的行属性就是 `drag.rowClass()` + `drag.rowProps()`：不拖动时类名是空串。
  assert.ok(html.includes('<tr class="">'));
  // 成员表 / 维修表有 `data-row-id`，这张表迁移前就没有 —— 迁移不该顺手加上。
  assert.equal(html.includes("data-row-id"), false);
});
