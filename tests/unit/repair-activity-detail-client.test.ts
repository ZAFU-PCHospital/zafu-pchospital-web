import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import type { ReactElement, ReactNode } from "react";
import type {
  RegistrationLookupView,
  RegistrationPublicView,
  RepairActivityPublicView,
} from "../../src/features/repair-activities/repair-activity-service";
import { repairActivitiesPage } from "../../src/config/repair-activities";
import { repairActivityIssueTypeLabels } from "../../src/features/repair-activities/repair-activity-validation";

const require = createRequire(import.meta.url);
const React = require("react") as typeof import("react");
type Props = { children?: ReactNode };
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (React.isValidElement<Props>(node)) return text(node.props.children);
  return typeof node === "string" ? node : "";
}

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | undefined {
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

function pageAlerts(node: ReactNode) {
  const alerts: ReactElement<{ message: string; closeLabel?: string; onClose?: () => void }>[] = [];
  const visit = (current: ReactNode) => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!React.isValidElement<Record<string, unknown>>(current)) return;
    const type = current.type as { name?: string } | string;
    if (typeof type === "function" && type.name === "PageAlert") {
      alerts.push(
        current as ReactElement<{ message: string; closeLabel?: string; onClose?: () => void }>,
      );
    }
    visit(current.props.children as ReactNode);
  };
  visit(node);
  return alerts;
}

function pageAlertText(node: ReactNode): string {
  return pageAlerts(node)
    .map((alert) => alert.props.message)
    .join("");
}

function queueElement(node: ReactNode) {
  return findElement(node, (element) => {
    const type = element.type as { name?: string } | string;
    return typeof type === "function" && type.name === "RepairActivityQueue";
  });
}
const activity: RepairActivityPublicView = {
  id: "a",
  title: "原活动",
  location: "学 3-301 活动室",
  capacity: 10,
  registeredCount: 2,
  remaining: 8,
  activityAt: "2026-10-24T10:00:00Z",
  // 缺结束时间的历史活动：排队 / 结束判定回退活动日次日 00:00（上海）。
  endsAt: null,
  signupOpensAt: "2026-10-24T04:00:00Z",
  signupClosesAt: "2026-10-24T09:00:00Z",
  status: "UPCOMING",
};
const registration: RegistrationPublicView = {
  id: "r1",
  activityId: "a",
  name: "测试客户",
  phoneMasked: "138****0000",
  issueType: "CLEAN_PASTE",
  deviceModel: "测试机型",
  status: "REGISTERED",
  createdAt: "2026-10-24T04:00:01Z",
};
const lookupRegistration: RegistrationLookupView = {
  ...registration,
  editToken: "edit-token",
  editTokenExpiresAt: "2026-10-24T05:00:00Z",
};

