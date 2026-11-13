import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { POST } from "../../src/app/api/v1/telemetry/route";
import { resetRateLimitsForTests } from "../../src/lib/api/rate-limit";
import { resetServerEnvForTests } from "../../src/lib/env";

const ORIGIN = "https://telemetry.example";

function setup(t: TestContext, ip = "203.0.113.9") {
  const env = {
    DATABASE_URL: "mysql://unused",
    AUTH_SECRET: "unit-test-auth-secret-at-least-32-bytes",
    INVITE_CODE_PEPPER: "unit-test-invite-pepper-at-least-32-bytes",
    PII_AUDIT_PEPPER: "unit-test-audit-pepper-at-least-32-bytes",
    APP_BASE_URL: ORIGIN,
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  resetServerEnvForTests();
  resetRateLimitsForTests();
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetServerEnvForTests();
    resetRateLimitsForTests();
  });
  const logs: string[] = [];
  t.mock.method(console, "info", (message: string) => {
    logs.push(message);
  });
  return {
    logs,
    request: (
      body: unknown,
      overrides: { origin?: string | null; contentType?: string; ip?: string } = {},
    ) =>
      new Request(`${ORIGIN}/api/v1/telemetry`, {
        method: "POST",
        headers: {
          ...(overrides.origin === null ? {} : { origin: overrides.origin ?? ORIGIN }),
          "content-type": overrides.contentType ?? "application/json",
          "x-real-ip": overrides.ip ?? ip,
          "x-request-id": "req_telemetry_test",
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
  };
}

test("错误遥测写入结构化日志，且不落 message、查询串与 IP", async (t) => {
  const { logs, request } = setup(t);
  const response = await POST(
    request({
      kind: "error",
      route: "/repair/42?phone=13800138000",
      boundary: "route",
      name: "TypeError",
      digest: "abc123",
      release: "ABCDEF12",
      message: "手机号 13800138000 不存在",
      stack: "TypeError: ...",
    }),
  );

  assert.equal(response.status, 202);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), {
    success: true,
    data: { accepted: true },
    meta: { requestId: "req_telemetry_test" },
  });

  assert.equal(logs.length, 1);
  const entry = JSON.parse(logs[0] ?? "{}");
  assert.equal(entry.event, "client_telemetry");
  assert.equal(entry.kind, "error");
  assert.equal(entry.route, "/repair/[id]");
  assert.equal(entry.code, "ROUTE_ERROR");
  assert.equal(entry.boundary, "route");
  assert.equal(entry.name, "TypeError");
  assert.equal(entry.digest, "abc123");
  assert.equal(entry.clientRelease, "abcdef12");
  assert.equal(typeof entry.release, "string");
  const serialized = logs[0] ?? "";
  assert.ok(!serialized.includes("13800138000"));
  assert.ok(!serialized.includes("203.0.113.9"));
  assert.ok(!serialized.includes("TypeError: ..."));
});

test("Web Vitals 遥测写入指标与评分", async (t) => {
  const { logs, request } = setup(t);
  const response = await POST(
    request({
      kind: "web-vital",
      route: "/activities/42",
      metric: "LCP",
      value: 1234.5678,
      rating: "good",
    }),
  );

  assert.equal(response.status, 202);
  const entry = JSON.parse(logs[0] ?? "{}");
  assert.equal(entry.kind, "web-vital");
  assert.equal(entry.route, "/activities/[id]");
  assert.equal(entry.metric, "LCP");
  assert.equal(entry.value, 1234.568);
  assert.equal(entry.rating, "good");
});

test("拒绝跨域、非 JSON 与结构不符的请求", async (t) => {
  const { logs, request } = setup(t);

  const crossOrigin = await POST(
    request(
      { kind: "error", route: "/", boundary: "window", name: "Error" },
      { origin: "https://evil.example" },
    ),
  );
  assert.equal(crossOrigin.status, 403);

  const missingOrigin = await POST(
    request({ kind: "error", route: "/", boundary: "window", name: "Error" }, { origin: null }),
  );
  assert.equal(missingOrigin.status, 403);

  const notJson = await POST(request("{}", { contentType: "text/plain" }));
  assert.equal(notJson.status, 415);

  const invalid = await POST(request({ kind: "web-vital", route: "/", metric: "FID", value: 1 }));
  assert.equal(invalid.status, 400);
  assert.equal(
    ((await invalid.json()) as { error: { code: string } }).error.code,
    "VALIDATION_FAILED",
  );

  const malformed = await POST(request("{not-json"));
  assert.equal(malformed.status, 400);

  assert.equal(logs.length, 0);
});

test("超过体积上限返回 413", async (t) => {
  const { request } = setup(t);
  const response = await POST(request("x".repeat(4097)));
  assert.equal(response.status, 413);
});

test("按客户端 IP 限流，第 121 次请求返回 429", async (t) => {
  const { request } = setup(t);
  const body = { kind: "web-vital", route: "/", metric: "LCP", value: 1 };
  for (let index = 0; index < 120; index++) {
    const response = await POST(request(body));
    assert.equal(response.status, 202);
  }
  const limited = await POST(request(body));
  assert.equal(limited.status, 429);

  const otherIp = await POST(request(body, { ip: "203.0.113.10" }));
  assert.equal(otherIp.status, 202);
});
