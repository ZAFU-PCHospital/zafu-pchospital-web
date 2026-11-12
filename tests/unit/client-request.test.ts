import assert from "node:assert/strict";
import test from "node:test";
import { createLatestRequest } from "../../src/lib/client/latest-request";
import { ClientRequestError, requestJson, withRequest } from "../../src/lib/client/request";

test("请求默认 15 秒超时；传输层忽略取消也能结束等待", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal!: AbortSignal;
  t.mock.method(globalThis, "fetch", (_: unknown, init: RequestInit) => {
    signal = init.signal!;
    return new Promise<Response>(() => {});
  });
  let settled = false;
  const pending = requestJson("/isolated");
  const rejected = assert
    .rejects(
      pending,
      (error) => error instanceof ClientRequestError && error.code === "REQUEST_TIMEOUT",
    )
    .then(() => {
      settled = true;
    });
  t.mock.timers.tick(14_999);
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(signal.aborted, true);
});

test("超时同时覆盖 response.json 挂起，释放后可以发下一次请求", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    status: 200,
    json: () => new Promise(() => {}),
  }));
  const pending = requestJson("/isolated");
  const rejected = assert.rejects(pending, { code: "REQUEST_TIMEOUT" });
  await Promise.resolve();
  t.mock.timers.tick(15_000);
  await rejected;
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: true, data: 0 }));
  assert.deepEqual(await requestJson("/isolated"), { data: 0, meta: undefined });
});

test("取消立即结束等待；已取消请求不发送；成功后清除超时", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new AbortController();
  let calls = 0;
  const pending = withRequest(
    () => {
      calls++;
      return new Promise(() => {});
    },
    { signal: controller.signal },
  );
  const rejected = assert.rejects(pending, { code: "REQUEST_ABORTED" });
  controller.abort();
  await rejected;
  await assert.rejects(
    withRequest(
      async () => {
        calls++;
      },
      { signal: controller.signal },
    ),
    { code: "REQUEST_ABORTED" },
  );
  assert.equal(calls, 1);
  let successfulSignal!: AbortSignal;
  await withRequest(async (signal) => {
    successfulSignal = signal;
  });
  t.mock.timers.tick(15_000);
  assert.equal(successfulSignal.aborted, false);
});

test("HTTP 失败不会因成功信封而报成功，服务端业务错误码原样保留", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ success: true, data: {} }, { status: 500 }),
  );
  await assert.rejects(requestJson("/isolated"), { code: "INVALID_RESPONSE", status: 500 });
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      { success: false, error: { code: "ACTIVITY_ENDED", message: "活动已结束" } },
      { status: 404 },
    ),
  );
  await assert.rejects(requestJson("/isolated"), {
    code: "ACTIVITY_ENDED",
    status: 404,
    message: "活动已结束",
  });
});

test("网络与非 JSON 响应映射到客户端错误码", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("offline");
  });
  await assert.rejects(requestJson("/isolated"), { code: "NETWORK_ERROR" });
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("<html>gateway</html>", { status: 502 }),
  );
  await assert.rejects(requestJson("/isolated"), { code: "INVALID_RESPONSE", status: 502 });
});

test("最新代次覆盖 A→B→A，旧 finally 不会使新请求失效", () => {
  const scope = createLatestRequest();
  const first = scope.begin();
  const second = scope.begin();
  const third = scope.begin();
  first.finish();
  second.finish();
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  assert.equal(third.isCurrent(), true);
  third.finish();
  assert.equal(third.isCurrent(), true, "完成后仍可保护下一帧回调");
  scope.invalidate();
  assert.equal(third.isCurrent(), false);
});
