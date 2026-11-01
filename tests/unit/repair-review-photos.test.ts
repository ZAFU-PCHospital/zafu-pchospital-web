import assert from "node:assert/strict";
import test, { before } from "node:test";
import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { RepairPhotoView } from "../../src/types/contracts";

(globalThis as unknown as { React: typeof React }).React = React;

let RepairReviewPhotos: typeof import("../../src/components/admin/RepairReviewPhotos").RepairReviewPhotos;

before(async () => {
  ({ RepairReviewPhotos } = await import("../../src/components/admin/RepairReviewPhotos"));
});

function photo(): RepairPhotoView {
  return {
    id: "p1",
    contentUrl: "/api/v1/repair-photos/p1/content",
    thumbnailUrl: "/api/v1/repair-photos/p1/content?variant=thumb",
    originalName: "现场照片.webp",
    mimeType: "image/webp",
    sizeBytes: 1024,
    width: 1280,
    height: 960,
    sortOrder: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
  };
}

test("审核照片区区分加载中、读取失败与空态", () => {
  const loading = renderToStaticMarkup(
    createElement(RepairReviewPhotos, { photos: null, error: "", onRetry: () => {} }),
  );
  assert.match(loading, /正在加载/);

  const failed = renderToStaticMarkup(
    createElement(RepairReviewPhotos, {
      photos: [],
      error: "当前账号没有执行该操作的权限",
      onRetry: () => {},
    }),
  );
  assert.match(failed, /role="alert"/);
  assert.match(failed, /照片加载失败：当前账号没有执行该操作的权限/);
  assert.match(failed, /重新加载/);
  assert.doesNotMatch(failed, /这条记录没有上传照片/, "读取失败不能显示成空态");

  const empty = renderToStaticMarkup(
    createElement(RepairReviewPhotos, { photos: [], error: "", onRetry: () => {} }),
  );
  assert.match(empty, /这条记录没有上传照片/);
});

test("审核照片区有照片时使用缩略图网格", () => {
  const html = renderToStaticMarkup(
    createElement(RepairReviewPhotos, { photos: [photo()], error: "", onRetry: () => {} }),
  );
  assert.match(html, /variant=thumb/);
  assert.doesNotMatch(html, /src="\/api\/v1\/repair-photos\/p1\/content"/);
  assert.match(html, /现场照片\.webp/, "审核端保留原有文件名提示");
});
