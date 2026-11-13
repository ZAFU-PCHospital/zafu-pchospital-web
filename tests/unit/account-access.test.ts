import assert from "node:assert/strict";
import test from "node:test";

import {
  accountReturnCandidate,
  decideAccountAccess,
  safeAccountReturnPath,
} from "../../src/lib/auth/account-access";
import {
  EMAIL_STEP_PATH,
  PASSWORD_STEP_PATH,
  isAccountStepPage,
} from "../../src/lib/auth/account-steps";
import type { RoleCode } from "../../src/types/contracts";

/**
 * 统一账号门禁的纯判定。
 *
 * 表驱动打在 `decideAccountAccess` 上：不连库、不读环境变量，档位作为入参给出，
 * 时间由夹具固定。真实数据库下的状态读取与 `authenticateRequest` 贯通在
 * `tests/integration/email-gate.test.ts`。
 */
const AT = new Date("2026-10-16T12:00:00.000Z");
const LATER = new Date("2026-10-16T18:00:00.000Z");
const EARLIER = new Date("2026-10-16T11:59:59.999Z");

function decide(overrides: Partial<Parameters<typeof decideAccountAccess>[0]> = {}) {
  const base = {
    mustChangePassword: false,
    roles: ["MEMBER"] as RoleCode[],
    mode: "all" as const,
    emailVerified: false,
    exemptionExpiresAt: null as Date | null,
    now: AT,
    returnTo: null as string | null,
  };
  return decideAccountAccess({ ...base, ...overrides });
}

test("off 档保持既有行为：未验证邮箱不拦，改密照旧优先", () => {
  assert.deepEqual(decide({ mode: "off", emailVerified: false }), {
    state: "READY",
    destination: "/member",
    exemptionExpiresAt: null,
  });
  assert.deepEqual(decide({ mode: "off", roles: ["ADMIN"], emailVerified: false }), {
    state: "READY",
    destination: "/admin",
    exemptionExpiresAt: null,
  });
  assert.equal(decide({ mode: "off", mustChangePassword: true }).destination, PASSWORD_STEP_PATH);
});

test("admin 档只约束当次持有 ADMIN 的账号，双角色不能靠成员侧绕过", () => {
  assert.equal(decide({ mode: "admin", roles: ["MEMBER"], emailVerified: false }).state, "READY");
  assert.equal(
    decide({ mode: "admin", roles: ["ADMIN"], emailVerified: false }).state,
    "EMAIL_VERIFICATION_REQUIRED",
  );
  // 双角色即使正在访问成员侧（roles 里有 ADMIN），admin 档同样生效。
  assert.equal(
    decide({ mode: "admin", roles: ["ADMIN", "MEMBER"], emailVerified: false }).state,
    "EMAIL_VERIFICATION_REQUIRED",
  );
  assert.equal(
    decide({ mode: "all", roles: ["MEMBER"], emailVerified: false }).state,
    "EMAIL_VERIFICATION_REQUIRED",
  );
});

test("改密优先于邮箱；豁免只豁免邮箱这一步", () => {
  assert.equal(
    decide({ mustChangePassword: true, emailVerified: false }).state,
    "PASSWORD_CHANGE_REQUIRED",
  );
  assert.equal(
    decide({ mustChangePassword: true, emailVerified: true }).state,
    "PASSWORD_CHANGE_REQUIRED",
  );
  // 有有效豁免也必须先改密，且落点是改密页（不是邮箱页）。
  const forced = decide({ mustChangePassword: true, exemptionExpiresAt: LATER });
  assert.equal(forced.state, "PASSWORD_CHANGE_REQUIRED");
  assert.equal(forced.destination, PASSWORD_STEP_PATH);
  assert.equal(forced.exemptionExpiresAt, LATER.toISOString());
});

test("已验证或豁免仍有效即放行；到期与撤销的豁免不算豁免", () => {
  assert.equal(decide({ emailVerified: true }).state, "READY");
  const exempted = decide({ emailVerified: false, exemptionExpiresAt: LATER });
  assert.equal(exempted.state, "READY");
  assert.equal(exempted.exemptionExpiresAt, LATER.toISOString());
  // `now >= expiresAt` 即失效（含正好到点）。
  for (const expired of [AT, EARLIER]) {
    const gated = decide({ exemptionExpiresAt: expired });
    assert.equal(gated.state, "EMAIL_VERIFICATION_REQUIRED");
    assert.equal(gated.exemptionExpiresAt, null, "已失效的豁免不对外报告");
  }
});

