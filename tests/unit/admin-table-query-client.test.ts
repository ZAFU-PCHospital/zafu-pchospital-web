import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";
import type { ReactElement, ReactNode } from "react";
import { tableQueryOptions } from "../../src/config/table-queries";
import { emptyTableQuery, type TableQueryState } from "../../src/lib/table/query-state";
import type { QuickField, StatusTabs } from "../../src/lib/table/quick-query";

const require = createRequire(import.meta.url);
const React = require("react") as typeof import("react");
// tsx 以经典转换编译 TSX，组件模块里的 JSX 会查找全局 React。
(globalThis as unknown as { React: typeof React }).React = React;

type Props = { children?: ReactNode };
type Element = ReactElement<Record<string, unknown>>;

function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (React.isValidElement<Props>(node)) return text(node.props.children);
  return typeof node === "string" ? node : "";
}

function findElement(
  node: ReactNode,
  predicate: (element: Element) => boolean,
): Element | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
  } else if (React.isValidElement<Record<string, unknown>>(node)) {
    if (predicate(node)) return node;
    return findElement(node.props.children as ReactNode, predicate);
  }
}

function findAll(node: ReactNode, predicate: (element: Element) => boolean): Element[] {
  const found: Element[] = [];
  if (Array.isArray(node)) {
    for (const child of node) found.push(...findAll(child, predicate));
  } else if (React.isValidElement<Record<string, unknown>>(node)) {
    if (predicate(node)) found.push(node);
    found.push(...findAll(node.props.children as ReactNode, predicate));
  }
  return found;
}

function clickable(node: ReactNode, label: string): Element {
  const element = findElement(
    node,
    (candidate) =>
      typeof candidate.props.onClick === "function" &&
      text(candidate.props.children as ReactNode).includes(label),
  );
  assert.ok(element, `找不到「${label}」入口`);
  return element;
}

function clickableByClass(node: ReactNode, className: string): Element {
  const element = findElement(
    node,
    (candidate) =>
      typeof candidate.props.onClick === "function" &&
      typeof candidate.props.className === "string" &&
      candidate.props.className.includes(className),
  );
  assert.ok(element, `找不到 .${className}`);
  return element;
}

const quick: readonly QuickField[] = [
  { key: "query", label: "机主姓名 / 内容 / 备注 / 成员", placeholder: "搜索维修记录" },
  {
    key: "status",
    label: "审核状态",
    options: [
      { value: "DRAFT", label: "草稿" },
      { value: "PENDING", label: "待审核" },
      { value: "APPROVED", label: "已通过" },
      { value: "REJECTED", label: "已退回" },
    ],
  },
  {
    key: "categoryId",
    label: "故障分类",
    options: [{ value: "cat-1", label: "软件问题" }],
  },
];

const statusTabs: StatusTabs = {
  key: "status",
  label: "审核状态",
  options: [
    { value: "PENDING", label: "待审核" },
    { value: "APPROVED", label: "已通过" },
    { value: "REJECTED", label: "已退回" },
  ],
};

const baseValue = () =>
  emptyTableQuery<Record<string, string>>({ query: "", status: "", categoryId: "" });

async function mount(t: TestContext, initial: TableQueryState<Record<string, string>>) {
  const slots: unknown[] = [];
  const effects: { deps?: unknown[]; cleanup?: () => void }[] = [];
  const pending: (() => void)[] = [];
  let cursor = 0;
  let effectIndex = 0;
  let current = initial;
  const changes: TableQueryState<Record<string, string>>[] = [];
  let clearCount = 0;

  const changed = (old: unknown[] | undefined, next: unknown[] | undefined) =>
    !old ||
    !next ||
    old.length !== next.length ||
    old.some((value, index) => !Object.is(value, next[index]));

  t.mock.method(React, "useState", <S>(init: S | (() => S)) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof init === "function" ? (init as () => S)() : init;
    return [
      slots[index],
      (value: S | ((old: S) => S)) => {
        slots[index] =
          typeof value === "function" ? (value as (old: S) => S)(slots[index] as S) : value;
      },
    ];
  });
  t.mock.method(React, "useRef", <S>(init: S) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: init };
    return slots[index];
  });
  t.mock.method(React, "useEffect", (effect: () => void | (() => void), deps?: unknown[]) => {
    const index = effectIndex++;
    const previous = effects[index];
    if (previous && !changed(previous.deps, deps)) return;
    pending.push(() => {
      previous?.cleanup?.();
      const cleanup = effect();
      effects[index] = { deps, cleanup: typeof cleanup === "function" ? cleanup : undefined };
    });
  });
  t.mock.method(React, "useId", () => "test-query");

  const { AdminTableQuery } = await import("../../src/components/admin/AdminTableQuery");
  const view = () => {
    cursor = 0;
    effectIndex = 0;
    const node = AdminTableQuery({
      value: current,
      options: tableQueryOptions("repairs"),
      quick,
      statusTabs,
      onChange(next) {
        current = next;
        changes.push(next);
      },
      onClear() {
        clearCount++;
      },
      refreshing: false,
    });
    const queued = pending.splice(0);
    queued.forEach((run) => run());
    return node;
  };

  t.after(() => effects.forEach((slot) => slot.cleanup?.()));
  view();
  return { view, changes, clearCount: () => clearCount };
}

