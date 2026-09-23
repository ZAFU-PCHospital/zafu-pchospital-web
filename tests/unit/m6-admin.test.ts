import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EXPORT_COLUMNS,
  escapeCsvField,
  neutralizeFormula,
  toCells,
  toCsv,
} from "../../src/features/admin/export-csv";
import { memberListInput, requiredVersion, roleSet } from "../../src/features/members/member-http";
import { requiredBool, requiredString, stringArray } from "../../src/features/repairs/repair-http";
import { AppError } from "../../src/lib/api/errors";
import { permissionsForRoles, requirePermission } from "../../src/lib/auth/permissions";
import { ADMIN_SECTION_INDEX, adminCopy, adminNav } from "../../src/config/admin";
import { mainNav } from "../../src/config/navigation";
import {
  ADMIN_BATCH_LIMIT,
  EXPORT_MAX_ROWS,
  ExportFormat,
  type AuthorizedActor,
  type RepairExportRow,
} from "../../src/types/contracts";

/**
 * M6 契约与纯函数单测。
 *
 * 覆盖三类容易回归的东西：
 * 1. 权限码与错误码（公共契约，改动会影响其它模块）；
 * 2. 导出层（CSV 转义与注入防护是安全相关，必须有测试锁住）；
 * 3. 路由入参解析（白名单校验，非法值必须抛稳定错误码而不是透传）。
 */

function actor(roles: readonly ("MEMBER" | "ADMIN")[]): AuthorizedActor {
  return {
    actorType: "USER",
    userId: "e6000000-0000-4000-8000-000000000001",
    userStatus: "ACTIVE",
    permissions: permissionsForRoles(roles),
    requestId: "req_m6_unit",
  };
}

test("data:export 只授予 ADMIN，MEMBER 不得导出", () => {
  assert.equal(permissionsForRoles(["ADMIN"]).includes("data:export"), true);
  assert.equal(permissionsForRoles(["MEMBER"]).includes("data:export"), false);
  assert.throws(() => requirePermission(actor(["MEMBER"]), "data:export"), /没有执行该操作的权限/);
  assert.doesNotThrow(() => requirePermission(actor(["ADMIN"]), "data:export"));
});

test("M6 新错误码都有明确 HTTP 状态，且批量/导出上限是正整数", () => {
  const cases: [ConstructorParameters<typeof AppError>[0], number][] = [
    ["MEMBER_BATCH_LIMIT_EXCEEDED", 400],
    ["MEMBER_ROLE_INVALID", 400],
    ["MEMBER_LAST_ADMIN", 409],
    ["MEMBER_SELF_LOCKOUT", 409],
    ["REPAIR_ADMIN_REASON_REQUIRED", 400],
    ["REPAIR_BATCH_LIMIT_EXCEEDED", 400],
    ["REPAIR_CATEGORY_CODE_CONFLICT", 409],
    ["EXPORT_FORMAT_INVALID", 400],
    ["EXPORT_ROW_LIMIT_EXCEEDED", 409],
  ];
  for (const [code, status] of cases) {
    assert.equal(new AppError(code, "x").status, status, code);
  }
  assert.equal(Number.isInteger(ADMIN_BATCH_LIMIT) && ADMIN_BATCH_LIMIT > 0, true);
  assert.equal(Number.isInteger(EXPORT_MAX_ROWS) && EXPORT_MAX_ROWS > 0, true);
  assert.deepEqual([...ExportFormat], ["CSV", "XLSX"]);
});

test("导出列顺序与 RepairExportRow 的取值一一对应", () => {
  const row: RepairExportRow = {
    repairDate: "2026-09-22",
    memberName: "张三",
    categoryName: "硬件故障",
    result: "已完成",
    durationMinutes: "45",
    status: "已通过",
    createdAt: "2026-09-22 19:00",
    repairRecordId: "e6000000-0000-4000-8000-0000000000aa",
    photoUrls: "/api/v1/repair-photos/x/content",
  };
  assert.deepEqual(toCells(row), [
    row.repairDate,
    row.memberName,
    row.categoryName,
    row.result,
    row.durationMinutes,
    row.status,
    row.createdAt,
    row.repairRecordId,
    row.photoUrls,
  ]);
  assert.equal(EXPORT_COLUMNS.length, toCells(row).length);
});

test("CSV 转义遵循 RFC 4180：逗号 / 引号 / 换行必须加引号且引号翻倍", () => {
  assert.equal(escapeCsvField("普通文本"), "普通文本");
  assert.equal(escapeCsvField("含,逗号"), '"含,逗号"');
  assert.equal(escapeCsvField('含"引号'), '"含""引号"');
  assert.equal(escapeCsvField("含\n换行"), '"含\n换行"');
});

test("CSV 公式注入防护：= + - @ 开头的内容前置单引号", () => {
  assert.equal(neutralizeFormula("=1+1"), "'=1+1");
  assert.equal(neutralizeFormula("+SUM(A1)"), "'+SUM(A1)");
  assert.equal(neutralizeFormula("-2+3"), "'-2+3");
  assert.equal(neutralizeFormula("@cmd"), "'@cmd");
  assert.equal(neutralizeFormula("正常内容"), "正常内容");
  // 防护后仍走标准转义，不得破坏引号规则
  assert.equal(escapeCsvField('=HYPERLINK("http://x")'), '"\'=HYPERLINK(""http://x"")"');
});

