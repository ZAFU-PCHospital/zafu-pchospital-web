import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";

import { appendAuditLog } from "@/lib/audit/audit-service";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";

import type { VerifiedBackup } from "./repair-photo-backup";
import {
  classifyOrphanFiles,
  REPAIR_PHOTO_ORPHAN_MAX_DELETE,
  REPAIR_PHOTO_ORPHAN_MIN_AGE_HOURS,
  type OrphanScanSummary,
  type StoredRepairFile,
} from "./repair-photo-orphan";
import {
  isRepairStorageKey,
  listStoredRepairFiles,
  localRepairPhotoStorage,
  uploadRoot,
  type RepairPhotoStorage,
} from "./repair-photo-storage";

export type OrphanFileStatus =
  | "candidate"
  | "deleted"
  | "too-new"
  | "changed"
  | "still-referenced"
  | "already-missing"
  | "delete-failed"
  | "audit-failed";

export type OrphanFileReport = {
  key: string;
  sizeBytes: number;
  modifiedAt: string;
  status: OrphanFileStatus;
  message?: string;
};

export type OrphanPostCheck = {
  deleted: number;
  failed: number;
  remainingCandidates: number;
  remainingOrphanFiles: number;
  passed: boolean;
};

export type OrphanReport = {
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
  minAgeHours: number;
  maxDelete: number;
  scan: OrphanScanSummary;
  invalidReferencedKeys: string[];
  byStatus: Record<string, number>;
  items: OrphanFileReport[];
  postCheck?: OrphanPostCheck;
};

export type OrphanCleanupOptions = {
  apply: boolean;
  /** apply 前必须由 CLI 校验定时备份清单；没有它拒绝删除文件。 */
  backup?: VerifiedBackup;
  /** apply 前确认备份归档包含待删除孤儿文件；CLI 会传入 tar 条目校验。 */
  verifyBackupUploads?: (keys: readonly string[]) => Promise<void>;
  /** 文件修改时间必须早于该安全窗才会被删除，默认 24 小时。 */
  minAgeHours?: number;
  /** 单轮最多删除的文件数，默认 500；超过则拒绝执行。 */
  maxDelete?: number;
  now?: Date;
  runId?: string;
  storage?: RepairPhotoStorage;
  onProgress?: (item: OrphanFileReport) => void;
};

type ReferencedSnapshot = {
  referenced: Set<string>;
  invalidReferencedKeys: string[];
};

/**
 * 清理 `repairs/` 下没有任何 `repair_photos` 行引用的文件。
 *
 * - 软删除照片仍保留变体引用，因此不会被当成孤儿；
 * - 只删除早于 `minAgeHours` 的文件，避免误删「刚写入、数据库事务尚未提交」的上传；
 * - apply 前逐文件复核引用、大小与修改时间，并从校验通过的备份归档确认文件可恢复；
 * - 每删除一个文件写一条 SYSTEM 审计；文件已删除但审计失败会以 audit-failed 报告。
 */
