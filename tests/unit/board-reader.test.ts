import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  boardRetryDelay,
  createBoardReader,
} from "../../src/components/repair-activities/board-reader";
import { BoardSyncStatus } from "../../src/components/repair-activities/BoardSyncStatus";
import { memberRepairActivitiesCopy } from "../../src/config/repair-activities";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

function setup(t: TestContext, interval = 5_000, mockTimeout = false) {
  t.mock.timers.enable({
    apis: ["Date", ...(mockTimeout ? ["setTimeout" as const] : [])],
    now: 1_000_000,
  });
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  const doc = { visibilityState: "visible" };
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  });
  let paused = false;
  const reader = createBoardReader<{ value: string }>({
    url: "/isolated",
    interval: () => interval,
    paused: () => paused,
    changed() {},
  });
  t.after(() => reader.dispose());
  return {
    reader,
    doc,
    pause: (value: boolean) => {
      paused = value;
    },
  };
}

test("对账读取超时保留快照并释放 pending，迟到结果不能覆盖手动重试", async (t) => {
  const { reader } = setup(t, 5_000, true);
  let finish!: (response: Response) => void;
  let calls = 0;
  t.mock.method(globalThis, "fetch", () => {
    calls++;
    return calls === 2
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(
          Response.json({ success: true, data: { value: calls === 1 ? "snapshot" : "fresh" } }),
        );
  });
  await reader.read();
  const pending = reader.read({ manual: true });
  t.mock.timers.tick(15_000);
  await pending;
  assert.equal(reader.state.pending, false);
  assert.equal(reader.state.data?.value, "snapshot");
  assert.equal(reader.state.failures, 1);
  await reader.read({ manual: true });
  finish(Response.json({ success: true, data: { value: "late" } }));
  await Promise.resolve();
  assert.equal(reader.state.data?.value, "fresh");
});

test("有界退避：进行中 10/20/40/60 秒，结束与历史最多 120 秒", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 50].map((n) => boardRetryDelay(5_000, n)),
    [10_000, 20_000, 40_000, 60_000, 60_000],
  );
  assert.equal(boardRetryDelay(60_000, 10), 120_000);
});

test("失败保留快照和成功时间，恢复解除提示并回到基础节拍", async (t) => {
  const { reader } = setup(t);
  let failing = false,
    calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (failing) throw new Error("offline");
    return Response.json({ success: true, data: { value: "snapshot" } });
  });
  await reader.read();
  const successAt = reader.state.lastSuccessAt;
  failing = true;
  t.mock.timers.tick(5_000);
  await reader.read();
  assert.equal(reader.state.data?.value, "snapshot");
  assert.equal(reader.state.lastSuccessAt, successAt);
  assert.equal(reader.state.failures, 1);
  t.mock.timers.tick(5_000);
  await reader.read({ resume: true });
  assert.equal(calls, 2, "focus 不能绕过失败退避");
  t.mock.timers.tick(5_000);
  await reader.read();
  assert.equal(reader.state.failures, 2);
  failing = false;
  await reader.read({ manual: true });
  assert.equal(reader.state.failures, 0);
  assert.equal(reader.state.error, null);
  t.mock.timers.tick(4_999);
  await reader.read();
  assert.equal(calls, 4);
  t.mock.timers.tick(1);
  await reader.read();
  assert.equal(calls, 5);
});

test("在途请求合并，失效后的迟到结果不得覆盖写后读取", async (t) => {
  const { reader } = setup(t);
  let resolve!: (response: Response) => void;
  let calls = 0;
  t.mock.method(globalThis, "fetch", () => {
    calls++;
    return calls === 1
      ? new Promise<Response>((done) => {
          resolve = done;
        })
      : Promise.resolve(Response.json({ success: true, data: { value: "new" } }));
  });
  const old = reader.read();
  assert.equal(reader.read({ manual: true }), old);
  reader.invalidate();
  await reader.read({ manual: true });
  resolve(Response.json({ success: true, data: { value: "old" } }));
  await old;
  assert.equal(reader.state.data?.value, "new");
  assert.equal(calls, 2);
});

test("隐藏与弹层暂停时不取数，暂停中完成的后台结果不生效", async (t) => {
  const { reader, doc, pause } = setup(t);
  let resolve!: (response: Response) => void;
  let calls = 0;
  t.mock.method(globalThis, "fetch", () => {
    calls++;
    return new Promise<Response>((done) => {
      resolve = done;
    });
  });
  doc.visibilityState = "hidden";
  await reader.read();
  doc.visibilityState = "visible";
  pause(true);
  await reader.read();
  assert.equal(calls, 0);
  pause(false);
  const pending = reader.read();
  pause(true);
  resolve(Response.json({ success: true, data: { value: "late" } }));
  await pending;
  assert.equal(reader.state.data, null);
  assert.equal(reader.state.failures, 0);
});

test("资格错误停止自动读取，手动重试成功可恢复", async (t) => {
  const { reader } = setup(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return calls === 1
      ? Response.json({ success: false, error: { message: "forbidden" } }, { status: 403 })
      : Response.json({ success: true, data: { value: "restored" } });
  });
  await reader.read();
  t.mock.timers.tick(120_000);
  await reader.read({ resume: true });
  assert.equal(calls, 1);
  assert.equal(reader.state.stopped, true);
  await reader.read({ manual: true });
  assert.equal(reader.state.stopped, false);
  assert.equal(reader.state.data?.value, "restored");
});

test("同步提示渲染成功时间与持续失败文案，未同步不冒充已同步", (t) => {
  const previous = (globalThis as { React?: typeof React }).React;
  (globalThis as { React?: typeof React }).React = React;
  t.after(() => {
    (globalThis as { React?: typeof React }).React = previous;
  });
  const copy = memberRepairActivitiesCopy.board;
  const state = {
    data: null,
    pending: false,
    lastSuccessAt: 1_000_000,
    failures: 2,
    error: "offline",
    stopped: false,
  };
  const html = renderToStaticMarkup(
    createElement(BoardSyncStatus, { label: copy.queueSyncedAt, state }),
  );
  assert.ok(html.includes(copy.syncRepeatedFailure));
  assert.ok(html.includes('role="status"'));
  const unloaded = renderToStaticMarkup(
    createElement(BoardSyncStatus, {
      label: copy.queueSyncedAt,
      state: { ...state, failures: 0, lastSuccessAt: null },
    }),
  );
  assert.ok(unloaded.includes(copy.syncNever));
  assert.equal(unloaded.includes(copy.syncReady), false);
  const firstFailure = renderToStaticMarkup(
    createElement(BoardSyncStatus, {
      label: copy.queueSyncedAt,
      state: { ...state, lastSuccessAt: null },
    }),
  );
  assert.ok(firstFailure.includes(copy.syncInitialFailure));
  const ready = renderToStaticMarkup(
    createElement(BoardSyncStatus, {
      label: copy.servedSyncedAt,
      state: { ...state, failures: 0, lastSuccessAt: 1_000_000 },
    }),
  );
  assert.match(ready, /datetime="1970-01-01T00:16:40.000Z"/i);
  assert.ok(ready.includes(copy.syncReady));
});
