import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { MemberTableContext } from "../../src/components/admin/member-table-spec";
import type { AuditLogEntry, MemberListEntry, RepairView } from "../../src/types/contracts";

/**
 * 成员表迁移到内核后的 **DOM 契约测试**。
 *
 * 「迁移前后 DOM 等价」是这次改造唯一不能妥协的约束（`AGENTS.md`：操作前后除明确要改的
 * 那一处，其它像素不该移动）。因此这里不测「组件能不能跑」，而是把迁移前那张表的标记
 * 逐项固定下来：列的顺序与宽度、表头文案、每个单元格的 `data-label`、类名、空值行、
 * `title`、以及**不该出现的 `admin-table__num`**。
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
type MemberConfig = typeof import("../../src/config/member");

type Modules = {
  AdminTable: typeof import("../../src/components/admin/AdminTable").AdminTable;
  memberTableSpec: typeof import("../../src/components/admin/member-table-spec").memberTableSpec;
  auditTableSpec: typeof import("../../src/components/admin/audit-table-spec").auditTableSpec;
  repairTableSpec: typeof import("../../src/components/admin/repair-table-spec").repairTableSpec;
  admin: AdminConfig;
  memberConfig: MemberConfig;
};

let cached: Modules | null = null;
async function load(): Promise<Modules> {
  if (cached) return cached;
  const [table, spec, auditSpec, repairSpec, admin, memberConfig] = await Promise.all([
    import("../../src/components/admin/AdminTable"),
    import("../../src/components/admin/member-table-spec"),
    import("../../src/components/admin/audit-table-spec"),
    import("../../src/components/admin/repair-table-spec"),
    import("../../src/config/admin"),
    import("../../src/config/member"),
  ]);
  cached = {
    AdminTable: table.AdminTable,
    memberTableSpec: spec.memberTableSpec,
    auditTableSpec: auditSpec.auditTableSpec,
    repairTableSpec: repairSpec.repairTableSpec,
    admin,
    memberConfig,
  };
  return cached;
}

/** 迁移前的列宽（第九轮验收后的值），迁移后必须逐列一致。 */
const LEGACY_WIDTHS = [221, 124, 92, 96, 96, 72, 96, 132, 150];

function legacyLabels(modules: Modules): string[] {
  const table = modules.admin.adminCopy.members.table;
  return [
    table.realName,
    table.skills,
    table.studentId,
    table.className,
    table.roles,
    table.status,
    table.joinedAt,
    table.repairs,
    table.contacts,
  ];
}

