import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  REPAIR_PHOTO_DISPLAY_QUALITY,
  fitWithin,
  preparePhoto,
  uploadPhotoWithProgress,
} from "../../src/components/repairs/photo-upload";

const originals = new Map<string, PropertyDescriptor | undefined>();

function stubGlobal(key: string, value: unknown) {
  if (!originals.has(key)) originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

class FakeXhr {
  static instances: FakeXhr[] = [];
  upload: {
    onprogress:
      ((event: { lengthComputable: boolean; total: number; loaded: number }) => void) | null;
  } = { onprogress: null };
  status = 0;
  responseText = "";
  timeout = 0;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: FormData | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }

  send(body: FormData) {
    this.body = body;
  }
}

afterEach(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
  FakeXhr.instances = [];
});

function stubBitmap(width = 4000, height = 3000) {
  let closed = false;
  stubGlobal("createImageBitmap", async () => ({
    width,
    height,
    close: () => {
      closed = true;
    },
  }));
  return () => closed;
}

function stubOffscreenCanvas(makeBlob: (width: number, height: number) => Blob) {
  const calls: { width: number; height: number; type?: string; quality?: number }[] = [];
  class FakeOffscreenCanvas {
    constructor(
      public width: number,
      public height: number,
    ) {}

    getContext() {
      return { drawImage: () => {} };
    }

    async convertToBlob(options: { type: string; quality: number }) {
      calls.push({ width: this.width, height: this.height, ...options });
      return makeBlob(this.width, this.height);
    }
  }
  stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
  return calls;
}

test("fitWithin 等比缩到长边以内且不放大", () => {
  assert.deepEqual(fitWithin(4000, 3000, 1280), { width: 1280, height: 960 });
  assert.deepEqual(fitWithin(1000, 800, 1280), { width: 1000, height: 800 });
  assert.deepEqual(fitWithin(100, 2000, 1280), { width: 64, height: 1280 });
});

test("preparePhoto 走真实 Canvas 路径：缩到 1280 长边并编码 WebP", async () => {
  const closed = stubBitmap(4000, 3000);
  const calls = stubOffscreenCanvas(() => new Blob([new Uint8Array(100)], { type: "image/webp" }));
  const source = new File([new Uint8Array(4096)], "big.jpg", { type: "image/jpeg" });

  const prepared = await preparePhoto(source);

  assert.equal(prepared.compressed, true);
  assert.equal(prepared.file.type, "image/webp");
  assert.equal(prepared.originalSize, 4096);
  assert.equal(prepared.preparedSize, 100);
  assert.deepEqual(calls[0], {
    width: 1280,
    height: 960,
    type: "image/webp",
    quality: REPAIR_PHOTO_DISPLAY_QUALITY,
  });
  assert.equal(closed(), true, "编码后释放 ImageBitmap");
});

test("preparePhoto 在编码不更小或编码格式不对时回退原图", async () => {
  stubBitmap(4000, 3000);
  stubOffscreenCanvas(() => new Blob([new Uint8Array(5000)], { type: "image/webp" }));
  const source = new File([new Uint8Array(4096)], "big.jpg", { type: "image/jpeg" });
  const larger = await preparePhoto(source);
  assert.equal(larger.compressed, false);
  assert.equal(larger.file, source);

  stubOffscreenCanvas(() => new Blob([new Uint8Array(100)], { type: "image/png" }));
  const wrongType = await preparePhoto(source);
  assert.equal(wrongType.compressed, false);
  assert.equal(wrongType.file, source);
});

test("preparePhoto 在无法解码时直接回退原图", async () => {
  stubGlobal("createImageBitmap", async () => {
    throw new Error("decoder unavailable");
  });
  const calls = stubOffscreenCanvas(() => new Blob([new Uint8Array(100)], { type: "image/webp" }));
  const source = new File([new Uint8Array(4096)], "broken.jpg", { type: "image/jpeg" });
  const prepared = await preparePhoto(source);

  assert.equal(prepared.compressed, false);
  assert.equal(prepared.file, source);
  assert.equal(calls.length, 0);
});

