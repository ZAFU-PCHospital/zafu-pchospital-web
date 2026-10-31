import assert from "node:assert/strict";
import test from "node:test";

import { repairEditorCopy } from "../../src/config/repairs";
import {
  formatPhotoSelectionError,
  validatePhotoSelection,
} from "../../src/components/repairs/photo-selection";

const limits = { maxBytes: 1024, maxFiles: 3 };

function file(name: string, bytes: number, type = "image/png"): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

test("一次选择多张合法照片可以全部加入", () => {
  assert.equal(
    validatePhotoSelection([file("a.png", 10), file("b.jpg", 20, "image/jpeg")], 0, limits),
    null,
  );
});

test("不选照片是允许的（照片选填）", () => {
  assert.equal(validatePhotoSelection([], 0, limits), null);
});

test("不支持的图片格式整批拒绝", () => {
  const error = validatePhotoSelection([file("a.pdf", 10, "application/pdf")], 0, limits);
  assert.deepEqual(error, { kind: "unsupported", name: "a.pdf" });
  assert.equal(formatPhotoSelectionError(error!), repairEditorCopy.photoTypeUnsupported);
});

test("超过单张上限时指出文件名与大小", () => {
  const error = validatePhotoSelection([file("big.png", 2048)], 0, limits);
  assert.equal(error?.kind, "too-large");
  assert.equal(
    formatPhotoSelectionError(error!),
    repairEditorCopy.photoTooLarge
      .replace("{name}", "big.png")
      .replace("{size}", "2 KB")
      .replace("{limit}", "1 KB"),
  );
});

test("超过剩余张数时给出还能再选几张，满额时给出上限", () => {
  const remaining = validatePhotoSelection([file("a.png", 1), file("b.png", 1)], 2, limits);
  assert.deepEqual(remaining, {
    kind: "too-many",
    currentCount: 2,
    remain: 1,
    maxFiles: 3,
  });
  assert.equal(
    formatPhotoSelectionError(remaining!),
    repairEditorCopy.photoSelectTooMany.replace("{remain}", "1"),
  );

  const full = validatePhotoSelection([file("a.png", 1)], 3, limits);
  assert.deepEqual(full, { kind: "too-many", currentCount: 3, remain: 0, maxFiles: 3 });
  assert.equal(
    formatPhotoSelectionError(full!),
    repairEditorCopy.photoLimitReached.replace("{count}", "3"),
  );
});