test("落点：原目标只加在步骤页查询串上，链路不断", () => {
  assert.equal(
    decide({ mustChangePassword: true, returnTo: "/member/repairs" }).destination,
    `${PASSWORD_STEP_PATH}?returnTo=%2Fmember%2Frepairs`,
  );
  assert.equal(
    decide({ returnTo: "/member/repairs" }).destination,
    `${EMAIL_STEP_PATH}?returnTo=%2Fmember%2Frepairs`,
  );
  // 已放行时原目标就是终点；没有合法原目标回角色默认页。
  assert.equal(
    decide({ emailVerified: true, returnTo: "/member/repairs" }).destination,
    "/member/repairs",
  );
  assert.equal(
    decide({ emailVerified: true, roles: ["ADMIN"], returnTo: null }).destination,
    "/admin",
  );
  // 豁免到期后仍停在邮箱步骤，不带残留豁免时间。
  assert.equal(decide({ exemptionExpiresAt: EARLIER }).destination, EMAIL_STEP_PATH);
});

test("回跳白名单：只收当前角色允许的规范业务 pathname，拒绝外部与控制字符", () => {
  const member: RoleCode[] = ["MEMBER"];
  for (const value of [
    "https://evil.invalid",
    "//evil.invalid",
    "/\\evil",
    "/member\\evil",
    "/member/%2fadmin",
    "/member?next=evil",
    "/member#frag",
    "/member\n",
    "/member a",
    "/member/../admin",
    "member/repairs",
    "",
    "/api/v1/me",
    "/login",
    "/account/email",
    "/account/change-password",
    "/",
  ])
    assert.equal(safeAccountReturnPath(value, member), null, `不该接受：${JSON.stringify(value)}`);
  assert.equal(safeAccountReturnPath(null, member), null);
  assert.equal(safeAccountReturnPath(undefined, member), null);
  assert.equal(safeAccountReturnPath(123 as unknown as string, member), null);
  assert.equal(safeAccountReturnPath("/member", member), "/member");
  assert.equal(safeAccountReturnPath("/member/repairs/12", member), "/member/repairs/12");
  assert.equal(safeAccountReturnPath("/member/", member), "/member/");
  // 角色不够：MEMBER 不能把落点定到后台，ADMIN 没有成员身份也不能定到 /member。
  assert.equal(safeAccountReturnPath("/admin/members", member), null);
  assert.equal(
    safeAccountReturnPath("/admin/repair-activities/activity-id", member),
    "/admin/repair-activities/activity-id",
  );
  assert.equal(safeAccountReturnPath("/admin/repair-activities/activity-id/edit", member), null);
  assert.equal(safeAccountReturnPath("/admin/repair-activities", member), null);
  assert.equal(safeAccountReturnPath("/admin/members", ["ADMIN"]), "/admin/members");
  assert.equal(safeAccountReturnPath("/member", ["ADMIN"]), null);
  assert.equal(safeAccountReturnPath("/member", ["ADMIN", "MEMBER"]), "/member");
});

test("步骤页对应关系按判定顺序给出可停留的一步（返修 F4）", () => {
  assert.equal(isAccountStepPage("PASSWORD_CHANGE_REQUIRED", PASSWORD_STEP_PATH), true);
  assert.equal(isAccountStepPage("PASSWORD_CHANGE_REQUIRED", EMAIL_STEP_PATH), false);
  assert.equal(isAccountStepPage("EMAIL_VERIFICATION_REQUIRED", EMAIL_STEP_PATH), true);
  // 只差邮箱的账号仍要用改密页 / 改密接口 —— 邮箱门禁不能把他从改密页踢走。
  assert.equal(isAccountStepPage("EMAIL_VERIFICATION_REQUIRED", PASSWORD_STEP_PATH), true);
  assert.equal(isAccountStepPage("EMAIL_VERIFICATION_REQUIRED", "/member"), false);
  assert.equal(isAccountStepPage("READY", EMAIL_STEP_PATH), false);
  assert.equal(isAccountStepPage("READY", PASSWORD_STEP_PATH), false);
  // 读不到服务端路径时不能当作步骤页（否则会跳过重定向）。
  assert.equal(isAccountStepPage("EMAIL_VERIFICATION_REQUIRED", null), false);
  assert.equal(isAccountStepPage("EMAIL_VERIFICATION_REQUIRED", ""), false);
});

test("未认证时的候选只按形状过滤，角色判定留到认证之后（返修 F4）", () => {
  // 形状过关的业务 pathname 都可以当候选 —— 此刻还没有角色可查。
  assert.equal(accountReturnCandidate("/member/repairs"), "/member/repairs");
  assert.equal(accountReturnCandidate("/admin/members"), "/admin/members");
  // 与角色版同一份拒绝清单：外部地址、步骤页 / 登录 / API 自环、控制字符都不收。
  for (const value of [
    "https://evil.invalid",
    "//evil.invalid",
    "/member/%2fadmin",
    "/member?next=evil",
    "/account/email",
    "/account/change-password",
    "/api/v1/me",
    "/login",
    "member/repairs",
    "",
    undefined,
    null,
  ])
    assert.equal(accountReturnCandidate(value), null, `不该接受：${String(value)}`);
  // 角色这一道只有 `safeAccountReturnPath` 会判：候选本身不构成任何准入。
  assert.equal(safeAccountReturnPath("/admin/members", ["MEMBER"]), null);
});
