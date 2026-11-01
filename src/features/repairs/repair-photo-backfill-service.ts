import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { appendAuditLog } from "@/lib/audit/audit-service";
import { AppError } from "@/lib/api/errors";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import {
  sha256Hex,
  type BackfillItemReport,
  type BackfillManifest,
  type BackfillManifestPhoto,
} from "./repair-photo-backfill";
import type { VerifiedBackup } from "./repair-photo-backup";
import { processRepairPhoto } from "./repair-photo-image";
import {
  localRepairPhotoStorage,
  uploadRoot,
  type RepairPhotoStorage,
} from "./repair-photo-storage";

type LegacyPhotoRow = {
  id: string;
  repairRecordId: string;
  storageKey: string;
  originalName: string | null;
  mimeType: string;
  sizeBytes: number;
  sha256Digest: Uint8Array;
  deletedAt: Date | null;
  createdAt: Date;
};

export type BackfillReport = {
  database: string;
  apply: boolean;
  runId: string;
  backup: Pick<
    VerifiedBackup,
    | "manifestPath"
    | "createdAt"
    | "dbTables"
    | "dbInserts"
    | "dbBytes"
    | "uploadsFiles"
    | "uploadsBytes"
    | "dbSha256"
    | "uploadsSha256"
  > | null;
  totalPhotos: number;
  legacyPhotos: number;
  totalBytes: number;
  byStatus: Record<string, number>;
  items: BackfillItemReport[];
  postCheck?: BackfillPostCheck;
};

export type BackfillPostCheck = {
  remainingLegacy: number;
  missingVariantFiles: number;
  mismatchedRows: number;
  expectedOriginalFiles: number;
  unreferencedFiles: number;
  unexpectedUnreferencedFiles: number;
  passed: boolean;
};

export type BackfillResult = {
  report: BackfillReport;
  manifest?: BackfillManifest;
};

export type BackfillOptions = {
  apply: boolean;
  /** apply 前必须由 CLI 校验定时备份清单；没有它拒绝写库。 */
  backup?: VerifiedBackup;
  storage?: RepairPhotoStorage;
  now?: Date;
  runId?: string;
  onProgress?: (item: BackfillItemReport) => void;
};

/**
 * 回填存量照片：把 `storage_key` 指向的旧原图转成 display + thumbnail，更新数据库。
 *
 * - 缺省 dry-run：读取、核对文件大小 / 摘要并实际解码，不写存储或数据库；
 * - apply 每张照片单独处理：先写两个变体，再以 `thumbnail_key IS NULL` 为条件更新；
 *   更新失败 / 并发跳过时删除刚写的变体，原图保留到单独的原图删除步骤；
 * - 软删除照片同样处理（内容接口只在 `deleted_at` 非空时拒绝访问）。
 */
