import assert from "node:assert/strict";
import test from "node:test";

import {
  fillPhotoCopy,
  photoSwipeAction,
  stepPhotoIndex,
} from "../../src/components/repairs/photo-browse";

test("照片文案占位符替换，未知占位符保持原样", () => {
  assert.equal(
    fillPhotoCopy("维修照片 {index}，共 {count} 张", { index: 2, count: 4 }),
    "维修照片 2，共 4 张",
  );
  assert.equal(fillPhotoCopy("第 {index} 张 {unknown}", { index: 1 }), "第 1 张 {unknown}");
});

test("灯箱切图在首尾循环，单张保持原位", () => {
  assert.equal(stepPhotoIndex(0, -1, 3), 2);
  assert.equal(stepPhotoIndex(2, 1, 3), 0);
  assert.equal(stepPhotoIndex(0, 1, 1), 0);
  assert.equal(stepPhotoIndex(0, 1, 0), 0);
});

test("触屏手势：横滑切图、下滑关闭，放大时不抢手势", () => {
  assert.equal(photoSwipeAction(-70, 8, false), "next");
  assert.equal(photoSwipeAction(70, -8, false), "previous");
  assert.equal(photoSwipeAction(10, 100, false), "close");
  assert.equal(photoSwipeAction(10, -100, false), null);
  assert.equal(photoSwipeAction(30, 5, false), null);
  assert.equal(photoSwipeAction(-100, 90, false), "next", "横向距离占优时优先切图");
  assert.equal(photoSwipeAction(-70, 8, true), null, "放大后横滑用于平移图片");
});
