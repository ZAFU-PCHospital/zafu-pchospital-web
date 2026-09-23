import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { SkillTableContext } from "../../src/components/admin/skill-table-spec";
import type { SkillAdminView } from "../../src/types/contracts";

/**
 * 技能标签表迁移到内核后的 **DOM 契约测试**。
 *
 * 「迁移前后 DOM 等价」是这次改造唯一不能妥协的约束（`AGENTS.md` §2：操作前后除明确要改的
 * 那一处，其它像素不该移动）。因此这里不测「组件能不能跑」，而是把迁移前那张表的标记逐项
 * 固定下来：列的顺序与表头文案、每个单元格的 `data-label`、类名、空值占位 `—`、
 * 行内控件的类名与无障碍名称、以及**不该出现的 `admin-table__num`**。
 *
 * 期望值全部从 `SkillAdminPanel.tsx` 迁移前的那段 `<table>` 逐项抄来，**不**从这个 spec
 * 反推 —— 否则测试只能证明「代码和它自己一致」。
 *
 * 用 `react-dom/server` 渲染，不需要 jsdom，也不需要浏览器 —— 断言优先于截图（§8.1）。
 *
 * 为什么要挂一个全局 `React`：`tsconfig` 的 `jsx` 是 `preserve`（Next 自己用自动运行时
 * 编译），而 `tsx` 跑测试时走的是**经典**运行时，组件源码里因此没有 `import React`。
 * 这里先把它挂到全局，再**动态**加载组件 —— 静态 import 会在赋值之前执行，来不及。
 */
(globalThis as unknown as { React: typeof React }).React = React;

type AdminConfig = typeof import("../../src/config/admin");

type Modules = {
  AdminTable: typeof import("../../src/components/admin/AdminTable").AdminTable;
  skillTableSpec: typeof import("../../src/components/admin/skill-table-spec").skillTableSpec;
  skillEmptyText: typeof import("../../src/components/admin/skill-table-spec").skillEmptyText;
  admin: AdminConfig;
};

let cached: Modules | null = null;
async function load(): Promise<Modules> {
  if (cached) return cached;
  const [table, spec, admin] = await Promise.all([
    import("../../src/components/admin/AdminTable"),
    import("../../src/components/admin/skill-table-spec"),
    import("../../src/config/admin"),
  ]);
  cached = {
    AdminTable: table.AdminTable,
    skillTableSpec: spec.skillTableSpec,
    skillEmptyText: spec.skillEmptyText,
    admin,
  };
  return cached;
}

/** 迁移前的表头顺序与文案（手柄列的表头在标记里就是空的）。 */
/**
 * 迁移前那张表的表头内容（含只给读屏的那句），逐字照抄。
 *
 * 手柄列的可见文案是空的，因此这里不是一个空字符串，而是一个 `sr-only` 节点 ——
 * 迁移当时内核表达不了它，现在由 `FieldSpec.headLabel` 表达（见文件末尾两条测试）。
 */
function legacyHeaders(modules: Modules): string[] {
  const table = modules.admin.adminCopy.skills.table;
  const copy = modules.admin.adminCopy.skills;
  return [
    `<span class="sr-only">${copy.action.drag}</span>`,
    table.name,
    table.description,
    table.usage,
    table.state,
    table.actions,
  ];
}

function skill(overrides: Partial<SkillAdminView> = {}): SkillAdminView {
  return {
    id: "sk-1",
    code: "ASSEMBLE",
    name: "装机",
    description: "台式机装机与点亮测试",
    sortOrder: 1,
    isActive: true,
    usedByMemberCount: 3,
    ...overrides,
  };
}

/**
 * 行首拖动手柄来自 `useRowDragSort`。DOM 断言不关心拖动逻辑本身，形状对得上即可
 * （与 `admin-table-render.test.ts` 里成员表的假 context 同一做法）。
 */
function contextOf(overrides: Partial<SkillTableContext> = {}): SkillTableContext {
  return {
    busy: false,
    total: 1,
    drag: {
      handleProps: (id: string) => ({ draggable: true, "data-grip-for": id }),
      rowClass: () => "",
      rowProps: () => ({}),
    } as unknown as SkillTableContext["drag"],
    onReorder: () => {},
    onToggle: () => {},
    onEdit: () => {},
    ...overrides,
  };
}

