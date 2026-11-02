import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { ReactNode } from "react";
import {
  clientDom,
  element,
  elements,
  keyEvent,
  mountClient,
  ReactDOM,
  text,
} from "../support/react-client";

async function mount(t: TestContext) {
  const dom = clientDom();
  t.mock.method(
    ReactDOM,
    "createPortal",
    ((node: ReactNode) => node) as typeof ReactDOM.createPortal,
  );
  const { ActionMenu } = await import("../../src/components/ui/ActionMenu");
  const trigger = new dom.Node(),
    panel = new dom.Node(),
    csv = new dom.Node(),
    xlsx = new dom.Node(),
    skipped = new dom.Node(),
    next = new dom.Node(),
    root = new dom.Node();
  skipped.disabled = true;
  panel.children = [csv, skipped, xlsx];
  root.children = [trigger];
  trigger.parent = root;
  dom.document.querySelectorAll = () => [trigger, csv, skipped, xlsx, next];
  let selected = "";
  const props = {
    label: "导出",
    title: "导出当前筛选的全部结果",
    disabled: false,
    items: [
      {
        label: "CSV",
        onSelect: () => {
          selected = "csv";
        },
      },
      { label: "不可用", disabled: true, onSelect: () => assert.fail("禁用项不能执行") },
      {
        label: "XLSX",
        onSelect: () => {
          selected = "xlsx";
        },
      },
    ],
  };
  const mounted = mountClient(
    t,
    () => ActionMenu(props),
    (tree) => {
      const button = element(tree, (e) => e.props.className === "action-menu__trigger");
      (button.props.ref as { current: unknown }).current = trigger;
      trigger.disabled = props.disabled;
      const floating = elements(tree, (e) => e.props.className === "action-menu__panel")[0];
      if (floating) (floating.props.ref as { current: unknown }).current = panel;
    },
  );
  t.after(() => {
    mounted.unmount();
    dom.restore();
  });
  const view = () => mounted.view();
  const toggle = () =>
    (
      element(view(), (e) => e.props.className === "action-menu__trigger").props
        .onClick as () => void
    )();
  const key = (value: string, shift = false) => {
    const event = keyEvent(value, panel, shift);
    (
      element(view(), (e) => e.props.className === "action-menu__panel").props.onKeyDown as (
        event: unknown,
      ) => void
    )(event);
    view();
    return event;
  };
  view();
  return {
    ...dom,
    view,
    toggle,
    key,
    props,
    trigger,
    panel,
    csv,
    xlsx,
    next,
    root,
    selected: () => selected,
  };
}

test("无 Popover API：初始无面板，点击打开，标题在 menu 外，动作前归还焦点", async (t) => {
  const m = await mount(t);
  assert.equal("showPopover" in m.Node.prototype, false);
  assert.equal(elements(m.view(), (e) => e.props.role === "menu").length, 0);
  m.toggle();
  const tree = m.view();
  assert.equal(m.document.activeElement, m.csv);
  const menu = element(tree, (e) => e.props.role === "menu");
  assert.equal(elements(menu.props.children as ReactNode, (e) => e.type === "p").length, 0);
  assert.equal(menu.props["aria-labelledby"], "test-menu-title");
  (
    element(
      tree,
      (e) => e.props.role === "menuitem" && text(e.props.children as ReactNode) === "XLSX",
    ).props.onClick as () => void
  )();
  assert.equal(m.selected(), "xlsx");
  assert.equal(m.document.activeElement, m.trigger);
  assert.equal(elements(m.view(), (e) => e.props.role === "menu").length, 0);
});

test("键盘打开、跳过禁用项、首末跳转、Esc、Tab 与 Shift+Tab", async (t) => {
  const m = await mount(t);
  const opening = keyEvent("ArrowUp", m.trigger);
  (
    element(m.view(), (e) => e.props.className === "action-menu__trigger").props.onKeyDown as (
      e: unknown,
    ) => void
  )(opening);
  m.view();
  assert.equal(m.document.activeElement, m.xlsx);
  m.key("ArrowDown");
  assert.equal(m.document.activeElement, m.csv);
  m.key("ArrowDown");
  assert.equal(m.document.activeElement, m.xlsx);
  m.key("Home");
  assert.equal(m.document.activeElement, m.csv);
  m.key("End");
  assert.equal(m.document.activeElement, m.xlsx);
  const escape = m.key("Escape");
  assert.ok(escape.prevented && escape.stopped);
  assert.equal(m.document.activeElement, m.trigger);
  m.toggle();
  m.view();
  m.key("Tab");
  assert.equal(m.document.activeElement, m.next);
  m.toggle();
  m.view();
  m.key("Tab", true);
  assert.equal(m.document.activeElement, m.trigger);
});

test("外部点击/焦点不抢目标；滚动/缩放归还焦点，内部滚动不关闭", async (t) => {
  const m = await mount(t);
  for (const [target, type] of [
    [m.document, "scroll"],
    [m.window, "resize"],
    [m.viewport, "resize"],
    [m.viewport, "scroll"],
  ] as const) {
    m.toggle();
    m.view();
    m.dispatch(target, type);
    m.view();
    assert.equal(m.document.activeElement, m.trigger);
    assert.equal(elements(m.view(), (e) => e.props.role === "menu").length, 0);
  }
  m.toggle();
  m.view();
  const internalScroll = new Event("scroll");
  Object.defineProperty(internalScroll, "target", { value: m.panel });
  m.document.dispatchEvent(internalScroll);
  assert.equal(elements(m.view(), (e) => e.props.role === "menu").length, 1);
  const outside = new Event("pointerdown");
  Object.defineProperty(outside, "target", { value: m.next });
  m.document.dispatchEvent(outside);
  m.next.focus();
  m.view();
  assert.equal(m.document.activeElement, m.next);
  m.toggle();
  m.view();
  m.next.focus();
  const focus = new Event("focusin");
  Object.defineProperty(focus, "target", { value: m.next });
  m.document.dispatchEvent(focus);
  m.view();
  assert.equal(m.document.activeElement, m.next);
});

test("disabled 阻止打开并关闭已打开菜单，不能聚焦禁用按钮时回到容器", async (t) => {
  const m = await mount(t);
  m.toggle();
  m.view();
  m.props.disabled = true;
  m.view();
  assert.equal(m.document.activeElement, m.root);
  m.toggle();
  assert.equal(elements(m.view(), (e) => e.props.role === "menu").length, 0);
});