export async function cleanRepairPhotoOrphans(
  options: OrphanCleanupOptions,
): Promise<OrphanReport> {
  if (options.apply && !options.backup)
    throw new Error("apply 必须先提供并校验备份清单，拒绝删除文件");
  const minAgeHours = options.minAgeHours ?? REPAIR_PHOTO_ORPHAN_MIN_AGE_HOURS;
  const maxDelete = options.maxDelete ?? REPAIR_PHOTO_ORPHAN_MAX_DELETE;
  if (!Number.isFinite(minAgeHours) || minAgeHours < 0 || minAgeHours > 24 * 365)
    throw new Error("minAgeHours 必须是 0–8760 之间的数字");
  if (!Number.isSafeInteger(maxDelete) || maxDelete <= 0) throw new Error("maxDelete 必须是正整数");

  const now = options.now ?? new Date();
  const runId = options.runId ?? createRunId("photo-orphans", now);
  const storage = options.storage ?? localRepairPhotoStorage;
  const db = getDb();
  const minAgeMs = minAgeHours * 60 * 60 * 1000;

  const snapshot = await loadReferencedKeys();
  const files = await loadStoredFiles();
  const presentReferenced = files.filter((file) => snapshot.referenced.has(file.key)).length;
  if (snapshot.referenced.size > 0 && presentReferenced === 0)
    throw new Error("上传目录中没有找到任何数据库引用的照片，疑似 UPLOAD_PATH 配置错误，拒绝清理");

  const classification = classifyOrphanFiles({
    files,
    referencedKeys: snapshot.referenced,
    invalidReferencedKeys: snapshot.invalidReferencedKeys,
    nowMs: now.getTime(),
    minAgeMs,
  });

  const items: OrphanFileReport[] = [
    ...classification.candidates.map((file) => fileItem(file, "candidate")),
    ...classification.tooNew.map((file) =>
      fileItem(file, "too-new", `不足 ${minAgeHours} 小时，留待下一轮`),
    ),
  ].sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
  const itemByKey = new Map(items.map((item) => [item.key, item]));

  if (options.apply && classification.candidates.length > 0) {
    if (classification.candidates.length > maxDelete)
      throw new Error(
        `候选孤儿文件 ${classification.candidates.length} 个，超过 --max-delete=${maxDelete}，已拒绝执行`,
      );
    if (!options.verifyBackupUploads) throw new Error("apply 必须先确认备份归档包含待删除孤儿文件");
    await options.verifyBackupUploads(classification.candidates.map((file) => file.key));

    for (const file of classification.candidates) {
      const item = itemByKey.get(file.key)!;
      const referencedNow = await db.repairPhoto.count({
        where: { OR: [{ storageKey: file.key }, { thumbnailKey: file.key }] },
      });
      if (referencedNow > 0) {
        item.status = "still-referenced";
        item.message = "扫描后出现新的照片行引用，跳过";
        options.onProgress?.(item);
        continue;
      }

      const path = join(uploadRoot(), file.key);
      let current;
      try {
        current = await stat(path);
      } catch (error) {
        if (isNotFound(error)) {
          item.status = "already-missing";
          item.message = "文件在删除前已不存在";
        } else {
          item.status = "delete-failed";
          item.message = `无法读取文件：${errorMessage(error)}`;
        }
        options.onProgress?.(item);
        continue;
      }
      if (
        !current.isFile() ||
        current.size !== file.sizeBytes ||
        current.mtime.getTime() !== file.modifiedAt.getTime()
      ) {
        item.status = "changed";
        item.message = "文件在扫描后发生变化，跳过";
        options.onProgress?.(item);
        continue;
      }

      try {
        await storage.delete(file.key);
      } catch (error) {
        item.status = "delete-failed";
        item.message = errorMessage(error);
        options.onProgress?.(item);
        continue;
      }

      try {
        await inSerializableTransaction(async (tx) => {
          await appendAuditLog(tx, {
            actor: { requestId: `photo-orphan:${runId}` },
            actorType: "SYSTEM",
            action: "repair.photo.orphan.pruned",
            targetType: "RepairPhotoStorage",
            targetId: randomUUID(),
            result: "SUCCESS",
            before: {
              storageKey: file.key,
              sizeBytes: file.sizeBytes,
              modifiedAt: file.modifiedAt.toISOString(),
            },
            after: { deleted: true, runId },
          });
        });
        item.status = "deleted";
      } catch (error) {
        // 文件已经删除，审计失败单独报告，便于补审计记录；不要重试删除。
        item.status = "audit-failed";
        item.message = `文件已删除，但审计写入失败：${errorMessage(error)}`;
      }
      options.onProgress?.(item);
    }
  }

  const postCheck = options.apply ? await runPostCheck(now.getTime(), minAgeMs, items) : undefined;
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
    minAgeHours,
    maxDelete,
    scan: classification.summary,
    invalidReferencedKeys: snapshot.invalidReferencedKeys,
    byStatus: countByStatus(items),
    items,
    postCheck,
  };
}

async function loadReferencedKeys(): Promise<ReferencedSnapshot> {
  const rows = await getDb().repairPhoto.findMany({
    select: { storageKey: true, thumbnailKey: true },
  });
  const referenced = new Set<string>();
  const invalidReferencedKeys = new Set<string>();
  for (const row of rows) {
    for (const key of [row.storageKey, row.thumbnailKey]) {
      if (!key) continue;
      referenced.add(key);
      if (!isRepairStorageKey(key)) invalidReferencedKeys.add(key);
    }
  }
  return { referenced, invalidReferencedKeys: [...invalidReferencedKeys].sort() };
}

async function loadStoredFiles(): Promise<StoredRepairFile[]> {
  const root = uploadRoot();
  const files: StoredRepairFile[] = [];
  for (const key of await listStoredRepairFiles()) {
    let info;
    try {
      info = await stat(join(root, key));
    } catch (error) {
      if (isNotFound(error)) continue;
      throw new Error(`无法读取存储文件 ${key}：${errorMessage(error)}`);
    }
    if (info.isFile()) files.push({ key, sizeBytes: info.size, modifiedAt: info.mtime });
  }
  return files;
}

async function runPostCheck(
  nowMs: number,
  minAgeMs: number,
  items: OrphanFileReport[],
): Promise<OrphanPostCheck> {
  const refreshed = await loadReferencedKeys();
  const after = classifyOrphanFiles({
    files: await loadStoredFiles(),
    referencedKeys: refreshed.referenced,
    invalidReferencedKeys: refreshed.invalidReferencedKeys,
    nowMs,
    minAgeMs,
  });
  const deleted = items.filter((item) => item.status === "deleted").length;
  const failed = items.filter(
    (item) => item.status === "delete-failed" || item.status === "audit-failed",
  ).length;
  return {
    deleted,
    failed,
    remainingCandidates: after.summary.candidates,
    remainingOrphanFiles: after.summary.orphanFiles,
    passed: failed === 0 && after.summary.candidates === 0,
  };
}

function fileItem(
  file: StoredRepairFile,
  status: OrphanFileStatus,
  message?: string,
): OrphanFileReport {
  return {
    key: file.key,
    sizeBytes: file.sizeBytes,
    modifiedAt: file.modifiedAt.toISOString(),
    status,
    message,
  };
}

function countByStatus(items: OrphanFileReport[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;
  return counts;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
