import { formatBytes, repairEditorCopy } from "@/config/repairs";

/**
 * 可以交给服务端的格式（服务端按真实文件头复核）。
 *
 * HEIC / HEIF 也放进选择器的 `accept`：iPhone 用户需要能选到照片并看到明确的转换指引，
 * 而不是被文件框静默过滤掉、误以为上传入口坏了。
 */
export const REPAIR_PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";
const SERVER_ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const HEIC_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);
const HEIC_NAME = /\.(heic|heif)$/i;

/** 本轮不转换 HEIC：识别出来给「相机格式」指引，不把它当普通不支持格式。 */
export function isHeicFile(file: File): boolean {
  return HEIC_TYPES.has(file.type.toLowerCase()) || HEIC_NAME.test(file.name);
}

export type PhotoSelectionLimits = {
  maxBytes: number;
  maxFiles: number;
};

export type PhotoSelectionError =
  | { kind: "heic"; name: string }
  | { kind: "unsupported"; name: string }
  | { kind: "too-large"; name: string; size: number; limit: number }
  | { kind: "too-many"; currentCount: number; remain: number; maxFiles: number };

/**
 * 新建页在提交前只能做本地校验；服务端仍会按真实文件头复核。
 * 一次选择多张时整批校验：任何一张不合规都先说明原因，避免传一半。
 */
export function validatePhotoSelection(
  files: File[],
  currentCount: number,
  limits: PhotoSelectionLimits,
): PhotoSelectionError | null {
  if (files.length === 0) return null;
  const heic = files.find(isHeicFile);
  if (heic) return { kind: "heic", name: heic.name };
  const unsupported = files.find((file) => !SERVER_ALLOWED_TYPES.has(file.type));
  if (unsupported) return { kind: "unsupported", name: unsupported.name };
  const oversized = files.find((file) => file.size > limits.maxBytes);
  if (oversized) {
    return {
      kind: "too-large",
      name: oversized.name,
      size: oversized.size,
      limit: limits.maxBytes,
    };
  }
  const remain = Math.max(limits.maxFiles - currentCount, 0);
  if (files.length > remain) {
    return { kind: "too-many", currentCount, remain, maxFiles: limits.maxFiles };
  }
  return null;
}

export function formatPhotoSelectionError(error: PhotoSelectionError): string {
  switch (error.kind) {
    case "heic":
      return repairEditorCopy.photoHeicUnsupported;
    case "unsupported":
      return repairEditorCopy.photoTypeUnsupported;
    case "too-large":
      return repairEditorCopy.photoTooLarge
        .replace("{name}", error.name)
        .replace("{size}", formatBytes(error.size))
        .replace("{limit}", formatBytes(error.limit));
    case "too-many":
      return error.remain > 0
        ? repairEditorCopy.photoSelectTooMany.replace("{remain}", String(error.remain))
        : repairEditorCopy.photoLimitReached.replace("{count}", String(error.maxFiles));
  }
}
