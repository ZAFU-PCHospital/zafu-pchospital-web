import assert from "node:assert/strict";
import test from "node:test";

import { ApiErrorCode, AppError } from "../../src/lib/api/errors";
import { permissionsForRoles, requirePermission } from "../../src/lib/auth/permissions";
import { parseUtcDateFilter, dateRangeWhere } from "../../src/lib/api/date-filter";
import { ADMIN_SECTION_INDEX, adminNav } from "../../src/config/admin";
import { mainNav } from "../../src/config/navigation";
import { APPLICATION_EXPORT_COLUMNS } from "../../src/features/admin/join-application-export-service";
import { EXPORT_COLUMNS, escapeCsvField, toCsvWith } from "../../src/features/admin/export-csv";
import {
  PUBLIC_CONTENT_SETTINGS_DEFAULTS,
  PUBLIC_CONTENT_SETTINGS_ID,
} from "../../src/features/admin/public-content-settings-service";
import { movedIds, reorderedIds } from "../../src/features/admin/reorder";
import { applyOrder, movedManyIds, movingRowIds } from "../../src/lib/list-order";
import { stableCodeFromName } from "../../src/lib/stable-code";
import {
  CommentModerationFilter,
  Permission,
  RankingDisplayNameMode,
  ReorderDirection,
} from "../../src/types/contracts";
import type { JoinApplicationExportRow, RepairExportRow } from "../../src/types/contracts";

/**
 * M6 批次 2 单元与契约测试。
 *
 * 只测**纯函数与静态契约**（不连数据库）：权限表、错误码状态、日期边界解析、
 * 导出列模型、后台导航编号。行为类断言放在
 * `tests/integration/m6-admin-batch2.test.ts`（真实 GreatSQL）。
 */

/* ------------------------------------------------------------------- 权限 */

test("批次 2 的三个权限码只授予 ADMIN", () => {
  const member = permissionsForRoles(["MEMBER"]);
  const admin = permissionsForRoles(["ADMIN"]);
  for (const permission of ["comment:moderate", "skill:manage", "settings:manage"] as const) {
    assert.equal(admin.includes(permission), true, `管理员缺少 ${permission}`);
    assert.equal(member.includes(permission), false, `成员不应拥有 ${permission}`);
  }
  // 管理端评论列表跨记录，不能靠成员也持有的 comment:read 放行。
  assert.equal(member.includes("comment:read"), true);
  assert.equal(member.includes("comment:moderate"), false);
  // 审计是只读权限，M6 批次 2 起才有界面；它不该顺带给出任何写能力。
  assert.equal(admin.includes("audit:read"), true);
  assert.equal(member.includes("audit:read"), false);
});

test("未登录账号不能调用批次 2 的任何管理入口", () => {
  assert.throws(
    () => requirePermission(null, "skill:manage"),
    (error) => error instanceof AppError && error.code === "UNAUTHENTICATED",
  );
  assert.throws(
    () => requirePermission(null, "settings:manage"),
    (error) => error instanceof AppError && error.code === "UNAUTHENTICATED",
  );
});

test("权限表里的每个权限码都在 Permission 联合类型中登记", () => {
  const declared = new Set<string>(Permission);
  for (const role of ["MEMBER", "ADMIN"] as const) {
    for (const permission of permissionsForRoles([role])) {
      assert.ok(declared.has(permission), `${role} 持有未登记的权限码 ${permission}`);
    }
  }
});

/* ------------------------------------------------------------------ 错误码 */

test("批次 2 的新错误码使用稳定的 HTTP 状态", () => {
  const expected: Record<string, number> = {
    SKILL_CODE_CONFLICT: 409,
    AUDIT_FILTER_INVALID: 400,
    PUBLIC_SETTINGS_INVALID: 400,
  };
  for (const [code, status] of Object.entries(expected)) {
    assert.ok((ApiErrorCode as readonly string[]).includes(code), `缺少错误码 ${code}`);
    assert.equal(new AppError(code as never, "x").status, status, `${code} 状态码不符`);
  }
});

/* -------------------------------------------------------------- 日期边界 */

