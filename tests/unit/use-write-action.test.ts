import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";

import { mountClient } from "../support/react-client";
import { useWriteAction, type WriteActionResult } from "../../src/components/ui/useWriteAction";

test("写操作包装在途防重、成功后刷新、失败可见", async (t) => {
  let successCount = 0;
  let actionCalls = 0;
  let current: ReturnType<typeof useWriteAction> | null = null;

  const mounted = mountClient(t, () => {
    const action = useWriteAction({
      onSuccess: () => {
        successCount += 1;
      },
    });
    current = action;
    return createElement("span", null, action.busy ? "busy" : "idle");
  });

  mounted.view();
  assert.equal(current!.busy, false);

  let resolveFirst!: (result: WriteActionResult) => void;
  const first = current!.run(
    "row",
    () => {
      actionCalls += 1;
      return new Promise((resolve) => {
        resolveFirst = resolve;
      });
    },
    "操作失败",
  );

  mounted.view();
  assert.equal(current!.busyKey, "row");
  assert.equal(
    await current!.run("row", async () => ({ ok: true }), "操作失败"),
    false,
    "在途时同一操作的第二次点击必须被忽略",
  );
  assert.equal(actionCalls, 1);

  resolveFirst({ ok: true });
  assert.equal(await first, true);
  mounted.view();
  assert.equal(successCount, 1);
  assert.equal(current!.busyKey, null);
  assert.equal(current!.error, "");

  assert.equal(
    await current!.run(
      "row",
      async () => ({ ok: false, message: "服务端拒绝了这次操作" }),
      "操作失败",
    ),
    false,
  );
  mounted.view();
  assert.equal(current!.error, "服务端拒绝了这次操作");
  current!.clearError();
  mounted.view();
  assert.equal(current!.error, "");
});
