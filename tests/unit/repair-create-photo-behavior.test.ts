import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers/promises";
import test, { before, type TestContext } from "node:test";
import type { ReactElement, ReactNode } from "react";

import type { RepairDetailView, RepairPhotoView } from "../../src/types/contracts";
import { repairEditorCopy } from "../../src/config/repairs";

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
async function mount(
  t: TestContext,
  options: {
    recordId?: string;
    allowSaveDraft?: boolean;
    prepare?: (file: File) => Promise<{
      file: File;
      compressed: boolean;
      originalSize: number;
      preparedSize: number;
    }>;
  } = {},
) {
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
  const uploads: {
    recordId: string;
    file: File;
    uploadKey?: string;
    onProgress: (ratio: number) => void;
    finish(ids: string[]): void;
    fail(error: unknown): void;
  }[] = [];
  const prepareCalls: File[] = [];
  const preparePhotoFn =
    options.prepare ??
    (async (file: File) => ({
      file,
      compressed: false,
      originalSize: file.size,
      preparedSize: file.size,
    }));
  const uploadPhotoFn = ({
    recordId,
    file,
    uploadKey,
    onProgress,
  }: {
    recordId: string;
    file: File;
    uploadKey?: string;
    onProgress: (ratio: number) => void;
  }) =>
    new Promise<RepairPhotoView[]>((resolve, reject) => {
      uploads.push({
        recordId,
        file,
        uploadKey,
        onProgress,
        finish: (ids) => resolve(ids.map((id) => ({ id }) as RepairPhotoView)),
        fail: reject,
      });
    });
  const view = () => {
    cursor = effectIndex = callbackIndex = 0;
    const node = RepairEditorView({
      recordId: options.recordId,
      allowSaveDraft: options.allowSaveDraft ?? false,
      photoLimits,
      router,
      preparePhotoFn: async (file) => {
        prepareCalls.push(file);
        return preparePhotoFn(file);
      },
      uploadPhotoFn,
    });
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
  return { view, requests, finish, navigations, uploads, prepareCalls };
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

function editRecord(): RepairDetailView {
  return {
    id: "record-1",
    member: { id: "member-1", name: "演示成员" },
    participants: [{ id: "member-1", name: "演示成员" }],
    repairDate: "2026-10-31",
    durationMinutes: null,
    category: {
      id: "clean",
      code: "clean",
      name: "清灰保养",
      description: null,
      sortOrder: 1,
      isActive: true,
    },
    deviceModel: null,
    ownerName: null,
    ownerPhone: null,
    content: null,
    result: "COMPLETED",
    remark: null,
    status: "DRAFT",
    isDifficult: false,
    isTypical: false,
    version: 1,
    submittedAt: null,
    reviewedAt: null,
    createdAt: "2026-10-31T06:00:00.000Z",
    updatedAt: "2026-10-31T06:00:00.000Z",
    photos: [],
    reviews: [],
    timeline: [],
    canEdit: true,
    canAttachPhotos: true,
    canReview: false,
    canFlag: false,
    isFavorited: false,
    photoLimits,
  };
}

async function loadEditReady(ui: Ui) {
  await ui.finish(0, { success: true, data: editRecord() });
  await ui.finish(1, {
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
  await ui.finish(2, { success: true, data: [{ id: "member-2", name: "协作成员" }] });
  ui.view();
}

function addEditPhotos(ui: Ui) {
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

function summaryOf(ui: Ui) {
  const summary = findElement(
    ui.view(),
    (element) => element.props.record !== undefined && Array.isArray(element.props.photos),
  );
  assert.ok(summary);
  return summary;
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

test("逐张上传：单张失败只重试失败项，不重复建单，上传中不可移除照片", async (t) => {
  const ui = await mount(t);
  await loadReady(ui);
  fillRequired(ui);
  addPhotos(ui);
  goNext(ui);
  submitConfirm(ui);
  await setImmediate();

  assert.equal(ui.requests[3].url, "/api/v1/repairs");
  const createBody = JSON.parse(String(ui.requests[3].init.body)) as Record<string, unknown>;
  assert.equal(createBody.ownerName, "演示客户");
  assert.equal(createBody.deviceModel, "联想小新 Pro 14");
  await ui.finish(3, { success: true, data: { id: "record-1" } }, 201);
  await setImmediate();

  assert.equal(ui.uploads.length, 1, "第一张先上传");
  assert.equal(ui.uploads[0]!.recordId, "record-1");
  assert.ok(ui.uploads[0]!.uploadKey, "每张照片带幂等键");
  const during = findElement(
    ui.view(),
    (element) => element.props.record !== undefined && Array.isArray(element.props.photos),
  );
  assert.equal(during?.props.onRemovePhoto, undefined, "上传在途不可移除");
  assert.equal(during?.props.onRetryPhoto, undefined);
  ui.uploads[0]!.onProgress(0.4);
  const uploading = findElement(
    ui.view(),
    (element) => element.props.record !== undefined && Array.isArray(element.props.photos),
  );
  const uploadingPhotos = uploading?.props.photos as { status?: string; progress?: number }[];
  assert.equal(uploadingPhotos[0]?.status, "uploading");
  assert.equal(uploadingPhotos[0]?.progress, 0.4);

  ui.uploads[0]!.fail(new Error("网络异常，照片未上传，请重试"));
  await setImmediate();
  assert.equal(ui.uploads.length, 2, "一张失败不阻塞下一张");
  ui.uploads[1]!.finish(["photo-2"]);
  await setImmediate();
  assert.equal(ui.requests[4].url, "/api/v1/repairs/record-1");
  await ui.finish(4, { success: true, data: { photos: [] } });
  ui.view();
  assert.ok(text(ui.view()).includes("1 张照片上传失败"));
  const failedSummary = findElement(
    ui.view(),
    (element) => element.props.record !== undefined && Array.isArray(element.props.photos),
  );
  assert.ok(failedSummary);
  assert.equal(typeof failedSummary.props.onRemovePhoto, "function", "失败后允许移除");
  assert.equal(typeof failedSummary.props.onRetryPhoto, "function", "失败后允许单张重试");

  (findButton(ui.view(), "重试上传")!.props.onClick as () => void)();
  await setImmediate();
  assert.equal(ui.uploads.length, 3);
  assert.equal(ui.uploads[2]!.uploadKey, ui.uploads[0]!.uploadKey, "重试复用原幂等键");
  assert.equal(ui.uploads[2]!.file.name, "before.png");
  ui.uploads[2]!.finish(["photo-1"]);
  await setImmediate();
  assert.equal(ui.requests[5].url, "/api/v1/repairs/record-1");
  await ui.finish(5, { success: true, data: { photos: [] } });
  ui.view();
  assert.deepEqual(ui.navigations, ["/member/repairs/record-1"]);
  assert.equal(ui.requests.filter((request) => request.url === "/api/v1/repairs").length, 1);
});

test("两张都成功后跳转记录详情，不重复建单", async (t) => {
  const ui = await mount(t);
  await loadReady(ui);
  fillRequired(ui);
  addPhotos(ui);
  goNext(ui);
  submitConfirm(ui);
  await setImmediate();

  assert.equal(ui.requests[3].url, "/api/v1/repairs");
  await ui.finish(3, { success: true, data: { id: "record-1" } }, 201);
  await setImmediate();
  assert.equal(ui.uploads.length, 1);
  ui.uploads[0]!.finish(["photo-1"]);
  await setImmediate();
  assert.equal(ui.uploads.length, 2);
  ui.uploads[1]!.finish(["photo-2"]);
  await setImmediate();
  assert.equal(ui.requests[4].url, "/api/v1/repairs/record-1");
  await ui.finish(4, { success: true, data: { photos: [] } });
  await setImmediate();

  assert.deepEqual(ui.navigations, ["/member/repairs/record-1"]);
  assert.equal(ui.requests.filter((request) => request.url === "/api/v1/repairs").length, 1);
});

test("上传前压缩：使用压缩后的文件并显示压缩前后体积", async (t) => {
  const ui = await mount(t, {
    prepare: async (file) => ({
      file: new File([new Uint8Array(2)], file.name, { type: "image/webp" }),
      compressed: true,
      originalSize: 4096,
      preparedSize: 1024,
    }),
  });
  await loadReady(ui);
  fillRequired(ui);
  addPhotos(ui);
  goNext(ui);
  submitConfirm(ui);
  await setImmediate();
  await ui.finish(3, { success: true, data: { id: "record-1" } }, 201);
  await setImmediate();

  assert.equal(ui.prepareCalls.length, 1);
  assert.equal(ui.uploads[0]!.file.type, "image/webp", "上传的是压缩后的文件");
  ui.uploads[0]!.finish(["photo-1"]);
  await setImmediate();
  const compressed = findElement(
    ui.view(),
    (element) => element.props.record !== undefined && Array.isArray(element.props.photos),
  );
  const compressedPhotos = compressed?.props.photos as {
    compressed?: boolean;
    originalSize?: number;
    preparedSize?: number;
  }[];
  assert.equal(compressedPhotos[0]?.compressed, true);
  assert.equal(compressedPhotos[0]?.originalSize, 4);
  assert.equal(compressedPhotos[0]?.preparedSize, 1024);

  ui.uploads[1]!.finish(["photo-2"]);
  await setImmediate();
  await ui.finish(4, { success: true, data: { photos: [] } });
  await setImmediate();
  assert.deepEqual(ui.navigations, ["/member/repairs/record-1"]);
});

test("HEIC 在选择阶段明确拒绝，不进入上传或建单", async (t) => {
  const ui = await mount(t);
  await loadReady(ui);
  fillRequired(ui);
  const picker = findElement(
    ui.view(),
    (element) => typeof element.props.onAdd === "function" && Array.isArray(element.props.photos),
  );
  assert.ok(picker);
  (picker.props.onAdd as (files: File[]) => void)([
    new File([new Uint8Array(4)], "IMG_0001.HEIC", { type: "image/heic" }),
  ]);
  ui.view();
  assert.ok(text(ui.view()).includes(repairEditorCopy.photoHeicUnsupported));
  assert.equal(ui.requests.length, 3);
  assert.equal(ui.uploads.length, 0);
  const after = findElement(
    ui.view(),
    (element) => typeof element.props.onAdd === "function" && Array.isArray(element.props.photos),
  );
  assert.deepEqual(after!.props.photos, []);
});

test("重复选择同一文件被跳过并提示", async (t) => {
  const ui = await mount(t);
  await loadReady(ui);
  const picker = findElement(
    ui.view(),
    (element) => typeof element.props.onAdd === "function" && Array.isArray(element.props.photos),
  );
  assert.ok(picker);
  const same = new File([new Uint8Array(4)], "same.png", {
    type: "image/png",
    lastModified: 100,
  });
  (picker.props.onAdd as (files: File[]) => void)([same, same]);
  ui.view();
  assert.ok(text(ui.view()).includes("已跳过 1 张重复选择的照片"));
  const after = findElement(
    ui.view(),
    (element) => typeof element.props.onAdd === "function" && Array.isArray(element.props.photos),
  );
  assert.equal((after!.props.photos as unknown[]).length, 1);
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

test("编辑页上传成功但列表刷新失败时提示刷新，不产生未处理异常", async (t) => {
  const ui = await mount(t, { recordId: "record-1" });
  await loadEditReady(ui);
  addEditPhotos(ui);
  await setImmediate();
  assert.equal(ui.uploads.length, 1);

  ui.uploads[0]!.finish(["photo-1"]);
  await setImmediate();
  assert.equal(ui.uploads.length, 2);
  ui.uploads[1]!.finish(["photo-2"]);
  await setImmediate();
  assert.equal(ui.requests[3]!.url, "/api/v1/repairs/record-1");

  // 刷新请求网络失败：不能把它当成上传失败，也不能留下未处理的 rejection。
  ui.requests[3]!.fail(new Error("网络异常"));
  await setImmediate();
  assert.ok(text(ui.view()).includes(repairEditorCopy.photoRefreshFailed));
  const picker = findElement(
    ui.view(),
    (element) => typeof element.props.onAdd === "function" && Array.isArray(element.props.photos),
  );
  assert.equal((picker!.props.photos as unknown[]).length, 0, "成功项已移出待上传队列");
});

test("建单后成功项不能被本地移除，只有失败项可移除", async (t) => {
  const ui = await mount(t);
  await loadReady(ui);
  fillRequired(ui);
  addPhotos(ui);
  goNext(ui);
  submitConfirm(ui);
  await setImmediate();
  await ui.finish(3, { success: true, data: { id: "record-1" } }, 201);
  await setImmediate();

  ui.uploads[0]!.fail(new Error("网络异常"));
  await setImmediate();
  ui.uploads[1]!.finish(["photo-2"]);
  await setImmediate();
  await ui.finish(4, { success: true, data: { photos: [] } });
  ui.view();

  const current = summaryOf(ui).props.photos as { id: string; status?: string }[];
  const successId = current.find((photo) => photo.status === "success")!.id;
  const failedId = current.find((photo) => photo.status === "error")!.id;
  (summaryOf(ui).props.onRemovePhoto as (id: string) => void)(successId);
  assert.equal((summaryOf(ui).props.photos as unknown[]).length, 2, "成功项不能被本地删除");
  (summaryOf(ui).props.onRemovePhoto as (id: string) => void)(failedId);
  assert.equal((summaryOf(ui).props.photos as unknown[]).length, 1);
});

test("确认页单张重试成功后刷新失败也不抛错并完成建单", async (t) => {
  const ui = await mount(t);
  await loadReady(ui);
  fillRequired(ui);
  addPhotos(ui);
  goNext(ui);
  submitConfirm(ui);
  await setImmediate();
  await ui.finish(3, { success: true, data: { id: "record-1" } }, 201);
  await setImmediate();

  ui.uploads[0]!.fail(new Error("网络异常"));
  await setImmediate();
  ui.uploads[1]!.finish(["photo-2"]);
  await setImmediate();
  await ui.finish(4, { success: true, data: { photos: [] } });
  ui.view();

  const failed = (summaryOf(ui).props.photos as { id: string; status?: string }[]).find(
    (photo) => photo.status === "error",
  )!;
  (summaryOf(ui).props.onRetryPhoto as (id: string) => void)(failed.id);
  await setImmediate();
  assert.equal(ui.uploads.length, 3);
  ui.uploads[2]!.finish(["photo-1"]);
  await setImmediate();
  assert.equal(ui.requests[5]!.url, "/api/v1/repairs/record-1");

  ui.requests[5]!.fail(new Error("刷新失败"));
  await setImmediate();
  assert.deepEqual(ui.navigations, ["/member/repairs/record-1"]);
});