test("日期筛选按上海自然日解释，结束日包含全天", () => {
  const range = parseUtcDateFilter("2026-09-22", "2026-09-22", "时间");
  // 上海 2026-09-22 00:00 = UTC 2026-09-21T16:00Z
  assert.equal(range.gte?.toISOString(), "2026-09-21T16:00:00.000Z");
  // 结束日包含全天 → 排他上界是次日 00:00（上海）= UTC 2026-09-22T16:00Z
  assert.equal(range.lt?.toISOString(), "2026-09-22T16:00:00.000Z");
  // 当天中午的一切都落在区间内（旧写法用 `lte: new Date("2026-09-22")` 会把它排除）
  const noon = new Date("2026-09-22T04:00:00.000Z");
  assert.ok(noon >= range.gte! && noon < range.lt!);
});

test("日期筛选：单边、空值与非法输入", () => {
  const empty = parseUtcDateFilter(undefined, undefined);
  assert.equal(empty.gte, undefined);
  assert.equal(empty.lt, undefined);
  assert.equal(dateRangeWhere(empty), undefined);
  assert.ok(dateRangeWhere(parseUtcDateFilter("2026-09-22", undefined)));
  assert.throws(
    () => parseUtcDateFilter("2026-09-22", "2026-09-21"),
    (error) => error instanceof AppError && error.code === "VALIDATION_FAILED",
  );
  // 日历上不存在的日期要被拒绝，而不是被 Date 静默进位成 10-02。
  assert.throws(
    () => parseUtcDateFilter("2026-09-31", undefined),
    (error) => error instanceof AppError && error.code === "VALIDATION_FAILED",
  );
});

/* -------------------------------------------------------------- 导出列模型 */

test("报名导出的列顺序与 JoinApplicationExportRow 的键逐一对应", () => {
  const row: JoinApplicationExportRow = {
    ticketNo: "JA-1",
    recruitmentCycle: "2026",
    realName: "张三",
    qq: "1234567",
    phone: "13900000000",
    status: "已提交",
    provisionStatus: "待发放",
    preferredDirection: "硬件",
    submittedAt: "2026-09-22 10:00",
    lastReviewedAt: "",
    applicationId: "app-1",
  };
  const keys = APPLICATION_EXPORT_COLUMNS.map((column) => column.key);
  assert.deepEqual([...keys].sort(), [...Object.keys(row)].sort());
  assert.equal(new Set(keys).size, keys.length, "列 key 不得重复");
  // 报名的 QQ 与手机号必须是独立列：招募要按联系方式联系人。
  assert.ok(keys.includes("qq"));
  assert.ok(keys.includes("phone"));
});

test("维修导出列保持批次 1 的顺序（不得被批次 2 改动）", () => {
  const keys: Array<keyof RepairExportRow> = EXPORT_COLUMNS.map((column) => column.key);
  assert.deepEqual(keys, [
    "repairDate",
    "memberName",
    "categoryName",
    "result",
    "durationMinutes",
    "status",
    "createdAt",
    "repairRecordId",
    "photoUrls",
  ]);
});

test("报名 CSV 复用同一套转义：BOM、CRLF、公式注入防护", () => {
  const csv = toCsvWith(APPLICATION_EXPORT_COLUMNS, [
    {
      ticketNo: "JA-1",
      recruitmentCycle: "2026",
      realName: '=HYPERLINK("http://evil")',
      qq: "1234567",
      phone: "13900000000",
      status: "已提交",
      provisionStatus: "待发放",
      preferredDirection: "硬件, 软件",
      submittedAt: "2026-09-22 10:00",
      lastReviewedAt: "",
      applicationId: "app-1",
    },
  ]);
  // 注意 `new TextDecoder()` 默认会把 BOM 吃掉，读文本时必须显式 ignoreBOM: true。
  assert.deepEqual([...csv.slice(0, 3)], [0xef, 0xbb, 0xbf], "缺少 UTF-8 BOM");
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(csv);
  assert.ok(text.startsWith("\uFEFF"));
  assert.ok(text.includes("\r\n"), "必须用 CRLF 分行");
  assert.ok(text.endsWith("\r\n"));
  // Excel 会把 `=` 开头的内容当公式执行，必须前置单引号强制为文本。
  assert.ok(text.includes(`"'=HYPERLINK(""http://evil"")"`));
  // 含逗号的字段整体加引号。
  assert.ok(text.includes('"硬件, 软件"'));
  assert.equal(escapeCsvField("=1+1"), "'=1+1");
});

/* ------------------------------------------------------------------ 导航 */

