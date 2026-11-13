import assert from "node:assert/strict";
import test from "node:test";

import { createTelemetryReporter } from "../../src/lib/telemetry/client";
import type { TelemetryPayload } from "../../src/lib/telemetry/payload";

function setup(options: { enabled?: boolean; sampleRate?: number } = {}) {
  const sent: TelemetryPayload[] = [];
  let now = 0;
  let random = 0;
  const reporter = createTelemetryReporter({
    send: (payload) => sent.push(payload),
    now: () => now,
    random: () => random,
    enabled: options.enabled,
    sampleRate: options.sampleRate,
  });
  return {
    sent,
    reporter,
    tick: (ms: number) => {
      now += ms;
    },
    setRandom: (value: number) => {
      random = value;
    },
  };
}

test("关闭后不再上报", () => {
  const { reporter, sent } = setup({ enabled: false });
  reporter.reportWebVital({ name: "LCP", value: 100 });
  reporter.reportError(new Error("boom"), "window");
  assert.equal(sent.length, 0);
});

test("Web Vitals 按采样率发送，同一页面同一指标只发一次", () => {
  const { reporter, sent, setRandom } = setup({ sampleRate: 0.5 });
  setRandom(0.9);
  reporter.reportWebVital({ name: "LCP", value: 100 });
  assert.equal(sent.length, 0);

  setRandom(0.1);
  reporter.reportWebVital({ name: "LCP", value: 100 });
  reporter.reportWebVital({ name: "LCP", value: 200 });
  reporter.reportWebVital({ name: "CLS", value: 0.1 });
  assert.deepEqual(
    sent.map((payload) => (payload.kind === "web-vital" ? payload.metric : "error")),
    ["LCP", "CLS"],
  );
});

test("同一错误每分钟最多 3 条，时间窗过后恢复", () => {
  const { reporter, sent, tick } = setup();
  for (let index = 0; index < 5; index++) {
    reporter.reportError(new TypeError("boom"), "route", "/repair/1?phone=1");
  }
  assert.equal(sent.length, 3);
  assert.equal(sent[0]?.route, "/repair/[id]");

  tick(59_999);
  reporter.reportError(new TypeError("boom"), "route");
  assert.equal(sent.length, 3);

  tick(1);
  reporter.reportError(new TypeError("boom"), "route");
  assert.equal(sent.length, 4);
});

test("错误边界与 digest 不同的错误分别计数", () => {
  const { reporter, sent } = setup();
  reporter.reportError(new Error("a"), "window");
  reporter.reportError(new Error("a"), "unhandledrejection");
  reporter.reportError(Object.assign(new Error("a"), { digest: "d1" }), "route");
  reporter.reportError(Object.assign(new Error("a"), { digest: "d2" }), "route");
  assert.equal(sent.length, 4);
});

test("每页错误总数有上限，换页后重置", () => {
  const { reporter, sent } = setup();
  for (let index = 0; index < 21; index++) {
    reporter.reportError(Object.assign(new Error("boom"), { digest: `d${index}` }), "window");
  }
  assert.equal(sent.length, 20);

  reporter.resetPage();
  reporter.reportError(new Error("boom"), "window");
  assert.equal(sent.length, 21);
  assert.equal(sent[20]?.kind, "error");
});
