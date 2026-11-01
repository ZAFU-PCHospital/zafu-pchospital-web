import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import { processRepairPhoto } from "../../src/features/repairs/repair-photo-image";
import { AppError } from "../../src/lib/api/errors";
import { TINY_JPEG_BYTES } from "../support/image-fixtures";

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

for (const [width, height] of [
  [10_000, 6_001],
  [20_000, 15_000],
]) {
  test(`${width}×${height} JPEG 在尺寸预检时返回分辨率超限的 413`, async () => {
    // 仅替换帧头尺寸，验证预检在解码像素前拒绝大图，避免测试分配巨量像素内存。
    const source = Buffer.from(TINY_JPEG_BYTES);
    const frameOffset = source.indexOf(Buffer.from([0xff, 0xc0]));
    assert.notEqual(frameOffset, -1);
    source.writeUInt16BE(height, frameOffset + 5);
    source.writeUInt16BE(width, frameOffset + 7);

    await assert.rejects(
      () => processRepairPhoto(source),
      (error) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, "REPAIR_PHOTO_TOO_LARGE");
        assert.equal(error.status, 413);
        assert.match(error.message, /6000 万像素/);
        return true;
      },
    );
  });
}