test("后台导航覆盖批次 2 的六个模块且编号从 13 起连续不重复", () => {
  const hrefs = adminNav.map((item) => item.href);
  for (const href of [
    "/admin/skills",
    "/admin/comments",
    "/admin/invite-codes",
    "/admin/join-applications",
    "/admin/audit",
    "/admin/settings",
  ]) {
    assert.ok(hrefs.includes(href), `后台导航缺少 ${href}`);
  }
  const indexes = adminNav.map((item) => item.index);
  assert.equal(new Set(indexes).size, indexes.length, "后台导航编号重复");
  assert.deepEqual(indexes, ["09", "10", "11", "12", "13", "14", "15", "16", "17", "18"]);
  assert.equal(ADMIN_SECTION_INDEX.settings, "18");
});

test("后台导航不进入公开索引栏（mainNav）", () => {
  const publicHrefs = mainNav.map((item) => item.href);
  for (const item of adminNav) {
    assert.equal(publicHrefs.includes(item.href), false, `${item.href} 不该出现在公开导航`);
  }
  assert.equal(
    publicHrefs.some((href) => href.startsWith("/admin")),
    false,
  );
});

/* ------------------------------------------------------------------ 设置 */

test("公开统计的默认值是「全部关闭 + 仅昵称」", () => {
  assert.deepEqual(PUBLIC_CONTENT_SETTINGS_DEFAULTS, {
    publicRepairStatsEnabled: false,
    publicRepairStatsDetailEnabled: false,
    publicRankingsEnabled: false,
    rankingDisplayName: "NICKNAME",
  });
  assert.equal(PUBLIC_CONTENT_SETTINGS_ID, "public-content");
  assert.deepEqual([...RankingDisplayNameMode], ["REAL_NAME", "NICKNAME", "HIDDEN"]);
  // 默认项必须是枚举里的合法取值。
  assert.ok((RankingDisplayNameMode as readonly string[]).includes("NICKNAME"));
});

/* ------------------------------------------------------------------ 枚举 */

test("评论删除态筛选只允许三种取值", () => {
  assert.deepEqual([...CommentModerationFilter], ["ACTIVE", "DELETED", "ALL"]);
  assert.deepEqual([...ReorderDirection], ["UP", "DOWN"]);
});

/* ------------------------------------------------- 标识生成与排序（第三轮反馈） */

test("stableCodeFromName：纯 ASCII 折叠成大写标识，含非 ASCII 时改用名称哈希", () => {
  assert.equal(stableCodeFromName("Windows Driver", "SK"), "WINDOWS_DRIVER");
  assert.equal(stableCodeFromName("wifi-6", "SK"), "WIFI_6");

  const cn = stableCodeFromName("散热 / 清灰", "CAT");
  assert.match(cn, /^CAT_[0-9A-F]{8}$/);
  // 确定性：同一个名称永远得到同一个标识（否则「重建同名标签」会拿到新标识）
  assert.equal(cn, stableCodeFromName("散热 / 清灰", "CAT"));
  // 不同的中文名不能撞车。只取 ASCII 片段的话 `CPU 主板` 与 `CPU 显卡` 都会变成 `CPU`，
  // 于是「新建一个名字完全不同的标签」会报「标识已存在」—— 最难排查的一类错误。
  assert.notEqual(cn, stableCodeFromName("硬件故障", "CAT"));
  assert.notEqual(stableCodeFromName("CPU 主板", "CAT"), stableCodeFromName("CPU 显卡", "CAT"));
});

test("reorderedIds：交换相邻项；边界幂等；未知 id 报 404", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(reorderedIds(ids, "b", "UP", "SKILL_NOT_FOUND", "x"), ["b", "a", "c"]);
  assert.deepEqual(reorderedIds(ids, "b", "DOWN", "SKILL_NOT_FOUND", "x"), ["a", "c", "b"]);
  // 已经在首/末位：返回 null 表示「不需要移动」，调用方幂等成功、不写审计
  assert.equal(reorderedIds(ids, "a", "UP", "SKILL_NOT_FOUND", "x"), null);
  assert.equal(reorderedIds(ids, "c", "DOWN", "SKILL_NOT_FOUND", "x"), null);
  assert.throws(
    () => reorderedIds(ids, "zzz", "UP", "SKILL_NOT_FOUND", "技能标签不存在"),
    (error) => error instanceof AppError && error.code === "SKILL_NOT_FOUND",
  );
  // 不改动入参
  assert.deepEqual(ids, ["a", "b", "c"]);
});

