import { formatBytes, repairEditorCopy } from "@/config/repairs";
import type { RepairPhotoView } from "@/types/contracts";

/**
 * 上传端的本地预处理与逐张上传（issue #324）。
 *
 * 目标与 P1 的变体契约一致：display 1280 长边、WebP quality 80。压缩只是**上传前**的
 * 体积优化；服务端仍按文件头复核并重新生成最终变体，不把客户端结果当可信输入。
 */

export const REPAIR_PHOTO_DISPLAY_MAX_EDGE = 1280;
export const REPAIR_PHOTO_DISPLAY_QUALITY = 0.8;
/** 已是 WebP 且尺寸/体积都小，重新编码通常不会更小。 */
const SKIP_RECOMPRESS_BYTES = 2 * 1024 * 1024;

export type PreparedPhoto = {
  /** 实际要上传的文件；压缩不可用时就是原文件。 */
  file: File;
  compressed: boolean;
  originalSize: number;
  preparedSize: number;
};

export type UploadPhotoInput = {
  recordId: string;
  file: File;
  uploadKey?: string;
  onProgress: (ratio: number) => void;
};

export type UploadPhotoFn = (input: UploadPhotoInput) => Promise<RepairPhotoView[]>;

export function photoSignature(file: File): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

/** 同一文件（名称 + 大小 + 修改时间）只保留一次；跨批次与批内都适用。 */
export function dedupePhotoFiles(
  files: readonly File[],
  existingSignatures: Iterable<string>,
): { unique: File[]; duplicateCount: number } {
  const seen = new Set(existingSignatures);
  const unique: File[] = [];
  let duplicateCount = 0;
  for (const file of files) {
    const signature = photoSignature(file);
    if (seen.has(signature)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(signature);
    unique.push(file);
  }
  return { unique, duplicateCount };
}

/** 等比缩到长边以内；不放大。 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const ratio = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/**
 * 压缩到 display 目标（WebP 1280 长边）。以下情况直接返回原文件：
 * 浏览器不支持解码 / Canvas / WebP 编码，或编码结果并不更小。
 * 压缩失败不影响上传，服务端仍会处理原图。
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const unchanged: PreparedPhoto = {
    file,
    compressed: false,
    originalSize: file.size,
    preparedSize: file.size,
  };
  if (typeof createImageBitmap !== "function") return unchanged;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return unchanged;
  }
  try {
    const target = fitWithin(bitmap.width, bitmap.height, REPAIR_PHOTO_DISPLAY_MAX_EDGE);
    const resized = target.width !== bitmap.width || target.height !== bitmap.height;
    if (!resized && file.type === "image/webp" && file.size <= SKIP_RECOMPRESS_BYTES)
      return unchanged;
    const blob = await encodeWebp(bitmap, target.width, target.height);
    // 有的浏览器不支持 WebP 编码（或返回了别的类型）：回退原图，别让服务端按类型拒绝。
    if (!blob || blob.type !== "image/webp" || blob.size >= file.size) return unchanged;
    return {
      file: new File([blob], file.name, { type: "image/webp", lastModified: file.lastModified }),
      compressed: true,
      originalSize: file.size,
      preparedSize: blob.size,
    };
  } catch {
    return unchanged;
  } finally {
    bitmap.close();
  }
}

async function encodeWebp(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    if (typeof canvas.convertToBlob === "function")
      return canvas.convertToBlob({
        type: "image/webp",
        quality: REPAIR_PHOTO_DISPLAY_QUALITY,
      });
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    return new Promise((resolve) =>
      canvas.toBlob((blob) => resolve(blob), "image/webp", REPAIR_PHOTO_DISPLAY_QUALITY),
    );
  }
  return null;
}

/**
 * 单文件上传：XHR 才能拿到真实的上传进度；错误信息统一由服务端信封 / 网络状态给出。
 * 非浏览器环境（测试 / SSR）退回 fetch，组件测试会注入自己的实现。
 */
export const uploadPhotoWithProgress: UploadPhotoFn = ({
  recordId,
  file,
  uploadKey,
  onProgress,
}) => {
  if (typeof XMLHttpRequest === "undefined") {
    const form = new FormData();
    form.append("photos", file);
    const headers: Record<string, string> = {};
    if (uploadKey) headers["Idempotency-Key"] = uploadKey;
    return fetch(`/api/v1/repairs/${recordId}/photos`, {
      method: "POST",
      headers,
      body: form,
    }).then(async (response) => {
      const json = (await response.json()) as {
        success?: boolean;
        data?: RepairPhotoView[];
        error?: { message?: string };
      };
      if (!json.success) throw new Error(json.error?.message ?? "照片上传失败");
      onProgress(1);
      return json.data ?? [];
    });
  }

  return new Promise<RepairPhotoView[]>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/v1/repairs/${recordId}/photos`);
    xhr.timeout = 120_000;
    if (uploadKey) xhr.setRequestHeader("Idempotency-Key", uploadKey);
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress(Math.min(0.99, event.loaded / event.total));
    };
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText) as {
          success?: boolean;
          data?: RepairPhotoView[];
          error?: { message?: string };
        };
        if (xhr.status >= 200 && xhr.status < 300 && json.success) {
          onProgress(1);
          resolve(json.data ?? []);
          return;
        }
        reject(new Error(json.error?.message ?? `照片上传失败（${xhr.status}）`));
      } catch {
        reject(new Error("照片上传响应无法解析，请重试"));
      }
    };
    xhr.onerror = () => reject(new Error("网络异常，照片未上传，请重试"));
    xhr.ontimeout = () => reject(new Error("照片上传超时，请重试"));
    const form = new FormData();
    form.append("photos", file);
    xhr.send(form);
  });
};

/** 压缩后的提示文案（仅用于界面展示，不参与上传）。 */
export function describePreparedPhoto(photo: {
  originalSize?: number;
  preparedSize?: number;
  compressed?: boolean;
}): string | null {
  if (!photo.compressed || photo.originalSize === undefined || photo.preparedSize === undefined)
    return null;
  return repairEditorCopy.photoCompressed
    .replace("{before}", formatBytes(photo.originalSize))
    .replace("{after}", formatBytes(photo.preparedSize));
}
