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

function signupDialog(node: ReactNode) {
  return findElement(node, (element) => typeof element.props.onConfirm === "function");
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
  capacity: 10,
  registeredCount: 2,
  remaining: 8,
  activityAt: "2026-10-24T10:00:00Z",
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
  const document = { visibilityState: "visible", ...events };
  const timeoutDelays: number[] = [];
  const recordTimeout = (handler: () => void, delay?: number) => {
    timeoutDelays.push(delay ?? 0);
    return setTimeout(handler, delay) as unknown as number;
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { setInterval, clearInterval, setTimeout: recordTimeout, clearTimeout, ...events },
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
  view();
  let formResets = 0;
  return {
    view,
    requests,
    timeoutDelays,
    formResets: () => formResets,
    requestSignup(overrides: Record<string, string> = {}) {
      const form = findElement(view(), (element) => element.props["aria-label"] === "报名参加");
      assert.ok(form);
      (form.props.ref as { current: unknown }).current = {
        reset() {
          formResets++;
        },
        focus() {},
      };
      formValues = new Map(
        Object.entries({
          name: "测试客户",
          phone: "13800000000",
          issueType: "CLEAN_PASTE",
          deviceModel: "测试机型",
          ...overrides,
        }),
      );
      (form.props.onSubmit as (event: unknown) => void)({
        preventDefault() {},
        currentTarget: {},
      });
      return signupDialog(view())!;
    },
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
  (ui.requestSignup().props.onConfirm as () => void)();
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
  assert.equal(
    findElement(ui.view(), (element) => element.props.id === "repair-activity-signup-phone")?.props
      .disabled,
    false,
    "切换活动后旧报名的 busy 不能残留",
  );
  assert.equal(
    findElement(ui.view(), (element) => element.props.children === copy.submitSignup)?.props
      .disabled,
    false,
  );

  ui.requests[1].finish(Response.json({ success: true, data: registration }));
  await setImmediate();
  assert.equal(
    text(ui.view()).includes(copy.signupSuccessTitle),
    false,
    "旧活动响应不能展示新活动成功",
  );
  assert.equal(signupDialog(ui.view()), undefined);
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

test("完整须知可展开且提交前必须同意，成功只展示到场准备并且不重复提交", async (t) => {
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

  const consent = ui.requestSignup();
  assert.ok(text(consent).includes(activity.title), "确认弹层应展示活动名");
  assert.ok(text(consent).includes("测试客户"), "确认弹层应展示姓名");
  assert.ok(text(consent).includes("13800000000"), "确认弹层应展示完整手机号供核对");
  assert.equal(ui.requests.length, 1, "未同意须知时不发送报名请求");
  assert.equal(consent.props.title, repairActivitiesPage.detail.consent.title);
  assert.equal(consent.props.confirmLabel, repairActivitiesPage.detail.consent.agree);
  assert.equal(consent.props.cancelLabel, repairActivitiesPage.detail.confirmEdit);
  assert.ok(findElement(consent, (element) => element.type === RepairActivityPrecautions));
  (consent.props.onConfirm as () => void)();
  assert.equal(signupDialog(ui.view())?.props.busy, true);
  assert.deepEqual(JSON.parse(ui.requests[1].init.body as string), {
    name: "测试客户",
    phone: "13800000000",
    issueType: "CLEAN_PASTE",
    deviceModel: "测试机型",
    consentAccepted: true,
  });
  ui.requests[1].finish(Response.json({ success: true, data: registration }));
  await setImmediate();
  let success = signupDialog(ui.view());
  assert.equal(success?.props.title, repairActivitiesPage.detail.signupSuccessTitle);
  assert.equal(success?.props.cancelLabel, undefined);
  assert.equal(ui.formResets(), 1, "成功后清空报名表单");
  assert.equal(
    findElement(success, (element) => element.type === RepairActivityPrecautions),
    undefined,
  );
  assert.ok(findElement(success, (element) => element.type === RepairActivityPreparation));
  for (const item of repairActivitiesPage.detail.preparation) {
    assert.ok(text(RepairActivityPreparation()).includes(item.title));
  }

  await ui.finish(2, null); // 成功后的刷新失败不能覆盖成功提醒。
  success = signupDialog(ui.view());
  assert.equal(success?.props.title, repairActivitiesPage.detail.signupSuccessTitle);
  (success?.props.onConfirm as () => void)();
  assert.equal(signupDialog(ui.view()), undefined);
  assert.ok(text(ui.view()).includes(repairActivitiesPage.detail.signupSuccessTitle));
  assert.ok(text(ui.view()).includes(registration.phoneMasked), "弹层关闭后仍显示已报名记录");
  assert.ok(
    text(ui.view()).includes(
      repairActivitiesPage.detail.registrationNumber.replace("{id}", registration.id),
    ),
    "凭条应包含报名编号",
  );
  assert.ok(
    text(ui.view()).includes(
      repairActivitiesPage.detail.receiptStatus.replace("{status}", "报名成功"),
    ),
    "凭条应包含报名状态",
  );
  assert.equal(ui.requests.filter((request) => request.init.method === "POST").length, 1);
});

test("非法手机号在打开确认弹层前拦截并可纠正", async (t) => {
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  ui.requestSignup({ phone: "1380000" });
  assert.equal(signupDialog(ui.view()), undefined, "非法手机号不能打开确认弹层");
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

  ui.requestSignup({ phone: "13900000000" });
  const consent = signupDialog(ui.view());
  assert.ok(consent);
  assert.equal(
    text(ui.view()).includes(repairActivitiesPage.detail.phoneFormatHint),
    false,
    "纠正手机号后错误消失",
  );
  assert.ok(text(consent).includes("13900000000"));
  assert.equal(ui.requests.length, 1, "纠正后仍需同意须知才提交");
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

test("报名确认连点只发送一个 POST，成功后保留已报名提示", async (t) => {
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  const consent = ui.requestSignup();
  (consent.props.onConfirm as () => void)();
  (consent.props.onConfirm as () => void)();
  assert.equal(
    ui.requests.filter((request) => request.init.method === "POST").length,
    1,
    "确认按钮连点不能重复提交",
  );
  ui.requests[1].finish(Response.json({ success: true, data: registration }));
  await setImmediate();
  (signupDialog(ui.view())?.props.onConfirm as () => void)();
  assert.ok(text(ui.view()).includes(repairActivitiesPage.detail.signupSuccessTitle));
  assert.ok(text(ui.view()).includes(registration.phoneMasked));
});

test("重复报名提示引导查询已有记录，不覆盖为普通失败", async (t) => {
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  const consent = ui.requestSignup();
  (consent.props.onConfirm as () => void)();
  ui.requests[1].finish(
    Response.json(
      {
        success: false,
        error: { code: "ACTIVITY_REGISTRATION_DUPLICATE", message: "该手机号已报名本场活动" },
      },
      { status: 409 },
    ),
  );
  await setImmediate();
  assert.equal(signupDialog(ui.view()), undefined);
  assert.ok(text(ui.view()).includes(repairActivitiesPage.detail.duplicateHint));
  assert.equal(ui.formResets(), 0, "重复报名时保留已填写的表单以便查询");
  assert.equal(ui.requests.length, 2, "重复报名不刷新活动");
});

test("报名响应丢失时先查询确认，查到记录按成功处理", async (t) => {
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  (ui.requestSignup().props.onConfirm as () => void)();
  ui.requests[1].fail(new Error("network"));
  await setImmediate();
  assert.equal(
    ui.requests[2].url,
    "/api/v1/repair-activities/a/registrations/lookup",
    "网络异常后先查询本人记录",
  );
  ui.requests[2].finish(Response.json({ success: true, data: lookupRegistration }));
  await setImmediate();
  const dialog = signupDialog(ui.view());
  assert.equal(dialog?.props.title, repairActivitiesPage.detail.signupSuccessTitle);
  (dialog?.props.onConfirm as () => void)();
  assert.ok(text(ui.view()).includes(repairActivitiesPage.detail.signupSuccessTitle));
  assert.ok(text(ui.view()).includes(registration.phoneMasked));
});

test("报名响应丢失且查询不到时停在待确认，不直接报失败", async (t) => {
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  (ui.requestSignup().props.onConfirm as () => void)();
  ui.requests[1].fail(new Error("network"));
  await setImmediate();
  ui.requests[2].finish(Response.json({ success: false }, { status: 404 }));
  await setImmediate();
  assert.equal(signupDialog(ui.view()), undefined);
  assert.ok(text(ui.view()).includes(repairActivitiesPage.detail.signupPendingTitle));
  assert.ok(text(ui.view()).includes(repairActivitiesPage.detail.lookupNotFoundRetry));
  assert.equal(text(ui.view()).includes("网络异常，请稍后重试"), false);
});

test("待确认查询失败可重试，确认未报名后可重新填写", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  (ui.requestSignup().props.onConfirm as () => void)();
  ui.requests[1].fail(new Error("network"));
  await setImmediate();
  ui.requests[2].fail(new Error("network"));
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
  assert.equal(ui.requests[3].url, "/api/v1/repair-activities/a/registrations/lookup");
  ui.requests[3].fail(new Error("network"));
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
  assert.equal(ui.requests[4].url, "/api/v1/repair-activities/a/registrations/lookup");
  ui.requests[4].finish(Response.json({ success: false }, { status: 404 }));
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

  content = text(ui.view());
  assert.equal(content.includes(copy.signupPendingTitle), false, "重新填写后解除待确认");
  assert.equal(
    findElement(ui.view(), (element) => element.props.id === "repair-activity-signup-phone")?.props
      .disabled,
    false,
    "重新填写后报名手机号恢复可编辑",
  );
  assert.equal(
    findElement(ui.view(), (element) => element.props.children === copy.submitSignup)?.props
      .disabled,
    false,
    "重新填写后可以再次提交",
  );
  assert.equal(ui.formResets(), 1, "重新填写清空旧表单");
  assert.equal(ui.requestSignup().props.title, copy.consent.title);
});

test("待确认时主查询到本人记录会清除待确认并展示凭条", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  (ui.requestSignup().props.onConfirm as () => void)();
  ui.requests[1].fail(new Error("network"));
  await setImmediate();
  ui.requests[2].finish(Response.json({ success: false }, { status: 404 }));
  await setImmediate();
  assert.ok(text(ui.view()).includes(copy.signupPendingTitle));
  assert.ok(text(ui.view()).includes(copy.pendingRestart));

  ui.requestLookup("13800000000");
  assert.equal(ui.requests[3].url, "/api/v1/repair-activities/a/registrations/lookup");
  assert.ok(ui.requests[3].init.signal instanceof AbortSignal, "主查询带超时/中止信号");
  ui.requests[3].finish(Response.json({ success: true, data: lookupRegistration }));
  await setImmediate();

  const content = text(ui.view());
  assert.equal(content.includes(copy.signupPendingTitle), false, "查到记录后不再显示待确认");
  assert.ok(content.includes(copy.signupSuccessTitle), "主查询结果转为成功凭条");
  assert.ok(
    content.includes(copy.registrationNumber.replace("{id}", registration.id)),
    "凭条展示报名编号",
  );
  assert.equal(
    findElement(ui.view(), (element) => element.props.id === "repair-activity-signup-phone"),
    undefined,
    "确认已报名后收起报名表单，避免重复提交",
  );
  assert.ok(content.includes(registration.phoneMasked), "凭条保留脱敏手机号");
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
  assert.ok(
    findElement(ui.view(), (element) => element.props["aria-label"] === copy.signupTitle),
    "同一设备取消后重新显示报名表单",
  );
  await ui.finish(3, { ...activity, status: "OPEN", registeredCount: 1, remaining: 9 });
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

test("查询到已签到记录时状态用中文且不再提供改类型", async (t) => {
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "CLOSED", registeredCount: 3, remaining: 7 });
  ui.requestLookup("13800000000");
  ui.requests[1].finish(
    Response.json({ success: true, data: { ...lookupRegistration, status: "CHECKED_IN" } }),
  );
  await setImmediate();
  const content = text(ui.view());
  assert.ok(
    content.includes(repairActivitiesPage.detail.lookupStatusLabel.replace("{status}", "已签到")),
  );
  assert.ok(content.includes(repairActivitiesPage.detail.notEditable));
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

test("报名失败只显示错误，保留输入以便重试，不显示成功提醒", async (t) => {
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  const consent = ui.requestSignup();
  (consent.props.onConfirm as () => void)();
  ui.requests[1].finish(
    Response.json({ success: false, error: { message: "名额已满" } }, { status: 409 }),
  );
  await setImmediate();
  assert.equal(signupDialog(ui.view()), undefined);
  assert.ok(text(ui.view()).includes("名额已满"));
  assert.equal(ui.formResets(), 0, "失败时保留已填写的表单");
  assert.equal(ui.requests.length, 2, "失败时不刷新活动或再次提交");
  assert.equal(ui.requestSignup().props.title, repairActivitiesPage.detail.consent.title);
});

test("上次报名的慢刷新结束时，不解除下一次报名的在途禁用", async (t) => {
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  (ui.requestSignup().props.onConfirm as () => void)();
  ui.requests[1].finish(Response.json({ success: true }));
  await setImmediate();
  assert.equal(ui.requests[2].init.method, undefined, "首次报名成功后刷新活动");
  (signupDialog(ui.view())?.props.onConfirm as () => void)();

  (ui.requestSignup().props.onConfirm as () => void)();
  assert.equal(ui.requests[3].init.method, "POST");
  assert.equal(signupDialog(ui.view())?.props.busy, true);
  await ui.finish(2, { ...activity, status: "OPEN", registeredCount: 3, remaining: 7 });
  assert.equal(signupDialog(ui.view())?.props.busy, true, "旧 GET 不能解锁仍在提交的新报名");
  const name = findElement(ui.view(), (element) => element.props.name === "name");
  assert.equal(name?.props.disabled, true);

  ui.requests[3].finish(Response.json({ success: true }));
  await setImmediate();
  assert.equal(
    signupDialog(ui.view())?.props.title,
    repairActivitiesPage.detail.signupSuccessTitle,
  );
  assert.equal(signupDialog(ui.view())?.props.busy, false);
  await ui.finish(4, null);
});

test("本设备已提交时收起报名表单，只保留查询入口", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t, { device: { submitted: true, registration } });
  await ui.finish(0, { ...activity, status: "OPEN" });
  await setImmediate();

  const content = text(ui.view());
  assert.ok(content.includes(copy.deviceRegisteredTitle), "显示已提交面板");
  assert.ok(content.includes(registration.phoneMasked), "显示脱敏手机号");
  assert.ok(
    content.includes(copy.receiptIssueType.replace("{type}", "清灰换硅脂")),
    "已提交面板显示故障类型",
  );
  assert.equal(
    findElement(ui.view(), (element) => element.props["aria-label"] === copy.signupTitle),
    undefined,
    "已提交设备不再渲染报名表单",
  );
  assert.ok(
    findElement(ui.view(), (element) => element.props.id === "repair-activity-lookup-name"),
    "查询表单仍在",
  );
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
  (ui.requestSignup().props.onConfirm as () => void)();
  ui.requests[1].finish(
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

  assert.ok(
    findElement(ui.view(), (element) => element.props["aria-label"] === copy.signupTitle),
    "重新检查后恢复报名表单",
  );
});

test("设备状态查询失败时放开报名表单", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t, { device: "error" });
  await ui.finish(0, { ...activity, status: "OPEN" });
  await setImmediate();

  assert.ok(
    findElement(ui.view(), (element) => element.props["aria-label"] === copy.signupTitle),
    "设备接口失败不能把报名入口挡死",
  );
});

test("设备 409 后状态读取失败时用设备提示，不误报手机号重复", async (t) => {
  const copy = repairActivitiesPage.detail;
  const ui = await mount(t);
  await ui.finish(0, { ...activity, status: "OPEN" });
  ui.setDeviceStatus("error");
  (ui.requestSignup().props.onConfirm as () => void)();
  ui.requests[1].finish(
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
  assert.ok(
    findElement(ui.view(), (element) => element.props["aria-label"] === copy.signupTitle),
    "新活动按自己的状态放开表单",
  );
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
  assert.ok(
    findElement(ui.view(), (element) => element.props["aria-label"] === copy.signupTitle),
    "缺 AbortSignal.any 的浏览器也要能报名",
  );
});
