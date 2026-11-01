import { createHash } from "node:crypto";

import { isRepairStorageKey } from "./repair-photo-storage";

export const REPAIR_PHOTO_BACKFILL_MANIFEST_KIND = "repair-photo-backfill";

export type BackfillItemStatus =
  | "ready"
  | "updated"
  | "skipped-concurrent"
  | "missing-original"
  | "size-mismatch"
  | "digest-mismatch"
  | "decode-failed"
  | "write-failed"
  | "invalid-key";

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

export function isBackfillComplete(
  legacyPhotos: number,
  byStatus: Record<string, number>,
): boolean {
  return (byStatus.updated ?? 0) === legacyPhotos;
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
  const runId = requiredString(value, "runId");
  const database = requiredString(value, "database");
  const startedAt = requiredDateString(value, "startedAt");
  const finishedAt = requiredDateString(value, "finishedAt");
  const backup = parseBackup(value.backup);
  const totals = parseTotals(value.totals);
  if (!Array.isArray(value.photos)) throw new Error("回填清单缺少 photos");
  const seen = new Set<string>();
  const photos = value.photos.map((item, index) => {
    const photo = parsePhoto(item, index);
    if (seen.has(photo.photoId)) throw new Error(`回填清单 photoId 重复：${photo.photoId}`);
    seen.add(photo.photoId);
    return photo;
  });
  if (!Array.isArray(value.failures)) throw new Error("回填清单缺少 failures");
  const failures = value.failures.map((item, index) => {
    if (!isRecord(item)) throw new Error(`回填清单 failures[${index}] 格式无效`);
    return {
      photoId: requiredString(item, "photoId"),
      recordId: requiredString(item, "recordId"),
      status: requiredString(item, "status") as BackfillItemStatus,
      message: requiredString(item, "message"),
    };
  });

  return {
    kind: REPAIR_PHOTO_BACKFILL_MANIFEST_KIND,
    version: 1,
    runId,
    database,
    startedAt,
    finishedAt,
    backup,
    totals,
    photos,
    failures,
  };
}

function parsePhoto(value: unknown, index: number): BackfillManifestPhoto {
  if (!isRecord(value)) throw new Error(`回填清单 photos[${index}] 格式无效`);
  const photo = {
    photoId: requiredString(value, "photoId", `photos[${index}].`),
    recordId: requiredString(value, "recordId", `photos[${index}].`),
    originalKey: requiredRepairKey(value, "originalKey", index),
    originalSizeBytes: requiredPositiveInt(value, "originalSizeBytes", index),
    originalSha256: requiredSha256(value, "originalSha256", index),
    displayKey: requiredRepairKey(value, "displayKey", index),
    displaySizeBytes: requiredPositiveInt(value, "displaySizeBytes", index),
    displaySha256: requiredSha256(value, "displaySha256", index),
    width: requiredPositiveInt(value, "width", index),
    height: requiredPositiveInt(value, "height", index),
    thumbnailKey: requiredRepairKey(value, "thumbnailKey", index),
    thumbnailSizeBytes: requiredPositiveInt(value, "thumbnailSizeBytes", index),
    thumbnailSha256: requiredSha256(value, "thumbnailSha256", index),
    deletedAt:
      value.deletedAt === null ? null : requiredDateString(value, "deletedAt", `photos[${index}].`),
  };
  return photo;
}

function parseBackup(value: unknown): BackfillManifest["backup"] {
  if (!isRecord(value)) throw new Error("回填清单 backup 格式无效");
  return {
    manifestPath: requiredString(value, "manifestPath", "backup."),
    createdAt: requiredDateString(value, "createdAt", "backup."),
    dbTables: requiredNonNegativeInt(value, "dbTables", "backup."),
    dbInserts: requiredNonNegativeInt(value, "dbInserts", "backup."),
    dbBytes: requiredNonNegativeInt(value, "dbBytes", "backup."),
    uploadsFiles: requiredNonNegativeInt(value, "uploadsFiles", "backup."),
    uploadsBytes: requiredNonNegativeInt(value, "uploadsBytes", "backup."),
    dbSha256: requiredSha256(value, "dbSha256", 0, "backup."),
    uploadsSha256: requiredSha256(value, "uploadsSha256", 0, "backup."),
  };
}

function parseTotals(value: unknown): BackfillManifest["totals"] {
  if (!isRecord(value)) throw new Error("回填清单 totals 格式无效");
  return {
    totalPhotos: requiredNonNegativeInt(value, "totalPhotos", "totals."),
    legacyPhotos: requiredNonNegativeInt(value, "legacyPhotos", "totals."),
    updated: requiredNonNegativeInt(value, "updated", "totals."),
    failed: requiredNonNegativeInt(value, "failed", "totals."),
    remainingLegacy: requiredNonNegativeInt(value, "remainingLegacy", "totals."),
  };
}

function requiredString(record: Record<string, unknown>, field: string, prefix = ""): string {
  const value = record[field];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`回填清单 ${prefix}${field} 无效`);
  return value;
}

function requiredDateString(record: Record<string, unknown>, field: string, prefix = ""): string {
  const value = requiredString(record, field, prefix);
  if (Number.isNaN(Date.parse(value))) throw new Error(`回填清单 ${prefix}${field} 不是有效日期`);
  return value;
}

function requiredPositiveInt(
  record: Record<string, unknown>,
  field: string,
  index: number,
): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    throw new Error(`回填清单 photos[${index}].${field} 无效`);
  return value;
}

function requiredNonNegativeInt(
  record: Record<string, unknown>,
  field: string,
  prefix = "",
): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`回填清单 ${prefix}${field} 无效`);
  return value;
}

function requiredSha256(
  record: Record<string, unknown>,
  field: string,
  index: number,
  prefix = "",
): string {
  const value = record[field];
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new Error(`回填清单 ${prefix || `photos[${index}].`}${field} 无效`);
  return value;
}

function requiredRepairKey(record: Record<string, unknown>, field: string, index: number): string {
  const value = record[field];
  if (typeof value !== "string" || !isRepairStorageKey(value))
    throw new Error(`回填清单 photos[${index}].${field} 不是规范的 repairs/ 路径`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
