import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers/promises";
import test, { before, type TestContext } from "node:test";
import type { ReactElement, ReactNode } from "react";

const require = createRequire(import.meta.url);
const React = require("react") as typeof import("react");

let RepairEditorView: typeof import("../../src/components/repairs/RepairEditor").RepairEditorView;

before(async () => {
  (globalThis as unknown as { React: typeof React }).React = React;
  ({ RepairEditorView } = await import("../../src/components/repairs/RepairEditor"));
});

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

function findButton(node: ReactNode, label: string) {
  return findElement(
    node,
    (element) => element.props.children === label && typeof element.props.onClick === "function",
  );
}

const photoLimits = { maxBytes: 10 * 1024 * 1024, maxFiles: 9 };

/** 复用既有客户端测试的 hook 存储方式；只驱动真实 JSX / effect，不启动 Next。 */
async function mount(t: TestContext) {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-31T06:00:00Z") });
  (globalThis as unknown as { React: typeof React }).React = React;
  const originals = ["window", "document"].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  const events = {
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { ...events },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { visibilityState: "visible", ...events },
  });
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  URL.createObjectURL = () => "blob:mock";
  URL.revokeObjectURL = () => {};
  const slots: unknown[] = [];
  const effects: { deps?: unknown[]; cleanup?: () => void }[] = [];
  const callbacks: { deps?: unknown[]; callback: unknown }[] = [];
  let cursor = 0;
  let effectIndex = 0;
  let callbackIndex = 0;
  let pendingEffects: (() => void)[] = [];
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
    pendingEffects.push(() => {
      previous?.cleanup?.();
      const cleanup = effect();
      effects[index] = { deps, cleanup: typeof cleanup === "function" ? cleanup : undefined };
    });
  });

  const requests: {
    url: string;
    init: RequestInit;
    finish(response: Response): void;
    fail(error: unknown): void;
  }[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    (url: string, init: RequestInit) =>
      new Promise<Response>((finish, fail) => {
        requests.push({ url, init, finish, fail });
      }),
  );

  const navigations: string[] = [];
  const router = {
    push(href: string) {
      navigations.push(href);
    },
    replace(href: string) {
      navigations.push(href);
    },
  };
  const view = () => {
    cursor = effectIndex = callbackIndex = 0;
    const node = RepairEditorView({ allowSaveDraft: false, photoLimits, router });
    const queue = pendingEffects;
    pendingEffects = [];
    queue.forEach((run) => run());
    return node;
  };

  async function finish(index: number, body: unknown, status = 200) {
    requests[index].finish(Response.json(body, { status }));
    await setImmediate();
  }

  t.after(() => {
    effects.forEach((slot) => slot.cleanup?.());
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  view();
  return { view, requests, finish, navigations };
}

type Ui = Awaited<ReturnType<typeof mount>>;

async function loadReady(ui: Ui) {
  await ui.finish(0, {
    success: true,
    data: [
      {
        id: "clean",
        code: "clean",
        name: "清灰保养",
        description: null,
        sortOrder: 1,
        isActive: true,
      },
    ],
  });
  await ui.finish(1, {
    success: true,
    data: { memberProfileId: "member-1", displayName: "演示成员" },
  });
  await ui.finish(2, {
    success: true,
    data: [{ id: "member-2", name: "协作成员" }],
  });
  ui.view();
}

function changeField(
  ui: Ui,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
  value: string,
) {
  const element = findElement(ui.view(), predicate);
  assert.ok(element);
  (element.props.onChange as (event: unknown) => void)({ target: { value } });
}

function fillRequired(ui: Ui, ownerName = "演示客户") {
  if (ownerName)
    changeField(
      ui,
      (element) => element.props["aria-describedby"] === "repair-owner-name-hint",
      ownerName,
    );
  changeField(
    ui,
    (element) => element.props["aria-describedby"] === "repair-device-model-hint",
    "联想小新 Pro 14",
  );
  changeField(ui, (element) => element.props.type === "number", "45");
  changeField(ui, (element) => element.props.type === "tel", "13800000000");
  changeField(ui, (element) => element.type === "select", "clean");
  ui.view();
}

function addPhotos(ui: Ui) {
  const picker = findElement(
    ui.view(),
    (element) => typeof element.props.onAdd === "function" && Array.isArray(element.props.photos),
  );
  assert.ok(picker);
  (picker.props.onAdd as (files: File[]) => void)([
    new File([new Uint8Array(4)], "before.png", { type: "image/png" }),
    new File([new Uint8Array(4)], "after.png", { type: "image/png" }),
  ]);
  ui.view();
}

function goNext(ui: Ui) {
  (findButton(ui.view(), "下一步")!.props.onClick as () => void)();
  ui.view();
}

function submitConfirm(ui: Ui) {
  (findButton(ui.view(), "确认提交")!.props.onClick as () => void)();
}

test("确认提交先建单再批量上传；失败重试不重复建单，上传中不可移除照片", async (t) => {
  const ui = await mount(t);
  await ui.finish(0, {
    success: true,
    data: [
      {
        id: "clean",
        code: "clean",
        name: "清灰保养",
        description: null,
        sortOrder: 1,
        isActive: true,
      },
    ],
  });
  await ui.finish(1, {
    success: true,
    data: { memberProfileId: "member-1", displayName: "演示成员" },
  });
  await ui.finish(2, {
    success: true,
    data: [{ id: "member-2", name: "协作成员" }],
  });
  ui.view();

  const change = (element: ReactElement<Record<string, unknown>>, value: string) =>
    (element.props.onChange as (event: unknown) => void)({ target: { value } });
  change(
    findElement(
      ui.view(),
      (element) => element.props["aria-describedby"] === "repair-owner-name-hint",
    )!,
    "演示客户",
  );
  change(
    findElement(
      ui.view(),
      (element) => element.props["aria-describedby"] === "repair-device-model-hint",
    )!,
    "联想小新 Pro 14",
  );
  change(
    findElement(ui.view(), (element) => element.props.type === "number")!,
    "45",
  );
  change(
    findElement(ui.view(), (element) => element.props.type === "tel")!,
    "13800000000",
  );
  change(
    findElement(ui.view(), (element) => element.type === "select")!,
    "clean",
  );
  ui.view();

  const photoPicker = findElement(
    ui.view(),
    (element) => typeof element.props.onAdd === "function" && Array.isArray(element.props.photos),
  );
  assert.ok(photoPicker);
  (photoPicker.props.onAdd as (files: File[]) => void)([
    new File([new Uint8Array(4)], "before.png", { type: "image/png" }),
    new File([new Uint8Array(4)], "after.png", { type: "image/png" }),
  ]);
  ui.view();
  assert.equal(
    (
      findElement(
        ui.view(),
        (element) =>
          typeof element.props.onAdd === "function" && Array.isArray(element.props.photos),
      )!.props.photos as unknown[]
    ).length,
    2,
  );

  (findButton(ui.view(), "下一步")!.props.onClick as () => void)();
  ui.view();
  (findButton(ui.view(), "确认提交")!.props.onClick as () => void)();
  await setImmediate();

  assert.equal(ui.requests[3].url, "/api/v1/repairs");
  assert.equal(ui.requests[3].init.method, "POST");
  const createBody = JSON.parse(String(ui.requests[3].init.body)) as Record<string, unknown>;
  assert.equal(createBody.ownerName, "演示客户");
  assert.equal(createBody.deviceModel, "联想小新 Pro 14");
  assert.equal(createBody.categoryId, "clean");
  assert.equal(createBody.participantIds instanceof Array, true);

  await ui.finish(3, { success: true, data: { id: "record-1" } }, 201);
  ui.view();
  const summary = findElement(
    ui.view(),
    (element) => element.props.record !== undefined && Array.isArray(element.props.photos),
  );
  assert.ok(summary);
  assert.equal(summary.props.onRemovePhoto, undefined, "上传在途时移除按钮不可用");

  assert.equal(ui.requests[4].url, "/api/v1/repairs/record-1/photos");
  assert.equal(ui.requests[4].init.method, "POST");
  const uploaded = ui.requests[4].init.body as FormData;
  assert.equal(uploaded.getAll("photos").length, 2, "一次批量上传两张");

  await ui.finish(4, { success: false, error: { message: "照片保存失败，请重试" } }, 500);
  ui.view();
  assert.ok(text(ui.view()).includes("记录已创建，但照片上传失败"));
  const failedSummary = findElement(
    ui.view(),
    (element) => element.props.record !== undefined && Array.isArray(element.props.photos),
  );
  assert.ok(failedSummary);
  assert.equal(typeof failedSummary.props.onRemovePhoto, "function", "失败后允许移除");

  const photosAfterFailure = failedSummary.props.photos as { id: string }[];
  (failedSummary.props.onRemovePhoto as (id: string) => void)(photosAfterFailure[0]!.id);
  ui.view();
  const afterRemove = findElement(
    ui.view(),
    (element) => element.props.record !== undefined && Array.isArray(element.props.photos),
  );
  assert.equal((afterRemove!.props.photos as unknown[]).length, 1);

  (findButton(ui.view(), "重试上传")!.props.onClick as () => void)();
  await setImmediate();
  assert.equal(ui.requests[5].url, "/api/v1/repairs/record-1/photos");
  assert.equal(ui.requests.filter((request) => request.url === "/api/v1/repairs").length, 1);
  assert.equal((ui.requests[5].init.body as FormData).getAll("photos").length, 1);

  await ui.finish(5, { success: false, error: { message: "照片保存失败，请重试" } }, 500);
  assert.equal(ui.requests.filter((request) => request.url === "/api/v1/repairs").length, 1);
});

test("上传成功后跳转记录详情，不重复建单", async (t) => {
  const ui = await mount(t);
  await loadReady(ui);
  fillRequired(ui);
  addPhotos(ui);
  goNext(ui);
  submitConfirm(ui);
  await setImmediate();

  assert.equal(ui.requests[3].url, "/api/v1/repairs");
  await ui.finish(3, { success: true, data: { id: "record-1" } }, 201);
  assert.equal(ui.requests[4].url, "/api/v1/repairs/record-1/photos");
  await ui.finish(4, { success: true, data: [] }, 201);

  assert.deepEqual(ui.navigations, ["/member/repairs/record-1"]);
  assert.equal(ui.requests.filter((request) => request.url === "/api/v1/repairs").length, 1);
});

test("建单失败停留确认页，不发照片请求，可返回修改", async (t) => {
  const ui = await mount(t);
  await loadReady(ui);
  fillRequired(ui);
  addPhotos(ui);
  goNext(ui);
  submitConfirm(ui);
  await setImmediate();

  assert.equal(ui.requests[3].url, "/api/v1/repairs");
  await ui.finish(3, { success: false, error: { message: "所选分类不存在" } }, 400);
  ui.view();

  assert.ok(text(ui.view()).includes("所选分类不存在"));
  assert.equal(ui.requests.filter((request) => request.url.includes("/photos")).length, 0);
  assert.ok(findButton(ui.view(), "返回修改"));
  assert.ok(findButton(ui.view(), "确认提交"));
});

test("必填项缺失时停在填写页，不建单", async (t) => {
  const ui = await mount(t);
  await loadReady(ui);
  fillRequired(ui, "");
  goNext(ui);

  assert.ok(text(ui.view()).includes("请填写机主姓名"));
  assert.equal(ui.requests.length, 3);
  assert.ok(
    findElement(
      ui.view(),
      (element) => element.props["aria-describedby"] === "repair-owner-name-hint",
    ),
  );
});