/** 面板把行属性挂在 `<tr>` 上（手柄在 spec 里，行属性不在）：测试里用同样的拼法。 */
function rowPropsOf(id: string) {
  const drag = contextOf().drag;
  return { className: drag.rowClass(id), ...drag.rowProps(id) };
}

function render(
  modules: Modules,
  items: SkillAdminView[],
  extra: Record<string, unknown> = {},
): string {
  return renderToStaticMarkup(
    createElement(modules.AdminTable<SkillAdminView, SkillTableContext>, {
      spec: modules.skillTableSpec,
      items,
      renderContext: contextOf({ total: items.length }),
      emptyText: modules.skillEmptyText,
      rowProps: (item: SkillAdminView) => rowPropsOf(item.id),
      ...extra,
    }),
  );
}

/** 取某个 `<td>` 的完整标记（按 `data-label` 定位，含结束标签），用于断言单元格内部结构。 */
function cellOf(html: string, label: string): string {
  const start = html.indexOf(`data-label="${label}"`);
  assert.notEqual(start, -1, `找不到 data-label="${label}" 的单元格`);
  const open = html.lastIndexOf("<td", start);
  const end = html.indexOf("</td>", start) + "</td>".length;
  return html.slice(open, end);
}

test("表头：顺序与文案逐列一致，且**不输出 colgroup**（迁移前就没有列宽）", async () => {
  const modules = await load();
  const html = render(modules, [skill()]);
  const headers = [...html.matchAll(/<th scope="col"[^>]*>(.*?)<\/th>/g)].map((match) => match[1]);
  assert.deepEqual(headers, legacyHeaders(modules));
  // 这张表从来没接过 `useColumnResize`：冒出 colgroup 就说明列宽从「浏览器按内容分配」
  // 变成了固定宽度，布局会跟着变。
  assert.equal(html.includes("<colgroup>"), false, "不该输出 colgroup");
  assert.equal(html.includes("<col "), false, "不该输出 col");
  assert.ok(
    html.includes(`<caption class="sr-only">${modules.admin.adminCopy.skills.title}</caption>`),
    "缺少读屏用标题",
  );
});

test("表头类名：手柄列 admin-table__grip、名称列 admin-table__grow，其余不带类", async () => {
  const modules = await load();
  const html = render(modules, [skill()]);
  const head = html.slice(html.indexOf("<thead>"), html.indexOf("</thead>"));
  const classes = [...head.matchAll(/<th scope="col"(?: class="([^"]*)")?>/g)].map(
    (match) => match[1] ?? "",
  );
  assert.deepEqual(classes, ["admin-table__grip", "admin-table__grow", "", "", "", ""]);
});

test("data-label：五个有字段名的列逐列一致，手柄列没有字段名", async () => {
  const modules = await load();
  const table = modules.admin.adminCopy.skills.table;
  const html = render(modules, [skill()]);
  // `data-label` 是 ≤1100px 卡片式降级时每个值前面的字段名，少一个就会在移动端丢信息。
  for (const label of [table.name, table.description, table.usage, table.state, table.actions]) {
    assert.ok(html.includes(`data-label="${label}"`), `缺少 data-label="${label}"`);
  }
  // 手柄列没有字段名（迁移前这一格连 `data-label` 属性都没有）。
  assert.equal(cellOf(html, table.name).includes("admin-table__grip"), false);
});

test("单元格类名：手柄格 admin-table__grip、名称格 admin-table__grow，且**不出现 admin-table__num**", async () => {
  const modules = await load();
  const table = modules.admin.adminCopy.skills.table;
  const html = render(modules, [skill()]);
  // 手柄列没有字段名 ⇒ 不写 `data-label`（写了空串会在卡片式降级里多出一个空标签格）。
  assert.ok(html.includes('<td class="admin-table__grip">'), "手柄格类名不对");
  assert.ok(
    html.includes(`<td data-label="${table.name}" class="admin-table__grow">`),
    "名称格应当是 admin-table__grow",
  );
  // 「选用成员」是数字，但迁移前没有右对齐：内核按 `number` 默认会给 `admin-table__num`，
  // spec 里已显式 `numeric: false`，冒出来就是像素变了。
  assert.equal(
    html.includes("admin-table__num"),
    false,
    "内核按字段类型默认加了右对齐类，但这会改变迁移后的像素",
  );
});