test("搜索：展开、Esc 归还焦点、提交 trim，输入法合成期不提交", async (t) => {
  const mounted = await mount(t, baseValue());
  let tree = mounted.view();
  const toggle = clickableByClass(tree, "admin-query__toggle");
  let toggleFocused = 0;
  (toggle.props.ref as { current: { focus(): void } }).current = {
    focus() {
      toggleFocused++;
    },
  };
  (toggle.props.onClick as () => void)();
  tree = mounted.view();

  let input = findElement(tree, (element) => element.type === "input");
  assert.ok(input);
  (input.props.onChange as (event: { target: { value: string } }) => void)({
    target: { value: " 屏幕 " },
  });
  tree = mounted.view();
  input = findElement(tree, (element) => element.type === "input");
  assert.ok(input);

  (input.props.onCompositionStart as () => void)();
  const form = findElement(tree, (element) => element.type === "form");
  assert.ok(form);
  const submit = form.props.onSubmit as (event: { preventDefault(): void }) => void;
  submit({ preventDefault() {} });
  assert.equal(mounted.changes.length, 0, "输入法合成期按 Enter 不应提交");

  (input.props.onCompositionEnd as () => void)();
  submit({ preventDefault() {} });
  assert.equal(mounted.changes.at(-1)?.fixed.query, "屏幕");

  tree = mounted.view();
  input = findElement(tree, (element) => element.type === "input");
  assert.ok(input);
  (input.props.onKeyDown as (event: unknown) => void)({
    key: "Escape",
    preventDefault() {},
    nativeEvent: { isComposing: false },
  });
  assert.equal(toggleFocused, 1, "Esc 收起后焦点应回到搜索入口");
});

test("状态页签只改 status，草稿不再作为一级页签或窄屏选项", async (t) => {
  const mounted = await mount(t, baseValue());
  const tree = mounted.view();
  (clickable(tree, "待审核").props.onClick as () => void)();
  assert.equal(mounted.changes.at(-1)?.fixed.status, "PENDING");

  const select = findElement(tree, (element) => element.type === "select");
  assert.ok(select);
  const options = findAll(
    select.props.children as ReactNode,
    (element) => element.type === "option",
  );
  assert.deepEqual(
    options.map((option) => option.props.value),
    ["", "PENDING", "APPROVED", "REJECTED"],
  );
  assert.ok(!options.some((option) => option.props.value === "DRAFT"));
});

test("条件 chip、完整条件弹窗与更多筛选都只修改对应字段", async (t) => {
  const initial = emptyTableQuery<Record<string, string>>({
    query: "",
    status: "PENDING",
    categoryId: "cat-1",
  });
  const mounted = await mount(t, initial);
  let tree = mounted.view();

  const removeStatus = findElement(
    tree,
    (element) =>
      typeof element.props["aria-label"] === "string" &&
      element.props["aria-label"].startsWith("移除 审核状态"),
  );
  assert.ok(removeStatus);
  (removeStatus.props.onClick as () => void)();
  assert.equal(mounted.changes.at(-1)?.fixed.status, "");

  tree = mounted.view();
  const valueButton = findElement(
    tree,
    (element) =>
      typeof element.props.onClick === "function" &&
      typeof element.props["aria-label"] === "string" &&
      element.props["aria-label"].startsWith("查看完整条件 故障分类"),
  );
  assert.ok(valueButton);
  (valueButton.props.onClick as () => void)();
  tree = mounted.view();
  const conditionModal = findElement(
    tree,
    (element) => (element.type as { name?: string }).name === "AdminModal",
  );
  assert.ok(conditionModal);
  const removeCondition = clickable(conditionModal, "移除该条件");
  (removeCondition.props.onClick as () => void)();
  assert.equal(mounted.changes.at(-1)?.fixed.categoryId, "");

  tree = mounted.view();
  (clickable(tree, "更多筛选").props.onClick as () => void)();
  tree = mounted.view();
  const moreDialog = findElement(
    tree,
    (element) => (element.type as { name?: string }).name === "QuickFiltersDialog",
  );
  assert.ok(moreDialog);
  (moreDialog.props.onApply as (values: Record<string, string>) => void)({
    categoryId: "cat-1",
  });
  assert.equal(mounted.changes.at(-1)?.fixed.categoryId, "cat-1");
  assert.equal(mounted.changes.at(-1)?.fixed.status, "");
});

test("清除筛选保留排序与分组", async (t) => {
  const initial = {
    ...emptyTableQuery<Record<string, string>>({
      query: "屏幕",
      status: "PENDING",
      categoryId: "",
    }),
    sort: [{ field: "repairDate", direction: "desc" as const }],
    groupBy: "status",
  };
  const mounted = await mount(t, initial);
  const tree = mounted.view();
  (clickable(tree, "清除筛选").props.onClick as () => void)();
  const next = mounted.changes.at(-1);
  assert.deepEqual(next?.sort, initial.sort);
  assert.equal(next?.groupBy, "status");
  assert.equal(next?.fixed.query, "");
  assert.equal(next?.fixed.status, "");
});
