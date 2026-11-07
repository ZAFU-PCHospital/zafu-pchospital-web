import assert from "node:assert/strict";
import test from "node:test";

import { isDashboardAllClear } from "../../src/components/member/dashboard-all-clear";

const emptyQueue = { draftCount: 0, pendingCount: 0, rejectedCount: 0 };

test("待办都已加载且为空时才显示全部完成", () => {
  assert.equal(
    isDashboardAllClear({
      queue: emptyQueue,
      pendingServeCount: 0,
      pendingServesFailed: false,
      unread: 0,
    }),
    true,
  );
});

test("存在待补单或待补单读取失败时不显示全部完成", () => {
  assert.equal(
    isDashboardAllClear({
      queue: emptyQueue,
      pendingServeCount: 1,
      pendingServesFailed: false,
      unread: 0,
    }),
    false,
  );
  assert.equal(
    isDashboardAllClear({
      queue: emptyQueue,
      pendingServeCount: 0,
      pendingServesFailed: true,
      unread: 0,
    }),
    false,
  );
});

test("队列或未读状态未知时不显示全部完成", () => {
  assert.equal(
    isDashboardAllClear({
      queue: null,
      pendingServeCount: 0,
      pendingServesFailed: false,
      unread: 0,
    }),
    false,
  );
  assert.equal(
    isDashboardAllClear({
      queue: emptyQueue,
      pendingServeCount: 0,
      pendingServesFailed: false,
      unread: null,
    }),
    false,
  );
  assert.equal(
    isDashboardAllClear({
      queue: { draftCount: 1, pendingCount: 0, rejectedCount: 0 },
      pendingServeCount: 0,
      pendingServesFailed: false,
      unread: 0,
    }),
    false,
  );
});