/** 与既有客户端测试相同的 hook 存储方式；只驱动真实 JSX/effect，不启动 Next 或 DB。 */
async function mount(
  t: TestContext,
  options: {
    device?: { submitted: boolean; registration: unknown } | "pending" | "error";
    draft?: unknown;
  } = {},
) {
  const originalCss = require.extensions[".css"];
  require.extensions[".css"] = (module) => {
    module.exports = {};
  };
  t.after(() => {
    if (originalCss) require.extensions[".css"] = originalCss;
    else delete require.extensions[".css"];
  });
  t.mock.timers.enable({
    apis: ["Date", "setInterval", "setTimeout"],
    now: new Date("2026-10-24T04:00:01Z"),
  });
  (globalThis as unknown as { React: typeof React }).React = React;
  const originals = ["window", "document"].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  const handlers = new Map<string, () => void>();
  const events = {
    addEventListener: (name: string, fn: () => void) => handlers.set(name, fn),
    removeEventListener: (name: string) => handlers.delete(name),
  };
  const document = { visibilityState: "visible", activeElement: null as unknown, ...events };
  const sessionStore = new Map<string, string>();
  const sessionStorage = {
    getItem: (key: string) => sessionStore.get(key) ?? null,
    setItem: (key: string, value: string) => sessionStore.set(key, String(value)),
    removeItem: (key: string) => sessionStore.delete(key),
  };
  const timeoutDelays: number[] = [];
  const recordTimeout = (handler: () => void, delay?: number) => {
    timeoutDelays.push(delay ?? 0);
    return setTimeout(handler, delay) as unknown as number;
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setInterval,
      clearInterval,
      setTimeout: recordTimeout,
      clearTimeout,
      sessionStorage,
      ...events,
    },
  });
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  const slots: unknown[] = [];
  const effects: { deps?: unknown[]; cleanup?: () => void }[] = [];
  const callbacks: { deps?: unknown[]; callback: unknown }[] = [];
  let cursor = 0,
    effectIndex = 0,
    callbackIndex = 0,
    id = "a";
  let pending: (() => void)[] = [];
  const changed = (old: unknown[] | undefined, next: unknown[] | undefined) =>
    !old ||
    !next ||
    old.length !== next.length ||
    old.some((value, i) => !Object.is(value, next[i]));
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
  t.mock.method(React, "useCallback", (callback: unknown, deps?: unknown[]) => {
    const index = callbackIndex++;
    if (!callbacks[index] || changed(callbacks[index].deps, deps))
      callbacks[index] = { deps, callback };
    return callbacks[index].callback;
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
  const requests: {
    url: string;
    init: RequestInit;
    signal: AbortSignal;
    finish(response: Response): void;
    fail(error: unknown): void;
  }[] = [];
  let formValues = new Map<string, string>();
  let deviceStatus: { submitted: boolean; registration: unknown } | "pending" | "error" = {
    submitted: false,
    registration: null,
  };
  const deviceDeferred: ((status: { submitted: boolean; registration: unknown }) => void)[] = [];
  t.mock.method(globalThis, "FormData", function () {
    return formValues;
  });
  t.mock.method(globalThis, "fetch", (url: string, init: RequestInit) => {
    // 设备状态查询（issue #304）每次挂载都会发一次：直接给出结果，不占用 requests 下标。
    if (String(url).endsWith("/registrations/device")) {
      if (deviceStatus === "error") return Promise.reject(new TypeError("network"));
      if (deviceStatus === "pending") {
        return new Promise<Response>((resolve) => {
          deviceDeferred.push((status) => resolve(Response.json({ success: true, data: status })));
        });
      }
      return Promise.resolve(Response.json({ success: true, data: deviceStatus }));
    }
    return new Promise<Response>((finish, fail) => {
      requests.push({ url, init, signal: init.signal as AbortSignal, finish, fail });
    });
  });
  const { RepairActivityDetail } =
    await import("../../src/components/repair-activities/RepairActivityDetail");
  const view = () => {
    cursor = effectIndex = callbackIndex = 0;
    const node = RepairActivityDetail({ activityId: id });
    const queue = pending;
    pending = [];
    queue.forEach((run) => run());
    return node;
  };
  t.after(() => {
    effects.forEach((slot) => slot.cleanup?.());
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  if (options.device) deviceStatus = options.device;
  if (options.draft !== undefined) {
    sessionStore.set(
      `zafu-pchospital:repair-activity-signup-draft:${id}`,
      typeof options.draft === "string" ? options.draft : JSON.stringify(options.draft),
    );
  }
  view();
  let signupNameNode: { focus(): void } | null = null;
  const stepElement = (index: 1 | 2 | 3) =>
    findElement(
      view(),
      (element) => element.props["aria-labelledby"] === `repair-activity-signup-step-${index}`,
    );
  const visibleStep = () => {
    for (const index of [1, 2, 3] as const) {
      if (stepElement(index)?.props.hidden === false) return index;
    }
    return null;
  };
  const clickInStep = (index: 1 | 2 | 3, label: string) => {
    const section = stepElement(index);
    assert.ok(section, `第 ${index} 步未渲染`);
    const button = findElement(
      section,
      (element) => element.props.children === label && typeof element.props.onClick === "function",
    );
    assert.ok(button, `第 ${index} 步找不到按钮「${label}」`);
    (button.props.onClick as () => void)();
    view();
  };
  const setDraftField = (field: string, value: string) => {
    const section = stepElement(3);
    assert.ok(section, "第三步未渲染");
    if (field === "issueType") {
      const select = findElement(
        section,
        (element) => element.type === "select" && element.props.name === "issueType",
      );
      assert.ok(select, "第三步没有故障类型选择");
      (select.props.onChange as (event: unknown) => void)({ target: { value } });
      return;
    }
    const input = findElement(section, (element) => element.props.name === field);
    assert.ok(input, `找不到字段 ${field}`);
    (input.props.onChange as (event: unknown) => void)({ target: { value } });
  };
  const fillSignupDraft = (overrides: Record<string, string> = {}) => {
    const values = {
      name: "测试客户",
      phone: "13800000000",
      issueType: "CLEAN_PASTE",
      deviceModel: "测试机型",
      ...overrides,
    };
    Object.entries(values).forEach(([field, value]) => setDraftField(field, value));
    view();
    const nameInput = findElement(
      stepElement(3) ?? [],
      (element) => element.props.id === "repair-activity-signup-name",
    );
    if (nameInput) {
      signupNameNode = {
        focus() {
          document.activeElement = signupNameNode;
        },
      };
      (nameInput.props.ref as { current: unknown }).current = signupNameNode;
    }
  };
  const agreeConsent = () => {
    const section = stepElement(2);
    assert.ok(section, "第二步未渲染");
    const checkbox = findElement(
      section,
      (element) => element.type === "input" && element.props.type === "checkbox",
    );
    assert.ok(checkbox, "第二步没有同意勾选框");
    (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
    view();
  };
  const startWizard = () => {
    const section = stepElement(1);
    assert.ok(section, "第一步未渲染");
    const button = findElement(
      section,
      (element) =>
        (element.props.children === repairActivitiesPage.detail.startSignup ||
          element.props.children === repairActivitiesPage.detail.continueSignup) &&
        typeof element.props.onClick === "function",
    );
    assert.ok(button, "第一步没有开始报名按钮");
    (button.props.onClick as () => void)();
    view();
  };
  const signupFormInStep = () => {
    const section = stepElement(3);
    assert.ok(section, "第三步未渲染");
    return findElement(
      section,
      (element) =>
        element.type === "form" &&
        element.props["aria-label"] === repairActivitiesPage.detail.signupTitle,
    );
  };
  const openSignupForm = (overrides: Record<string, string> = {}) => {
    if (visibleStep() === 1) startWizard();
    if (visibleStep() === 2) {
      agreeConsent();
      clickInStep(2, repairActivitiesPage.detail.nextStep);
    }
    fillSignupDraft(overrides);
    const form = signupFormInStep();
    assert.ok(form, "第三步没有报名表单");
    return form;
  };
  const submitForm = () => {
    const form = signupFormInStep();
    assert.ok(form, "第三步没有报名表单");
    (form.props.onSubmit as (event: unknown) => void)({
      preventDefault() {},
      currentTarget: {},
    });
    view();
  };
  const storedDraft = (activityId = id) => {
    const raw = sessionStore.get(`zafu-pchospital:repair-activity-signup-draft:${activityId}`);
    return raw ? (JSON.parse(raw) as Record<string, string>) : null;
  };
  return {
    view,
    requests,
    timeoutDelays,
    stepElement,
    visibleStep,
    clickInStep,
    agreeConsent,
    openSignupForm,
    submitForm,
    submitSignup(overrides: Record<string, string> = {}) {
      openSignupForm(overrides);
      submitForm();
      const index = requests.findLastIndex((request) => request.init.method === "POST");
      assert.ok(index >= 0, "提交后应发出报名 POST");
      return { index, request: requests[index] };
    },
    activeElement: () => document.activeElement,
    signupNameNode: () => signupNameNode,
    storedDraft,
    requestLookup(phone: string) {
      const form = findElement(
        view(),
        (element) => element.props["aria-label"] === repairActivitiesPage.detail.lookupTitle,
      );
      assert.ok(form);
      formValues = new Map([
        ["name", "测试客户"],
        ["phone", phone],
      ]);
      (form.props.onSubmit as (event: unknown) => void)({
        preventDefault() {},
        currentTarget: {},
      });
    },
    setDeviceStatus(status: { submitted: boolean; registration: unknown } | "pending" | "error") {
      deviceStatus = status;
    },
    resolveDevice(index: number, status: { submitted: boolean; registration: unknown }) {
      const resolve = deviceDeferred[index];
      if (!resolve) throw new Error(`没有第 ${index} 个待决设备请求`);
      resolve(status);
    },
    devicePendingCount: () => deviceDeferred.length,
    changeId(value: string) {
      id = value;
      view();
    },
    visibility(value: string) {
      document.visibilityState = value;
      handlers.get("visibilitychange")?.();
    },
    focus() {
      handlers.get("focus")?.();
    },
    async finish(index: number, data: RepairActivityPublicView | null) {
      requests[index].finish(
        data
          ? Response.json({ success: true, data })
          : Response.json({ success: false, error: { code: "INTERNAL_ERROR" } }, { status: 500 }),
      );
      await setImmediate();
    },
  };
}

test("活动轮询慢请求不叠加，隐藏时暂停，迟到响应与失败不覆盖已有内容", async (t) => {
  const ui = await mount(t);
  await ui.finish(0, activity);
  ui.view(); // 倒计时已归零，但服务端仍返回 UPCOMING，启动 30 秒复查。
  assert.equal(ui.requests.length, 2);
  t.mock.timers.tick(90_000);
  assert.equal(ui.requests.length, 2, "三个轮询节拍仍共用唯一在途请求");
  ui.visibility("hidden");
  assert.equal(ui.requests[1].signal.aborted, true);
  t.mock.timers.tick(90_000);
  assert.equal(ui.requests.length, 2);
  ui.visibility("visible");
  assert.equal(ui.requests.length, 3);
  await ui.finish(1, { ...activity, title: "已失效响应", status: "OPEN" });
  assert.equal(text(ui.view()).includes("已失效响应"), false);
  await ui.finish(2, null);
  assert.ok(text(ui.view()).includes("原活动"), "后台失败保留原内容");
  ui.focus();
  assert.equal(ui.requests.length, 4);
  await ui.finish(3, { ...activity, title: "最新活动", status: "OPEN" });
  assert.ok(text(ui.view()).includes("最新活动"));
  t.mock.timers.tick(60_000);
  assert.equal(ui.requests.length, 4, "状态已开放，停止等待开放的轮询");
});

test("排队区块只在活动开始后、活动自然日结束前渲染", async (t) => {
  const ui = await mount(t);
  await ui.finish(0, {
    ...activity,
    activityAt: "2026-10-24T10:00:00Z",
    signupOpensAt: "2026-10-24T04:00:00Z",
    signupClosesAt: "2026-10-24T09:00:00Z",
    status: "UPCOMING",
  });
  assert.equal(queueElement(ui.view()), undefined);
  // 倒计时归零后组件自动复查状态；用它进入活动进行中的响应。
  await ui.finish(1, {
    ...activity,
    activityAt: "2026-10-24T03:00:00Z",
    signupOpensAt: "2026-10-23T04:00:00Z",
    signupClosesAt: "2026-10-24T02:00:00Z",
    status: "CLOSED",
  });
  assert.ok(queueElement(ui.view()));

  // 当前测试时钟为 04:00:01Z，活动上海自然日结束于 16:00:00Z。
  t.mock.timers.tick(12 * 60 * 60 * 1000);
  assert.equal(queueElement(ui.view()), undefined);
});

test("排队区块在活动开始边界由定时器显示", async (t) => {
  const ui = await mount(t);
  await ui.finish(0, {
    ...activity,
    activityAt: "2026-10-24T10:00:00Z",
    signupOpensAt: "2026-10-23T04:00:00Z",
    signupClosesAt: "2026-10-24T09:00:00Z",
    status: "CLOSED",
  });
  assert.equal(queueElement(ui.view()), undefined);

  // 状态已是 CLOSED，不会再有倒计时重取；只能由开始边界的定时器切到可见。
  t.mock.timers.tick(6 * 60 * 60 * 1000);
  assert.ok(queueElement(ui.view()));
});

test("远期活动跨过 setTimeout 上限后仍按链路显示排队", async (t) => {
  const ui = await mount(t);
  const day = 24 * 60 * 60 * 1000;
  const start = Date.parse("2026-10-24T04:00:01Z") + 30 * day;
  await ui.finish(0, {
    ...activity,
    activityAt: new Date(start).toISOString(),
    signupOpensAt: new Date(start - 5 * day).toISOString(),
    signupClosesAt: new Date(start - day).toISOString(),
    status: "CLOSED",
  });
  assert.equal(queueElement(ui.view()), undefined);
  assert.ok(ui.timeoutDelays.length >= 2);
  assert.ok(ui.timeoutDelays.every((delay) => delay <= 2_147_483_647));

  // 超过浏览器约 24.8 天的最大 setTimeout；链式重排不能提前显示。
  t.mock.timers.tick(2_147_483_647);
  assert.equal(queueElement(ui.view()), undefined);

  t.mock.timers.tick(30 * day - 2_147_483_647 + 1_000);
  assert.ok(queueElement(ui.view()));

  // 继续跨过活动上海自然日结束点后移除。
  t.mock.timers.tick(day);
  assert.equal(queueElement(ui.view()), undefined);
});

test("切换活动会使旧请求失效，旧活动响应不能覆盖新目标", async (t) => {
  const ui = await mount(t);
  ui.changeId("b");
  assert.equal(ui.requests[0].signal.aborted, true);
  assert.equal(ui.requests[1].url, "/api/v1/repair-activities/b");
  await ui.finish(1, { ...activity, id: "b", title: "新目标", status: "OPEN" });
  await ui.finish(0, { ...activity, title: "旧目标", status: "OPEN" });
  const node: ReactElement = ui.view();
  assert.ok(text(node).includes("新目标"));
  assert.equal(text(node).includes("旧目标"), false);
});

test("切换活动时解除旧的报名在途禁用，迟到响应不能展示成功", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  ui.openSignupForm();
  ui.submitForm();
  assert.equal(ui.requests[1].init.method, "POST");
  assert.equal(
    findElement(ui.view(), (element) => element.props.id === "repair-activity-signup-phone")?.props
      .disabled,
    true,
    "报名在途时手机号禁用",
  );

  ui.changeId("b");
  assert.equal(ui.requests[2].url, "/api/v1/repair-activities/b");
  await ui.finish(2, { ...activity, id: "b", title: "新活动", status: "OPEN" });
  assert.ok(text(ui.view()).includes("新活动"));
  assert.equal(ui.visibleStep(), 1, "切换活动后回到第一步");
  assert.equal(
    findElement(ui.view(), (element) => element.props.id === "repair-activity-signup-phone")?.props
      .disabled,
    false,
    "切换活动后旧报名的 busy 不能残留",
  );
  const submitButton = findElement(
    ui.stepElement(3)!,
    (element) => element.props.children === copy.submitSignup,
  );
  assert.equal(submitButton?.props.disabled, false);

  ui.requests[1].finish(Response.json({ success: true, data: registration }));
  await setImmediate();
  assert.equal(ui.visibleStep(), 1, "旧活动响应不能展示新活动成功");
  assert.equal(ui.visibleStep(), 1);
});

test("切换活动时清空查询状态并中止在途查询", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  ui.requestLookup("13800000000");
  assert.equal(ui.requests[1].url, "/api/v1/repair-activities/a/registrations/lookup");
  const lookupSignal = ui.requests[1].signal;
  assert.equal(lookupSignal.aborted, false);

  ui.changeId("b");
  assert.equal(lookupSignal.aborted, true, "切换活动中止旧查询");
  assert.equal(ui.requests[2].url, "/api/v1/repair-activities/b");
  await ui.finish(2, { ...activity, id: "b", title: "新活动", status: "OPEN" });

  ui.requests[1].finish(Response.json({ success: true, data: lookupRegistration }));
  await setImmediate();
  const content = text(ui.view());
  assert.ok(content.includes("新活动"));
  assert.equal(content.includes(copy.lookupRegisteredTitle), false, "旧查询结果不能写入新活动");
  assert.equal(content.includes(registration.name), false);
  const lookupSection = findElement(
    ui.view(),
    (element) => element.props["aria-labelledby"] === "repair-activity-lookup-title",
  );
  assert.ok(lookupSection);
  assert.equal(
    findElement(
      lookupSection,
      (element) => element.type === "select" && element.props.name === "issueType",
    ),
    undefined,
  );
});

test("三步向导先确认活动、再阅读须知，勾选同意后才进入填写", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  const panel = findElement(
    ui.view(),
    (element) => element.props["aria-labelledby"] === "repair-activity-precautions-title",
  );
  assert.ok(panel);
  const { RepairActivityPrecautions } =
    await import("../../src/components/repair-activities/RepairActivityPrecautions");
  const { RepairActivityPreparation } =
    await import("../../src/components/repair-activities/RepairActivityPreparation");
  assert.ok(findElement(panel, (element) => element.type === RepairActivityPreparation));
  const fullNotice = findElement(panel, (element) => element.type === "details");
  assert.ok(fullNotice);
  assert.equal(fullNotice.props.open, undefined, "默认折叠完整须知");
  assert.ok(findElement(fullNotice, (element) => element.type === RepairActivityPrecautions));
  assert.equal(
    text(RepairActivityPrecautions()),
    repairActivitiesPage.detail.consent.clauses.join(""),
  );

  assert.equal(ui.visibleStep(), 1);
  const step1 = ui.stepElement(1)!;
  assert.ok(text(step1).includes(copy.stepTitles[0]));
  assert.ok(text(step1).includes(activity.location!), "第一步摘要带地点");
  assert.equal(ui.requests.length, 1, "尚未开始填写时不发送报名请求");

  ui.clickInStep(1, copy.startSignup);
  assert.equal(ui.visibleStep(), 2, "第一步继续后进入须知");

  const step2 = ui.stepElement(2)!;
  assert.ok(text(step2).includes(copy.stepTitles[1]));
  assert.ok(text(step2).includes(copy.consent.subtitle));
  assert.ok(findElement(step2, (element) => element.type === RepairActivityPrecautions));

  ui.clickInStep(2, copy.nextStep);
  assert.equal(ui.visibleStep(), 2, "未勾选同意不能进入填写");
  const consentError = findElement(
    ui.stepElement(2)!,
    (element) => element.props.id === "repair-activity-signup-consent-error",
  );
  assert.equal(consentError?.props.role, "alert");
  assert.ok(text(consentError).includes(copy.consent.required));
  assert.equal(ui.requests.length, 1, "未勾选同意不发送报名请求");

  ui.agreeConsent();
  assert.equal(
    findElement(
      ui.stepElement(2)!,
      (element) => element.props.id === "repair-activity-signup-consent-error",
    ),
    undefined,
    "勾选后错误消失",
  );
  ui.clickInStep(2, copy.nextStep);
  assert.equal(ui.visibleStep(), 3);

  const { index, request } = ui.submitSignup();
  assert.deepEqual(JSON.parse(request.init.body as string), {
    name: "测试客户",
    phone: "13800000000",
    issueType: "CLEAN_PASTE",
    deviceModel: "测试机型",
    consentAccepted: true,
  });
  assert.equal(
    findElement(ui.stepElement(3)!, (element) => element.props.children === copy.submitting)?.props
      .disabled,
    true,
    "提交在途时禁用提交按钮",
  );
  ui.requests[index].finish(Response.json({ success: true, data: registration }));
  await setImmediate();

  const { RepairActivityReceipt } =
    await import("../../src/components/repair-activities/RepairActivityReceipt");
  const content = text(ui.view());
  assert.ok(content.includes(copy.resultTitle), "终态标题换成报名结果");
  const receipt = findElement(ui.view(), (element) => element.type === RepairActivityReceipt);
  assert.ok(receipt, "直接展示成功凭条");
  const receiptContent = text(RepairActivityReceipt(receipt.props as never));
  assert.ok(receiptContent.includes(registration.phoneMasked));
  assert.ok(receiptContent.includes(repairActivityIssueTypeLabels.CLEAN_PASTE));
  assert.equal(ui.visibleStep(), null, "结果不占步骤条");
  assert.equal(
    findElement(ui.view(), (element) => element.props["aria-label"] === copy.signupTitle),
    undefined,
    "成功后收起报名表单",
  );
  assert.equal(ui.storedDraft(), null, "成功后清空草稿");
  assert.equal(
    ui.requests.filter((request) => request.init.method === "POST").length,
    1,
    "只提交一次",
  );

  await ui.finish(index + 1, null);
  assert.ok(
    findElement(ui.view(), (element) => element.type === RepairActivityReceipt),
    "刷新失败仍保留成功凭条",
  );
});

test("报名未开始时锁住向导，不进入须知并保留查询入口", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t);
  await ui.finish(0, {
    ...activity,
    status: "UPCOMING",
    signupOpensAt: "2026-10-24T05:00:00Z",
    signupClosesAt: "2026-10-24T09:00:00Z",
  });
  const content = text(ui.view());
  assert.ok(content.includes(copy.flowLocked), "非 OPEN 状态显示锁定提示");
  assert.equal(ui.visibleStep(), 1);
  assert.equal(
    findElement(ui.view(), (element) => element.props["aria-label"] === copy.stepLabel),
    undefined,
    "锁定时不渲染步骤条",
  );
  const cta = findElement(
    ui.stepElement(1)!,
    (element) => element.props.children === copy.upcomingDisabled,
  );
  assert.equal(cta?.props.disabled, true, "未开始报名时 CTA 禁用");
  (cta!.props.onClick as () => void)();
  ui.view();
  assert.equal(ui.visibleStep(), 1, "锁定状态不能进入须知");
  assert.ok(
    findElement(ui.view(), (element) => element.props.id === "repair-activity-lookup-name"),
    "锁定状态仍可查询本人记录",
  );
});

