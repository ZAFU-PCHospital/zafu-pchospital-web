import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { before } from "node:test";
import type { ReactElement, ReactNode } from "react";

import type { PendingPhoto } from "../../src/components/repairs/PendingPhotoPicker";

const require = createRequire(import.meta.url);
const React = require("react") as typeof import("react");
let PendingPhotoPicker: typeof import("../../src/components/repairs/PendingPhotoPicker").PendingPhotoPicker;

before(async () => {
  (globalThis as unknown as { React: typeof React }).React = React;
  ({ PendingPhotoPicker } = await import("../../src/components/repairs/PendingPhotoPicker"));
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

function pendingPhoto(index: number): PendingPhoto {
  return {
    id: `photo-${index}`,
    file: new File([new Uint8Array(4)], `photo-${index}.png`, { type: "image/png" }),
    previewUrl: `blob:photo-${index}`,
  };
}

test("文件选择一次接收多张照片并清空 input 以便重选", () => {
  let added: File[] = [];
  const tree = PendingPhotoPicker({
    photos: [],
    hint: "选填，最多 3 张",
    emptyLabel: "未选择照片",
    onAdd: (files) => {
      added = files;
    },
    onRemove: () => {},
  });
  const input = findElement(
    tree,
    (element) => element.type === "input" && element.props.type === "file",
  );
  assert.ok(input);
  assert.equal(input.props.multiple, true);
  assert.equal(input.props.accept, "image/jpeg,image/png,image/webp,image/heic,image/heif");
  assert.ok(text(tree).includes("未选择照片"));

  const files = [
    new File([new Uint8Array(1)], "a.png", { type: "image/png" }),
    new File([new Uint8Array(1)], "b.png", { type: "image/png" }),
  ];
  const target = { files, value: "selected" };
  (input.props.onChange as (event: unknown) => void)({ target });
  assert.deepEqual(added, files);
  assert.equal(target.value, "", "清空 input 后才能再次选择同一张图片");
});

test("已选照片显示预览与移除按钮", () => {
  let removed = "";
  const photos = [pendingPhoto(1), pendingPhoto(2)];
  const tree = PendingPhotoPicker({
    photos,
    emptyLabel: "未选择照片",
    onRemove: (id) => {
      removed = id;
    },
  });
  assert.equal(
    findElement(tree, (element) => element.props.alt === "待上传照片 1") !== undefined,
    true,
  );
  assert.equal(
    findElement(tree, (element) => element.props.alt === "待上传照片 2") !== undefined,
    true,
  );
  const firstRemove = findElement(
    tree,
    (element) => element.props["aria-label"] === "移除待上传照片 1",
  );
  assert.ok(firstRemove);
  assert.ok(findElement(tree, (element) => element.props["aria-label"] === "移除待上传照片 2"));
  (firstRemove.props.onClick as () => void)();
  assert.equal(removed, "photo-1");
});

test("确认步骤只读展示照片，不提供再次选择或移除", () => {
  const tree = PendingPhotoPicker({
    photos: [pendingPhoto(1)],
    readOnly: true,
    emptyLabel: "未选择照片",
    disabled: true,
  });
  assert.equal(
    findElement(tree, (element) => element.type === "input" && element.props.type === "file"),
    undefined,
  );
  assert.equal(
    findElement(tree, (element) => element.props.children === "移除"),
    undefined,
  );
  assert.ok(findElement(tree, (element) => element.props.alt === "待上传照片 1") !== undefined);
});

test("只读但允许移除时保留移除按钮，仍不显示文件输入", () => {
  let removed = "";
  const tree = PendingPhotoPicker({
    photos: [pendingPhoto(1)],
    readOnly: true,
    allowRemove: true,
    emptyLabel: "未选择照片",
    onRemove: (id) => {
      removed = id;
    },
  });
  assert.equal(
    findElement(tree, (element) => element.type === "input" && element.props.type === "file"),
    undefined,
  );
  const remove = findElement(tree, (element) => element.props["aria-label"] === "移除待上传照片 1");
  assert.ok(remove);
  (remove.props.onClick as () => void)();
  assert.equal(removed, "photo-1");
});

test("逐张状态：进度、压缩体积、失败原因与单张重试", () => {
  let retried = "";
  const photos: PendingPhoto[] = [
    {
      ...pendingPhoto(1),
      status: "uploading",
      progress: 0.42,
      originalSize: 4096,
      preparedSize: 1024,
      compressed: true,
    },
    {
      ...pendingPhoto(2),
      status: "error",
      error: "网络异常，照片未上传，请重试",
      originalSize: 2048,
    },
  ];
  const tree = PendingPhotoPicker({
    photos,
    emptyLabel: "未选择照片",
    onRetry: (id) => {
      retried = id;
    },
  });
  const content = text(tree);
  assert.ok(content.includes("上传中 42%"), "上传中要显示进度");
  assert.ok(content.includes("已压缩 4 KB → 1 KB"), "压缩后显示前后体积");
  assert.ok(content.includes("上传失败"));
  assert.ok(content.includes("网络异常，照片未上传，请重试"));
  const retry = findElement(tree, (element) => element.props["aria-label"] === "重试上传照片 2");
  assert.ok(retry);
  (retry.props.onClick as () => void)();
  assert.equal(retried, "photo-2");
});

test("选择器提供拖拽投放与拍照入口", () => {
  let added: File[] = [];
  const tree = PendingPhotoPicker({
    photos: [],
    emptyLabel: "未选择照片",
    onAdd: (files) => {
      added = files;
    },
  });
  const camera = findElement(
    tree,
    (element) => element.type === "input" && element.props.capture === "environment",
  );
  assert.ok(camera, "手机端要有相机入口");
  assert.equal(camera.props.accept, "image/jpeg,image/png,image/webp,image/heic,image/heif");

  const dropzone = findElement(tree, (element) => element.props.className === "photo-dropzone");
  assert.ok(dropzone, "要有拖拽投放区");
  const file = new File([new Uint8Array(1)], "drop.png", { type: "image/png" });
  (dropzone.props.onDrop as (event: unknown) => void)({
    preventDefault: () => {},
    currentTarget: { dataset: {} },
    dataTransfer: { files: [file] },
  });
  assert.deepEqual(added, [file]);
});
