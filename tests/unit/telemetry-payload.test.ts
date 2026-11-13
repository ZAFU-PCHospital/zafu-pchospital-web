import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../src/lib/api/errors";
import {
  buildErrorPayload,
  buildWebVitalPayload,
  parseTelemetryPayload,
  sanitizeRoute,
  telemetryCodeForBoundary,
} from "../../src/lib/telemetry/payload";

test("路由只保留路径并归一化动态段", () => {
  assert.equal(sanitizeRoute("/activities/123?phone=13800138000#signup"), "/activities/[id]");
  assert.equal(
    sanitizeRoute("https://pczafu.cn/admin/members/550e8400-e29b-41d4-a716-446655440000?qq=123456"),
    "/admin/members/[id]",
  );
  assert.equal(sanitizeRoute(" repair/42 "), "/repair/[id]");
  assert.equal(sanitizeRoute(""), "/");
  assert.equal(sanitizeRoute(null), "/");
  assert.equal(sanitizeRoute("not-a-url"), "/not-a-url");
  assert.ok(sanitizeRoute(`/${"a".repeat(400)}`).length <= 200);
});

test("Web Vitals 只接受白名单指标与有效数值", () => {
  const payload = buildWebVitalPayload(
    { name: "LCP", value: 1234.5678, rating: "good" },
    "/activities/42?token=secret",
    "ABCDEF12",
  );
  assert.deepEqual(payload, {
    kind: "web-vital",
    route: "/activities/[id]",
    release: "abcdef12",
    metric: "LCP",
    value: 1234.568,
    rating: "good",
  });
  assert.equal(buildWebVitalPayload({ name: "FID", value: 1 }, "/"), null);
  assert.equal(buildWebVitalPayload({ name: "LCP", value: Number.NaN }, "/"), null);
  assert.equal(buildWebVitalPayload({ name: "LCP", value: -1 }, "/"), null);
  assert.equal(
    buildWebVitalPayload({ name: "LCP", value: 1, rating: "bad" }, "/", "not-a-sha")?.rating,
    undefined,
  );
});

test("错误载荷不包含 message 与 stack", () => {
  const error = Object.assign(new TypeError("手机号 13800138000 不存在"), {
    digest: "1789012345",
  });
  const payload = buildErrorPayload(error, "route", "/login?qq=123456");
  assert.deepEqual(payload, {
    kind: "error",
    route: "/login",
    boundary: "route",
    name: "TypeError",
    digest: "1789012345",
  });
  const serialized = JSON.stringify(payload);
  assert.ok(!serialized.includes("13800138000"));
  assert.ok(!serialized.includes("stack"));
});

test("非标准错误名与 digest 回退，不把原文带进载荷", () => {
  const payload = buildErrorPayload(
    { name: "Bad name with spaces", digest: "x".repeat(200), message: "secret" },
    "window",
    "/",
  );
  assert.equal(payload.name, "Error");
  assert.equal(payload.digest, undefined);
  assert.ok(!JSON.stringify(payload).includes("secret"));
});

test("服务端解析丢弃白名单以外的字段", () => {
  const parsed = parseTelemetryPayload({
    kind: "error",
    route: "/repair/9?phone=13800138000",
    boundary: "unhandledrejection",
    name: "TypeError",
    digest: "req_1",
    release: "ABCDEF12",
    message: "13800138000",
    stack: "TypeError: ...",
    phone: "13800138000",
  });
  assert.deepEqual(parsed, {
    kind: "error",
    route: "/repair/[id]",
    release: "abcdef12",
    boundary: "unhandledrejection",
    name: "TypeError",
    digest: "req_1",
  });

  const vital = parseTelemetryPayload({
    kind: "web-vital",
    route: "/",
    metric: "CLS",
    value: 0.1234,
    rating: "needs-improvement",
    extra: "dropped",
  });
  assert.deepEqual(vital, {
    kind: "web-vital",
    route: "/",
    metric: "CLS",
    value: 0.123,
    rating: "needs-improvement",
  });
});

test("服务端拒绝结构不符的遥测输入", () => {
  const invalidInputs: unknown[] = [
    null,
    [],
    {},
    { kind: "error", route: "", boundary: "route", name: "Error" },
    { kind: "error", route: "/", boundary: "unknown", name: "Error" },
    { kind: "web-vital", route: "/", metric: "FID", value: 1 },
    { kind: "web-vital", route: "/", metric: "LCP", value: "1" },
    { kind: "web-vital", route: "/", metric: "LCP", value: -1 },
    { kind: "unknown", route: "/" },
  ];
  for (const input of invalidInputs) {
    assert.throws(
      () => parseTelemetryPayload(input),
      (error) => error instanceof AppError && error.code === "VALIDATION_FAILED",
      `应拒绝 ${JSON.stringify(input)}`,
    );
  }
});

test("错误边界映射为稳定的错误码", () => {
  assert.equal(telemetryCodeForBoundary("route"), "ROUTE_ERROR");
  assert.equal(telemetryCodeForBoundary("global"), "GLOBAL_ERROR");
  assert.equal(telemetryCodeForBoundary("window"), "WINDOW_ERROR");
  assert.equal(telemetryCodeForBoundary("unhandledrejection"), "UNHANDLED_REJECTION");
});
