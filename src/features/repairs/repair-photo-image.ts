import { createHash } from "node:crypto";

import sharp from "sharp";

import { AppError } from "@/lib/api/errors";

/** P0 决策：display 1280 长边 / thumb 320 长边，WebP quality 80 / 75。 */
export const repairPhotoVariantSpec = {
  display: { maxEdge: 1280, quality: 80 },
  thumbnail: { maxEdge: 320, quality: 75 },
} as const;

/**
 * 防止解压炸弹：单张最多 6000 万像素（覆盖 5000 万像素手机直出）。
 * 隔离测量 50/64/100MP 单任务峰值增量约 108/107/138 MiB；生产机只有约 1.6G，
 * 因此配合进程级单任务闸门，不再接受更高的解码内存。
 */
const MAX_INPUT_PIXELS = 60_000_000;

export type ProcessedRepairPhotoVariant = {
  bytes: Uint8Array;
  width: number;
  height: number;
  digest: Buffer;
};

export type ProcessedRepairPhoto = {
  /** 详情/审核展示图；写入 `storage_key`。 */
  display: ProcessedRepairPhotoVariant;
  /** 列表缩略图；写入 `thumbnail_key`。 */
  thumbnail: ProcessedRepairPhotoVariant;
};

function variant(result: {
  data: Buffer;
  info: { width: number; height: number };
}): ProcessedRepairPhotoVariant {
  return {
    bytes: new Uint8Array(result.data),
    width: result.info.width,
    height: result.info.height,
    digest: createHash("sha256").update(result.data).digest(),
  };
}

/**
 * 新上传的唯一图像入口：方向纠正、移除 EXIF/GPS、生成 display + thumb WebP。
 *
 * 不保留原图；调用方只把两个变体落盘。逐张串行调用，避免一次解码多张大图。
 */
export async function processRepairPhoto(bytes: Uint8Array): Promise<ProcessedRepairPhoto> {
  const input = Buffer.from(bytes);
  const options = { failOn: "error" as const, limitInputPixels: MAX_INPUT_PIXELS };
  try {
    // 先只读文件头判断尺寸：超限时返回可理解的 413，而不是进入解码后再报格式错误。
    const metadata = await sharp(input, { failOn: "error" }).metadata();
    if (metadata.width && metadata.height && metadata.width * metadata.height > MAX_INPUT_PIXELS)
      throw new AppError(
        "REPAIR_PHOTO_TOO_LARGE",
        `图片分辨率过高，最多 ${MAX_INPUT_PIXELS / 10_000} 万像素`,
      );

    // 两次解码而不是同时保留多个 libvips 图像，优先控制生产机内存峰值。
    const display = await sharp(input, options)
      .rotate()
      .resize({
        width: repairPhotoVariantSpec.display.maxEdge,
        height: repairPhotoVariantSpec.display.maxEdge,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: repairPhotoVariantSpec.display.quality })
      .toBuffer({ resolveWithObject: true });

    const thumbnail = await sharp(input, options)
      .rotate()
      .resize({
        width: repairPhotoVariantSpec.thumbnail.maxEdge,
        height: repairPhotoVariantSpec.thumbnail.maxEdge,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: repairPhotoVariantSpec.thumbnail.quality })
      .toBuffer({ resolveWithObject: true });

    return { display: variant(display), thumbnail: variant(thumbnail) };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("REPAIR_PHOTO_TYPE_UNSUPPORTED", "图片无法解码或格式不受支持", {
      cause: error,
    });
  }
}
