import { formatBytes, repairEditorCopy } from "@/config/repairs";

/** 与服务端 `detectImageType` 支持的格式保持一致。 */
export const REPAIR_PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";
const ALLOWED_TYPES = new Set(REPAIR_PHOTO_ACCEPT.split(","));

export type PhotoSelectionLimits = {
  maxBytes: number;
  maxFiles: number;
};

export type PhotoSelectionError =
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
  const unsupported = files.find((file) => !ALLOWED_TYPES.has(file.type));
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
