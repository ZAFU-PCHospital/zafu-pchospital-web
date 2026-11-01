import assert from "node:assert/strict";
import test from "node:test";

import {
  createBoundedGate,
  repairPhotoImageGate,
  withRepairPhotoImageSlot,
} from "../../src/features/repairs/repair-photo-admission";
import { AppError } from "../../src/lib/api/errors";

function isRateLimited(error: unknown): boolean {
  assert.equal(error instanceof AppError, true, `期望 AppError，实际 ${String(error)}`);
  assert.equal((error as AppError).code, "RATE_LIMITED");
  return true;
}

function options(overrides: { waitTimeoutMs?: number } = {}) {
  return {
    maxActive: 1,
    maxWaiting: 1,
    waitTimeoutMs: overrides.waitTimeoutMs ?? 1_000,
    busyMessage: "busy",
    timeoutMessage: "timeout",
  };
}

test("活跃满且等待满时立即拒绝；释放后按顺序授予等待者", async () => {
  const gate = createBoundedGate(options());
  const releaseFirst = await gate.acquire();
  const second = gate.acquire();

  await assert.rejects(gate.acquire(), isRateLimited);
  assert.deepEqual(gate.snapshot(), { active: 1, waiting: 1 });

  releaseFirst();
  const releaseSecond = await second;
  assert.deepEqual(gate.snapshot(), { active: 1, waiting: 0 });

  releaseSecond();
  releaseSecond();
  assert.deepEqual(gate.snapshot(), { active: 0, waiting: 0 });
});

test("排队超时会释放等待位置，不占用名额", async () => {
  const gate = createBoundedGate(options({ waitTimeoutMs: 20 }));
  const release = await gate.acquire();

  await assert.rejects(gate.acquire(), (error) => isRateLimited(error));
  assert.deepEqual(gate.snapshot(), { active: 1, waiting: 0 });

  release();
  const next = await gate.acquire();
  assert.deepEqual(gate.snapshot(), { active: 1, waiting: 0 });
  next();
});

test("请求取消后不泄漏等待名额，已取到的名额可正常释放", async () => {
  const gate = createBoundedGate(options());
  const release = await gate.acquire();
  const controller = new AbortController();
  const waiting = gate.acquire(controller.signal);

  controller.abort();
  await assert.rejects(waiting, isRateLimited);
  assert.deepEqual(gate.snapshot(), { active: 1, waiting: 0 });

  release();
  assert.deepEqual(gate.snapshot(), { active: 0, waiting: 0 });
  await assert.rejects(gate.acquire(controller.signal), isRateLimited);
});

test("图像处理闸门同一时刻只运行一个任务", async () => {
  let running = 0;
  let maxRunning = 0;
  const task = () =>
    withRepairPhotoImageSlot(async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running -= 1;
    });

  await Promise.all([task(), task()]);
  assert.equal(maxRunning, 1);
  assert.deepEqual(repairPhotoImageGate.snapshot(), { active: 0, waiting: 0 });
});