test("movedManyIds：整块移动保持内部先后，落点永远是块外的参照行", () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  // 把 b、c 一起拖到 e 之前：块内顺序不变
  assert.deepEqual(movedManyIds(ids, ["b", "c"], "e").order, ["a", "d", "b", "c", "e", "f"]);
  // 传进来的顺序与列表顺序不一致时，以**列表里的先后**为准（界面勾选顺序可能不同）
  assert.deepEqual(movedManyIds(ids, ["c", "b"], "e").order, ["a", "d", "b", "c", "e", "f"]);
  // 拖到末尾
  assert.deepEqual(movedManyIds(ids, ["a", "b"], null).order, ["c", "d", "e", "f", "a", "b"]);
  // 落点就是块自己 → 位置不变（幂等），不会「拖了没反应地转一圈」
  assert.equal(movedManyIds(ids, ["b", "c"], "b").order, null);
  assert.equal(movedManyIds(ids, ["b", "c"], "c").order, null);
  // 块已经在落点位置上 → 幂等
  assert.equal(movedManyIds(ids, ["b", "c"], "d").order, null);
  // 未知 id 只收集不抛错（这个模块要在浏览器里跑）
  assert.deepEqual(movedManyIds(ids, ["zzz"], "a").unknown, ["zzz"]);
  assert.deepEqual(movedManyIds(ids, ["a"], "zzz").unknown, ["zzz"]);
});

test("movingRowIds：拖的那行在选中集合里、且选中不止一行时整块移动", () => {
  assert.deepEqual(movingRowIds("b", []), ["b"]);
  assert.deepEqual(movingRowIds("b", ["b"]), ["b"]);
  assert.deepEqual(movingRowIds("b", ["a", "b", "c"]), ["a", "b", "c"]);
  // 拖的是没被勾选的那一行：只移动它自己
  assert.deepEqual(movingRowIds("d", ["a", "b", "c"]), ["d"]);
});

test("applyOrder：乐观更新按 id 顺序重排，缺的项保持原序接在末尾", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  assert.deepEqual(
    applyOrder(items, ["c", "a", "b", "d"]).map((item) => item.id),
    ["c", "a", "b", "d"],
  );
  // 并发追加的新项（不在 order 里）不能被丢掉
  assert.deepEqual(
    applyOrder(items, ["d", "c"]).map((item) => item.id),
    ["d", "c", "a", "b"],
  );
  // 不改动入参
  assert.deepEqual(
    items.map((item) => item.id),
    ["a", "b", "c", "d"],
  );
});

test("movedIds：拖动一次可以跨越任意格；落到原位幂等；未知 id 报 404", () => {
  const ids = ["a", "b", "c", "d"];
  // 把 d 拖到 b 之前：一次跨两格，只写一次库
  assert.deepEqual(movedIds(ids, "d", "b", "SKILL_NOT_FOUND", "x"), ["a", "d", "b", "c"]);
  // 拖到最前
  assert.deepEqual(movedIds(ids, "c", "a", "SKILL_NOT_FOUND", "x"), ["c", "a", "b", "d"]);
  // `beforeId` 为 null = 拖到末尾
  assert.deepEqual(movedIds(ids, "a", null, "SKILL_NOT_FOUND", "x"), ["b", "c", "d", "a"]);
  // 落到原位：返回 null（幂等成功，不写审计）。
  assert.equal(movedIds(ids, "b", "b", "SKILL_NOT_FOUND", "x"), null);
  // 「放到 c 之前」而 b 本来就在 c 前面 —— 没变化
  assert.equal(movedIds(ids, "b", "c", "SKILL_NOT_FOUND", "x"), null);
  // 「放到 d 之前」是明确的落点：b 要挪到 c 后面（落点是位置，不是「相对先后」）
  assert.deepEqual(movedIds(ids, "b", "d", "SKILL_NOT_FOUND", "x"), ["a", "c", "b", "d"]);
  // 已经在末尾还拖到末尾
  assert.equal(movedIds(ids, "d", null, "SKILL_NOT_FOUND", "x"), null);
  // 目标 id 不在列表里：与上移 / 下移同一个错误码
  assert.throws(
    () => movedIds(ids, "zzz", "a", "SKILL_NOT_FOUND", "技能标签不存在"),
    (error) => error instanceof AppError && error.code === "SKILL_NOT_FOUND",
  );
  assert.throws(
    () => movedIds(ids, "a", "zzz", "SKILL_NOT_FOUND", "技能标签不存在"),
    (error) => error instanceof AppError && error.code === "SKILL_NOT_FOUND",
  );
  // 不改动入参
  assert.deepEqual(ids, ["a", "b", "c", "d"]);
});
