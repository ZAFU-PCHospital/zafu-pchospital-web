import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";

import { POST } from "../../src/app/api/v1/auth/logout/route";
import { authService } from "../../src/features/auth/auth-service";
import { resetServerEnvForTests } from "../../src/lib/env";
import type { PublicRequestContext } from "../../src/types/contracts";

function setup(t: TestContext) {
  const env = {
    DATABASE_URL: "mysql://unused",
    AUTH_SECRET: "unit-test-auth-secret-at-least-32-bytes",
    INVITE_CODE_PEPPER: "unit-test-invite-pepper-at-least-32-bytes",
    PII_AUDIT_PEPPER: "unit-test-audit-pepper-at-least-32-bytes",
    APP_BASE_URL: "https://logout.example",
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  resetServerEnvForTests();
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetServerEnvForTests();
  });
}

function request(origin: string | null = "https://logout.example", token = "test-token") {
  return new Request("https://logout.example/api/v1/auth/logout", {
    method: "POST",
    headers: {
      ...(origin ? { origin } : {}),
      ...(token ? { cookie: `pc_hospital_session=${token}` } : {}),
      "x-request-id": "req_logout_test",
    },
  });
}

test("仅在服务层确认完成后返回成功信封并清 Cookie", async (t) => {
  setup(t);
  let complete!: () => void;
  t.mock.method(authService, "logout", async (token: string, context: PublicRequestContext) => {
    assert.equal(token, "test-token");
    assert.equal(context.requestId, "req_logout_test");
    await new Promise<void>((resolve) => {
      complete = resolve;
    });
  });
  let settled = false;
  const pending = POST(request()).then((response) => {
    settled = true;
    return response;
  });
  await setImmediate();
  assert.equal(settled, false);
  complete();
  const response = await pending;
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    data: { loggedOut: true },
    meta: { requestId: "req_logout_test" },
  });
  assert.match(response.headers.get("set-cookie") ?? "", /pc_hospital_session=;/);
  assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
  assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/);
});

test("服务端处理失败保留 Cookie，不误报成功", async (t) => {
  setup(t);
  t.mock.method(authService, "logout", async () => {
    throw new Error("transaction failed");
  });
  const response = await POST(request());
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal((await response.json()).success, false);
});

for (const origin of [null, "https://other.example"]) {
  test(`来源 ${origin ?? "缺失"} 时拒绝退出且保留 Cookie`, async (t) => {
    setup(t);
    const logout = t.mock.method(authService, "logout", async () => {});
    const response = await POST(request(origin));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal((await response.json()).error.code, "FORBIDDEN");
    assert.equal(logout.mock.callCount(), 0);
  });
}
