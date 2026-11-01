import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import { processRepairPhoto } from "../../src/features/repairs/repair-photo-image";
import { AppError } from "../../src/lib/api/errors";

test("生成 1280 display 与 320 thumb，保持比例并输出 WebP", async () => {
  const source = await sharp({
    create: { width: 2000, height: 1000, channels: 3, background: "#336699" },
  })
    .jpeg()
    .toBuffer();

  const processed = await processRepairPhoto(new Uint8Array(source));
  assert.equal(processed.display.width, 1280);
  assert.equal(processed.display.height, 640);
  assert.equal(processed.thumbnail.width, 320);
  assert.equal(processed.thumbnail.height, 160);

  for (const variant of [processed.display, processed.thumbnail]) {
    const meta = await sharp(Buffer.from(variant.bytes)).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.exif, undefined, "输出不得保留 EXIF/GPS");
    assert.ok(variant.digest.length === 32);
    assert.ok(variant.bytes.byteLength > 0);
  }
});

test("按 EXIF 方向纠正后再缩放，且不放大原图", async () => {
  const source = await sharp({
    create: { width: 60, height: 30, channels: 3, background: "#993333" },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();

  const processed = await processRepairPhoto(new Uint8Array(source));
  // orientation=6 表示顺时针旋转 90°：60×30 → 30×60。
  assert.equal(processed.display.width, 30);
  assert.equal(processed.display.height, 60);
  assert.equal(processed.thumbnail.width, 30);
  assert.equal(processed.thumbnail.height, 60);

  const meta = await sharp(Buffer.from(processed.display.bytes)).metadata();
  assert.equal(meta.orientation, undefined);
  assert.equal(meta.exif, undefined);
});

test("无法解码的图片返回明确错误", async () => {
  await assert.rejects(
    () => processRepairPhoto(Uint8Array.from([0xff, 0xd8, 0xff, 0, 0, 0])),
    (error) => error instanceof AppError && error.code === "REPAIR_PHOTO_TYPE_UNSUPPORTED",
  );
});
