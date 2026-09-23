import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MAX_FILTER_RULES } from "../../src/lib/api/list-filter";

/**
 * 列级筛选（P2 第二半）的 **DOM 契约 + 口径一致性** 测试。
 *
 * 两类断言：
 *
 * 1. **前后端同一份白名单**：界面上能选的列与运算符，必须与后端 `MEMBER_FILTERABLE`
 *    逐项一致。多一个就是「点了必然 400」，少一个就是「后端支持却选不出来」——
 *    与 `sortableFields(spec)` ↔ `MEMBER_SORTABLE` 是同一条约定。
 * 2. **条件区的 DOM 契约**：列名来自 spec、值控件按 `FieldFilterSpec.input` 渲染、
 *    计数槽位常驻（按钮宽度不随条件数变化，同排按钮不会横移）。
 *
 * 与 `admin-table-render.test.ts` 同样的手法：用 `react-dom/server` 渲染，不需要 jsdom
 * （项目没装）。弹层本体走 `createPortal`，SSR 下没有 `document` 渲染不出来，
 * 因此这里测的是它里面那块**纯展示**的条件区，以及入口按钮 —— 两者都无副作用。
 * 交互路径（换列后旧值留不留、什么时候能点「应用」）由 `filter-draft.test.ts` 覆盖。
 *
 * 全局 `React`：`tsconfig` 的 `jsx` 是 `preserve`，`tsx` 跑测试走**经典**运行时，
 * 组件源码里因此没有 `import React`。必须**先**挂全局、再动态 import。
 */
(globalThis as unknown as { React: typeof React }).React = React;

type Modules = {
  AdminFilterTrigger: typeof import("../../src/components/admin/AdminFilterDialog").AdminFilterTrigger;
  AdminFilterDialogBody: typeof import("../../src/components/admin/AdminFilterDialog").AdminFilterDialogBody;
  filterFieldsOf: typeof import("../../src/lib/table/field-spec").filterFieldsOf;
  memberTableSpec: typeof import("../../src/components/admin/member-table-spec").memberTableSpec;
  MEMBER_FILTERABLE: typeof import("../../src/features/members/member-filter-fields").MEMBER_FILTERABLE;
  admin: typeof import("../../src/config/admin");
};

let cached: Modules | null = null;
async function load(): Promise<Modules> {
  if (cached) return cached;
  const [dialog, fieldSpec, spec, filterFields, admin] = await Promise.all([
    import("../../src/components/admin/AdminFilterDialog"),
    import("../../src/lib/table/field-spec"),
    import("../../src/components/admin/member-table-spec"),
    import("../../src/features/members/member-filter-fields"),
    import("../../src/config/admin"),
  ]);
  cached = {
    AdminFilterTrigger: dialog.AdminFilterTrigger,
    AdminFilterDialogBody: dialog.AdminFilterDialogBody,
    filterFieldsOf: fieldSpec.filterFieldsOf,
    memberTableSpec: spec.memberTableSpec,
    MEMBER_FILTERABLE: filterFields.MEMBER_FILTERABLE,
    admin,
  };
  return cached;
}

const noop = () => {};
const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1;

test("成员表：界面能筛的列与后端白名单逐项一致", async () => {
  const { filterFieldsOf, memberTableSpec, MEMBER_FILTERABLE } = await load();
  const fields = filterFieldsOf(memberTableSpec);

  // 列顺序 = 表头顺序；`key` 是后端字段名，`columnKey` 是列 id。
  // 成员首列两处不同：列 id 是 `member`（格子里有手柄 / 姓名 / 昵称 / 查看），
  // 后端认的是 `realName`。
  assert.deepEqual(
    fields.map((field) => field.key),
    ["realName", "studentId", "className", "status", "joinedAt"],
  );
  assert.deepEqual(
    fields.map((field) => field.columnKey),
    ["member", "studentId", "className", "status", "joinedAt"],
  );

  for (const field of fields) {
    const allowed = MEMBER_FILTERABLE[field.key];
    assert.ok(allowed, `${field.key} 界面能筛，后端白名单里却没有 —— 这条条件必然 400`);
    assert.deepEqual(
      [...field.ops],
      [...allowed],
      `${field.key} 的运算符与后端不一致（界面 ${field.ops.join("/")}，后端 ${allowed.join("/")}）`,
    );
    assert.ok(field.ops.length > 0, `${field.key} 一个运算符都没有，不该出现在弹层里`);
  }
});

test("关联列与派生列不参与列级筛选（后端也没有它们的字段）", async () => {
  const { filterFieldsOf, memberTableSpec, MEMBER_FILTERABLE } = await load();
  const offered = new Set(filterFieldsOf(memberTableSpec).map((field) => field.key));

  // 角色 / 技能是关联（一个成员可以有多个，不是一列标量），维修记录是跨表聚合，
  // 联系方式是脱敏后的拼接展示值 —— 四种都不是「某一列的值」。
  for (const key of ["roles", "skills", "repairs", "contacts"]) {
    assert.equal(offered.has(key), false, `${key} 不该出现在列级筛选里`);
    assert.equal(MEMBER_FILTERABLE[key], undefined, `${key} 后端也不该有筛选项`);
  }

  // 后端有的、界面暂时没入口的字段要**一个一个点名**：将来白名单加了字段却没有界面，
  // 这条断言会先红，而不是让「后端支持但没人能用」悄悄存在。
  const missing = Object.keys(MEMBER_FILTERABLE).filter((key) => !offered.has(key));
  assert.deepEqual(missing, ["nickname"]);
});