test("刷新后从 sessionStorage 恢复报名草稿", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t, {
    draft: {
      name: "恢复客户",
      phone: "13911112222",
      issueType: "CLEAN_ONLY",
      deviceModel: "联想小新",
    },
  });
  await ui.finish(0, { ...activity, status: "OPEN" });
  ui.clickInStep(1, copy.startSignup);
  ui.agreeConsent();
  ui.clickInStep(2, copy.nextStep);
  assert.equal(ui.visibleStep(), 3);

  const section = ui.stepElement(3)!;
  assert.equal(
    findElement(section, (element) => element.props.id === "repair-activity-signup-name")?.props
      .value,
    "恢复客户",
  );
  assert.equal(
    findElement(section, (element) => element.props.id === "repair-activity-signup-phone")?.props
      .value,
    "13911112222",
  );
  assert.equal(
    findElement(
      section,
      (element) => element.type === "select" && element.props.name === "issueType",
    )?.props.value,
    "CLEAN_ONLY",
  );
  assert.equal(
    findElement(section, (element) => element.props.name === "deviceModel")?.props.value,
    "联想小新",
  );
});

test("步骤条可回退，返回时保留已填内容与同意状态", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  ui.openSignupForm({
    name: "回退客户",
    phone: "13700000000",
    issueType: "SOFTWARE_SYSTEM",
    deviceModel: "ThinkPad",
  });
  const stepper = findElement(
    ui.view(),
    (element) => element.props["aria-label"] === copy.stepLabel,
  );
  assert.ok(stepper, "报名中渲染步骤条");
  const step1Button = findElement(
    stepper,
    (element) =>
      typeof element.props["aria-label"] === "string" &&
      element.props["aria-label"].startsWith(copy.stepIndex.replace("{index}", "1")) &&
      typeof element.props.onClick === "function",
  );
  assert.ok(step1Button, "已完成步骤可点回");
  assert.equal(step1Button.props.disabled, false);
  (step1Button.props.onClick as () => void)();
  ui.view();
  assert.equal(ui.visibleStep(), 1);

  ui.clickInStep(1, copy.continueSignup);
  assert.equal(ui.visibleStep(), 2, "已同意时第一步直接继续");
  ui.clickInStep(2, copy.nextStep);
  assert.equal(ui.visibleStep(), 3);
  const section = ui.stepElement(3)!;
  assert.equal(
    findElement(section, (element) => element.props.id === "repair-activity-signup-name")?.props
      .value,
    "回退客户",
  );
  assert.equal(
    findElement(
      section,
      (element) => element.type === "select" && element.props.name === "issueType",
    )?.props.value,
    "SOFTWARE_SYSTEM",
  );

  ui.clickInStep(3, copy.previousStep);
  assert.equal(ui.visibleStep(), 2, "第三步可返回须知");
});

