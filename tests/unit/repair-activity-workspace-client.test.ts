import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";

import { clientDom, element, elements, mountClient, React } from "../support/react-client";

import { RepairActivityWorkspace } from "../../src/components/admin/RepairActivityWorkspace";
import { RepairActivityRegistrationsPanel } from "../../src/components/admin/RepairActivityRegistrationsPanel";
import { MemberRepairActivityBoard } from "../../src/components/repair-activities/MemberRepairActivityBoard";
import type { RepairActivityPublicView } from "../../src/features/repair-activities/repair-activity-service";

const require = createRequire(import.meta.url);
const { SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");

function mount(t: TestContext, canAdmin = true, tab = "board") {
  const dom = clientDom();
  let location = new URL(
    `http://localhost/admin/repair-activities/activity?keep=1&tab=${tab}#details`,
  );
  const history = [location.href];
  let position = 0;
  const focused: string[] = [];
  const scrolls: number[] = [];
  const window = Object.assign(dom.window, {
    scrollY: 0,
    scrollTo({ top }: { top: number }) {
      window.scrollY = top;
      scrolls.push(top);
    },
    history: {
      pushState(_state: unknown, _unused: string, url: URL) {
        location = new URL(url);
        history.splice(++position, Infinity, location.href);
      },
      back() {
        location = new URL(history[--position]);
        window.dispatchEvent(new Event("popstate"));
      },
    },
  });
  Object.defineProperty(window, "location", { configurable: true, get: () => location });
  Object.assign(dom.document, {
    getElementById(id: string) {
      return { focus: () => focused.push(id) };
    },
  });
  t.mock.method(React, "useContext", (context: unknown) => {
    assert.equal(context, SearchParamsContext);
    return new URLSearchParams(location.search);
  });
  t.mock.method(React, "useMemo", <T>(factory: () => T) => factory());
  const activity = {
    id: "activity",
    title: "测试活动",
    location: "测试现场",
    activityAt: "2026-11-13T08:00:00Z",
    endsAt: "2026-11-13T10:00:00Z",
    signupOpensAt: "2026-11-12T00:00:00Z",
    signupClosesAt: "2026-11-13T07:00:00Z",
    capacity: 20,
    registeredCount: 3,
    remaining: 17,
    status: "CLOSED",
  } as RepairActivityPublicView;
  const ui = mountClient(t, () => RepairActivityWorkspace({ activity, canAdmin }));
  t.after(() => {
    ui.unmount();
    dom.restore();
  });
  const panel = (name: string) =>
    element(ui.view(), (el) => el.props.id === `activity-panel-${name}`);
  const button = (name: string) =>
    element(ui.view(), (el) => el.props.id === `activity-tab-${name}`);
  ui.view();
  return { window, ui, panel, button, focused, scrolls, url: () => location };
}

test("对象页 ?tab 深链与切换保留查询、已访问面板及逐页签滚动，隐藏看板收到暂停状态", (t) => {
  const m = mount(t);
  const board = () => element(m.ui.view(), (el) => el.type === MemberRepairActivityBoard);
  assert.equal(m.button("board").props["aria-selected"], true);
  assert.equal(board().props.active, true);
  assert.equal(board().props.embedded, true);
  assert.equal(elements(m.ui.view(), (el) => el.props.role === "tabpanel").length, 1);

  m.window.scrollY = 640;
  m.window.dispatchEvent(new Event("scroll"));
  (m.button("registrations").props.onClick as () => void)();
  assert.equal(m.url().searchParams.get("tab"), "registrations");
  assert.equal(m.url().searchParams.get("keep"), "1");
  assert.equal(m.url().hash, "#details");
  assert.equal(m.panel("board").props.hidden, true);
  assert.equal(board().props.active, false);
  assert.equal(m.panel("registrations").props.hidden, false);
  assert.equal(
    element(m.ui.view(), (el) => el.type === RepairActivityRegistrationsPanel).props.active,
    true,
  );
  assert.equal(m.window.scrollY, 0);

  m.window.scrollY = 275;
  m.window.dispatchEvent(new Event("scroll"));
  (m.button("board").props.onClick as () => void)();
  assert.equal(m.panel("registrations").props.hidden, true);
  assert.equal(m.panel("board").props.hidden, false);
  assert.equal(board().props.active, true);
  assert.equal(m.window.scrollY, 640);
  assert.equal(elements(m.ui.view(), (el) => el.props.role === "tabpanel").length, 2);
  m.window.history.back();
  m.ui.view();
  assert.equal(m.button("registrations").props["aria-selected"], true);
  assert.equal(m.window.scrollY, 275);
  assert.equal(board().props.active, false);
});

test("成员管理页签深链回到概览，方向键仅在允许页签间切换并移动焦点", (t) => {
  const m = mount(t, false, "registrations");
  assert.equal(m.button("overview").props["aria-selected"], true);
  assert.equal(elements(m.ui.view(), (el) => el.props.role === "tab").length, 2);
  const key = (tab: string, value: string) => {
    let prevented = false;
    (m.button(tab).props.onKeyDown as (event: unknown) => void)({
      key: value,
      preventDefault: () => (prevented = true),
    });
    m.ui.view();
    assert.equal(prevented, true);
  };
  key("overview", "End");
  assert.equal(m.button("board").props["aria-selected"], true);
  assert.equal(m.focused.at(-1), "activity-tab-board");
  key("board", "ArrowRight");
  assert.equal(m.button("overview").props["aria-selected"], true);
  key("overview", "ArrowLeft");
  assert.equal(m.button("board").props["aria-selected"], true);
  key("board", "Home");
  assert.equal(m.button("overview").props["aria-selected"], true);
});
