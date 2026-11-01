import { createHash } from "node:crypto";

export const REPAIR_PHOTO_BACKFILL_MANIFEST_KIND = "repair-photo-backfill";

export type BackfillItemStatus =
  | "ready"
  | "updated"
  | "skipped-concurrent"
  | "missing-original"
  | "size-mismatch"
  | "digest-mismatch"
  | "decode-failed"
  | "write-failed";

export type BackfillItemReport = {
  photoId: string;
  recordId: string;
  originalKey: string;
  originalSizeBytes: number;
  deletedAt: string | null;
  status: BackfillItemStatus;
  message?: string;
  display?: { width: number; height: number; sizeBytes: number };
  thumbnail?: { width: number; height: number; sizeBytes: number };
};

export type BackfillManifestPhoto = {
  photoId: string;
  recordId: string;
  originalKey: string;
  originalSizeBytes: number;
  originalSha256: string;
  displayKey: string;
  displaySizeBytes: number;
  displaySha256: string;
  width: number;
  height: number;
  thumbnailKey: string;
  thumbnailSizeBytes: number;
  thumbnailSha256: string;
  deletedAt: string | null;
};

export type BackfillManifest = {
  kind: typeof REPAIR_PHOTO_BACKFILL_MANIFEST_KIND;
  version: 1;
  runId: string;
  database: string;
  startedAt: string;
  finishedAt: string;
  backup: {
    manifestPath: string;
    createdAt: string;
    dbTables: number;
    dbInserts: number;
    dbBytes: number;
    uploadsFiles: number;
    uploadsBytes: number;
    dbSha256: string;
    uploadsSha256: string;
  };
  totals: {
    totalPhotos: number;
    legacyPhotos: number;
    updated: number;
    failed: number;
    remainingLegacy: number;
  };
  photos: BackfillManifestPhoto[];
  failures: { photoId: string; recordId: string; status: BackfillItemStatus; message: string }[];
};

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 解析回填结果清单；删除原图只允许使用这份清单里成功回填的照片。 */
export function parseBackfillManifest(raw: string): BackfillManifest {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("回填清单不是合法 JSON");
  }
  if (!isRecord(value)) throw new Error("回填清单格式无效");
  if (value.kind !== REPAIR_PHOTO_BACKFILL_MANIFEST_KIND || value.version !== 1)
    throw new Error("回填清单类型或版本不匹配");
  if (!Array.isArray(value.photos)) throw new Error("回填清单缺少 photos");

  const photos = value.photos.map((item, index) => {
    if (!isRecord(item)) throw new Error(`回填清单 photos[${index}] 格式无效`);
    for (const field of [
      "photoId",
      "recordId",
      "originalKey",
      "originalSha256",
      "displayKey",
      "displaySha256",
      "thumbnailKey",
      "thumbnailSha256",
    ] as const) {
      if (typeof item[field] !== "string" || !item[field])
        throw new Error(`回填清单 photos[${index}].${field} 无效`);
    }
    for (const field of [
      "originalSizeBytes",
      "displaySizeBytes",
      "width",
      "height",
      "thumbnailSizeBytes",
    ] as const) {
      if (typeof item[field] !== "number" || !Number.isSafeInteger(item[field]))
        throw new Error(`回填清单 photos[${index}].${field} 无效`);
    }
    if (item.deletedAt !== null && typeof item.deletedAt !== "string")
      throw new Error(`回填清单 photos[${index}].deletedAt 无效`);
    return item as BackfillManifestPhoto;
  });

  return { ...(value as unknown as BackfillManifest), photos };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