export async function backfillRepairPhotos(options: BackfillOptions): Promise<BackfillResult> {
  if (options.apply && !options.backup) throw new Error("apply 必须先提供并校验备份清单，拒绝写库");

  const db = getDb();
  const storage = options.storage ?? localRepairPhotoStorage;
  const now = options.now ?? new Date();
  const runId = options.runId ?? createRunId("photo-backfill", now);
  const [totalPhotos, rows] = await Promise.all([
    db.repairPhoto.count(),
    db.repairPhoto.findMany({
      where: { thumbnailKey: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        repairRecordId: true,
        storageKey: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        sha256Digest: true,
        deletedAt: true,
        createdAt: true,
      },
    }),
  ]);

  const items: BackfillItemReport[] = [];
  const manifestPhotos: BackfillManifestPhoto[] = [];
  for (const row of rows) {
    const result = await processLegacyPhoto({
      row,
      apply: options.apply,
      storage,
      runId,
    });
    items.push(result.report);
    if (result.manifest) manifestPhotos.push(result.manifest);
    options.onProgress?.(result.report);
  }

  const remainingLegacy = await db.repairPhoto.count({ where: { thumbnailKey: null } });
  const postCheck = options.apply ? await runBackfillPostCheck(manifestPhotos, storage) : undefined;
  const byStatus = countByStatus(items);
  const report: BackfillReport = {
    database: databaseLabel(),
    apply: options.apply,
    runId,
    backup: options.backup
      ? {
          manifestPath: options.backup.manifestPath,
          createdAt: options.backup.createdAt,
          dbTables: options.backup.dbTables,
          dbInserts: options.backup.dbInserts,
          dbBytes: options.backup.dbBytes,
          uploadsFiles: options.backup.uploadsFiles,
          uploadsBytes: options.backup.uploadsBytes,
          dbSha256: options.backup.dbSha256,
          uploadsSha256: options.backup.uploadsSha256,
        }
      : null,
    totalPhotos,
    legacyPhotos: rows.length,
    totalBytes: rows.reduce((sum, row) => sum + row.sizeBytes, 0),
    byStatus,
    items,
    postCheck,
  };

  if (!options.apply) return { report };

  const failures = items
    .filter((item) => item.status !== "updated")
    .map((item) => ({
      photoId: item.photoId,
      recordId: item.recordId,
      status: item.status,
      message: item.message ?? item.status,
    }));
  const manifest: BackfillManifest = {
    kind: "repair-photo-backfill",
    version: 1,
    runId,
    database: report.database,
    startedAt: now.toISOString(),
    finishedAt: new Date().toISOString(),
    backup: {
      manifestPath: options.backup!.manifestPath,
      createdAt: options.backup!.createdAt,
      dbTables: options.backup!.dbTables,
      dbInserts: options.backup!.dbInserts,
      dbBytes: options.backup!.dbBytes,
      uploadsFiles: options.backup!.uploadsFiles,
      uploadsBytes: options.backup!.uploadsBytes,
      dbSha256: options.backup!.dbSha256,
      uploadsSha256: options.backup!.uploadsSha256,
    },
    totals: {
      totalPhotos,
      legacyPhotos: rows.length,
      updated: manifestPhotos.length,
      failed: failures.length,
      remainingLegacy,
    },
    photos: manifestPhotos,
    failures,
  };
  return { report, manifest };
}

