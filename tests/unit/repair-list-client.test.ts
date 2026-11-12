import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import type { ReactElement, ReactNode } from "react";
import { repairCopy, repairResultLabels, repairStatusLabels } from "../../src/config/repairs";

const require = createRequire(import.meta.url);
const React = require("react") as typeof import("react");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const {
  SearchParamsContext,
  PathnameContext,
} = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
type Props = {
  children?: ReactNode;
  className?: string;
  message?: string;
  item?: { id: string };
  onClick?: () => void;
};
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  return React.isValidElement<Props>(node) ? [node, ...elements(node.props.children)] : [];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (React.isValidElement<Props>(node)) return text(node.props.children);
  return typeof node === "string" ? node : "";
}

async function mount(t: TestContext) {
  const slots: { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void }[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  const changed = (a?: readonly unknown[], b?: readonly unknown[]) =>
    !a || !b || a.length !== b.length || a.some((entry, i) => !Object.is(entry, b[i]));
  t.mock.method(React, "useState", <S>(initial: S | (() => S)) => {
    const i = cursor++;
    if (!(i in slots))
      slots[i] = { value: typeof initial === "function" ? (initial as () => S)() : initial };
    return [
      slots[i].value as S,
      (next: S | ((old: S) => S)) => {
        slots[i].value =
          typeof next === "function" ? (next as (old: S) => S)(slots[i].value as S) : next;
      },
    ];
  });
  t.mock.method(React, "useRef", <S>(initial: S) => {
    const i = cursor++;
    slots[i] ??= { value: { current: initial } };
    return slots[i].value;
  });
  const memo = (factory: () => unknown, deps: readonly unknown[]) => {
    const i = cursor++;
    if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { value: factory(), deps };
    return slots[i].value;
  };
  t.mock.method(React, "useMemo", memo);
  t.mock.method(React, "useCallback", (callback: unknown, deps: readonly unknown[]) =>
    memo(() => callback, deps),
  );
  t.mock.method(
    React,
    "useEffect",
    (effect: () => void | (() => void), deps?: readonly unknown[]) => {
      const i = cursor++;
      const old = slots[i];
      if (!old || changed(old.deps, deps))
        effects.push(() => {
          old?.cleanup?.();
          slots[i] = { deps, cleanup: effect() || undefined };
        });
    },
  );
  let params = new URLSearchParams();
  t.mock.method(React, "useContext", (context: unknown) => {
    if (context === SearchParamsContext) return params;
    if (context === PathnameContext) return "/member/repairs";
    if (context === AppRouterContext) return { replace() {} };
    return null;
  });
  const requests: {
    url: string;
    signal?: AbortSignal | null;
    finish: (response: Response) => void;
  }[] = [];
  t.mock.method(globalThis, "fetch", (input: unknown, init: RequestInit) => {
    const url = String(input);
    if (url.includes("pageSize=1&") || url.endsWith("pageSize=1"))
      return Promise.resolve(
        Response.json({ success: true, data: [], meta: { pagination: { total: 42 } } }),
      );
    if (!url.startsWith("/api/v1/repairs?"))
      return Promise.resolve(Response.json({ success: true, data: [] }));
    return new Promise<Response>((finish) => requests.push({ url, signal: init.signal, finish }));
  });
  const previousReact = (globalThis as { React?: typeof React }).React;
  (globalThis as { React?: typeof React }).React = React;
  t.after(() => {
    slots.forEach((slot) => slot.cleanup?.());
    (globalThis as { React?: typeof React }).React = previousReact;
  });
  const { RepairList } = await import("../../src/components/repairs/RepairList");
  const view = () => {
    cursor = 0;
    effects = [];
    const node = RepairList({ statusLabels: repairStatusLabels, resultLabels: repairResultLabels });
    effects.forEach((effect) => effect());
    return node;
  };
  return {
    requests,
    view,
    filter(status: string) {
      params = new URLSearchParams({ status });
      view();
      return view();
    },
    click(label: string) {
      const button = elements(view()).find(
        (element) => text(element.props.children) === label && element.props.onClick,
      );
      assert.ok(button, `Missing button: ${label}`);
      button.props.onClick!();
      return view();
    },
    async finish(index: number, id: string, page = 1) {
      requests[index].finish(
        Response.json({
          success: true,
          data: [{ id }],
          meta: { pagination: { page, pageSize: 20, total: 42, totalPages: 3 } },
        }),
      );
      await setImmediate();
    },
    ids() {
      return elements(view()).flatMap((element) =>
        element.props.item ? [element.props.item.id] : [],
      );
    },
  };
}

test("维修列表保留已渲染表格，快速筛选与翻页只接受最新响应", async (t) => {
  const ui = await mount(t);
  ui.view();
  await ui.finish(0, "initial");
  ui.filter("PENDING");
  assert.deepEqual(ui.ids(), ["initial"]);
  ui.filter("DRAFT");
  assert.equal(ui.requests[1].signal?.aborted, true);
  await ui.finish(2, "draft");
  await ui.finish(1, "late-pending");
  assert.deepEqual(ui.ids(), ["draft"]);
  ui.click(repairCopy.list.nextPage);
  ui.click(repairCopy.list.nextPage);
  assert.equal(ui.requests[3].signal?.aborted, true);
  assert.match(ui.requests[4].url, /page=3/);
  await ui.finish(4, "page-three", 3);
  await ui.finish(3, "late-page-two", 2);
  assert.deepEqual(ui.ids(), ["page-three"]);
});

test("维修列表超时保留表格，通过错误浮条反馈；重试后迟到响应不回填", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ui = await mount(t);
  ui.view();
  await ui.finish(0, "initial");
  ui.filter("PENDING");
  t.mock.timers.tick(15_000);
  await setImmediate();
  assert.deepEqual(ui.ids(), ["initial"]);
  assert.ok(elements(ui.view()).some((element) => element.props.message?.includes("请求超时")));
  ui.filter("DRAFT");
  await ui.finish(2, "retry");
  await ui.finish(1, "late");
  assert.deepEqual(ui.ids(), ["retry"]);
});