test("报名成功后直接渲染一屏凭条：活动名、起止时间、地点与一行到场准备", async (t) => {
  const ui = await mount(t);
  await ui.finish(0, {
    ...activity,
    status: "OPEN",
    endsAt: "2026-10-24T12:00:00Z",
  });
  ui.submitSignup();
  const postIndex = ui.requests.findLastIndex((request) => request.init.method === "POST");
  assert.ok(postIndex >= 0, "第三步提交必须发出报名 POST");
  ui.requests[postIndex].finish(Response.json({ success: true, data: registration }));
  await setImmediate();

  const { RepairActivityReceipt } =
    await import("../../src/components/repair-activities/RepairActivityReceipt");
  const { RepairActivityPreparation } =
    await import("../../src/components/repair-activities/RepairActivityPreparation");
  const { RepairActivityPrecautions } =
    await import("../../src/components/repair-activities/RepairActivityPrecautions");

  const receipt = findElement(ui.view(), (element) => element.type === RepairActivityReceipt);
  assert.ok(receipt, "成功态必须是凭条，而不是一段纯文字");

  const receiptContent = text(RepairActivityReceipt(receipt.props as never));
  assert.ok(receiptContent.includes(activity.title), "凭条要有活动名称");
  assert.ok(receiptContent.includes("2026/10/24 18:00–20:00"), "凭条要有起止时间区间");
  assert.ok(receiptContent.includes(activity.location!), "凭条要有地点");
  assert.ok(receiptContent.includes(registration.name), "凭条要有姓名");
  assert.ok(receiptContent.includes(registration.phoneMasked), "凭条要有脱敏手机");
  assert.ok(
    receiptContent.includes(repairActivitiesPage.detail.receipt.screenshotHint),
    "截图提示",
  );
  assert.equal(receiptContent.includes(registration.id), false, "用户已裁定凭条不放报名编号");

  const preparation = findElement(
    RepairActivityReceipt(receipt.props as never),
    (element) => element.type === RepairActivityPreparation,
  );
  assert.equal(preparation?.props.layout, "compact", "凭条下方到场准备用紧凑两列");
  assert.equal(
    findElement(
      RepairActivityReceipt(receipt.props as never),
      (element) => element.type === RepairActivityPrecautions,
    ),
    undefined,
    "凭条里不展开完整须知",
  );
});

