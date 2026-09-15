import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../src/lib/api/errors";
import { enforceRateLimit, resetRateLimitsForTests } from "../../src/lib/api/rate-limit";
import { maskPhone, maskQq, redactAuditSummary } from "../../src/lib/audit/redaction";
import { normalizePhone, normalizeQq } from "../../src/lib/security/normalization";
import { JoinApplicationStatus, Permission, RoleCode } from "../../src/types/contracts";

test("公共枚举不包含重复值", () => {
  for (const values of [JoinApplicationStatus, Permission, RoleCode]) {
    assert.equal(new Set(values).size, values.length);
  }
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

test("公开端点限流返回稳定错误码", () => {
  resetRateLimitsForTests();
  enforceRateLimit("test", 1, 60_000);
  assert.throws(
    () => enforceRateLimit("test", 1, 60_000),
    (error) => error instanceof AppError && error.code === "RATE_LIMITED",
  );
});