test("列筛选入口：计数槽位常驻，宽度不随条件数变化", async () => {
  const { AdminFilterTrigger, filterFieldsOf, memberTableSpec, admin } = await load();
  const fields = filterFieldsOf(memberTableSpec);
  const labels = admin.adminShared.filters;
  const slot = 'class="admin-filterbtn__count"';

  const idle = renderToStaticMarkup(
    createElement(AdminFilterTrigger, { fields, count: 0, onClick: noop }),
  );
  const active = renderToStaticMarkup(
    createElement(AdminFilterTrigger, { fields, count: 3, onClick: noop }),
  );

  // 槽位两次都在：数字出现 / 消失都不会改变按钮宽度，同排的按钮因此不会横移。
  assert.equal(countOf(idle, slot), 1);
  assert.equal(countOf(active, slot), 1);
  assert.ok(idle.includes(`aria-label="${labels.open}"`));
  assert.ok(
    active.includes(`aria-label="${labels.openActive.replace("{count}", "3")}"`),
    "有条件在生效时，按钮的无障碍名称要说清楚有几个",
  );

  // 有条件才用信号色描边（`is-active`），没有时是普通描边按钮。
  assert.ok(active.includes("is-active"));
  assert.equal(idle.includes("is-active"), false);
});

test("没有任何可筛列的表不给入口（不点开一个空弹层）", async () => {
  const { AdminFilterTrigger } = await load();
  const markup = renderToStaticMarkup(
    createElement(AdminFilterTrigger, { fields: [], count: 0, onClick: noop }),
  );
  assert.equal(markup, "");
});

test("条件区：列名来自 spec，值控件按声明的形态渲染", async () => {
  const { AdminFilterDialogBody, filterFieldsOf, memberTableSpec, admin } = await load();
  const fields = filterFieldsOf(memberTableSpec);
  const labels = admin.adminShared.filters;
  const props = {
    fields,
    atLimit: false,
    onAdd: noop,
    onRemove: noop,
    onChangeField: noop,
    onChangeOp: noop,
    onChangeValue: noop,
  };

  // 空草稿：只说「还没有条件」，不给一行空白 —— 空白行的「应用」永远是灰的。
  const empty = renderToStaticMarkup(createElement(AdminFilterDialogBody, { ...props, draft: [] }));
  assert.equal(countOf(empty, 'class="admin-conditions__row"'), 0);
  assert.ok(empty.includes(labels.empty));

  const draft = [
    { field: "realName", op: "contains", value: "张" },
    { field: "status", op: "eq", value: "ACTIVE" },
    { field: "joinedAt", op: "gte", value: "2026-01-01" },
  ] as const;
  const html = renderToStaticMarkup(
    createElement(AdminFilterDialogBody, { ...props, draft }),
  );

  assert.equal(countOf(html, 'class="admin-conditions__row"'), 3);

  // 列名来自 `FieldSpec.label`（成员首列在筛选里显示为「成员」，后端字段是 realName）。
  for (const label of ["成员", "状态", "加入时间"]) {
    assert.ok(html.includes(`>${label}<`), `列下拉里没有「${label}」`);
  }

  // 三种值控件：文本 / 枚举 / 日期。
  assert.ok(html.includes('value="张"'), "文本条件要带出已填的值");
  assert.match(html, /<input class="field__input" type="date"/);
  assert.ok(html.includes('value="2026-01-01"'), "日期条件要带出已选的日期");
  // 状态条件的选项文案与表格里显示的一致（同一份 `memberStatusLabels`）。
  for (const label of [admin.memberStatusLabels.ACTIVE, admin.memberStatusLabels.REVOKED]) {
    assert.ok(html.includes(`>${label}<`), `状态条件里没有选项「${label}」`);
  }
  assert.ok(html.includes(`>${labels.pick}<`), "枚举值要给「请选择」的可见空态");

  // 运算符只给这一列声明过的那些。
  assert.ok(html.includes(`>${labels.ops.contains}<`));
  assert.ok(html.includes(`>${labels.ops.gte}<`));
  const realNameRow = html.slice(0, html.indexOf("studentId"));
  assert.equal(
    realNameRow.includes(`>${labels.ops.eq}<`),
    false,
    "「成员」列只声明了 contains，不该出现「等于」",
  );
});

test("到达条件上限时「添加条件」禁用并说明原因", async () => {
  const { AdminFilterDialogBody, filterFieldsOf, memberTableSpec, admin } = await load();
  const fields = filterFieldsOf(memberTableSpec);
  const labels = admin.adminShared.filters;

  const draft = Array.from({ length: MAX_FILTER_RULES }, () => ({
    field: "realName",
    op: "contains" as const,
    value: "张",
  }));
  const html = renderToStaticMarkup(
    createElement(AdminFilterDialogBody, {
      fields,
      draft,
      atLimit: true,
      onAdd: noop,
      onRemove: noop,
      onChangeField: noop,
      onChangeOp: noop,
      onChangeValue: noop,
    }),
  );

  assert.equal(countOf(html, 'class="admin-conditions__row"'), MAX_FILTER_RULES);
  // 到上限时「添加条件」是禁用态 + 一句为什么，而不是点了没反应。
  const tools = html.slice(html.indexOf("admin-conditions__tools"));
  assert.match(tools, /disabled/);
  assert.ok(tools.includes(labels.limit.replace("{count}", String(MAX_FILTER_RULES))));
});