test("非法手机号在填写步骤内拦截并可纠正", async (t) => {
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  ui.openSignupForm({ phone: "1380000" });
  ui.submitForm();
  assert.equal(ui.visibleStep(), 3, "校验失败时仍停在填写步骤");
  assert.equal(ui.requests.length, 1, "非法手机号不发送报名请求");
  const phoneInput = findElement(
    ui.view(),
    (element) => element.props.id === "repair-activity-signup-phone",
  );
  assert.equal(phoneInput?.props["aria-invalid"], true);
  assert.equal(phoneInput?.props["aria-describedby"], "repair-activity-signup-phone-error");
  const error = findElement(
    ui.view(),
    (element) => element.props.id === "repair-activity-signup-phone-error",
  );
  assert.equal(error?.props.role, "alert");
  assert.ok(text(ui.view()).includes(repairActivitiesPage.detail.phoneFormatHint));

  (phoneInput!.props.onChange as (event: unknown) => void)({
    target: { value: "13900000000" },
  });
  ui.view();
  assert.equal(
    text(ui.view()).includes(repairActivitiesPage.detail.phoneFormatHint),
    false,
    "纠正手机号后错误消失",
  );
  ui.submitForm();
  const request = ui.requests.find((item) => item.init.method === "POST");
  assert.ok(request, "纠正后可以提交");
  assert.equal(JSON.parse(request.init.body as string).phone, "13900000000");
});

test("姓名只输入空格时在报名表单内拦截", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  ui.openSignupForm({ name: "   " });
  ui.submitForm();

  assert.equal(ui.requests.length, 1, "空格姓名不发送报名请求");
  assert.equal(ui.visibleStep(), 3, "字段错误仍停在填写步骤");
  const nameInput = findElement(
    ui.view(),
    (element) => element.props.id === "repair-activity-signup-name",
  );
  assert.equal(nameInput?.props["aria-invalid"], true);
  assert.equal(nameInput?.props["aria-describedby"], "repair-activity-signup-name-error");
  const error = findElement(
    ui.view(),
    (element) => element.props.id === "repair-activity-signup-name-error",
  );
  assert.equal(error?.props.role, "alert");
  assert.ok(text(ui.view()).includes(copy.nameFormatHint));
});

test("服务端字段校验错误回到表单内，不进入结果终态", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  const { index } = ui.submitSignup();
  ui.requests[index].finish(
    Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "姓名须为 2–40 个字符",
          fieldErrors: { name: ["请输入 2–40 个字符"] },
        },
      },
      { status: 400 },
    ),
  );
  await setImmediate();

  assert.equal(ui.visibleStep(), 3, "字段错误仍停在填写步骤");
  assert.equal(pageAlertText(ui.view()), "");
  const nameInput = findElement(
    ui.view(),
    (element) => element.props.id === "repair-activity-signup-name",
  );
  assert.equal(nameInput?.props["aria-invalid"], true);
  assert.ok(text(ui.view()).includes("请输入 2–40 个字符"));
  ui.view();
  t.mock.timers.tick(0);
  assert.equal(ui.activeElement(), ui.signupNameNode(), "焦点应在 busy 结束后落到姓名输入框");
  assert.ok(
    findElement(ui.view(), (element) => element.props["aria-label"] === copy.signupTitle),
    "字段错误后仍保留报名表单",
  );
});

test("查询手机号非法时就地提示且不发送请求", async (t) => {
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  ui.requestLookup("1380000");
  assert.equal(ui.requests.length, 1, "非法手机号不发送查询请求");
  const phoneInput = findElement(
    ui.view(),
    (element) => element.props.id === "repair-activity-lookup-phone",
  );
  assert.equal(phoneInput?.props["aria-invalid"], true);
  assert.equal(phoneInput?.props["aria-describedby"], "repair-activity-lookup-phone-error");
  assert.ok(text(ui.view()).includes(repairActivitiesPage.detail.phoneFormatHint));

  ui.requestLookup("13800000000");
  assert.equal(ui.requests[1].url, "/api/v1/repair-activities/a/registrations/lookup");
});

test("第三步提交连点只发送一个 POST，成功后保留已报名凭条", async (t) => {
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  ui.openSignupForm();
  ui.submitForm();
  ui.submitForm();
  assert.equal(
    ui.requests.filter((request) => request.init.method === "POST").length,
    1,
    "提交按钮连点不能重复提交",
  );
  const index = ui.requests.findLastIndex((request) => request.init.method === "POST");
  ui.requests[index].finish(Response.json({ success: true, data: registration }));
  await setImmediate();
  const { RepairActivityReceipt } =
    await import("../../src/components/repair-activities/RepairActivityReceipt");
  const receipt = findElement(ui.view(), (element) => element.type === RepairActivityReceipt);
  assert.ok(receipt, "成功后显示凭条");
  assert.ok(text(RepairActivityReceipt(receipt.props as never)).includes(registration.phoneMasked));
  assert.equal(ui.visibleStep(), null);
});

test("重复报名提示引导查询已有记录，不覆盖为普通失败", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  const { index } = ui.submitSignup();
  ui.requests[index].finish(
    Response.json(
      {
        success: false,
        error: { code: "ACTIVITY_REGISTRATION_DUPLICATE", message: "该手机号已报名本场活动" },
      },
      { status: 409 },
    ),
  );
  await setImmediate();
  const content = text(ui.view());
  assert.ok(content.includes(copy.duplicateTitle), "重复报名用独立结果标题");
  assert.ok(content.includes(copy.duplicateHint));
  assert.equal(ui.visibleStep(), null, "结果终态收起向导");
  assert.equal(ui.storedDraft()?.phone, "13800000000", "重复报名保留草稿以便查询");
  assert.equal(ui.requests.length, 2, "重复报名不刷新活动");
});

test("报名响应丢失时先查询确认，查到记录按成功处理", async (t) => {
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  const { index } = ui.submitSignup();
  ui.requests[index].fail(new Error("network"));
  await setImmediate();
  assert.equal(
    ui.requests[index + 1].url,
    "/api/v1/repair-activities/a/registrations/lookup",
    "网络异常后先查询本人记录",
  );
  ui.requests[index + 1].finish(Response.json({ success: true, data: lookupRegistration }));
  await setImmediate();
  const { RepairActivityReceipt } =
    await import("../../src/components/repair-activities/RepairActivityReceipt");
  const receipt = findElement(ui.view(), (element) => element.type === RepairActivityReceipt);
  assert.ok(receipt, "确认报名成功后显示凭条");
  assert.ok(text(RepairActivityReceipt(receipt.props as never)).includes(registration.phoneMasked));
  assert.equal(ui.visibleStep(), null);
});

test("报名响应丢失且查询不到时停在待确认，不直接报失败", async (t) => {
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  const { index } = ui.submitSignup();
  ui.requests[index].fail(new Error("network"));
  await setImmediate();
  ui.requests[index + 1].finish(Response.json({ success: false }, { status: 404 }));
  await setImmediate();
  const content = text(ui.view());
  assert.ok(content.includes(repairActivitiesPage.detail.signupPendingTitle));
  assert.ok(content.includes(repairActivitiesPage.detail.lookupNotFoundRetry));
  assert.equal(content.includes("网络异常，请稍后重试"), false);
});

