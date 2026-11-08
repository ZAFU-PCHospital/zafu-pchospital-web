import assert from "node:assert/strict";
import test from "node:test";

import {
  isDashboardAllClear,
  pendingServesState,
} from "../../src/components/member/dashboard-state";

const emptyQueue = { draftCount: 0, pendingCount: 0, rejectedCount: 0 };

test("待补单空列表与读取失败可区分", () => {
  assert.deepEqual(pendingServesState({ pendingServes: [], degraded: [] }), {
    items: [],
    failed: false,
  });
  assert.deepEqual(pendingServesState({ pendingServes: [], degraded: ["pendingServes"] }), {
    items: [],
    failed: true,
  });
  assert.deepEqual(pendingServesState(null), { items: [], failed: false });
});

test("待补单列表原样返回，不把失败标记混进空态", () => {
  const item = {
    registrationId: "registration-1",
    name: "张三",
    activityId: "activity-1",
    activityTitle: "秋季义务维修",
    activityAt: "2026-10-15T04:00:00.000Z",
  };
  assert.deepEqual(pendingServesState({ pendingServes: [item], degraded: [] }), {
    items: [item],
    failed: false,
  });
});

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
