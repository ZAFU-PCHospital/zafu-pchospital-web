import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import type { ReactElement, ReactNode } from "react";
import { memberRepairActivitiesCopy } from "../../src/config/repair-activities";
import type {
  StaffBoardView,
  StaffRegistrationView,
} from "../../src/features/repair-activities/repair-activity-staff-service";

const require = createRequire(import.meta.url);
const React = require("react") as typeof import("react");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const copy = memberRepairActivitiesCopy.board;
const end = new Date("2026-10-23T16:00:00.000Z");
type Props = {
  children?: ReactNode;
  disabled?: boolean;
  checked?: boolean;
  type?: string;
  className?: string;
  message?: string;
  title?: string;
  busy?: boolean;
  confirmDisabled?: boolean;
  onClick?: () => void;
  onChange?: (event?: { target: { value: string } }) => void;
  onConfirm?: () => void;
  onClose?: () => void;
};
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (React.isValidElement<Props>(node)) return text(node.props.children);
  return typeof node === "string" ? node : "";
}
const row: StaffRegistrationView = {
  id: "registration",
  activityId: "activity",
  name: "隔离夹具",
  phoneMasked: "139****0000",
  issueType: "CLEAN_ONLY",
  issueTypeLabel: "清灰",
  deviceModel: null,
  status: "REGISTERED",
  checkedInAt: null,
  servedAt: null,
  repairRecordId: null,
  createdAt: "2026-10-23T00:00:00Z",
};
function board(attended = true): StaffBoardView {
  return {
    activity: {
      id: "activity",
      title: "隔离活动",
      activityAt: "2026-10-23T10:30:00Z",
      capacity: 10,
      signupOpensAt: "2026-10-22T00:00:00Z",
      signupClosesAt: "2026-10-23T04:00:00Z",
      status: "CLOSED",
      registeredCount: 3,
      remaining: 7,
      attended,
    },
    attended,
    attendanceCheckedInAt: attended ? "2026-10-23T05:00:00Z" : null,
    canAdmin: true,
    attendanceMembers: [],
    eligible: [row],
    queue: [{ ...row, id: "queue", status: "CHECKED_IN", checkedInAt: "2026-10-23T05:00:00Z" }],
    served: [
      {
        ...row,
        id: "served",
        status: "SERVED",
        repairRecordId: "draft",
        recordStatus: "DRAFT",
        canRevert: true,
        canFill: false,
      },
    ],
    pendingServeRegistration: null,
  };
}