test("待确认查询失败可重试，确认未报名后可重新填写", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  const { index } = ui.submitSignup();
  ui.requests[index].fail(new Error("network"));
  await setImmediate();
  ui.requests[index + 1].fail(new Error("network"));
  await setImmediate();
  assert.ok(text(ui.view()).includes(copy.signupPendingTitle));
  assert.ok(text(ui.view()).includes(copy.lookupFailedRetry));
  assert.equal(text(ui.view()).includes(copy.pendingRestart), false, "查询失败不提供重新填写");

  let retry = findElement(
    ui.view(),
    (element) =>
      element.props.children === copy.checkResult && typeof element.props.onClick === "function",
  );
  assert.ok(retry);
  (retry.props.onClick as () => void)();
  await setImmediate();
  assert.equal(ui.requests[index + 2].url, "/api/v1/repair-activities/a/registrations/lookup");
  ui.requests[index + 2].fail(new Error("network"));
  await setImmediate();
  assert.ok(text(ui.view()).includes(copy.lookupFailedRetry));
  assert.equal(text(ui.view()).includes(copy.pendingRestart), false);

  retry = findElement(
    ui.view(),
    (element) =>
      element.props.children === copy.checkResult && typeof element.props.onClick === "function",
  );
  assert.ok(retry);
  (retry.props.onClick as () => void)();
  await setImmediate();
  assert.equal(ui.requests[index + 3].url, "/api/v1/repair-activities/a/registrations/lookup");
  ui.requests[index + 3].finish(Response.json({ success: false }, { status: 404 }));
  await setImmediate();
  let content = text(ui.view());
  assert.ok(content.includes(copy.lookupNotFoundRetry));
  assert.equal(content.includes(copy.lookupFailedRetry), false);

  const restart = findElement(
    ui.view(),
    (element) =>
      element.props.children === copy.pendingRestart && typeof element.props.onClick === "function",
  );
  assert.ok(restart, "确认未报名后提供重新填写");
  (restart.props.onClick as () => void)();
  ui.view();

  content = text(ui.view());
  assert.equal(content.includes(copy.signupPendingTitle), false, "重新填写后解除待确认");
  assert.equal(ui.visibleStep(), 3, "重新填写回到第三步");
  assert.equal(ui.storedDraft(), null, "重新填写清空旧草稿");
  assert.equal(
    findElement(ui.view(), (element) => element.props.id === "repair-activity-signup-phone")?.props
      .disabled,
    false,
    "重新填写后报名手机号恢复可编辑",
  );
  assert.equal(
    findElement(ui.stepElement(3)!, (element) => element.props.children === copy.submitSignup)
      ?.props.disabled,
    false,
    "重新填写后可以再次提交",
  );
});

test("待确认时主查询到本人记录会清除待确认并展示凭条", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  const { index } = ui.submitSignup();
  ui.requests[index].fail(new Error("network"));
  await setImmediate();
  ui.requests[index + 1].finish(Response.json({ success: false }, { status: 404 }));
  await setImmediate();
  assert.ok(text(ui.view()).includes(copy.signupPendingTitle));
  assert.ok(text(ui.view()).includes(copy.pendingRestart));

  ui.requestLookup("13800000000");
  assert.equal(ui.requests[index + 2].url, "/api/v1/repair-activities/a/registrations/lookup");
  assert.ok(ui.requests[index + 2].init.signal instanceof AbortSignal, "主查询带超时/中止信号");
  ui.requests[index + 2].finish(Response.json({ success: true, data: lookupRegistration }));
  await setImmediate();

  const content = text(ui.view());
  assert.equal(content.includes(copy.signupPendingTitle), false, "查到记录后不再显示待确认");
  const { RepairActivityReceipt } =
    await import("../../src/components/repair-activities/RepairActivityReceipt");
  const receipt = findElement(ui.view(), (element) => element.type === RepairActivityReceipt);
  assert.ok(receipt, "主查询结果转为成功凭条");
  assert.equal(
    findElement(ui.view(), (element) => element.props.id === "repair-activity-signup-phone"),
    undefined,
    "确认已报名后收起报名表单，避免重复提交",
  );
  assert.ok(
    text(RepairActivityReceipt(receipt.props as never)).includes(registration.phoneMasked),
    "凭条保留脱敏手机号",
  );
});

test("满额页保留查询本人记录入口", async (t) => {
  const ui = await mount(t);
  await ui.finish(0, {
    ...activity,
    status: "FULL",
    registeredCount: 10,
    remaining: 0,
  });
  assert.ok(text(ui.view()).includes(repairActivitiesPage.detail.fullDisabled));
  assert.ok(text(ui.view()).includes(repairActivitiesPage.detail.fullLookupHint));
  assert.ok(text(ui.view()).includes(repairActivitiesPage.detail.lookupMine));
});

test("查询到本人有效报名时突出你已报名成功并保留改类型", async (t) => {
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "FULL", registeredCount: 10, remaining: 0 });
  ui.requestLookup("13800000000");
  assert.equal(ui.requests[1].url, "/api/v1/repair-activities/a/registrations/lookup");
  assert.equal(JSON.parse(ui.requests[1].init.body as string).phone, "13800000000");
  assert.ok(ui.requests[1].init.signal instanceof AbortSignal, "手动查询也带超时/中止信号");
  ui.requests[1].finish(Response.json({ success: true, data: lookupRegistration }));
  await setImmediate();
  const content = text(ui.view());
  assert.ok(content.includes(repairActivitiesPage.detail.lookupRegisteredTitle));
  assert.ok(content.includes(registration.name));
  assert.ok(content.includes(registration.phoneMasked));
  assert.ok(content.includes(repairActivityIssueTypeLabels.CLEAN_PASTE));
  assert.ok(
    content.includes(
      repairActivitiesPage.detail.registrationNumber.replace("{id}", registration.id),
    ),
  );
  const lookupSection = findElement(
    ui.view(),
    (element) => element.props["aria-labelledby"] === "repair-activity-lookup-title",
  );
  assert.ok(lookupSection);
  const editSelect = findElement(
    lookupSection,
    (element) => element.type === "select" && element.props.name === "issueType",
  );
  assert.equal(editSelect?.props.disabled, false, "有效报名仍可修改故障类型");
});

test("查询到有效报名时可在活动开始前二次确认取消，成功后释放表单", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN", activityAt: "2026-10-24T10:00:00Z" });
  ui.requestLookup("13800000000");
  ui.requests[1].finish(Response.json({ success: true, data: lookupRegistration }));
  await setImmediate();

  const cancelButton = findElement(
    ui.view(),
    (element) =>
      element.props.children === copy.cancelSignup && typeof element.props.onClick === "function",
  );
  assert.ok(cancelButton, "有效报名应提供取消入口");
  (cancelButton.props.onClick as () => void)();
  ui.view();

  const dialog = findElement(
    ui.view(),
    (element) =>
      element.props.title === copy.cancelConfirmTitle &&
      typeof element.props.onConfirm === "function",
  );
  assert.ok(dialog, "取消应经过二次确认");
  (dialog.props.onConfirm as () => void)();
  (dialog.props.onConfirm as () => void)();
  assert.equal(
    ui.requests.filter((request) => request.url.endsWith("/cancel")).length,
    1,
    "同帧连点只发一个取消请求",
  );
  assert.equal(ui.requests[2].url, "/api/v1/repair-activities/a/registrations/r1/cancel");
  assert.equal(ui.requests[2].init.method, "POST");
  assert.deepEqual(JSON.parse(ui.requests[2].init.body as string), {
    name: registration.name,
    phone: "13800000000",
    editToken: lookupRegistration.editToken,
  });
  ui.requests[2].finish(Response.json({ success: true, data: { cancelled: true } }));
  await setImmediate();

  assert.equal(text(ui.view()).includes(copy.lookupRegisteredTitle), false);
  assert.equal(ui.requests[3].url, "/api/v1/repair-activities/a", "取消后刷新名额");
  assert.equal(ui.visibleStep(), 1, "同一设备取消后重新显示报名向导");
  assert.ok(text(ui.view()).includes(copy.stepTitles[0]));
  await ui.finish(3, { ...activity, status: "OPEN", registeredCount: 1, remaining: 9 });
});

