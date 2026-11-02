import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { ReactNode } from "react";
import { clientDom, element, mountClient, React, text } from "../support/react-client";

async function toolbar(t: TestContext) {
  const dom = clientDom();
  const { AdminListToolbar } = await import("../../src/components/admin/AdminListToolbar");
  const root = new dom.Node(),
    select = new dom.Node(),
    cancel = new dom.Node();
  root.children = [select, cancel];
  root.querySelector = () => cancel;
  let selected: string[] = [];
  let onCancel = () => {};
  const state = { count: 6, refreshing: false, previous: false, busy: false, completed: 0 };
  const mounted = mountClient(
    t,
    () =>
      AdminListToolbar({
        count: state.count,
        refreshing: state.refreshing,
        previous: state.previous,
        selection: {
          count: selected.length,
          completed: state.completed,
          disabled: state.busy || state.refreshing,
          onClear: () => {
            selected = [];
          },
          renderTools: (handler) => {
            onCancel = handler;
            return React.createElement("div");
          },
        },
      }),
    (tree) => {
      const outer = element(
        tree,
        (e) =>
          (typeof e.props.className === "string" &&
            e.props.className.startsWith("admin-toolbar ")) ||
          e.props.className === "admin-toolbar",
      );
      (outer.props.ref as { current: unknown }).current = root;
      const button = element(tree, (e) => typeof e.props.onClick === "function");
      (button.props.ref as { current: unknown }).current = select;
      select.disabled = Boolean(button.props.disabled);
      select.visible = !(outer.props.className as string).includes("--selecting");
    },
  );
  t.after(() => {
    mounted.unmount();
    dom.restore();
  });
  const view = () => mounted.view();
  const active = () =>
    (
      element(
        view(),
        (e) =>
          typeof e.props.className === "string" && e.props.className.startsWith("admin-toolbar"),
      ).props.className as string
    ).includes("--selecting");
  view();
  return {
    ...dom,
    state,
    root,
    select,
    cancel,
    view,
    active,
    enter() {
      (element(view(), (e) => typeof e.props.onClick === "function").props.onClick as () => void)();
      view();
      dom.flushFrames();
    },
    selectIds(ids: string[]) {
      selected = ids;
      view();
    },
    clear() {
      onCancel();
      view();
      dom.flushFrames();
    },
  };
}

test("工具栏：选择入口、零选择、取消与焦点，直接勾选再清空仍可继续选择", async (t) => {
  const m = await toolbar(t);
  assert.equal(m.active(), false);
  m.enter();
  assert.equal(m.active(), true);
  assert.equal(m.document.activeElement, m.cancel);
  m.clear();
  assert.equal(m.active(), false);
  assert.equal(m.document.activeElement, m.select);
  m.selectIds(["one"]);
  assert.equal(m.active(), true);
  m.selectIds([]);
  assert.equal(m.active(), true, "手动清空不代表批量动作完成");
  m.clear();
  assert.equal(m.active(), false);
});

test("工具栏：成功信号才退出；失败/部分成功不退出，不打断外部焦点", async (t) => {
  const m = await toolbar(t);
  m.enter();
  m.selectIds(["one", "two"]);
  m.state.busy = true;
  m.view();
  m.clear();
  assert.equal(m.active(), true);
  m.state.busy = false;
  m.selectIds([]);
  assert.equal(m.active(), true);
  m.cancel.focus();
  m.state.completed++;
  m.view();
  m.flushFrames();
  assert.equal(m.active(), false);
  assert.equal(m.document.activeElement, m.select);
  m.enter();
  const outside = new m.Node();
  outside.focus();
  m.state.completed++;
  m.view();
  m.flushFrames();
  assert.equal(m.active(), false);
  assert.equal(m.document.activeElement, outside);
});

test("工具栏：空结果/刷新/忙碌禁用，数量和旧结果口径明确", async (t) => {
  const m = await toolbar(t);
  for (const state of [{ count: 0 }, { refreshing: true }, { busy: true }]) {
    Object.assign(m.state, { count: 6, refreshing: false, busy: false }, state);
    m.view();
    assert.equal(m.select.disabled, true);
  }
  m.state.busy = false;
  m.state.refreshing = false;
  m.state.previous = true;
  assert.ok(text(m.view()).includes("上次 6 条"));
  m.state.previous = false;
  assert.ok(text(m.view()).includes("共 6 条"));
});

test("批量工具：全选回调只交给已加载范围、半选、零选择与忙碌禁用", async (t) => {
  const dom = clientDom();
  const { AdminBatchTools } = await import("../../src/components/admin/AdminBatchTools");
  const checkbox = new dom.Node();
  let selected: string[] = [];
  const loaded = ["one", "two", "three"];
  const state = { disabled: false, empty: false };
  const mounted = mountClient(
    t,
    () =>
      AdminBatchTools({
        allSelected: selected.length === loaded.length,
        count: selected.length,
        selectAllLabel: "全选已加载",
        selectedLabel: "已选择 {count} 条",
        noneLabel: "未选择记录",
        clearLabel: "取消选择",
        onSelectAll: (checked) => {
          selected = checked ? [...loaded] : [];
        },
        onClear: () => {
          selected = [];
        },
        actions: null,
        ...state,
      }),
    (tree) => {
      (element(tree, (e) => e.type === "input").props.ref as { current: unknown }).current =
        checkbox;
    },
  );
  t.after(() => {
    mounted.unmount();
    dom.restore();
  });
  let tree: ReactNode = mounted.view();
  assert.ok(text(tree).includes("已选 0 项"));
  (element(tree, (e) => e.type === "input").props.onChange as (e: unknown) => void)({
    currentTarget: { checked: true },
  });
  tree = mounted.view();
  assert.deepEqual(selected, loaded);
  assert.ok(text(tree).includes("已选 3 项"));
  assert.equal(checkbox.indeterminate, false);
  selected = ["two"];
  mounted.view();
  assert.equal(checkbox.indeterminate, true);
  state.disabled = true;
  tree = mounted.view();
  assert.equal(element(tree, (e) => e.type === "input").props.disabled, true);
  assert.equal(
    element(
      tree,
      (e) => typeof e.props.className === "string" && e.props.className.includes("cancel-mobile"),
    ).props.disabled,
    true,
  );
  state.disabled = false;
  state.empty = true;
  tree = mounted.view();
  assert.equal(element(tree, (e) => e.type === "input").props.disabled, true);
});