test("没有 OffscreenCanvas 时退回 DOM canvas 编码", async () => {
  stubBitmap(2000, 1000);
  stubGlobal("OffscreenCanvas", undefined);
  let toBlobArgs: unknown[] = [];
  stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => {} }),
      toBlob: (callback: (blob: Blob | null) => void, type: string, quality: number) => {
        toBlobArgs = [type, quality];
        callback(new Blob([new Uint8Array(50)], { type: "image/webp" }));
      },
    }),
  });
  const prepared = await preparePhoto(
    new File([new Uint8Array(2048)], "dom.png", { type: "image/png" }),
  );

  assert.equal(prepared.compressed, true);
  assert.equal(prepared.preparedSize, 50);
  assert.deepEqual(toBlobArgs, ["image/webp", REPAIR_PHOTO_DISPLAY_QUALITY]);
});

test("XHR 上传带上幂等键与真实进度，成功返回服务端照片", async () => {
  stubGlobal("XMLHttpRequest", FakeXhr);
  const progress: number[] = [];
  const promise = uploadPhotoWithProgress({
    recordId: "record-1",
    file: new File([new Uint8Array(4)], "a.png", { type: "image/png" }),
    uploadKey: "photo-key",
    onProgress: (ratio) => progress.push(ratio),
  });
  const xhr = FakeXhr.instances[0]!;

  assert.equal(xhr.method, "POST");
  assert.equal(xhr.url, "/api/v1/repairs/record-1/photos");
  assert.equal(xhr.headers["Idempotency-Key"], "photo-key");
  assert.equal(xhr.timeout, 120_000);
  assert.equal((xhr.body!.get("photos") as File).name, "a.png");

  xhr.upload.onprogress!({ lengthComputable: true, total: 100, loaded: 42 });
  xhr.upload.onprogress!({ lengthComputable: true, total: 100, loaded: 100 });
  assert.deepEqual(progress, [0.42, 0.99], "上传进度保留 1% 给服务端确认");

  xhr.status = 201;
  xhr.responseText = JSON.stringify({ success: true, data: [{ id: "photo-1" }] });
  xhr.onload!();
  assert.deepEqual(await promise, [{ id: "photo-1" }]);
  assert.equal(progress.at(-1), 1);
});

test("XHR 上传把服务端错误信封作为失败原因", async () => {
  stubGlobal("XMLHttpRequest", FakeXhr);
  const promise = uploadPhotoWithProgress({
    recordId: "record-1",
    file: new File([new Uint8Array(4)], "a.png", { type: "image/png" }),
    onProgress: () => {},
  });
  const xhr = FakeXhr.instances[0]!;
  xhr.status = 413;
  xhr.responseText = JSON.stringify({ success: false, error: { message: "照片太大" } });
  xhr.onload!();
  await assert.rejects(promise, /照片太大/);
});

test("XHR 网络错误与超时给出可重试提示", async () => {
  stubGlobal("XMLHttpRequest", FakeXhr);
  const network = uploadPhotoWithProgress({
    recordId: "record-1",
    file: new File([new Uint8Array(4)], "a.png", { type: "image/png" }),
    onProgress: () => {},
  });
  FakeXhr.instances[0]!.onerror!();
  await assert.rejects(network, /网络异常/);

  const timeout = uploadPhotoWithProgress({
    recordId: "record-1",
    file: new File([new Uint8Array(4)], "a.png", { type: "image/png" }),
    onProgress: () => {},
  });
  FakeXhr.instances[1]!.ontimeout!();
  await assert.rejects(timeout, /超时/);
});

test("没有 XMLHttpRequest 时退回 fetch 并上报完成进度", async () => {
  stubGlobal("XMLHttpRequest", undefined);
  const calls: { url: string; init: RequestInit }[] = [];
  stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Response.json({ success: true, data: [] });
  });
  const progress: number[] = [];
  const data = await uploadPhotoWithProgress({
    recordId: "record-1",
    file: new File([new Uint8Array(4)], "a.png", { type: "image/png" }),
    uploadKey: "photo-key",
    onProgress: (ratio) => progress.push(ratio),
  });

  assert.deepEqual(data, []);
  assert.equal(calls[0]!.url, "/api/v1/repairs/record-1/photos");
  assert.equal((calls[0]!.init.headers as Record<string, string>)["Idempotency-Key"], "photo-key");
  assert.deepEqual(progress, [1]);
});