test("CSV 输出带 UTF-8 BOM 与 CRLF 行尾（Excel 打开中文不乱码）", () => {
  const row: RepairExportRow = {
    repairDate: "2026-09-22",
    memberName: "李四",
    categoryName: "系统问题",
    result: "未完成",
    durationMinutes: "",
    status: "待审核",
    createdAt: "2026-09-22 19:00",
    repairRecordId: "id-1",
    photoUrls: "",
  };
  const bytes = toCsv([row]);
  // BOM：EF BB BF。这是权威断言 —— Excel 靠这三个字节判断 UTF-8，
  // 注意 `new TextDecoder()` 默认会把 BOM **吃掉**（ignoreBOM 默认 false），
  // 所以下面读文本时必须显式 ignoreBOM: true，否则会误判成「没有 BOM」。
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const text = decodeKeepingBom(bytes);
  assert.equal(text.startsWith("\uFEFF"), true);
  assert.equal(text.includes("\r\n"), true);
  const lines = text.replace("\uFEFF", "").trimEnd().split("\r\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[0], EXPORT_COLUMNS.map((column) => column.header).join(","));
  assert.equal(lines[1]!.startsWith("2026-09-22,李四,系统问题,未完成,"), true);
});

test("空结果集也要有表头（导出一份只有列名的文件，而不是空文件）", () => {
  const text = decodeKeepingBom(toCsv([])).replace("\uFEFF", "");
  assert.equal(text.trimEnd(), EXPORT_COLUMNS.map((column) => column.header).join(","));
});

/** 解码但**保留** BOM，便于对 BOM 本身做文本断言。 */
function decodeKeepingBom(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
}

test("成员列表入参只接受白名单的 status / role", () => {
  const params = new URLSearchParams("status=ACTIVE&role=ADMIN&query= 张 三 ");
  const input = memberListInput(params, 1, 20);
  assert.equal(input.status, "ACTIVE");
  assert.equal(input.role, "ADMIN");
  assert.equal(input.query, "张 三");
  assert.throws(
    () => memberListInput(new URLSearchParams("status=BANNED"), 1, 20),
    /status 参数无效/,
  );
  assert.throws(
    () => memberListInput(new URLSearchParams("role=SUPERUSER"), 1, 20),
    /role 参数无效/,
  );
  // 缺省即 undefined，不能变成空串（否则会被当成「筛选空状态」）
  assert.equal(memberListInput(new URLSearchParams(""), 1, 20).status, undefined);
});

test("角色集合解析：必须是非空且只含契约角色的数组", () => {
  assert.deepEqual(roleSet({ roles: ["MEMBER", "ADMIN", "MEMBER"] }), ["MEMBER", "ADMIN"]);
  assert.throws(() => roleSet({ roles: [] }), /角色集合无效/);
  assert.throws(() => roleSet({ roles: ["OWNER"] }), /角色集合无效/);
  assert.throws(() => roleSet({ roles: "ADMIN" }), /roles 必须是数组/);
});

test("乐观锁版本号必须是正整数", () => {
  assert.equal(requiredVersion({ version: 3 }), 3);
  for (const bad of [0, -1, 1.5, "abc", undefined, null]) {
    assert.throws(() => requiredVersion({ version: bad }), /version 必须是正整数/);
  }
});

test("维修标记必须显式传布尔值，漏字段不得被静默当成 false", () => {
  assert.equal(requiredBool({ isDifficult: true }, "isDifficult"), true);
  assert.equal(requiredBool({ isDifficult: false }, "isDifficult"), false);
  for (const bad of [undefined, null, "true", 1, 0]) {
    assert.throws(() => requiredBool({ isDifficult: bad }, "isDifficult"), /必须是布尔值/);
  }
});

test("批量入参：字符串数组去重、拒绝空元素与非数组", () => {
  assert.deepEqual(stringArray({ ids: ["a", "b", "a"] }, "ids"), ["a", "b"]);
  assert.throws(() => stringArray({ ids: ["a", ""] }, "ids"), /含非法元素/);
  assert.throws(() => stringArray({ ids: "a" }, "ids"), /必须是数组/);
  assert.equal(requiredString({ reason: " 因为重复 " }, "reason"), " 因为重复 ");
  assert.throws(() => requiredString({ reason: "  " }, "reason"), /不能为空/);
});

test("后台导航不进入公开导航，且编号从 09 起、互不重复", () => {
  const publicHrefs = new Set(mainNav.map((item) => item.href));
  for (const item of adminNav) {
    assert.equal(item.href.startsWith("/admin/"), true, item.href);
    assert.equal(publicHrefs.has(item.href), false, `后台入口不得出现在 mainNav：${item.href}`);
  }
  const indexes = adminNav.map((item) => item.index);
  assert.equal(new Set(indexes).size, indexes.length);
  for (const index of indexes) assert.equal(Number(index) >= 9, true, index);
  assert.equal(ADMIN_SECTION_INDEX.home, "00");
  assert.equal(adminCopy.home.sections.length, adminNav.length);
});