async function processLegacyPhoto(input: {
  row: LegacyPhotoRow;
  apply: boolean;
  storage: RepairPhotoStorage;
  runId: string;
}): Promise<{ report: BackfillItemReport; manifest?: BackfillManifestPhoto }> {
  const { row, apply, storage, runId } = input;
  const base = {
    photoId: row.id,
    recordId: row.repairRecordId,
    originalKey: row.storageKey,
    originalSizeBytes: row.sizeBytes,
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
  let originalBytes: Uint8Array;
  try {
    originalBytes = await storage.open(row.storageKey);
  } catch (error) {
    return {
      report: { ...base, status: "missing-original", message: errorMessage(error) },
    };
  }
  if (originalBytes.byteLength !== row.sizeBytes)
    return {
      report: {
        ...base,
        status: "size-mismatch",
        message: `文件 ${originalBytes.byteLength} B != DB ${row.sizeBytes} B`,
      },
    };
  const originalSha256 = sha256Hex(originalBytes);
  if (originalSha256 !== Buffer.from(row.sha256Digest).toString("hex"))
    return {
      report: {
        ...base,
        status: "digest-mismatch",
        message: "原图 SHA256 与数据库摘要不一致",
      },
    };

  let processed: Awaited<ReturnType<typeof processRepairPhoto>>;
  try {
    processed = await processRepairPhoto(originalBytes);
  } catch (error) {
    return {
      report: {
        ...base,
        status: "decode-failed",
        message: errorMessage(error),
      },
    };
  }
  const display = {
    width: processed.display.width,
    height: processed.display.height,
    sizeBytes: processed.display.bytes.byteLength,
  };
  const thumbnail = {
    width: processed.thumbnail.width,
    height: processed.thumbnail.height,
    sizeBytes: processed.thumbnail.bytes.byteLength,
  };
  if (!apply) return { report: { ...base, status: "ready", display, thumbnail } };

  let displayKey: string | null = null;
  let thumbnailKey: string | null = null;
  try {
    displayKey = (await storage.put({ bytes: processed.display.bytes, mimeType: "image/webp" }))
      .storageKey;
    thumbnailKey = (await storage.put({ bytes: processed.thumbnail.bytes, mimeType: "image/webp" }))
      .storageKey;
    const updated = await inSerializableTransaction(async (tx) => {
      const result = await tx.repairPhoto.updateMany({
        where: { id: row.id, thumbnailKey: null },
        data: {
          storageKey: displayKey!,
          thumbnailKey: thumbnailKey!,
          mimeType: "image/webp",
          sizeBytes: processed.display.bytes.byteLength,
          sha256Digest: new Uint8Array(processed.display.digest),
          width: processed.display.width,
          height: processed.display.height,
        },
      });
      if (!result.count) return false;
      await appendAuditLog(tx, {
        actor: { requestId: `photo-backfill:${runId}` },
        actorType: "SYSTEM",
        action: "repair.photo.backfilled",
        targetType: "RepairPhoto",
        targetId: row.id,
        result: "SUCCESS",
        before: {
          storageKey: row.storageKey,
          mimeType: row.mimeType,
          sizeBytes: row.sizeBytes,
        },
        after: {
          storageKey: displayKey,
          thumbnailKey,
          mimeType: "image/webp",
          sizeBytes: processed.display.bytes.byteLength,
          width: processed.display.width,
          height: processed.display.height,
        },
      });
      return true;
    });

    if (!updated) {
      await deleteVariants(storage, displayKey, thumbnailKey);
      return {
        report: {
          ...base,
          status: "skipped-concurrent",
          message: "照片已被另一轮回填更新，未重复写入",
        },
      };
    }

    return {
      report: { ...base, status: "updated", display, thumbnail },
      manifest: {
        ...base,
        originalSha256,
        displayKey,
        displaySizeBytes: processed.display.bytes.byteLength,
        displaySha256: processed.display.digest.toString("hex"),
        width: processed.display.width,
        height: processed.display.height,
        thumbnailKey,
        thumbnailSizeBytes: processed.thumbnail.bytes.byteLength,
        thumbnailSha256: processed.thumbnail.digest.toString("hex"),
      },
    };
  } catch (error) {
    await deleteVariants(storage, displayKey, thumbnailKey);
    return {
      report: {
        ...base,
        status: "write-failed",
        message: `写入失败：${errorMessage(error)}`,
      },
    };
  }
}

async function runBackfillPostCheck(
  photos: BackfillManifestPhoto[],
  storage: RepairPhotoStorage,
): Promise<BackfillPostCheck> {
  const db = getDb();
  const remainingLegacy = await db.repairPhoto.count({ where: { thumbnailKey: null } });
  let missingVariantFiles = 0;
  let mismatchedRows = 0;
  for (const photo of photos) {
    const row = await db.repairPhoto.findUnique({
      where: { id: photo.photoId },
      select: { storageKey: true, thumbnailKey: true, width: true, height: true },
    });
    if (
      !row ||
      row.storageKey !== photo.displayKey ||
      row.thumbnailKey !== photo.thumbnailKey ||
      row.width !== photo.width ||
      row.height !== photo.height
    )
      mismatchedRows += 1;
    for (const [key, size, digest] of [
      [photo.displayKey, photo.displaySizeBytes, photo.displaySha256],
      [photo.thumbnailKey, photo.thumbnailSizeBytes, photo.thumbnailSha256],
    ] as const) {
      try {
        const bytes = await storage.open(key);
        if (bytes.byteLength !== size || sha256Hex(bytes) !== digest) missingVariantFiles += 1;
      } catch {
        missingVariantFiles += 1;
      }
    }
  }
  const scan = await scanRepairPhotoStorage();
  const expectedOriginals = new Set(photos.map((photo) => photo.originalKey));
  const unexpectedUnreferencedFiles = scan.unreferencedKeys.filter(
    (key) => !expectedOriginals.has(key),
  ).length;
  return {
    remainingLegacy,
    missingVariantFiles,
    mismatchedRows,
    expectedOriginalFiles: photos.filter((photo) => scan.files.includes(photo.originalKey)).length,
    unreferencedFiles: scan.unreferencedKeys.length,
    unexpectedUnreferencedFiles,
    passed: remainingLegacy === 0 && missingVariantFiles === 0 && mismatchedRows === 0,
  };
}

export type PruneItemStatus =
  | "deletable"
  | "deleted"
  | "invalid-key"
  | "row-changed"
  | "still-referenced"
  | "missing-original"
  | "size-mismatch"
  | "digest-mismatch"
  | "missing-variant"
  | "delete-failed";

export type PruneItemReport = {
  photoId: string;
  recordId: string;
  originalKey: string;
  originalSizeBytes: number;
  deletedAt: string | null;
  status: PruneItemStatus;
  message?: string;
};

export type PruneReport = {
  database: string;
  apply: boolean;
  runId: string;
  backup: Pick<
    VerifiedBackup,
    | "manifestPath"
    | "createdAt"
    | "dbTables"
    | "dbInserts"
    | "dbBytes"
    | "uploadsFiles"
    | "uploadsBytes"
    | "dbSha256"
    | "uploadsSha256"
  > | null;
  manifestRunId: string;
  candidates: number;
  byStatus: Record<string, number>;
  items: PruneItemReport[];
  postCheck: {
    remainingOriginalFiles: number;
    remainingVariantFiles: number;
    unreferencedFiles: number;
    passed: boolean;
  };
};

export type PruneOptions = {
  manifest: BackfillManifest;
  apply: boolean;
  backup?: VerifiedBackup;
  storage?: RepairPhotoStorage;
  now?: Date;
  runId?: string;
  onProgress?: (item: PruneItemReport) => void;
};

/**
 * 删除回填后的旧原图。
 *
 * 只处理回填清单里成功更新的照片，并且要求：当前行仍指向清单中的 display/thumb、
 * 两个变体文件与摘要一致、原图大小 / 摘要一致、且没有任何 `repair_photos` 行
 * 再引用该键。清单外的文件（包括备份目录）一律不碰。
 */
export async function pruneBackfilledOriginals(options: PruneOptions): Promise<PruneReport> {
  if (options.apply && !options.backup)
    throw new Error("apply 必须先提供并校验备份清单，拒绝删除文件");
  const storage = options.storage ?? localRepairPhotoStorage;
  const now = options.now ?? new Date();
  const runId = options.runId ?? createRunId("photo-originals-prune", now);
  const db = getDb();
  const photoIds = options.manifest.photos.map((photo) => photo.photoId);
  const rows = await db.repairPhoto.findMany({
    where: { id: { in: photoIds } },
    select: {
      id: true,
      repairRecordId: true,
      storageKey: true,
      thumbnailKey: true,
      width: true,
      height: true,
    },
  });
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const references = await db.repairPhoto.findMany({
    select: { storageKey: true, thumbnailKey: true },
  });
  const referenced = new Set<string>();
  for (const row of references) {
    referenced.add(row.storageKey);
    if (row.thumbnailKey) referenced.add(row.thumbnailKey);
  }

  const items: PruneItemReport[] = [];
  for (const photo of options.manifest.photos) {
    const base = {
      photoId: photo.photoId,
      recordId: photo.recordId,
      originalKey: photo.originalKey,
      originalSizeBytes: photo.originalSizeBytes,
      deletedAt: photo.deletedAt,
    };
    if (!photo.originalKey.startsWith("repairs/") || photo.originalKey.includes("\\"))
      items.push({ ...base, status: "invalid-key", message: "原图键不在 repairs/ 目录" });
    else {
      const row = rowById.get(photo.photoId);
      if (
        !row ||
        row.storageKey !== photo.displayKey ||
        row.thumbnailKey !== photo.thumbnailKey ||
        row.width !== photo.width ||
        row.height !== photo.height
      )
        items.push({ ...base, status: "row-changed", message: "照片行已变化，跳过" });
      else if (referenced.has(photo.originalKey))
        items.push({ ...base, status: "still-referenced", message: "仍有照片行引用原图键" });
      else {
        const variants = await verifyVariants(storage, photo);
        if (!variants.ok)
          items.push({ ...base, status: "missing-variant", message: variants.message });
        else {
          const original = await verifyOriginal(storage, photo);
          if (!original.ok)
            items.push({
              ...base,
              status: original.status,
              message: original.message,
            });
          else if (!options.apply) items.push({ ...base, status: "deletable" });
          else {
            try {
              await storage.delete(photo.originalKey);
              items.push({ ...base, status: "deleted" });
            } catch (error) {
              items.push({ ...base, status: "delete-failed", message: errorMessage(error) });
            }
          }
        }
      }
    }
    options.onProgress?.(items[items.length - 1]!);
  }

  const scan = await scanRepairPhotoStorage();
  const remainingOriginalFiles = options.manifest.photos.filter((photo) =>
    scan.files.includes(photo.originalKey),
  ).length;
  const remainingVariantFiles = options.manifest.photos.reduce((sum, photo) => {
    let count = 0;
    if (scan.files.includes(photo.displayKey)) count += 1;
    if (scan.files.includes(photo.thumbnailKey)) count += 1;
    return sum + count;
  }, 0);
  return {
    database: databaseLabel(),
    apply: options.apply,
    runId,
    backup: options.backup
      ? {
          manifestPath: options.backup.manifestPath,
          createdAt: options.backup.createdAt,
          dbTables: options.backup.dbTables,
          dbInserts: options.backup.dbInserts,
          dbBytes: options.backup.dbBytes,
          uploadsFiles: options.backup.uploadsFiles,
          uploadsBytes: options.backup.uploadsBytes,
          dbSha256: options.backup.dbSha256,
          uploadsSha256: options.backup.uploadsSha256,
        }
      : null,
    manifestRunId: options.manifest.runId,
    candidates: items.filter((item) => item.status === "deletable" || item.status === "deleted")
      .length,
    byStatus: countByStatus(items),
    items,
    postCheck: {
      remainingOriginalFiles,
      remainingVariantFiles,
      unreferencedFiles: scan.unreferencedKeys.length,
      passed:
        remainingVariantFiles === options.manifest.photos.length * 2 &&
        items.every((item) => ["deleted", "deletable", "missing-original"].includes(item.status)) &&
        (!options.apply || remainingOriginalFiles === 0),
    },
  };
}

async function verifyVariants(
  storage: RepairPhotoStorage,
  photo: BackfillManifestPhoto,
): Promise<{ ok: true } | { ok: false; message: string }> {
  for (const [key, size, digest, label] of [
    [photo.displayKey, photo.displaySizeBytes, photo.displaySha256, "display"],
    [photo.thumbnailKey, photo.thumbnailSizeBytes, photo.thumbnailSha256, "thumbnail"],
  ] as const) {
    try {
      const bytes = await storage.open(key);
      if (bytes.byteLength !== size || sha256Hex(bytes) !== digest)
        return { ok: false, message: `${label} 文件大小或摘要不符` };
    } catch {
      return { ok: false, message: `${label} 文件不存在` };
    }
  }
  return { ok: true };
}

async function verifyOriginal(
  storage: RepairPhotoStorage,
  photo: BackfillManifestPhoto,
): Promise<
  | { ok: true }
  | { ok: false; status: "missing-original" | "size-mismatch" | "digest-mismatch"; message: string }
> {
  let bytes: Uint8Array;
  try {
    bytes = await storage.open(photo.originalKey);
  } catch {
    return { ok: false, status: "missing-original", message: "原图文件不存在" };
  }
  if (bytes.byteLength !== photo.originalSizeBytes)
    return { ok: false, status: "size-mismatch", message: "原图大小不符" };
  if (sha256Hex(bytes) !== photo.originalSha256)
    return { ok: false, status: "digest-mismatch", message: "原图摘要不符" };
  return { ok: true };
}

export async function scanRepairPhotoStorage(): Promise<{
  files: string[];
  referencedKeys: string[];
  unreferencedKeys: string[];
}> {
  const db = getDb();
  const rows = await db.repairPhoto.findMany({
    select: { storageKey: true, thumbnailKey: true },
  });
  const referenced = new Set<string>();
  for (const row of rows) {
    referenced.add(row.storageKey);
    if (row.thumbnailKey) referenced.add(row.thumbnailKey);
  }
  const files = await listRepairFiles();
  return {
    files,
    referencedKeys: [...referenced],
    unreferencedKeys: files.filter((key) => !referenced.has(key)),
  };
}

async function listRepairFiles(): Promise<string[]> {
  const root = join(uploadRoot(), "repairs");
  const files: string[] = [];
  await walk(root, "");
  return files;

  async function walk(dir: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(dir, entry.name), relative);
      else if (entry.isFile()) files.push(`repairs/${relative}`);
    }
  }
}

async function deleteVariants(
  storage: RepairPhotoStorage,
  displayKey: string | null,
  thumbnailKey: string | null,
): Promise<void> {
  for (const key of [displayKey, thumbnailKey]) {
    if (!key) continue;
    try {
      await storage.delete(key);
    } catch (error) {
      console.error(`[repairs] 回填清理变体失败 key=${key}`, errorMessage(error));
    }
  }
}

function countByStatus(items: { status: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;
  return counts;
}

function errorMessage(error: unknown): string {
  if (error instanceof AppError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

function createRunId(prefix: string, now: Date): string {
  return `${prefix}-${now
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14)}-${randomUUID().slice(0, 8)}`;
}

function databaseLabel(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) return "(未设置 DATABASE_URL)";
  const url = new URL(raw);
  return `${url.hostname}:${url.port || "3306"}${url.pathname}`;
}
