export const REPAIR_PHOTO_ORPHAN_MIN_AGE_HOURS = 24;
export const REPAIR_PHOTO_ORPHAN_MAX_DELETE = 500;

export type StoredRepairFile = {
  key: string;
  sizeBytes: number;
  modifiedAt: Date;
};

export type OrphanScanSummary = {
  files: number;
  bytes: number;
  referencedKeys: number;
  referencedFilesPresent: number;
  missingReferencedFiles: number;
  invalidReferencedKeys: number;
  orphanFiles: number;
  orphanBytes: number;
  tooNewFiles: number;
  tooNewBytes: number;
  candidates: number;
  candidateBytes: number;
};

export type OrphanClassification = {
  candidates: StoredRepairFile[];
  tooNew: StoredRepairFile[];
  summary: OrphanScanSummary;
};

function byKey(left: StoredRepairFile, right: StoredRepairFile): number {
  return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
}

/**
 * 把存储文件分成「早于安全窗、可删除的孤儿」和「仍在安全窗内的孤儿」。
 * 引用集合包含软删除照片的 storage/thumbnail 键；只有两类键都不存在的文件才算孤儿。
 */
export function classifyOrphanFiles(input: {
  files: readonly StoredRepairFile[];
  referencedKeys: ReadonlySet<string>;
  invalidReferencedKeys?: readonly string[];
  nowMs: number;
  minAgeMs: number;
}): OrphanClassification {
  const present = new Set(input.files.map((file) => file.key));
  let referencedFilesPresent = 0;
  for (const key of input.referencedKeys) if (present.has(key)) referencedFilesPresent += 1;

  let bytes = 0;
  let orphanFiles = 0;
  let orphanBytes = 0;
  let tooNewFiles = 0;
  let tooNewBytes = 0;
  let candidateBytes = 0;
  const candidates: StoredRepairFile[] = [];
  const tooNew: StoredRepairFile[] = [];

  for (const file of input.files) {
    bytes += file.sizeBytes;
    if (input.referencedKeys.has(file.key)) continue;
    orphanFiles += 1;
    orphanBytes += file.sizeBytes;
    if (input.nowMs - file.modifiedAt.getTime() >= input.minAgeMs) {
      candidates.push(file);
      candidateBytes += file.sizeBytes;
    } else {
      tooNew.push(file);
      tooNewFiles += 1;
      tooNewBytes += file.sizeBytes;
    }
  }
  candidates.sort(byKey);
  tooNew.sort(byKey);

  return {
    candidates,
    tooNew,
    summary: {
      files: input.files.length,
      bytes,
      referencedKeys: input.referencedKeys.size,
      referencedFilesPresent,
      missingReferencedFiles: input.referencedKeys.size - referencedFilesPresent,
      invalidReferencedKeys: input.invalidReferencedKeys?.length ?? 0,
      orphanFiles,
      orphanBytes,
      tooNewFiles,
      tooNewBytes,
      candidates: candidates.length,
      candidateBytes,
    },
  };
}