test("手柄：类名、aria-hidden、title 与拖动 props 都保留", async () => {
  const modules = await load();
  const copy = modules.admin.adminCopy.skills;
  const html = render(modules, [skill()]);
  assert.ok(html.includes('class="admin-drag"'), "手柄类名应当是 admin-drag");
  assert.ok(
    html.includes(`aria-hidden="true" title="${copy.action.drag}"`),
    "手柄应当对读屏隐藏，鼠标悬停提示是拖动文案",
  );
  assert.ok(html.includes("data-grip-for="), "手柄应当挂上拖动 props");
  assert.ok(html.includes('draggable="true"'), "手柄是整行唯一可拖的元素");
});

test("单元格内容：名称、说明、选用成员数、状态标签", async () => {
  const modules = await load();
  const { adminCopy, adminShared } = modules.admin;
  const table = adminCopy.skills.table;
  const item = skill();
  const html = render(modules, [item]);

  assert.ok(cellOf(html, table.name).includes(`>${item.name}<`), "名称应当显示");
  assert.ok(cellOf(html, table.description).includes(item.description as string));
  assert.ok(cellOf(html, table.usage).includes(`>${item.usedByMemberCount}<`));
  // 状态用「通过」语气色（与迁移前一致）。
  assert.ok(
    cellOf(html, table.state).includes(
      '<span class="repair-tag repair-tag--approved">启用中</span>',
    ),
    "启用中的标签类名与文案应当不变",
  );
  assert.equal(html.includes(adminShared.none), false, "有值时不该出现空值占位");
});

test("缺省值：没有说明时显示 —，停用走中性标签", async () => {
  const modules = await load();
  const { adminCopy, adminShared } = modules.admin;
  const table = adminCopy.skills.table;
  const html = render(modules, [skill({ description: null, isActive: false })]);
  assert.ok(cellOf(html, table.description).includes(`>${adminShared.none}<`), "空说明显示占位符");
  assert.ok(
    cellOf(html, table.state).includes(
      `<span class="admin-tag admin-tag--muted">${adminCopy.skills.state.inactive}</span>`,
    ),
    "停用应当是中性标签",
  );
});

test("操作列：↑ ↓ 的无障碍名称、首末行禁用、编辑/停用按钮文案", async () => {
  const modules = await load();
  const copy = modules.admin.adminCopy.skills;
  const items = [skill({ id: "sk-1" }), skill({ id: "sk-2", name: "系统重装" })];
  const html = render(modules, items);

  assert.ok(html.includes(`aria-label="${copy.action.moveUp}"`), "上移按钮缺少无障碍名称");
  assert.ok(html.includes(`aria-label="${copy.action.moveDown}"`), "下移按钮缺少无障碍名称");
  assert.ok(html.includes('<span aria-hidden="true">↑</span>'), "↑ 应当对读屏隐藏");
  assert.ok(html.includes('<span aria-hidden="true">↓</span>'), "↓ 应当对读屏隐藏");
  // 第一行的 ↑ 与最后一行的 ↓ 是禁用态（`Button` 把 props 原样交给原生 button）。
  assert.ok(html.includes(`disabled="" aria-label="${copy.action.moveUp}"`), "第一行的 ↑ 应当禁用");
  assert.ok(
    html.includes(`disabled="" aria-label="${copy.action.moveDown}"`),
    "最后一行的 ↓ 应当禁用",
  );
  // 编辑带图标、停用是纯文字按钮（与迁移前一致）。
  assert.equal(
    [...html.matchAll(new RegExp(`<span>${copy.action.edit}</span>`, "g"))].length,
    2,
    "每行一个「编辑」按钮",
  );
  assert.equal(
    [...html.matchAll(new RegExp(`<span>${copy.action.deactivate}</span>`, "g"))].length,
    2,
    "启用中的行显示「停用」",
  );
  assert.equal(html.includes(`<span>${copy.action.activate}</span>`), false);
});