test("取消网络失败时保留查询结果并提示重试", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  ui.requestLookup("13800000000");
  ui.requests[1].finish(Response.json({ success: true, data: lookupRegistration }));
  await setImmediate();
  const cancelButton = findElement(
    ui.view(),
    (element) =>
      element.props.children === copy.cancelSignup && typeof element.props.onClick === "function",
  );
  assert.ok(cancelButton);
  (cancelButton.props.onClick as () => void)();
  const dialog = findElement(
    ui.view(),
    (element) =>
      element.props.title === copy.cancelConfirmTitle &&
      typeof element.props.onConfirm === "function",
  );
  (dialog!.props.onConfirm as () => void)();
  ui.requests[2].fail(new Error("network"));
  await setImmediate();

  const content = text(ui.view());
  assert.ok(pageAlertText(ui.view()).includes("网络异常，请稍后重试"));
  assert.ok(content.includes(copy.lookupRegisteredTitle), "失败时保留查询结果以便重试");
  assert.equal(ui.requests[3].url, "/api/v1/repair-activities/a");
  await ui.finish(3, { ...activity, status: "OPEN" });
});

test("取消服务端状态拒绝时保留查询结果并展示原因", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  ui.requestLookup("13800000000");
  ui.requests[1].finish(Response.json({ success: true, data: lookupRegistration }));
  await setImmediate();
  const cancelButton = findElement(
    ui.view(),
    (element) =>
      element.props.children === copy.cancelSignup && typeof element.props.onClick === "function",
  );
  assert.ok(cancelButton);
  (cancelButton.props.onClick as () => void)();
  const dialog = findElement(
    ui.view(),
    (element) =>
      element.props.title === copy.cancelConfirmTitle &&
      typeof element.props.onConfirm === "function",
  );
  (dialog!.props.onConfirm as () => void)();
  ui.requests[2].finish(
    Response.json(
      { success: false, error: { message: "活动已开始，不能自助取消，请联系活动管理员" } },
      { status: 409 },
    ),
  );
  await setImmediate();

  const content = text(ui.view());
  assert.ok(pageAlertText(ui.view()).includes("活动已开始，不能自助取消"));
  assert.ok(content.includes(copy.lookupRegisteredTitle));
  await ui.finish(3, { ...activity, status: "OPEN" });
});

test("迟到的设备状态不能把刚取消的报名写回并重新收起表单", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t, { device: "pending" });
  await ui.finish(0, { ...activity, status: "OPEN" });
  ui.requestLookup("13800000000");
  ui.requests[1].finish(Response.json({ success: true, data: lookupRegistration }));
  await setImmediate();
  const cancelButton = findElement(
    ui.view(),
    (element) =>
      element.props.children === copy.cancelSignup && typeof element.props.onClick === "function",
  );
  assert.ok(cancelButton);
  (cancelButton.props.onClick as () => void)();
  const dialog = findElement(
    ui.view(),
    (element) =>
      element.props.title === copy.cancelConfirmTitle &&
      typeof element.props.onConfirm === "function",
  );
  (dialog!.props.onConfirm as () => void)();
  ui.requests[2].finish(Response.json({ success: true, data: { cancelled: true } }));
  await setImmediate();
  assert.equal(ui.devicePendingCount(), 1);
  ui.resolveDevice(0, { submitted: true, registration });
  await setImmediate();
  assert.equal(ui.visibleStep(), 1, "取消成功后迟到的设备状态不能重新收起报名向导");
  assert.ok(text(ui.view()).includes(copy.stepTitles[0]));
  await ui.finish(3, { ...activity, status: "OPEN" });
});

test("活动开始后仍可查询，但自助取消入口收起并提示联系管理员", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t);
  await ui.finish(0, {
    ...activity,
    status: "CLOSED",
    registeredCount: 1,
    remaining: 9,
    activityAt: "2026-10-24T03:00:00Z",
  });
  ui.requestLookup("13800000000");
  ui.requests[1].finish(Response.json({ success: true, data: lookupRegistration }));
  await setImmediate();

  assert.equal(
    findElement(
      ui.view(),
      (element) =>
        element.props.children === copy.cancelSignup && typeof element.props.onClick === "function",
    ),
    undefined,
  );
  assert.ok(text(ui.view()).includes(copy.cancelStarted));
});

test("活动开始前已签到/已接待时仍不显示取消按钮", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "CLOSED", registeredCount: 3, remaining: 7 });
  ui.requestLookup("13800000000");
  ui.requests[1].finish(
    Response.json({ success: true, data: { ...lookupRegistration, status: "CHECKED_IN" } }),
  );
  await setImmediate();
  const content = text(ui.view());
  assert.ok(content.includes(copy.lookupStatusLabel.replace("{status}", "已签到")));
  assert.ok(content.includes(copy.notEditable));
  const assertNoCancel = () => {
    const lookupSection = findElement(
      ui.view(),
      (element) => element.props["aria-labelledby"] === "repair-activity-lookup-title",
    );
    assert.ok(lookupSection);
    assert.equal(
      findElement(
        lookupSection,
        (element) => element.type === "select" && element.props.name === "issueType",
      ),
      undefined,
    );
    assert.equal(
      findElement(
        lookupSection,
        (element) =>
          element.props.children === copy.cancelSignup &&
          typeof element.props.onClick === "function",
      ),
      undefined,
      "已签到/已接待即使活动尚未开始也不能显示自助取消",
    );
  };
  assertNoCancel();

  ui.requestLookup("13800000000");
  ui.requests[2].finish(
    Response.json({ success: true, data: { ...lookupRegistration, status: "SERVED" } }),
  );
  await setImmediate();
  assert.ok(text(ui.view()).includes(copy.lookupStatusLabel.replace("{status}", "已接待")));
  assertNoCancel();
});

test("报名失败进入结果终态，保留输入以便重试，不显示成功提醒", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  const { index } = ui.submitSignup();
  ui.requests[index].finish(
    Response.json({ success: false, error: { message: "名额已满" } }, { status: 409 }),
  );
  await setImmediate();

  let content = text(ui.view());
  assert.ok(content.includes(copy.signupFailedTitle), "报名失败进入结果终态");
  assert.ok(content.includes("名额已满"));
  assert.equal(content.includes(copy.signupSuccessTitle), false);
  assert.equal(ui.visibleStep(), null, "结果终态收起向导");
  assert.equal(ui.storedDraft()?.name, "测试客户", "失败时保留已填写的草稿");
  assert.equal(ui.requests.length, 2, "失败时不刷新活动或再次提交");

  const retry = findElement(
    ui.view(),
    (element) =>
      element.props.children === copy.confirmEdit && typeof element.props.onClick === "function",
  );
  assert.ok(retry, "失败结果提供返回修改");
  (retry.props.onClick as () => void)();
  ui.view();
  assert.equal(ui.visibleStep(), 3, "返回修改回到第三步");
  assert.equal(
    findElement(ui.view(), (element) => element.props.id === "repair-activity-signup-name")?.props
      .value,
    "测试客户",
    "返回后保留姓名",
  );

  content = text(ui.view());
  assert.equal(content.includes(copy.signupFailedTitle), false, "返回修改后清除失败结果");
});

