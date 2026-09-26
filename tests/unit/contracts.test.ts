import assert from "node:assert/strict";
import test from "node:test";

import { ApiErrorCode, AppError } from "../../src/lib/api/errors";
import {
  enforceRateLimit,
  rateLimitBucketCountForTests,
  resetRateLimitsForTests,
} from "../../src/lib/api/rate-limit";
import { maskPhone, maskQq, redactAuditSummary } from "../../src/lib/audit/redaction";
import { normalizePhone, normalizeQq } from "../../src/lib/security/normalization";
import { digestSessionToken, hashPassword, verifyPassword } from "../../src/lib/security/secrets";
import { resetServerEnvForTests } from "../../src/lib/env";
import { assertSameOrigin, sessionCookie } from "../../src/lib/auth/request";
import { authenticateRequest } from "../../src/lib/auth/request";
import { submitMemberSignup } from "../../src/lib/member-signup";
import {
  JoinApplicationStatus,
  Permission,
  RepairStatus,
  RoleCode,
} from "../../src/types/contracts";

test("公共枚举不包含重复值", () => {
  for (const values of [JoinApplicationStatus, Permission, RepairStatus, RoleCode]) {
    assert.equal(new Set(values).size, values.length);
  }
});

test("M1 稳定错误码已进入公共契约", () => {
  for (const code of [
    "AUTH_INVALID_CREDENTIALS",
    "AUTH_SESSION_INVALID",
    "AUTH_SESSION_EXPIRED",
    "AUTH_RATE_LIMITED",
    "PASSWORD_CHANGE_REQUIRED",
    "PASSWORD_CURRENT_INVALID",
    "PASSWORD_CONFIRMATION_MISMATCH",
    "ACCOUNT_DISABLED",
    "MEMBER_PROFILE_INACTIVE",
  ]) {
    assert.equal(ApiErrorCode.includes(code as (typeof ApiErrorCode)[number]), true);
  }
});

test("无 Cookie 的受保护请求返回未登录", async () => {
  await assert.rejects(
    () => authenticateRequest(new Request("http://localhost/api/v1/me"), "req_no_cookie"),
    (error) => error instanceof AppError && error.code === "UNAUTHENTICATED",
  );
});

test("QQ 与手机号规范化只产生受控格式", () => {
  assert.equal(normalizeQq("123 456 789"), "123456789");
  assert.equal(normalizePhone("138-0000-0000"), "13800000000");
  assert.throws(() => normalizeQq("123"), AppError);
  assert.throws(() => normalizePhone("10000"), AppError);
});

test("审计摘要移除秘密并脱敏完整联系方式", () => {
  const redacted = redactAuditSummary({
    password: "do-not-log",
    inviteCode: "do-not-log",
    qq: "123456789",
    phoneNormalized: "13800000000",
    nested: { accessToken: "do-not-log", safe: "ok" },
  });
  assert.deepEqual(redacted, {
    qq: maskQq("123456789"),
    phoneNormalized: maskPhone("13800000000"),
    nested: { safe: "ok" },
  });
  assert.doesNotMatch(JSON.stringify(redacted), /do-not-log|13800000000|123456789/);
});

test("审计脱敏只拦凭据类 code 字段，不误伤普通业务字段", () => {
  // 回归：早期 BLOCKED_KEY 用裸 `code` 匹配，把 `skillCodes` 整键丢掉，
  // 导致技能变更审计的 before / after 全部变成空对象（审计内容静默丢失）。
  const redacted = redactAuditSummary({
    skillCodes: ["REPAIR", "SYSTEM"],
    errorCode: "SKILL_NOT_FOUND",
    statusCode: 409,
    inviteCode: "should-be-removed",
    verificationCode: "should-be-removed",
  }) as Record<string, unknown>;

  // 普通业务字段必须保留
  assert.deepEqual(redacted.skillCodes, ["REPAIR", "SYSTEM"]);
  assert.equal(redacted.errorCode, "SKILL_NOT_FOUND");
  assert.equal(redacted.statusCode, 409);
  // 凭据类 code 仍然必须被移除
  assert.equal("inviteCode" in redacted, false);
  assert.equal("verificationCode" in redacted, false);
  assert.doesNotMatch(JSON.stringify(redacted), /should-be-removed/);
});

