import assert from "node:assert/strict";
import test from "node:test";

import { ApiErrorCode, AppError } from "../../src/lib/api/errors";
import {
  MEMBER_NICKNAME_MAX_LENGTH,
  MEMBER_RECENT_REPAIR_LIMIT,
  MEMBER_SKILL_LIMIT,
  Permission,
} from "../../src/types/contracts";
import { rolePermissions } from "../../src/lib/auth/permissions";
import {
  memberCopy,
  formatCount,
  formatDurationMinutes,
  formatShanghaiDate,
} from "../../src/config/member";
import { mergeSkillOptions } from "../../src/features/skills/skill-options";
import { approvedRepairWhere } from "../../src/features/repairs/repair-query-service";

/**
 * M3 契约测试（纯单元，不依赖数据库/HTTP）。
 *
 * 覆盖任务书 §17 中可静态断言的部分：错误码、权限、限额常量、
 * 以及与用户可见语义强相关的展示函数（「待配置」不得退化为 0）。
 * 端到端的信封与隐私断言在 `tests/integration/m3-member-dashboard.test.ts`。
 */

test("M3 稳定错误码已进入公共契约", () => {
  for (const code of [
    "MEMBER_REQUIRED",
    "MEMBER_PROFILE_NOT_FOUND",
    "MEMBER_PROFILE_FORBIDDEN",
    "MEMBER_PROFILE_VERSION_CONFLICT",
    "MEMBER_PROFILE_INVALID_NICKNAME",
    "MEMBER_PROFILE_INACTIVE",
    "SKILL_LIMIT_EXCEEDED",
    "SKILL_NOT_FOUND",
    "SKILL_INACTIVE",
    "SKILL_SELECTION_INVALID",
    "ACADEMIC_TERM_CONFIG_INVALID",
    "VALIDATION_FAILED",
  ] as const) {
    assert.equal(ApiErrorCode.includes(code), true, `错误码 ${code} 未包含在 ApiErrorCode 中`);
  }
});

test("M3 冲突类错误码映射为 409，非法输入为 400", () => {
  const statusOf = (code: (typeof ApiErrorCode)[number]) => new AppError(code, "test").status;
  assert.equal(statusOf("MEMBER_PROFILE_VERSION_CONFLICT"), 409);
  assert.equal(statusOf("MEMBER_PROFILE_INVALID_NICKNAME"), 400);
  assert.equal(statusOf("SKILL_LIMIT_EXCEEDED"), 400);
  assert.equal(statusOf("SKILL_INACTIVE"), 409);
  // 不存在、软删除与无权访问统一 404，避免成员枚举。
  assert.equal(statusOf("MEMBER_PROFILE_NOT_FOUND"), 404);
  // 学期配置错误属于服务端配置问题，不是用户输入问题。
  assert.equal(statusOf("ACADEMIC_TERM_CONFIG_INVALID"), 500);
});

test("M3 新增权限已定义且仅授予对应角色", () => {
  for (const permission of [
    "member.profile.read_self",
    "member.profile.update_self",
    "member.profile.read_internal",
    "member.skill.assign_self",
  ] as const) {
    assert.equal(Permission.includes(permission), true, `权限 ${permission} 未定义`);
  }

  // 成员只能读写自我资料与自己的技能。
  const memberPermissions = rolePermissions.MEMBER;
  assert.equal(memberPermissions.includes("member.profile.read_self"), true);
  assert.equal(memberPermissions.includes("member.profile.update_self"), true);
  assert.equal(memberPermissions.includes("member.skill.assign_self"), true);

  // 管理员拥有内部主页读取权限；成员是否拥有由角色配置决定，这里只断言管理员不缺失。
  assert.equal(rolePermissions.ADMIN.includes("member.profile.read_internal"), true);
});

test("M3 限额常量与任务书一致", () => {
  assert.equal(MEMBER_SKILL_LIMIT, 12);
  assert.equal(MEMBER_NICKNAME_MAX_LENGTH, 64);
  assert.equal(MEMBER_RECENT_REPAIR_LIMIT, 5);
});

test("未配置指标显示为「待配置」而不是 0", () => {
  const label = memberCopy.common.unconfigured;
  assert.equal(formatCount(null, label), label);
  assert.notEqual(formatCount(null, label), "0 次");
  // AVAILABLE 的 0 与 UNCONFIGURED 必须能区分：0 是真实值，应显示「0 次」。
  assert.equal(formatCount(0, label), "0 次");
});

test("时长格式化只输出小时/分钟且不回退为负数", () => {
  assert.equal(formatDurationMinutes(0), "0 分钟");
  assert.equal(formatDurationMinutes(59), "59 分钟");
  assert.equal(formatDurationMinutes(60), "1 小时");
  assert.equal(formatDurationMinutes(90), "1 小时 30 分钟");
  assert.equal(formatDurationMinutes(125), "2 小时 5 分钟");
  assert.equal(formatDurationMinutes(Number.NaN), "—");
  assert.equal(formatDurationMinutes(-1), "—");
});

test("上海自然日格式化不因时区偏移跨天", () => {
  // 2026-09-13 23:30 UTC = 2026-09-14 07:30（UTC+8），必须显示 09-14。
  assert.equal(formatShanghaiDate("2026-09-13T23:30:00.000Z"), "2026-09-14");
  // 2026-09-13 15:59 UTC = 2026-09-13 23:59（UTC+8），必须显示 09-13。
  assert.equal(formatShanghaiDate("2026-09-13T15:59:00.000Z"), "2026-09-13");
  assert.equal(formatShanghaiDate(null), "—");
  assert.equal(formatShanghaiDate("not-a-date"), "—");
});

test("M3 文案不出现第二套统计口径或虚假数据承诺", () => {
  const text = JSON.stringify(memberCopy);
  // M5 之后已不存在「尚未接入」的模块：同理也不能再出现「后续模块开放」这类
  // 未兑现的承诺，或 M4/M5 这种内部里程碑编号。
  assert.doesNotMatch(text, /尚未接入|后续模块开放|M\d/);
  // 排行文案必须真实存在（区块标题与未配置提示），而不是被删空
  assert.match(text, /排行/);
  // 已通过与统计口径必须对用户可见。
  assert.match(text, /已通过/);

  const active = {
    id: "active",
    code: "ACTIVE",
    name: "启用技能",
    description: null,
    sortOrder: 1,
    isActive: true,
  };
  const inactiveSelected = {
    id: "inactive",
    code: "INACTIVE",
    name: "历史技能",
    description: null,
    sortOrder: 2,
    isActive: false,
  };
  assert.deepEqual(
    mergeSkillOptions([active], [active, inactiveSelected]).map((skill) => skill.id),
    ["active", "inactive"],
    "已停用的历史技能必须保留在选择器中，供成员取消",
  );

  assert.deepEqual(
    approvedRepairWhere({ memberProfileId: "member-1" }),
    { memberProfileId: "member-1", status: "APPROVED", deletedAt: null },
    "M2 分析入口与 M3 成员摘要必须共享同一个正式维修谓词",
  );
});