test("报名被客户黑名单拦截时，错误进入结果终态并可返回修改", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  const { index } = ui.submitSignup();
  ui.requests[index].finish(
    Response.json(
      {
        success: false,
        error: {
          code: "ACTIVITY_CUSTOMER_BLOCKED",
          message:
            "该姓名与手机号近期有未到场的活动记录，暂时无法报名本场活动。请联系活动管理员处理。",
        },
      },
      { status: 403 },
    ),
  );
  await setImmediate();

  const content = text(ui.view());
  assert.ok(content.includes(copy.signupFailedTitle));
  assert.ok(
    content.includes(
      "该姓名与手机号近期有未到场的活动记录，暂时无法报名本场活动。请联系活动管理员处理。",
    ),
  );
  assert.equal(ui.storedDraft()?.phone, "13800000000", "错误结果不清空草稿");
  assert.equal(pageAlerts(ui.view()).length, 0);
  assert.equal(ui.visibleStep(), null);

  const retry = findElement(
    ui.view(),
    (element) =>
      element.props.children === copy.confirmEdit && typeof element.props.onClick === "function",
  );
  assert.ok(retry);
  (retry.props.onClick as () => void)();
  ui.view();
  assert.equal(ui.visibleStep(), 3, "返回后仍保留报名表单");
});

test("本设备已提交时收起报名表单，只保留查询入口", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t, {
    device: { submitted: true, registration },
    draft: {
      name: "残留客户",
      phone: "13800000000",
      issueType: "CLEAN_PASTE",
      deviceModel: "",
    },
  });
  await ui.finish(0, { ...activity, status: "OPEN" });
  await setImmediate();

  const content = text(ui.view());
  assert.ok(content.includes(copy.deviceRegisteredTitle), "显示已提交面板");
  assert.ok(content.includes(registration.phoneMasked), "显示脱敏手机号");
  assert.ok(
    content.includes(copy.receiptIssueType.replace("{type}", "清灰换硅脂")),
    "已提交面板显示故障类型",
  );
  assert.equal(ui.visibleStep(), null, "已提交设备不展示报名向导");
  assert.equal(
    findElement(ui.view(), (element) => element.props["aria-label"] === copy.signupTitle),
    undefined,
    "已提交设备不再渲染报名表单",
  );
  assert.ok(
    findElement(ui.view(), (element) => element.props.id === "repair-activity-lookup-name"),
    "查询表单仍在",
  );
  assert.equal(ui.storedDraft(), null, "收起表单时清掉残留草稿");
});

test("设备状态未返回前只显示占位，不渲染报名表单", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t, { device: "pending" });
  await ui.finish(0, { ...activity, status: "OPEN" });
  const content = text(ui.view());
  assert.ok(content.includes(copy.deviceStatusChecking), "显示设备状态占位");
  assert.equal(
    findElement(ui.view(), (element) => element.props["aria-label"] === copy.signupTitle),
    undefined,
    "状态未决时不渲染表单，避免填到一半被收起",
  );
});

test("提交撞上设备 409 时直接切到已提交面板", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  ui.setDeviceStatus({ submitted: true, registration });
  const { index } = ui.submitSignup();
  ui.requests[index].finish(
    Response.json(
      {
        success: false,
        error: { code: "ACTIVITY_DEVICE_ALREADY_REGISTERED", message: "本设备已提交过本场报名" },
      },
      { status: 409 },
    ),
  );
  await setImmediate();
  await setImmediate();

  const content = text(ui.view());
  assert.ok(content.includes(copy.deviceRegisteredTitle), "命中 409 后显示已提交面板");
  assert.ok(content.includes(registration.name));
  assert.equal(ui.visibleStep(), null, "命中 409 后收起报名向导");
  assert.equal(
    findElement(ui.view(), (element) => element.props["aria-label"] === copy.signupTitle),
    undefined,
    "命中 409 后收起报名表单",
  );
});

test("已提交面板可重新检查：报名被删除后恢复表单", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t, { device: { submitted: true, registration } });
  await ui.finish(0, { ...activity, status: "OPEN" });
  await setImmediate();
  assert.ok(text(ui.view()).includes(copy.deviceRegisteredTitle));

  ui.setDeviceStatus({ submitted: false, registration: null });
  const button = findElement(
    ui.view(),
    (element) =>
      element.props.children === copy.deviceRecheck && typeof element.props.onClick === "function",
  );
  assert.ok(button, "面板提供重新检查按钮");
  (button.props.onClick as () => void)();
  await setImmediate();
  await setImmediate();

  assert.equal(ui.visibleStep(), 1, "重新检查后恢复报名向导");
  assert.ok(text(ui.view()).includes(copy.stepTitles[0]));
});

test("设备状态查询失败时放开报名向导", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t, { device: "error" });
  await ui.finish(0, { ...activity, status: "OPEN" });
  await setImmediate();

  assert.equal(ui.visibleStep(), 1, "设备接口失败不能把报名入口挡死");
  assert.ok(text(ui.view()).includes(copy.stepTitles[0]));
  assert.ok(
    findElement(
      ui.stepElement(1)!,
      (element) =>
        element.props.children === copy.startSignup && typeof element.props.onClick === "function",
    ),
    "第一步提供开始报名",
  );
});

test("设备 409 后状态读取失败时用设备提示，不误报手机号重复", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  ui.setDeviceStatus("error");
  const { index } = ui.submitSignup();
  ui.requests[index].finish(
    Response.json(
      { success: false, error: { code: "ACTIVITY_DEVICE_ALREADY_REGISTERED" } },
      { status: 409 },
    ),
  );
  await setImmediate();
  await setImmediate();

  const content = text(ui.view());
  assert.ok(content.includes(copy.deviceConflictFallback), "回退到设备专用提示");
  assert.equal(content.includes(copy.duplicateHint), false, "不能说成该手机号已报名");
  assert.equal(ui.visibleStep(), null);
});

test("切换活动时丢弃旧的设备状态响应", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t, { device: "pending" });
  await ui.finish(0, { ...activity, status: "OPEN" });
  assert.equal(ui.devicePendingCount(), 1, "旧活动有一个在途设备请求");

  ui.changeId("b");
  await ui.finish(1, { ...activity, id: "b", title: "新活动", status: "OPEN" });
  assert.equal(ui.devicePendingCount(), 2, "新活动也发了一次设备请求");

  ui.resolveDevice(0, { submitted: true, registration });
  await setImmediate();
  assert.equal(
    text(ui.view()).includes(copy.deviceRegisteredTitle),
    false,
    "旧活动的设备状态不能写到新页面",
  );

  ui.resolveDevice(1, { submitted: false, registration: null });
  await setImmediate();
  assert.equal(ui.visibleStep(), 1, "新活动按自己的状态放开报名向导");
  assert.ok(text(ui.view()).includes(copy.stepTitles[0]));
});

test("AbortSignal.any 缺失时设备状态失败仍放开报名表单", async (t) => {
  const copy = repairActivitiesPage.detail;
  const original = AbortSignal.any;
  Object.defineProperty(AbortSignal, "any", { value: undefined, configurable: true });
  t.after(() => Object.defineProperty(AbortSignal, "any", { value: original, configurable: true }));

  const ui = await mount(t, { device: "error" });
  await ui.finish(0, { ...activity, status: "OPEN" });
  await setImmediate();

  const content = text(ui.view());
  assert.equal(content.includes(copy.deviceStatusChecking), false, "占位不能常驻");
  assert.equal(ui.visibleStep(), 1, "缺 AbortSignal.any 的浏览器也要能报名");
  assert.ok(
    findElement(
      ui.stepElement(1)!,
      (element) =>
        element.props.children === copy.startSignup && typeof element.props.onClick === "function",
    ),
  );
});