test("公开端点限流返回稳定错误码", () => {
  resetRateLimitsForTests();
  enforceRateLimit("test", 1, 60_000);
  assert.throws(
    () => enforceRateLimit("test", 1, 60_000),
    (error) => error instanceof AppError && error.code === "RATE_LIMITED",
  );
});

test("限流桶数量有上限，不会被伪造 IP 撑爆内存", () => {
  resetRateLimitsForTests();
  for (let i = 0; i < 20_000; i += 1) enforceRateLimit(`flood:${i}`, 10, 60_000);
  const count = rateLimitBucketCountForTests();
  // 没有淘汰时这里必然是 20000（审计 F2：键含客户端可控 IP，可以无限增长）
  assert.ok(count <= 10_000, `限流桶数量应受上限约束，实际 ${count}`);
  enforceRateLimit("after-flood", 1, 60_000);
  assert.throws(
    () => enforceRateLimit("after-flood", 1, 60_000),
    (error) => error instanceof AppError && error.code === "RATE_LIMITED",
  );
  resetRateLimitsForTests();
});

test("Session 摘要固定为 32 字节且不等于原令牌", () => {
  const previous = {
    AUTH_SECRET: process.env.AUTH_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    INVITE_CODE_PEPPER: process.env.INVITE_CODE_PEPPER,
    PII_AUDIT_PEPPER: process.env.PII_AUDIT_PEPPER,
  };
  process.env.AUTH_SECRET = "unit-test-auth-secret-at-least-32-bytes";
  process.env.DATABASE_URL = "mysql://unused";
  process.env.INVITE_CODE_PEPPER = "unit-test-invite-pepper-at-least-32-bytes";
  process.env.PII_AUDIT_PEPPER = "unit-test-audit-pepper-at-least-32-bytes";
  resetServerEnvForTests();
  const digest = digestSessionToken("a-private-random-session-token");
  assert.equal(digest.byteLength, 32);
  assert.notEqual(Buffer.from(digest).toString("utf8"), "a-private-random-session-token");
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetServerEnvForTests();
});

test("Cookie 安全属性与写接口同源校验保持固定", () => {
  const cookie = sessionCookie("token", "2030-01-01T00:00:00.000Z");
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "lax");
  assert.equal(cookie.path, "/");

  const previous = {
    AUTH_SECRET: process.env.AUTH_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    INVITE_CODE_PEPPER: process.env.INVITE_CODE_PEPPER,
    PII_AUDIT_PEPPER: process.env.PII_AUDIT_PEPPER,
    APP_BASE_URL: process.env.APP_BASE_URL,
  };
  process.env.AUTH_SECRET = "unit-test-auth-secret-at-least-32-bytes";
  process.env.DATABASE_URL = "mysql://unused";
  process.env.INVITE_CODE_PEPPER = "unit-test-invite-pepper-at-least-32-bytes";
  process.env.PII_AUDIT_PEPPER = "unit-test-audit-pepper-at-least-32-bytes";
  process.env.APP_BASE_URL = "https://pczafu.cn";
  resetServerEnvForTests();
  try {
    assert.doesNotThrow(() =>
      assertSameOrigin(
        new Request("https://pczafu.cn/api", { headers: { origin: "https://pczafu.cn" } }),
      ),
    );
    assert.throws(
      () =>
        assertSameOrigin(
          new Request("https://pczafu.cn/api", { headers: { origin: "https://example.com" } }),
        ),
      AppError,
    );
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    resetServerEnvForTests();
  }
});

test("密码只以 scrypt 哈希校验", async () => {
  const hash = await hashPassword("Unit-Password-2026");
  assert.match(hash, /^scrypt\$/);
  assert.equal(await verifyPassword("Unit-Password-2026", hash), true);
  assert.equal(await verifyPassword("Wrong-Password-2026", hash), false);
});

test("/join 重复报名信封映射为成功回执", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        success: true,
        data: {
          ticketNo: "JA-TEST",
          submittedAt: "2026-09-16T00:00:00.000Z",
          duplicate: true,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    assert.deepEqual(
      await submitMemberSignup({ qq: "123456789", realName: "测试成员", phone: "13800000000" }),
      {
        ok: true,
        ticket: "JA-TEST",
        submittedAt: "2026-09-16T00:00:00.000Z",
        duplicate: true,
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