function member(overrides: Partial<MemberListEntry> = {}): MemberListEntry {
  return {
    id: "m-1",
    userId: "u-1",
    realName: "张三",
    nickname: "小三",
    studentId: "S001",
    className: "计科 2101",
    status: "ACTIVE",
    roles: ["MEMBER", "ADMIN"],
    userStatus: "ACTIVE",
    skills: [
      { id: "s1", name: "装机", isActive: true },
      { id: "s2", name: "系统重装", isActive: true },
      { id: "s3", name: "焊接", isActive: false },
    ],
    qqMasked: "123****789",
    phoneMasked: "138****0000",
    approvedRepairCount: 3,
    approvedRepairMinutes: 99,
    joinedAt: "2025-09-01T02:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

/**
 * 行首控件来自两个 hook：`useRowSelect`（复选框 / 范围选择）与 `useRowDragSort`
 * （拖动排序手柄）。DOM 断言不关心交互，形状对得上即可。
 */
function contextOf(sortingActive = false): MemberTableContext {
  return {
    rows: {
      checkboxProps: (id: string) => ({
        className: "admin-check admin-rownum__box",
        type: "checkbox",
        checked: false,
        onChange: () => {},
        "data-checkbox-for": id,
      }),
    } as unknown as MemberTableContext["rows"],
    sort: {
      draggingId: null,
      dropTarget: null,
      rowClass: () => undefined,
      rowProps: () => ({}),
      handleProps: (id: string) => ({ "data-grip-for": id }),
      keyboardProps: (id: string) => ({ "data-grip-keys-for": id }),
    } as unknown as MemberTableContext["sort"],
    firstRowNumber: 1,
    onView: () => {},
    sortingActive,
    updateMember: async () => {},
  };
}

function render(
  modules: Modules,
  items: MemberListEntry[],
  extra: Record<string, unknown> = {},
): string {
  return renderToStaticMarkup(
    createElement(modules.AdminTable<MemberListEntry, MemberTableContext>, {
      spec: modules.memberTableSpec,
      items,
      renderContext: contextOf(),
      emptyText: modules.admin.adminShared.empty,
      rowProps: (item: MemberListEntry) => ({ "data-row-id": item.id }),
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
  return html.slice(open, end);
}

test("列宽与列数：与迁移前逐列一致", async () => {
  const modules = await load();
  const html = render(modules, [member()]);
  const widths = [...html.matchAll(/<col style="width:(\d+)px"\/>/g)].map((match) =>
    Number(match[1]),
  );
  assert.deepEqual(widths, LEGACY_WIDTHS);
});

test("表头：顺序与文案一致，每个单元格都带 data-label", async () => {
  const modules = await load();
  const html = render(modules, [member()]);
  const headers = [...html.matchAll(/<th scope="col">(.*?)<\/th>/g)].map((match) => match[1]);
  assert.deepEqual(headers, legacyLabels(modules));
  // `data-label` 是 ≤1100px 卡片式降级时每个值前面的字段名，少一个就会在移动端丢信息。
  for (const label of legacyLabels(modules)) {
    assert.ok(html.includes(`data-label="${label}"`), `缺少 data-label="${label}"`);
  }
});

test("行与单元格：行键、首列类名、截断列的 title、读屏标题都保留", async () => {
  const modules = await load();
  const html = render(modules, [member()]);
  assert.ok(html.includes('data-row-id="m-1"'), "行上缺少 data-row-id（写操作后按 id 定位要用）");
  assert.ok(html.includes('class="admin-table__member"'), "首列缺少 admin-table__member");
  // 班级列窄且会截断，完整值在迁移前就挂在 `title` 上。
  assert.ok(
    cellOf(html, modules.admin.adminCopy.members.table.className).includes('title="计科 2101"'),
  );
  assert.ok(
    html.includes(`<caption class="sr-only">${modules.admin.adminCopy.members.title}</caption>`),
    "缺少读屏用标题",
  );
});

test("不引入 admin-table__num：加入时间与维修记录迁移前并未右对齐", async () => {
  const modules = await load();
  const html = render(modules, [member()]);
  assert.equal(
    html.includes("admin-table__num"),
    false,
    "内核按字段类型默认给日期/数字加了右对齐类，但这会改变迁移后的像素 —— spec 里已显式 numeric: false",
  );
});

test("单元格内容：行号、昵称、技能收尾、角色、状态、统计、联系方式", async () => {
  const modules = await load();
  const { adminCopy, adminShared, memberRoleLabels, memberStatusLabels } = modules.admin;
  const { formatDurationMinutes } = modules.memberConfig;
  const table = adminCopy.members.table;
  const item = member();
  const html = render(modules, [item]);

  assert.ok(html.includes('class="admin-rownum__n" aria-hidden="true">1<'), "行号应当是 1");
  assert.ok(
    html.includes(`aria-label="${table.selectOne}${item.realName}"`),
    "复选框缺少带姓名的无障碍名称",
  );
  assert.ok(html.includes(`aria-label="${table.view} ${item.realName}"`), "详情入口缺少无障碍名称");
  // 手柄 = 拖动排序（`useRowDragSort`），它的无障碍名称必须说清「拖谁」，否则读屏听到
  // 十几个一模一样的「拖动调整这一行的位置」。
  assert.ok(
    html.includes(`aria-label="${table.dragRow}：${item.realName}"`),
    "拖动排序手柄缺少带姓名的无障碍名称",
  );
  assert.ok(html.includes('class="admin-rowgrip"'), "手柄类名应当是 admin-rowgrip");
  assert.ok(html.includes(`（${item.nickname}）`), "昵称应当跟在姓名同一行");

  // 技能标签：可见的只有两枚，第三枚收进 `+1`；完整列表在 `title` 上。
  const skills = cellOf(html, table.skills);
  assert.ok(skills.includes(">装机<") && skills.includes(">系统重装<"));
  assert.equal(skills.includes(">焊接<"), false, "第三枚技能标签不该出现在可见标签里");
  assert.ok(skills.includes(`>${table.skillsMore.replace("{count}", "1")}<`), "缺少 +1 收尾");
  assert.ok(skills.includes(`title="${item.skills.map((skill) => skill.name).join("、")}"`));

  assert.ok(html.includes(memberRoleLabels.MEMBER) && html.includes(memberRoleLabels.ADMIN));
  assert.ok(html.includes(memberStatusLabels.ACTIVE));
  assert.ok(
    html.includes(table.repairsCount.replace("{count}", "3")) &&
      html.includes(formatDurationMinutes(99)),
  );
  assert.ok(html.includes(item.qqMasked as string) && html.includes(item.phoneMasked as string));
  assert.equal(html.includes(adminShared.none), false, "有值时不该出现空值占位");
});

test("缺省值与边界：空技能、零维修、空班级、无昵称都走原有占位", async () => {
  const modules = await load();
  const html = render(modules, [
    member({
      skills: [],
      approvedRepairCount: 0,
      approvedRepairMinutes: 0,
      className: null,
      nickname: null,
      studentId: null,
      qqMasked: null,
      phoneMasked: null,
    }),
  ]);
  // 空值统一是 `—`（`adminShared.none`），不是「未登记」一类的噪音文案。
  assert.ok(html.includes(modules.admin.adminShared.none));
  assert.ok(
    html.includes(modules.admin.adminCopy.members.table.repairsCount.replace("{count}", "0")),
  );
  assert.equal(html.includes("（）"), false, "没有昵称时不该出现空括号");
});

test("空列表：整行占满列数的空态单元格", async () => {
  const modules = await load();
  const html = render(modules, []);
  // `react-dom/server` 保留 JSX 的属性名 `colSpan`（浏览器解析时会归一成 colspan）。
  assert.ok(
    html.includes(
      `<td class="admin-table__empty" colSpan="${LEGACY_WIDTHS.length}">${modules.admin.adminShared.empty}</td>`,
    ),
    "空态必须是占满列数的单行单元格",
  );
});

test("排序控件：不传 onSortChange 时不渲染按钮（迁移后外观零变化）", async () => {
  const modules = await load();
  assert.equal(render(modules, [member()]).includes("admin-th__sort"), false);
});

test("排序控件：传了 onSortChange 时只给白名单内的列渲染按钮", async () => {
  const modules = await load();
  const table = modules.admin.adminCopy.members.table;
  const html = render(modules, [member()], { onSortChange: () => {}, sort: [] });
  const buttons = [
    ...html.matchAll(/<button type="button" class="admin-th__sort[^"]*">(.*?)<\/button>/g),
  ];
  // 可排序：成员（sortKey = realName）/ 学号 / 班级 / 状态 / 加入时间；
  // 不可排序：技能标签与角色（关联）、维修记录（跨表聚合）、联系方式（脱敏拼接）。
  assert.deepEqual(
    buttons.map((match) => match[1]),
    [table.realName, table.studentId, table.className, table.status, table.joinedAt],
  );
});

test("未排序时：拖动手柄带拖动语义，槽位与无障碍名称都在", async () => {
  const modules = await load();
  const html = render(modules, [member()]);
  assert.ok(html.includes('class="admin-rowgrip"'), "手柄类名应当是 admin-rowgrip");
  assert.ok(html.includes("data-grip-for"), "未排序时手柄应当挂上拖动 props");
  assert.equal(html.includes("is-inert"), false, "未排序时手柄不该是作废态");
});

test("排序激活时：手柄作废（保留槽位、但不给拖动语义与无障碍名称）", async () => {
  const modules = await load();
  const html = render(modules, [member()], { renderContext: contextOf(true) });
  assert.ok(html.includes('class="admin-rowgrip is-inert"'), "排序激活时手柄应当标记为作废");
  assert.equal(html.includes("data-grip-for"), false, "排序激活时不该再挂拖动的 props");
  assert.equal(
    html.includes(modules.admin.adminCopy.members.table.dragRow),
    false,
    "读屏不该听到一个拖不动的手柄",
  );
  // 槽位必须还在：否则行号与复选框会横向移动（「操作前后其它像素不该移动」）。
  assert.ok(html.includes('class="admin-rownum"'), "行号槽位不该消失");
});

test("就地编辑：只有标量列被包成可编辑按钮，复合列不碰", async () => {
  const modules = await load();
  const item = member();
  const html = render(modules, [item]);
  const table = modules.admin.adminCopy.members.table;
  // 学号与班级：包成按钮（可点即编辑），无障碍名称说清「改哪一行的哪个字段」。
  assert.ok(
    html.includes(
      `<button type="button" class="admin-celledit p-0 text-start" aria-label="编辑${table.studentId}：${item.realName}">`,
    ),
    "学号列应当是可就地编辑的按钮",
  );
  assert.ok(
    html.includes(`aria-label="编辑${table.className}：${item.realName}"`),
    "班级列应当是可就地编辑的按钮",
  );
  // 其它列**一个都不该**被包起来：包了就是多了一层盒子，边框/省略号都会跟着变。
  assert.equal(
    [...html.matchAll(/admin-celledit/g)].length,
    2,
    "可编辑单元格应当恰好两处（学号、班级）",
  );
  // 复合单元格（成员列：行首控件 + 姓名 + 昵称 + 查看）刻意不开就地编辑。
  assert.equal(
    html.includes(`aria-label="编辑${table.realName}：`),
    false,
    "复合列不该出现就地编辑入口",
  );
});

test("就地编辑：空值单元格同样可编辑（提交空串由服务端归一成 null）", async () => {
  const modules = await load();
  const table = modules.admin.adminCopy.members.table;
  const html = render(modules, [member({ studentId: null, className: null })]);
  assert.ok(html.includes(`aria-label="编辑${table.studentId}：张三"`), "空学号也要能点进去改");
  assert.ok(html.includes(`aria-label="编辑${table.className}：张三"`), "空班级也要能点进去改");
  assert.ok(html.includes(modules.admin.adminShared.none), "空值仍显示占位");
});

test("排序状态：aria-sort 用 sortKey（realName）而不是列 id", async () => {
  const modules = await load();
  const html = render(modules, [member()], {
    onSortChange: () => {},
    sort: [{ field: "realName", direction: "desc" }],
  });
  const head = html.slice(html.indexOf("<thead>"), html.indexOf("</thead>"));
  assert.ok(
    head.includes('aria-sort="descending"'),
    "首列的排序字段是 realName（sortKey），不能拿列 id `member` 去比对",
  );
});

/* ---------------------------------------------------------------- 审计记录表 */

async function loadAudit() {
  return import("../../src/components/admin/audit-table-spec");
}

function auditEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: "a-1",
    actorType: "USER",
    actorUserId: "u-1",
    actorName: "张三",
    action: "member.profile.updated",
    targetType: "MemberProfile",
    targetId: "e6000000-0000-4000-8000-000000000002",
    requestId: "req_0123456789abcdef",
    result: "SUCCESS",
    errorCode: null,
    beforeSummary: { nickname: "旧" },
    afterSummary: { nickname: "新" },
    createdAt: "2026-09-23T02:00:00.000Z",
    ...overrides,
  };
}

function renderAudit(items: AuditLogEntry[], extra: Record<string, unknown> = {}): string {
  const spec = auditModules?.auditTableSpec;
  assert.ok(spec, "审计 spec 还没加载");
  return renderToStaticMarkup(
    createElement(
      modulesRef.AdminTable<AuditLogEntry, { onDetail: (entry: AuditLogEntry) => void }>,
      {
        spec,
        items,
        renderContext: auditContext,
        emptyText: modulesRef.admin.adminShared.empty,
        ...extra,
      },
    ),
  );
}

let modulesRef: Modules;
let auditModules: typeof import("../../src/components/admin/audit-table-spec") | null = null;
const auditContext = { onDetail: () => {} };

test("审计表：表头顺序与文案一致，且**不输出 colgroup**（迁移前就没有列宽）", async () => {
  modulesRef = await load();
  auditModules = await loadAudit();
  const copy = modulesRef.admin.adminCopy.audit;
  const html = renderAudit([auditEntry()]);
  const headers = [...html.matchAll(/<th scope="col"[^>]*>(.*?)<\/th>/g)].map((match) => match[1]);
  assert.deepEqual(headers, [
    copy.table.createdAt,
    copy.table.action,
    copy.table.actor,
    copy.table.target,
    copy.table.requestId,
    copy.table.result,
    copy.table.actions,
  ]);
  // 关键回归点：审计表没有声明列宽，内核因此不该冒出 `<colgroup>` ——
  // 冒出来就说明列宽从「浏览器按内容分配」变成了固定宽度，布局会变。
  assert.equal(html.includes("<colgroup>"), false, "不该输出 colgroup");
  assert.equal(html.includes("<col "), false, "不该输出 col");
});

test("审计表：内容列（动作）带 admin-table__grow，目标列短 ID 与 title 都在", async () => {
  modulesRef = await load();
  auditModules = await loadAudit();
  const copy = modulesRef.admin.adminCopy.audit;
  const entry = auditEntry();
  const html = renderAudit([entry]);
  // 内容列：表头与单元格都要带（吸收剩余宽度 + 允许换行）。
  assert.equal(
    [...html.matchAll(/admin-table__grow/g)].length,
    2,
    "动作列的表头与单元格都该带 admin-table__grow",
  );
  // 目标列：中文类型 + 短 ID，完整 ID 在 `title` 上。
  assert.ok(html.includes(`title="${entry.targetId}"`), "目标列缺少完整 ID 的 title");
  assert.ok(
    html.includes(`>${copy.targetLabels.MemberProfile}<`),
    "已知目标类型显示中文名（不是原样显示枚举值）",
  );
  assert.ok(html.includes(`<code>${entry.targetId.slice(0, 8)}…</code>`), "目标列应当显示短 ID");
  assert.ok(html.includes(entry.requestId), "请求 ID 应当显示");
});

test("审计表：未知目标类型原样显示（不猜也不隐藏），且不截断短 ID", async () => {
  modulesRef = await load();
  auditModules = await loadAudit();
  const unknown = renderAudit([auditEntry({ targetType: "SomethingNew", targetId: "short" })]);
  assert.ok(unknown.includes(">SomethingNew<"), "未知类型应当原样显示");
  // 8 位以内不加省略号（`shortAuditId` 的边界）。
  assert.ok(unknown.includes("<code>short</code>"), "短 ID 不该被加省略号");
});

test("审计表：结果标签按语气分色，失败带错误码；操作列是变更摘要入口", async () => {
  modulesRef = await load();
  auditModules = await loadAudit();
  const copy = modulesRef.admin.adminCopy.audit;
  const ok = renderAudit([auditEntry()]);
  assert.ok(ok.includes("repair-tag--approved") && ok.includes(copy.resultLabels.SUCCESS));
  const failed = renderAudit([
    auditEntry({ result: "FAILURE", errorCode: "MEMBER_LAST_ADMIN", actorName: null }),
  ]);
  assert.ok(failed.includes("repair-tag--rejected"));
  assert.ok(failed.includes("MEMBER_LAST_ADMIN"), "失败要带上错误码");
  assert.ok(failed.includes(copy.actorSystem), "系统写入的操作者显示「系统」");
  assert.ok(failed.includes(copy.action.detail), "操作列应当是变更摘要入口");
});

test("审计表：空列表占满 7 列", async () => {
  modulesRef = await load();
  auditModules = await loadAudit();
  const html = renderAudit([]);
  assert.ok(
    html.includes(
      `<td class="admin-table__empty" colSpan="7">${modulesRef.admin.adminShared.empty}</td>`,
    ),
    "空态必须是占满 7 列的单行单元格",
  );
});

/* ---------------------------------------------------------------- 维修记录表 */

type RepairContext = {
  selected: string[];
  onToggleSelected: (recordId: string, checked: boolean) => void;
  onDetail: (recordId: string) => void;
};

function repair(overrides: Partial<RepairView> = {}): RepairView {
  return {
    id: "r-1",
    member: { id: "m-1", name: "张三" },
    repairDate: "2026-09-01",
    durationMinutes: 99,
    category: {
      id: "c-1",
      code: "SYSTEM",
      name: "系统重装",
      description: null,
      sortOrder: 1,
      isActive: true,
    },
    content: "重装系统",
    result: "COMPLETED",
    remark: null,
    status: "APPROVED",
    isDifficult: false,
    isTypical: true,
    version: 1,
    submittedAt: "2026-09-01T02:00:00.000Z",
    reviewedAt: "2026-09-02T02:00:00.000Z",
    createdAt: "2026-09-01T02:00:00.000Z",
    updatedAt: "2026-09-02T02:00:00.000Z",
    photos: [],
    ...overrides,
  };
}

function renderRepairs(
  items: RepairView[],
  extra: Record<string, unknown> = {},
  selected: string[] = [],
): string {
  return renderToStaticMarkup(
    createElement(modulesRef.AdminTable<RepairView, RepairContext>, {
      spec: modulesRef.repairTableSpec,
      items,
      renderContext: {
        selected,
        onToggleSelected: () => {},
        onDetail: () => {},
      } satisfies RepairContext,
      emptyText: modulesRef.admin.adminShared.empty,
      ...extra,
    }),
  );
}

test("维修表：表头 8 列（首列空表头）且不输出 colgroup", async () => {
  modulesRef = await load();
  const copy = modulesRef.admin.adminCopy.repairs;
  const html = renderRepairs([repair()]);
  const headers = [...html.matchAll(/<th scope="col"[^>]*>(.*?)<\/th>/g)].map((match) => match[1]);
  assert.deepEqual(headers, [
    "",
    copy.table.repairDate,
    copy.table.member,
    copy.table.category,
    copy.table.result,
    copy.table.duration,
    copy.table.status,
    copy.table.actions,
  ]);
  assert.equal(html.includes("<colgroup>"), false, "维修表没有声明列宽，不该有 colgroup");
});

test("维修表：选择列是独立的复选框列（没有字段名），勾选状态跟着 selected 走", async () => {
  modulesRef = await load();
  const copy = modulesRef.admin.adminCopy.repairs;
  const html = renderRepairs([repair()], {}, ["r-1"]);
  /* 选择列没有字段名 ⇒ 内核**不写** `data-label`。
     迁移前这段手写标记里写的是 `data-label=""`，内核统一成「没有名字就不写这个属性」：
     卡片模式里 `attr(data-label)` 取不到属性与取到空串渲染完全相同（`.admin-table td::before`
     的 `content` 都是空串，那个 5.5rem 的标签格照样占位），因此像素不动；
     而且技能 / 分类两张表的手柄列原本就没有这个属性，统一之后三张表逐字等价。 */
  const selectCell = html.slice(html.indexOf("<tbody>"), html.indexOf('class="admin-check"'));
  assert.equal(selectCell.includes("data-label"), false, "选择列不该带空的 data-label");
  assert.ok(html.includes(`aria-label="${copy.table.selectOne}"`), "复选框要有无障碍名称");
  assert.ok(html.includes('class="admin-check"') && html.includes('type="checkbox"'));
  // 已勾选：SSR 会输出 checked。
  assert.ok(/<input[^>]*checked/.test(html), "已选中的行复选框应当勾上");
});

test("维修表：成员 / 分类按名字排——排序用的是 sortKey（memberName / categoryName）", async () => {
  modulesRef = await load();
  const copy = modulesRef.admin.adminCopy.repairs;
  const html = renderRepairs([repair()], {
    sort: [{ field: "memberName", direction: "asc" }],
    onSortChange: () => {},
  });
  const buttons = [
    ...html.matchAll(/<button type="button" class="admin-th__sort[^"]*">(.*?)<\/button>/g),
  ];
  // 可排：维修日期 / 成员 / 分类 / 结果 / 时长 / 状态；不可排：选择列与操作列。
  assert.deepEqual(
    buttons.map((match) => match[1]),
    [
      copy.table.repairDate,
      copy.table.member,
      copy.table.category,
      copy.table.result,
      copy.table.duration,
      copy.table.status,
    ],
  );
  const head = html.slice(html.indexOf("<thead>"), html.indexOf("</thead>"));
  assert.ok(
    head.includes('aria-sort="ascending"'),
    "排序字段是 memberName（sortKey），不能拿列 id `member` 去比对",
  );
});

test("维修表：单元格内容与占位（未分类 / 空结果 / 空时长 / 标记标签）", async () => {
  modulesRef = await load();
  const { formatDurationMinutes, formatShanghaiDate } = modulesRef.memberConfig;
  const item = repair();
  const html = renderRepairs([item]);
  assert.ok(html.includes(formatShanghaiDate(item.repairDate)), "维修日期应当格式化");
  assert.ok(html.includes(">张三<"), "成员名应当显示");
  assert.ok(html.includes(">系统重装<"), "分类名应当显示");
  assert.ok(html.includes(formatDurationMinutes(99)), "时长应当格式化");
  assert.ok(html.includes("repair-tag--approved"), "状态标签按状态分色");
  assert.ok(html.includes(">典型<"), "典型案例标记应当显示");
  assert.equal(html.includes(">疑难<"), false, "没勾疑难就不该出现疑难标签");

  // 占位：未分类 / 空结果 / 空时长。
  const empty = renderRepairs([
    repair({ category: null, result: null, durationMinutes: null, isTypical: false }),
  ]);
  assert.ok(empty.includes(">未分类<"), "空分类显示「未分类」");
  assert.ok(empty.includes(modulesRef.admin.adminShared.none), "空结果与空时长显示占位符");
});

test("维修表：成员列是内容列（grow），操作列是详情入口，空态占 8 列", async () => {
  modulesRef = await load();
  const copy = modulesRef.admin.adminCopy.repairs;
  const html = renderRepairs([repair()]);
  assert.equal(
    [...html.matchAll(/admin-table__grow/g)].length,
    2,
    "成员列的表头与单元格都该带 admin-table__grow",
  );
  assert.ok(html.includes(copy.action.detail), "操作列应当是详情入口");
  const emptyHtml = renderRepairs([]);
  assert.ok(
    emptyHtml.includes(
      `<td class="admin-table__empty" colSpan="8">${modulesRef.admin.adminShared.empty}</td>`,
    ),
    "空态必须占满 8 列",
  );
});
