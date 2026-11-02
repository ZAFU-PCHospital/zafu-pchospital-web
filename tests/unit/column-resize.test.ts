import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { clientDom, mountClient, React } from "../support/react-client";
import { useColumnResize, type ColumnSpec } from "../../src/components/admin/useColumnResize";

const columns: ColumnSpec[] = [48, 100, 150, 110, 180, 84, 100, 156, 240].map((width, index) => ({
  id: index === 8 ? "actions" : `field-${index}`,
  label: String(index),
  width,
}));

function resize(
  t: TestContext,
  container = 984,
  options: { lastColumnMinWidth?: number; saved?: Record<string, number> } = {},
) {
  const dom = clientDom();
  const saved = new Map<string, string>();
  if (options.saved) saved.set("columns", JSON.stringify(options.saved));
  Object.assign(dom.window, {
    getComputedStyle: () => ({ display: "table-header-group" }),
    requestAnimationFrame: globalThis.requestAnimationFrame,
    localStorage: {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
    },
  });
  t.mock.method(React, "useMemo", <T>(compute: () => T, deps: readonly unknown[]) => {
    const ref = React.useRef<{ deps: readonly unknown[]; value: T } | null>(null);
    if (!ref.current || deps.some((value, index) => !Object.is(value, ref.current!.deps[index])))
      ref.current = { deps, value: compute() };
    return ref.current.value;
  });
  let current: ReturnType<typeof useColumnResize>;
  const colNodes = columns.map(() => ({ style: { width: "" } }));
  const wrap = { clientWidth: container };
  const table = {
    parentElement: wrap,
    tHead: {},
    querySelectorAll: () =>
      columns.map((_, index) => ({
        getBoundingClientRect: () => {
          const left = current.widths.slice(0, index).reduce((sum, width) => sum + width, 0);
          return { left, right: left + current.widths[index] };
        },
      })),
  };
  const mounted = mountClient(t, () => {
    current = useColumnResize({
      storageKey: "columns",
      columns,
      lastColumnMinWidth: options.lastColumnMinWidth,
    });
    return null;
  });
  t.after(() => {
    mounted.unmount();
    dom.restore();
  });
  mounted.view();
  current!.tableRef(table as unknown as HTMLTableElement);
  mounted.view();
  current!.colRefs.forEach((ref, index) => ref(colNodes[index] as unknown as HTMLTableColElement));
  return {
    api: () => current!,
    view: mounted.view,
    painted: () => colNodes.map((node) => Number.parseInt(node.style.width, 10)),
    stored: () => JSON.parse(saved.get("columns") ?? "{}") as Record<string, number>,
    setContainer(width: number) {
      wrap.clientWidth = width;
      dom.dispatch(dom.window, "resize");
      mounted.view();
    },
    key(index: number, key: string, shiftKey = false) {
      const props = current!.lineProps(columns[index].id, columns[index].label);
      props.onKeyDown({ key, shiftKey, preventDefault() {} } as Parameters<
        typeof props.onKeyDown
      >[0]);
      mounted.view();
    },
    drag(index: number, clientX: number) {
      let props = current!.lineProps(columns[index].id, columns[index].label);
      const right = current!.widths.slice(0, index + 1).reduce((sum, width) => sum + width, 0);
      const handle = {
        setPointerCapture() {},
        hasPointerCapture: () => true,
        releasePointerCapture() {},
      };
      props.onPointerDown({
        button: 0,
        clientX: right,
        pointerId: 1,
        currentTarget: handle,
        preventDefault() {},
      } as unknown as Parameters<typeof props.onPointerDown>[0]);
      mounted.view();
      props = current!.lineProps(columns[index].id, columns[index].label);
      props.onPointerMove({ clientX } as Parameters<typeof props.onPointerMove>[0]);
      dom.flushFrames();
      props.onPointerUp({ pointerId: 1, currentTarget: handle } as unknown as Parameters<
        typeof props.onPointerUp
      >[0]);
      mounted.view();
    },
  };
}

function assertWidths(widths: number[], container: number, tail = 176) {
  assert.equal(
    widths.reduce((sum, width) => sum + width, 0),
    container,
  );
  assert.ok(widths.slice(0, -1).every((width) => width >= 48));
  assert.ok(widths.at(-1)! >= tail);
}

test("操作列下限在984px容器与旧列宽偏好下生效，其余列不小于48px", (t) => {
  const view = resize(t, 984, {
    lastColumnMinWidth: 176,
    saved: Object.fromEntries(
      columns.map((column) => [column.id, column.id === "actions" ? 48 : column.width]),
    ),
  });
  assertWidths(view.api().widths, 984);
  assert.equal(view.api().widths.at(-1), 176);
  view.setContainer(1100);
  assertWidths(view.api().widths, 1100);
  view.setContainer(844);
  assertWidths(view.api().widths, 844);
  view.api().reset();
  view.view();
  assertWidths(view.api().widths, 844);
  assert.equal(view.stored().actions, 176);
});

test("拖动与键盘耗尽预算时保留操作列下限，Home和全表reset恢复有效列宽", (t) => {
  const view = resize(t, 1440, { lastColumnMinWidth: 176 });
  view.drag(1, 10000);
  assertWidths(view.api().widths, 1440);
  assert.equal(view.api().widths.at(-1), 176);
  assert.equal(view.painted().at(-1), 176);
  assert.equal(view.stored().actions, 176);
  view.key(1, "Home");
  assert.equal(view.api().widths[1], columns[1].width);
  assertWidths(view.api().widths, 1440);
  for (let index = 0; index < 40; index++) view.key(7, "ArrowRight", true);
  assertWidths(view.api().widths, 1440);
  assert.equal(view.api().widths.at(-1), 176);
  for (let index = 0; index < 40; index++) view.key(7, "ArrowLeft", true);
  assert.equal(view.api().widths[7], 48);
  assertWidths(view.api().widths, 1440);
  view.api().reset();
  view.view();
  assert.deepEqual(
    view.api().widths.slice(0, -1),
    columns.slice(0, -1).map((column) => column.width),
  );
  assertWidths(view.api().widths, 1440);
});

test("未指定操作列下限的既有消费者保持原列宽分配", (t) => {
  const view = resize(t);
  assert.deepEqual(
    view.api().widths.slice(0, -1),
    columns.slice(0, -1).map((column) => column.width),
  );
  assert.equal(view.api().widths.at(-1), 56);
});