/** 复用已有客户端测试的 Node hook 装置，运行真实看板 JSX 和事件；不启动浏览器或 DB。 */
async function mount(
  t: TestContext,
  data: StaffBoardView,
  now: Date,
  rejectEnded = false,
  desktop = true,
) {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now });
  const originals = ["window", "document"].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  const scrolls: number[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setInterval,
      clearInterval,
      matchMedia: () => ({ matches: desktop, addEventListener() {}, removeEventListener() {} }),
      scrollX: 0,
      scrollY: 0,
      scrollTo({ top }: { top: number }) {
        scrolls.push(top);
        window.scrollY = top;
      },
      addEventListener() {},
      removeEventListener() {},
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      visibilityState: "visible",
      addEventListener() {},
      removeEventListener() {},
    },
  });
  (globalThis as unknown as { React: typeof React }).React = React;
  const slots: unknown[] = [];
  const effectSlots: { deps?: unknown[]; cleanup?: () => void }[] = [];
  const pendingEffects: { index: number; effect: () => void | (() => void) }[] = [];
  const callbackSlots: { deps?: unknown[]; callback: unknown }[] = [];
  let cursor = 0,
    effectCursor = 0,
    callbackCursor = 0,
    mounted = false;
  const depsChanged = (previous: unknown[] | undefined, next: unknown[] | undefined) =>
    !previous ||
    !next ||
    previous.length !== next.length ||
    previous.some((value, index) => !Object.is(value, next[index]));
  const runEffect = (effect: () => void | (() => void)): (() => void) | undefined => {
    const cleanup = effect();
    return typeof cleanup === "function" ? cleanup : undefined;
  };
  t.mock.method(React, "useState", <S>(initial: S | (() => S)) => {
    const index = cursor++;
    if (!(index in slots))
      slots[index] = typeof initial === "function" ? (initial as () => S)() : initial;
    return [
      slots[index],
      (value: S | ((old: S) => S)) => {
        slots[index] =
          typeof value === "function" ? (value as (old: S) => S)(slots[index] as S) : value;
      },
    ];
  });
  t.mock.method(React, "useRef", <T>(initial: T) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  });
  const effectHook = (effect: () => void | (() => void), deps?: unknown[]) => {
    const index = effectCursor++;
    if (!mounted) {
      effectSlots[index] = { deps };
      pendingEffects.push({ index, effect });
      return;
    }
    const previous = effectSlots[index];
    if (previous && !depsChanged(previous.deps, deps)) return;
    previous?.cleanup?.();
    effectSlots[index] = { deps, cleanup: runEffect(effect) };
  };
  t.mock.method(React, "useEffect", effectHook);
  t.mock.method(React, "useLayoutEffect", effectHook);
  t.mock.method(React, "useMemo", (factory: () => unknown, deps?: unknown[]) => {
    const index = callbackCursor++;
    if (!callbackSlots[index] || depsChanged(callbackSlots[index].deps, deps))
      callbackSlots[index] = { deps, callback: factory() };
    return callbackSlots[index].callback;
  });
  t.mock.method(React, "useCallback", (callback: unknown, deps?: unknown[]) => {
    const index = callbackCursor++;
    if (!callbackSlots[index] || depsChanged(callbackSlots[index].deps, deps))
      callbackSlots[index] = { deps, callback };
    return callbackSlots[index].callback;
  });
  t.mock.method(React, "useContext", (context: unknown) => {
    assert.equal(context, AppRouterContext);
    return { push() {}, refresh() {} };
  });
  let currentActivityId = "activity";
  let networkFailure = false;
  const reads: { view: string; at: number }[] = [];
  let postResponse: (() => Promise<Response>) | null = null;
  const posts: string[] = [];
  let gets = 0;
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push(String(input));
      if (postResponse) return postResponse();
      assert.ok(rejectEnded, "截止后不能发出写请求");
      return Response.json(
        { success: false, error: { code: "ACTIVITY_ENDED", message: "server" } },
        { status: 404 },
      );
    }
    gets += 1;
    const view = new URL(String(input), "http://localhost").searchParams.get("view") ?? "full";
    reads.push({ view, at: Date.now() });
    if (networkFailure) throw new Error("isolated network failure");
    const result =
      view === "served"
        ? { served: data.served }
        : view === "attendance"
          ? { attendanceMembers: data.attendanceMembers }
          : {
              ...data,
              servedCount: data.served.length,
              attendanceCount: data.canAdmin ? data.attendanceMembers.length : null,
            };
    return Response.json({ success: true, data: result });
  });
  const { MemberRepairActivityBoard } =
    await import("../../src/components/repair-activities/MemberRepairActivityBoard");
  const view = () => {
    cursor = 0;
    effectCursor = 0;
    callbackCursor = 0;
    return MemberRepairActivityBoard({ activityId: currentActivityId });
  };
  view();
  mounted = true;
  for (const { index, effect } of pendingEffects) {
    effectSlots[index].cleanup = runEffect(effect);
  }
  t.after(() => {
    for (const slot of effectSlots) slot.cleanup?.();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  await setImmediate();
  view();
  await setImmediate();
  function button(label: string) {
    const found = elements(view()).find(
      (element) => typeof element.type !== "string" && element.props.children === label,
    );
    assert.ok(found, `Missing button: ${label}`);
    return found.props;
  }
  function dialog() {
    return elements(view()).find((element) => element.props.title === copy.checkInConfirmTitle)
      ?.props;
  }
  return {
    scrolls,
    setScroll: (top: number) => {
      window.scrollY = top;
    },
    replyToPost: (reply: () => Promise<Response>) => {
      postResponse = reply;
    },
    switchActivity: (id: string) => {
      currentActivityId = id;
      return view();
    },
    failReads: (fail: boolean) => {
      networkFailure = fail;
    },
    reads,
    view,
    button,
    dialog,
    posts,
    gets: () => gets,
    elements: () => elements(view()),
  };
}

test("结束的看板保留历史、出勤状态和纠错，三项控件禁用且不误报尚未截止", async (t) => {
  const data = board(false);
  const ui = await mount(t, data, end);
  assert.equal(ui.button(copy.attendCta).disabled, true);
  assert.equal(ui.button(copy.checkIn).disabled, true);
  assert.equal(ui.button(copy.serve).disabled, true);
  assert.equal(
    ui.elements().find((element) => element.props.type === "checkbox")?.props.disabled,
    true,
  );
  assert.ok(text(ui.view()).includes(copy.activityEnded));
  assert.equal(text(ui.view()).includes(copy.signupNotClosed), false);
  data.attended = true;
  t.mock.timers.tick(5_000);
  await setImmediate();
  assert.ok(text(ui.view()).includes(copy.attendedBadge));
  assert.equal(ui.button(copy.withdraw).disabled, false);
  assert.equal(ui.button(copy.revertServe).disabled, undefined);
  assert.equal(
    ui
      .elements()
      .some(
        (element) =>
          element.props.className === "activity-board__panes activity-board__panes--admin",
      ),
    true,
  );
  assert.deepEqual(ui.posts, []);
});

test("报名截止但活动未结束时，工作台状态显示「可出勤」而不是「报名截止」（issue #239）", async (t) => {
  const ui = await mount(t, board(), new Date(end.getTime() - 60_000));
  assert.ok(text(ui.view()).includes("可出勤"));
  assert.equal(text(ui.view()).includes("报名截止"), false);
});

test("工作台搜索匹配公开给操作者的字段、保留真实位次和被筛选隐藏的签到选择", async (t) => {
  const data = board();
  data.queue.push({
    ...data.queue[0],
    id: "queue-two",
    name: "测试客户二",
    phoneMasked: "138****7621",
    deviceModel: "ThinkPad X1",
  });
  const ui = await mount(t, data, new Date(end.getTime() - 60_000));
  ui.elements().find((element) => element.props.type === "checkbox")!.props.onChange!();
  const search = (value: string) =>
    ui.elements().find((element) => element.props.type === "search")!.props.onChange!({
      target: { value },
    });
  search("７６２１ thinkpad");
  const filtered = text(ui.view());
  assert.ok(filtered.includes("测试客户二") && filtered.includes("第2位"));
  assert.ok(!filtered.includes("第1位"));
  assert.ok(filtered.includes("已选 1 人（含未显示的 1 人）"));
  assert.equal(ui.button(copy.checkIn).disabled, false);
  search("1387621");
  assert.ok(!text(ui.view()).includes("测试客户二"));
  search("");
  assert.equal(
    ui.elements().find((element) => element.props.type === "checkbox")?.props.checked,
    true,
  );
});

test("手机整页滚动在切换分区和首次加载历史后恢复对应浏览位置", async (t) => {
  const ui = await mount(t, board(), new Date(end.getTime() - 60_000), false, false);
  function switchTo(label: string) {
    ui
      .elements()
      .find(
        (element) =>
          element.props.className === "activity-board__seg-btn" &&
          text(element.props.children).includes(label),
      )!.props.onClick!();
    ui.view();
  }
  switchTo(copy.queueTitle);
  ui.setScroll(700);
  switchTo(copy.servedTitle);
  await setImmediate();
  ui.view();
  assert.equal(ui.scrolls.at(-1), 700);
  ui.setScroll(1250);
  switchTo(copy.queueTitle);
  assert.equal(ui.scrolls.at(-1), 700);
  switchTo(copy.servedTitle);
  assert.equal(ui.scrolls.at(-1), 1250);
});

for (const desktop of [true, false]) {
  for (const canAdmin of [true, false]) {
    test(`接待成员展示：${desktop ? "桌面" : "窄屏"} / ${canAdmin ? "管理员" : "成员"}`, async (t) => {
      const data = board();
      data.canAdmin = canAdmin;
      data.served[0].servedByName = "接待成员真实姓名";
      data.served.push({
        ...data.served[0],
        id: "pending",
        repairRecordId: null,
        recordStatus: null,
        servedByName: "较长的接待成员真实姓名用于换行展示",
      });
      data.served.push({ ...data.served[0], id: "unknown", servedByName: null });
      const ui = await mount(t, data, new Date(end.getTime() - 60_000), false, desktop);
      if (!desktop) {
        ui
          .elements()
          .find(
            (element) =>
              element.props.className === "activity-board__seg-btn" &&
              text(element.props.children).includes(copy.servedTitle),
          )!.props.onClick!();
        ui.view();
        await setImmediate();
      }
      const rendered = text(ui.view());
      assert.equal(rendered.includes("接待成员真实姓名"), canAdmin);
      assert.equal(rendered.includes("较长的接待成员真实姓名用于换行展示"), canAdmin);
      assert.equal(rendered.includes(copy.servedByUnknown), canAdmin);
      assert.equal(
        ui.elements().filter((element) => element.props.children === copy.servedBy).length,
        canAdmin ? 3 : 0,
      );
    });
  }
}

test("旧签到确认窗跨过结束上限不能提交，取消仍可用，既有看板不卸载", async (t) => {
  const ui = await mount(t, board(), new Date(end.getTime() - 1_000));
  ui.elements().find((element) => element.props.type === "checkbox")!.props.onChange!();
  ui.button(copy.checkIn).onClick!();
  const oldConfirm = ui.dialog()!;
  assert.equal(oldConfirm.confirmDisabled, false);
  // 不等真实午夜，也不依赖轮询先触发：旧事件处理器自己必须重查当前时间。
  t.mock.timers.tick(1_001);
  oldConfirm.onConfirm!();
  assert.deepEqual(ui.posts, []);
  assert.equal(ui.dialog()!.confirmDisabled, true);
  assert.equal(ui.dialog()!.busy, false);
  assert.equal(
    ui.elements().some((element) => element.props.className === "activity-board__attend-banner"),
    false,
    "截止反馈不能插入占位卡片",
  );
  assert.equal(
    ui.elements().some((element) => element.props.message === copy.activityEnded),
    true,
  );
  ui.dialog()!.onClose!();
  assert.equal(ui.dialog(), undefined);
  assert.equal(ui.button(copy.withdraw).disabled, false);
});

test("服务端先判定结束时保留看板并禁用操作，不伪报出勤成功或自动重试", async (t) => {
  const ui = await mount(t, board(false), new Date(end.getTime() - 60_000), true);
  ui.button(copy.attendCta).onClick!();
  await setImmediate();
  assert.equal(ui.posts.length, 1);
  assert.equal(ui.button(copy.attendCta).disabled, true);
  assert.equal(ui.button(copy.serve).disabled, true);
  assert.ok(text(ui.view()).includes(copy.activityEnded));
  assert.equal(text(ui.view()).includes(copy.attendedBadge), false);
});

test("结束后轮询节拍降为 60 秒，历史看板保留", async (t) => {
  const data = board(true);
  data.activity.status = "ENDED";
  const ui = await mount(t, data, end);
  // 初次加载判定结束后 effect 依赖变化会重建节拍；先让重建后的首轮刷新落定。
  ui.view();
  await setImmediate();
  const baseline = ui.gets();
  t.mock.timers.tick(5_000);
  await setImmediate();
  assert.equal(ui.gets(), baseline, "结束后不再按 5 秒节拍取数");
  t.mock.timers.tick(60_000);
  await setImmediate();
  assert.ok(ui.gets() > baseline, "60 秒节拍恢复刷新");
  assert.equal(
    ui.elements().some((element) => element.props.message === copy.activityEnded),
    true,
  );
});

test("自动失败可见、保留看板与勾选、退避恢复后回到 5 秒", async (t) => {
  const ui = await mount(t, board(), new Date(end.getTime() - 600_000));
  ui.elements().find((element) => element.props.type === "checkbox")!.props.onChange!();
  ui.failReads(true);
  const start = Date.now();
  const baseline = ui.reads.length;
  for (const duration of [5_000, 10_000, 20_000, 40_000]) {
    t.mock.timers.tick(duration);
    await setImmediate();
    ui.view();
  }
  assert.deepEqual(
    ui.reads
      .slice(baseline)
      .filter((read) => read.view === "live")
      .map((read) => read.at - start),
    [5_000, 15_000, 35_000, 75_000],
  );
  const statuses = ui
    .elements()
    .filter((element) => typeof element.type !== "string" && element.props.className === undefined);
  assert.ok(statuses.length > 0);
  assert.ok(text(ui.view()).includes("隔离活动"));
  assert.equal(
    ui.elements().find((element) => element.props.type === "checkbox")!.props.checked,
    true,
  );
  const sync = ui
    .elements()
    .find((element) => (element.props as { label?: string }).label === copy.queueSyncedAt)!;
  assert.equal((sync.props as { state: { failures: number } }).state.failures, 4);
  ui.failReads(false);
  ui.button(copy.refresh).onClick!();
  await setImmediate();
  ui.view();
  assert.equal(
    (
      ui
        .elements()
        .find((element) => (element.props as { label?: string }).label === copy.queueSyncedAt)!
        .props as { state: { failures: number } }
    ).state.failures,
    0,
  );
  const count = ui.reads.filter((read) => read.view === "live").length;
  t.mock.timers.tick(5_000);
  await setImmediate();
  assert.equal(ui.reads.filter((read) => read.view === "live").length, count + 1);
});

test("同实例切活动且新请求失败时不再显示旧场数据和勾选", async (t) => {
  const ui = await mount(t, board(), new Date(end.getTime() - 600_000));
  ui.elements().find((element) => element.props.type === "checkbox")!.props.onChange!();
  ui.failReads(true);
  ui.switchActivity("second");
  await setImmediate();
  assert.equal(text(ui.view()).includes("隔离活动"), false);
  assert.ok(ui.button(copy.retry));
});

test("桌面历史按 60 秒读取，出勤名单只在打开弹层时读取", async (t) => {
  const data = board();
  const ui = await mount(t, data, new Date(end.getTime() - 600_000));
  assert.equal(ui.reads.filter((read) => read.view === "attendance").length, 0);
  const baseline = ui.reads.filter((read) => read.view === "served").length;
  for (let i = 0; i < 11; i++) {
    t.mock.timers.tick(5_000);
    await setImmediate();
    ui.view();
  }
  assert.equal(ui.reads.filter((read) => read.view === "served").length, baseline);
  t.mock.timers.tick(5_000);
  await setImmediate();
  ui.view();
  assert.equal(ui.reads.filter((read) => read.view === "served").length, baseline + 1);
  ui.button(copy.attendanceEntry.replace("{count}", "0")).onClick!();
  await setImmediate();
  ui.view();
  assert.equal(ui.reads.filter((read) => read.view === "attendance").length, 1);
});

test("手机未显示已接待分区时不读取历史，切入后才读取", async (t) => {
  const ui = await mount(t, board(), new Date(end.getTime() - 600_000), false, false);
  assert.equal(
    ui.reads.some((read) => read.view === "served"),
    false,
  );
  const pane = ui
    .elements()
    .find(
      (element) =>
        element.props.className === "activity-board__seg-btn" &&
        text(element.props.children).includes(copy.servedTitle),
    )!;
  pane.props.onClick!();
  ui.view();
  await setImmediate();
  assert.equal(ui.reads.filter((read) => read.view === "served").length, 1);
});

test("旧活动写请求迟到的结束响应不污染新活动（含 A→B→A）", async (t) => {
  const ui = await mount(t, board(false), new Date(end.getTime() - 600_000));
  let resolve!: (response: Response) => void;
  ui.replyToPost(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  ui.button(copy.attendCta).onClick!();
  ui.switchActivity("second");
  await setImmediate();
  ui.view();
  await setImmediate();
  ui.switchActivity("activity");
  await setImmediate();
  ui.view();
  await setImmediate();
  resolve(
    Response.json(
      { success: false, error: { code: "ACTIVITY_ENDED", message: "old target" } },
      { status: 404 },
    ),
  );
  await setImmediate();
  ui.view();
  assert.equal(ui.button(copy.attendCta).disabled, false);
  assert.equal(text(ui.view()).includes(copy.activityEnded), false);
  assert.equal(
    ui.elements().some((element) => element.props.message === copy.activityEnded),
    false,
  );
});

test("签到成功但刷新失败的提示在恢复后解除，不残留失败浮条", async (t) => {
  const ui = await mount(t, board(), new Date(end.getTime() - 600_000));
  ui.replyToPost(async () => {
    ui.failReads(true);
    return Response.json({
      success: true,
      data: { checkedIn: [{ ...row, status: "CHECKED_IN" }] },
    });
  });
  ui.elements().find((element) => element.props.type === "checkbox")!.props.onChange!();
  ui.button(copy.checkIn).onClick!();
  ui.dialog()!.onConfirm!();
  await setImmediate();
  ui.view();
  await setImmediate();
  assert.equal(ui.posts.length, 1);
  assert.equal(
    ui.elements().some((element) => element.props.message === copy.checkInRefreshFailed),
    true,
  );
  ui.failReads(false);
  ui.button(copy.refresh).onClick!();
  await setImmediate();
  ui.view();
  assert.equal(
    ui.elements().some((element) => element.props.message === copy.checkInRefreshFailed),
    false,
  );
  assert.equal(ui.posts.length, 1, "恢复只重读，不能自动重放写请求");
});