test("行属性：拖动排序的类名与事件 props 落在 `<tr>` 上", async () => {
  const modules = await load();
  const html = render(modules, [skill()], {
    rowProps: (item: SkillAdminView) => ({
      className: item.id === "sk-1" ? "is-dragging" : "",
      "data-drop-for": item.id,
    }),
  });
  assert.ok(html.includes('class="is-dragging"'), "拖动中的行应当带上 is-dragging");
  assert.ok(html.includes('data-drop-for="sk-1"'), "行上的拖动 props 应当保留");
});

test("空列表：整行占满 6 列的空态单元格", async () => {
  const modules = await load();
  const html = render(modules, []);
  // `react-dom/server` 保留 JSX 的属性名 `colSpan`（浏览器解析时会归一成 colspan）。
  assert.ok(
    html.includes(
      `<td class="admin-table__empty" colSpan="6">${modules.admin.adminShared.empty}</td>`,
    ),
    "空态必须是占满列数的单行单元格",
  );
});

test("排序控件：这张表的接口没有 sort 参数，因此表头不渲染排序按钮", async () => {
  const modules = await load();
  const html = render(modules, [skill()]);
  assert.equal(html.includes("admin-th__sort"), false, "迁移前表头没有排序控件");
  assert.equal(html.includes("aria-sort"), false, "没有排序就不该有 aria-sort");
});

test("整行接管：编辑行由面板自己写 5 个格（含 colSpan=2 的表单），内核不插格子", async () => {
  const modules = await load();
  const { adminCopy, adminShared } = modules.admin;
  const copy = adminCopy.skills;
  const table = copy.table;
  const item = skill();
  // 这一段与 `SkillAdminPanel` 的 `renderRow` 逐字对应：编辑是把说明与选用成员两列
  // 合成一个表单（`colSpan={2}`），逐列渲染表达不了，所以迁移前后都由调用方写这些格子。
  // 测试是 `.ts`（JSX 走不了），因此这里用 `createElement` 写，形状与面板一致。
  const html = render(modules, [item], {
    renderRow: (row: SkillAdminView) =>
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
            createElement("input", { className: "field__input", name: "name" }),
          ),
        ),
        createElement(
          "td",
          { "data-label": table.state },
          row.isActive ? copy.state.active : copy.state.inactive,
        ),
        createElement("td", { "data-label": table.actions }, adminShared.none),
      ),
    rowProps: (row: SkillAdminView) => rowPropsOf(row.id),
  });
  const row = html.slice(html.indexOf("<tbody>"));
  // 6 列的表被 5 个格覆盖（表单那一格占两列），内核不该再补一个第 6 个空 td。
  assert.equal([...row.matchAll(/<td/g)].length, 5, "接管的行应当恰好 5 个单元格");
  assert.ok(row.includes('<td colSpan="2">'), "表单那一格应当跨两列");
  assert.ok(
    row.includes(`aria-label="${copy.action.edit} ${item.name}"`),
    "编辑表单的无障碍名称应当带上标签名",
  );
  assert.ok(row.includes(`<td data-label="${table.actions}">${adminShared.none}</td>`));
});

/**
 * 两处曾经的「登记差异」现在已经**归零**：内核补上了 `FieldSpec.headLabel`
 * （表头里的 `sr-only` 文案）并且在没有字段名时不再写空的 `data-label`。
 *
 * 下面两条因此改成与其余测试同向的**正断言** —— 钉住的就是迁移前的标记本身。
 * 它们的存在有历史原因：迁移当时内核表达不了这两件事，工程上先登记再补内核，
 * 而不是在 spec 里发明补丁。
 */
test("手柄列表头：可见为空，但带着只给读屏的列名（与原标记逐字相同）", async () => {
  const modules = await load();
  const copy = modules.admin.adminCopy.skills;
  const html = render(modules, [skill()]);
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
  const modules = await load();
  const table = modules.admin.adminCopy.skills.table;
  const html = render(modules, [skill()]);
  assert.ok(html.includes('<td class="admin-table__grip">'), "手柄格不该带空的 data-label");
  // 有字段名的格子照旧写着。
  assert.ok(cellOf(html, table.name).includes(`data-label="${table.name}"`));
});
