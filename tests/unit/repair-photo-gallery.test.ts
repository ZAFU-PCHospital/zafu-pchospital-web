import assert from "node:assert/strict";
import test, { before } from "node:test";
import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { RepairPhotoView } from "../../src/types/contracts";

(globalThis as unknown as { React: typeof React }).React = React;

type Modules = {
  RepairPhotoGallery: typeof import("../../src/components/repairs/RepairPhotoGallery").RepairPhotoGallery;
  PhotoLightboxView: typeof import("../../src/components/repairs/PhotoLightbox").PhotoLightboxView;
  PhotoLightbox: typeof import("../../src/components/repairs/PhotoLightbox").PhotoLightbox;
};

let modules: Modules;

before(async () => {
  const gallery = await import("../../src/components/repairs/RepairPhotoGallery");
  const lightbox = await import("../../src/components/repairs/PhotoLightbox");
  modules = {
    RepairPhotoGallery: gallery.RepairPhotoGallery,
    PhotoLightboxView: lightbox.PhotoLightboxView,
    PhotoLightbox: lightbox.PhotoLightbox,
  };
});

function photo(overrides: Partial<RepairPhotoView> = {}): RepairPhotoView {
  const id = overrides.id ?? "p1";
  return {
    id,
    contentUrl: `/api/v1/repair-photos/${id}/content`,
    thumbnailUrl: `/api/v1/repair-photos/${id}/content?variant=thumb`,
    originalName: "demo.jpg",
    mimeType: "image/webp",
    sizeBytes: 1024,
    width: 1280,
    height: 960,
    sortOrder: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

test("缩略图网格只引用 thumb 变体，并按契约宽高占位", () => {
  const html = renderToStaticMarkup(
    createElement(modules.RepairPhotoGallery, {
      photos: [photo(), photo({ id: "p2", sortOrder: 1 })],
    }),
  );

  assert.match(html, /src="\/api\/v1\/repair-photos\/p1\/content\?variant=thumb"/);
  assert.match(html, /src="\/api\/v1\/repair-photos\/p2\/content\?variant=thumb"/);
  assert.doesNotMatch(html, /src="\/api\/v1\/repair-photos\/p1\/content"/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /decoding="async"/);
  assert.match(html, /width="1280"/);
  assert.match(html, /height="960"/);
  assert.match(html, /alt="维修照片 1，共 2 张"/);
  assert.match(html, /aria-label="查看维修照片 2，共 2 张"/);
  assert.doesNotMatch(html, /demo\.jpg/, "成员端默认不显示原始文件名");
  assert.doesNotMatch(html, /第 1 \/ 2 张/, "未打开灯箱时不渲染预览层");
});

test("历史照片没有像素尺寸时使用默认占位", () => {
  const html = renderToStaticMarkup(
    createElement(modules.RepairPhotoGallery, {
      photos: [photo({ width: null, height: null })],
    }),
  );
  assert.match(html, /width="320"/);
  assert.match(html, /height="240"/);
});

test("灯箱使用 display 图、计数与操作按钮", () => {
  const html = renderToStaticMarkup(
    createElement(modules.PhotoLightboxView, {
      photos: [photo(), photo({ id: "p2", sortOrder: 1 })],
      index: 1,
      onIndexChange: () => {},
      onClose: () => {},
    }),
  );

  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /照片预览/);
  assert.match(html, /第 2 \/ 2 张/);
  assert.match(html, /src="\/api\/v1\/repair-photos\/p2\/content"/);
  assert.doesNotMatch(html, /variant=thumb/, "灯箱打开后才取 display，不再用缩略图");
  assert.match(html, /aria-label="上一张照片"/);
  assert.match(html, /aria-label="下一张照片"/);
  assert.match(html, /aria-label="关闭照片预览"/);
  assert.match(html, /放大至原始尺寸/);
  assert.match(html, /正在加载照片/);
  assert.match(html, /alt="维修照片 2，共 2 张"/);
});

test("单张照片不渲染上一张 / 下一张", () => {
  const html = renderToStaticMarkup(
    createElement(modules.PhotoLightboxView, {
      photos: [photo()],
      index: 0,
      onIndexChange: () => {},
      onClose: () => {},
    }),
  );
  assert.doesNotMatch(html, /上一张照片|下一张照片/);
});

test("服务端渲染不挂载灯箱 Portal", () => {
  assert.equal(
    modules.PhotoLightbox({
      photos: [photo()],
      index: 0,
      onIndexChange: () => {},
      onClose: () => {},
    }),
    null,
  );
});
