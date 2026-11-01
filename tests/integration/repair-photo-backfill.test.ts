import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import {
  backfillRepairPhotos,
  pruneBackfilledOriginals,
  scanRepairPhotoStorage,
} from "../../src/features/repairs/repair-photo-backfill-service";
import type { VerifiedBackup } from "../../src/features/repairs/repair-photo-backup";
import {
  localRepairPhotoStorage,
  uploadRoot,
} from "../../src/features/repairs/repair-photo-storage";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import { TINY_PNG_BYTES } from "../support/image-fixtures";
import { integrationTestsEnabled } from "./db-guard";

const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;
const PREFIX = "PHOTO323";
const SEED_TIME = new Date("2026-11-01T00:00:00.000Z");

let userId = "";
let profileId = "";
let recordId = "";
let uploadTestRoot = "";

function fakeBackup(): VerifiedBackup {
  return {
    manifestPath: "/tmp/manifest.txt",
    directory: "/tmp",
    createdAt: SEED_TIME.toISOString(),
    dbTables: 39,
    dbInserts: 1,
    dbBytes: 1,
    uploadsFiles: 1,
    uploadsBytes: 1,
    dbSha256: "a".repeat(64),
    uploadsSha256: "b".repeat(64),
  };
}

function applyOptions() {
  return {
    apply: true as const,
    backup: fakeBackup(),
    verifyBackupUploads: async () => {},
  };
}

function pngDigest(): Buffer {
  return createHash("sha256").update(TINY_PNG_BYTES).digest();
}

async function createLegacyPhoto(options: { deletedAt?: Date } = {}) {
  const original = await localRepairPhotoStorage.put({
    bytes: TINY_PNG_BYTES,
    mimeType: "image/png",
  });
  const photo = await getDb().repairPhoto.create({
    data: {
      id: randomUUID(),
      repairRecordId: recordId,
      storageKey: original.storageKey,
      originalName: "legacy.png",
      mimeType: "image/png",
      sizeBytes: TINY_PNG_BYTES.byteLength,
      sha256Digest: new Uint8Array(pngDigest()),
      sortOrder: 0,
      uploadedByUserId: userId,
      createdAt: SEED_TIME,
      deletedAt: options.deletedAt,
    },
  });
  return { photo, originalKey: original.storageKey };
}

async function createNewStylePhoto() {
  const display = await localRepairPhotoStorage.put({
    bytes: TINY_PNG_BYTES,
    mimeType: "image/png",
  });
  const thumb = await localRepairPhotoStorage.put({
    bytes: TINY_PNG_BYTES,
    mimeType: "image/png",
  });
  const photo = await getDb().repairPhoto.create({
    data: {
      id: randomUUID(),
      repairRecordId: recordId,
      storageKey: display.storageKey,
      thumbnailKey: thumb.storageKey,
      originalName: "new.png",
      mimeType: "image/webp",
      sizeBytes: TINY_PNG_BYTES.byteLength,
      sha256Digest: new Uint8Array(pngDigest()),
      width: 8,
      height: 8,
      sortOrder: 1,
      uploadedByUserId: userId,
      createdAt: SEED_TIME,
    },
  });
  return { photo, displayKey: display.storageKey, thumbKey: thumb.storageKey };
}

async function backfillOne() {
  const legacy = await createLegacyPhoto();
  const applied = await backfillRepairPhotos(applyOptions());
  assert.equal(applied.manifest?.photos.length, 1);
  return { legacy, manifest: applied.manifest! };
}

async function resetPhotos(): Promise<void> {
  const db = getDb();
  const photos = await db.repairPhoto.findMany({
    where: { repairRecordId: recordId },
    select: { id: true },
  });
  const ids = photos.map((photo) => photo.id);
  await db.auditLog.deleteMany({
    where: { targetType: "RepairPhoto", targetId: { in: ids } },
  });
  await db.repairPhoto.deleteMany({ where: { repairRecordId: recordId } });
}

before(async () => {
  if (!enabled) return;
  const db = getDb();
  userId = randomUUID();
  profileId = randomUUID();
  recordId = randomUUID();
  await db.user.create({
    data: {
      id: userId,
      status: "ACTIVE",
      displayName: `${PREFIX} 成员`,
      createdAt: SEED_TIME,
      updatedAt: SEED_TIME,
    },
  });
  await db.memberProfile.create({
    data: {
      id: profileId,
      userId,
      realName: `${PREFIX} 成员`,
      status: "ACTIVE",
      joinedAt: SEED_TIME,
      createdAt: SEED_TIME,
      updatedAt: SEED_TIME,
    },
  });
  await db.repairRecord.create({
    data: {
      id: recordId,
      memberProfileId: profileId,
      status: "PENDING",
      createRequestKey: `${PREFIX}:${recordId}`,
      createdAt: SEED_TIME,
      updatedAt: SEED_TIME,
    },
  });
});

beforeEach(async () => {
  if (!enabled) return;
  await resetPhotos();
  if (uploadTestRoot) await rm(uploadTestRoot, { recursive: true, force: true });
  uploadTestRoot = await mkdtemp(join(tmpdir(), "photo323-"));
  process.env.UPLOAD_PATH = uploadTestRoot;
});

after(async () => {
  if (!enabled) return;
  try {
    await resetPhotos();
    const db = getDb();
    await db.repairRecord.deleteMany({ where: { id: recordId } });
    await db.memberProfile.deleteMany({ where: { id: profileId } });
    await db.user.deleteMany({ where: { id: userId } });
  } finally {
    if (uploadTestRoot) await rm(uploadTestRoot, { recursive: true, force: true });
    await disconnectDb();
  }
});

dbTest("回填：dry-run 不写，apply 更新有效与软删除照片，重跑幂等", async () => {
  const db = getDb();
  const active = await createLegacyPhoto();
  await createLegacyPhoto({ deletedAt: SEED_TIME });
  const newStyle = await createNewStylePhoto();
  const filesBeforeDryRun = (await scanRepairPhotoStorage()).files.length;

  const dry = await backfillRepairPhotos({ apply: false });
  assert.equal(dry.report.totalPhotos, 3);
  assert.equal(dry.report.legacyPhotos, 2);
  assert.equal(dry.report.byStatus.ready, 2);
  assert.equal(dry.manifest, undefined);
  assert.equal((await scanRepairPhotoStorage()).files.length, filesBeforeDryRun);
  let activeRow = await db.repairPhoto.findUniqueOrThrow({ where: { id: active.photo.id } });
  assert.equal(activeRow.storageKey, active.originalKey);
  assert.equal(activeRow.thumbnailKey, null);

  const applied = await backfillRepairPhotos(applyOptions());
  assert.equal(applied.report.byStatus.updated, 2);
  assert.equal(applied.report.postCheck?.remainingLegacy, 0);
  assert.equal(applied.report.postCheck?.passed, true);
  assert.equal(applied.manifest?.photos.length, 2);
  assert.ok(applied.manifest?.photos.some((photo) => photo.deletedAt !== null));

  activeRow = await db.repairPhoto.findUniqueOrThrow({ where: { id: active.photo.id } });
  assert.notEqual(activeRow.storageKey, active.originalKey);
  assert.ok(activeRow.thumbnailKey);
  assert.equal(activeRow.mimeType, "image/webp");
  assert.equal(activeRow.width, 8);
  assert.equal(activeRow.height, 8);
  assert.ok(activeRow.sha256Digest.byteLength === 32);
  assert.ok((await localRepairPhotoStorage.open(active.originalKey)).byteLength > 0);
  assert.ok((await localRepairPhotoStorage.open(activeRow.storageKey)).byteLength > 0);
  assert.ok((await localRepairPhotoStorage.open(activeRow.thumbnailKey)).byteLength > 0);

  const newRow = await db.repairPhoto.findUniqueOrThrow({ where: { id: newStyle.photo.id } });
  assert.equal(newRow.storageKey, newStyle.displayKey);
  assert.equal(newRow.thumbnailKey, newStyle.thumbKey);
  assert.equal(
    await db.auditLog.count({
      where: { action: "repair.photo.backfilled", targetType: "RepairPhoto" },
    }),
    2,
  );

  const rerunDry = await backfillRepairPhotos({ apply: false });
  assert.equal(rerunDry.report.legacyPhotos, 0);
  const rerun = await backfillRepairPhotos(applyOptions());
  assert.equal(rerun.report.byStatus.updated ?? 0, 0);
  assert.equal(rerun.manifest?.photos.length, 0);
  assert.equal(
    await db.auditLog.count({
      where: { action: "repair.photo.backfilled", targetType: "RepairPhoto" },
    }),
    2,
  );
});

dbTest("原图删除：只删清单内、DB 不再引用且摘要一致的原图", async () => {
  const db = getDb();
  const active = await createLegacyPhoto();
  const deleted = await createLegacyPhoto({ deletedAt: SEED_TIME });
  const applied = await backfillRepairPhotos(applyOptions());
  const manifest = applied.manifest!;
  assert.equal(manifest.photos.length, 2);

  await writeFile(join(uploadRoot(), "not-a-photo.txt"), "keep me");
  await mkdir(join(uploadRoot(), "repairs", "zz"), { recursive: true });
  await writeFile(join(uploadRoot(), "repairs", "zz", "keep.bin"), "not in manifest");

  const dry = await pruneBackfilledOriginals({ manifest, apply: false });
  assert.equal(dry.candidates, 2);
  assert.equal(dry.byStatus.deletable, 2);
  assert.equal(dry.postCheck.passed, true);
  assert.ok((await localRepairPhotoStorage.open(active.originalKey)).byteLength > 0);

  const appliedPrune = await pruneBackfilledOriginals({
    manifest,
    apply: true,
    backup: fakeBackup(),
    verifyBackupUploads: async () => {},
  });
  assert.equal(appliedPrune.byStatus.deleted, 2);
  assert.equal(appliedPrune.postCheck.remainingOriginalFiles, 0);
  assert.equal(appliedPrune.postCheck.passed, true);
  for (const key of [active.originalKey, deleted.originalKey]) {
    await assert.rejects(() => localRepairPhotoStorage.open(key), { code: "ENOENT" });
  }
  const activeRow = await db.repairPhoto.findUniqueOrThrow({ where: { id: active.photo.id } });
  assert.ok((await localRepairPhotoStorage.open(activeRow.storageKey)).byteLength > 0);
  assert.ok((await localRepairPhotoStorage.open(activeRow.thumbnailKey!)).byteLength > 0);
  assert.equal(
    await db.auditLog.count({
      where: { action: "repair.photo.original.pruned", targetType: "RepairPhoto" },
    }),
    2,
  );
  assert.equal((await scanRepairPhotoStorage()).files.includes("repairs/zz/keep.bin"), true);
  assert.equal(await readFile(join(uploadRoot(), "not-a-photo.txt"), "utf8"), "keep me");

  const rerun = await pruneBackfilledOriginals({ manifest, apply: false });
  assert.equal(rerun.candidates, 0);
});

dbTest("原图缺失 / 摘要不符：不写变体，回填继续处理其他照片", async () => {
  await getDb().repairPhoto.create({
    data: {
      id: randomUUID(),
      repairRecordId: recordId,
      storageKey: `repairs/zz/${randomUUID()}.jpg`,
      mimeType: "image/jpeg",
      sizeBytes: TINY_PNG_BYTES.byteLength,
      sha256Digest: new Uint8Array(pngDigest()),
      sortOrder: 2,
      uploadedByUserId: userId,
      createdAt: SEED_TIME,
    },
  });
  const original = await localRepairPhotoStorage.put({
    bytes: TINY_PNG_BYTES,
    mimeType: "image/png",
  });
  await getDb().repairPhoto.create({
    data: {
      id: randomUUID(),
      repairRecordId: recordId,
      storageKey: original.storageKey,
      mimeType: "image/png",
      sizeBytes: TINY_PNG_BYTES.byteLength,
      sha256Digest: new Uint8Array(Buffer.alloc(32, 0xff)),
      sortOrder: 3,
      uploadedByUserId: userId,
      createdAt: SEED_TIME,
    },
  });

  const result = await backfillRepairPhotos(applyOptions());
  assert.equal(result.report.byStatus.updated ?? 0, 0);
  assert.equal(result.report.byStatus["missing-original"], 1);
  assert.equal(result.report.byStatus["digest-mismatch"], 1);
  assert.equal(result.manifest?.photos.length, 0);
  assert.equal(
    await getDb().repairPhoto.count({ where: { repairRecordId: recordId, thumbnailKey: null } }),
    2,
  );
});

dbTest("回填拒绝 repairs/../ 原图键，不读取或改写上传根下文件", async () => {
  const outside = join(uploadRoot(), "NOT-A-REPAIR-PHOTO.txt");
  await writeFile(outside, "keep me");
  await getDb().repairPhoto.create({
    data: {
      id: randomUUID(),
      repairRecordId: recordId,
      storageKey: "repairs/../NOT-A-REPAIR-PHOTO.txt",
      mimeType: "image/png",
      sizeBytes: TINY_PNG_BYTES.byteLength,
      sha256Digest: new Uint8Array(pngDigest()),
      sortOrder: 0,
      uploadedByUserId: userId,
      createdAt: SEED_TIME,
    },
  });

  const result = await backfillRepairPhotos(applyOptions());
  assert.equal(result.report.byStatus["invalid-key"], 1);
  assert.equal(result.manifest?.photos.length, 0);
  assert.equal(await readFile(outside, "utf8"), "keep me");
});

dbTest("prune 拒绝 repairs/../ 清单键，不删除上传根下文件", async () => {
  const { manifest } = await backfillOne();
  const outside = join(uploadRoot(), "NOT-A-REPAIR-PHOTO.txt");
  await writeFile(outside, "keep me");
  const bad = {
    ...manifest,
    photos: [{ ...manifest.photos[0]!, originalKey: "repairs/../NOT-A-REPAIR-PHOTO.txt" }],
  };
  const report = await pruneBackfilledOriginals({
    manifest: bad,
    apply: true,
    backup: fakeBackup(),
    verifyBackupUploads: async () => {},
  });
  assert.equal(report.byStatus["invalid-key"], 1);
  assert.equal(await readFile(outside, "utf8"), "keep me");
  assert.ok((await localRepairPhotoStorage.open(manifest.photos[0]!.originalKey)).byteLength > 0);
});

dbTest("prune 跳过被其他照片行重新引用的原图键", async () => {
  const { legacy, manifest } = await backfillOne();
  await getDb().repairPhoto.create({
    data: {
      id: randomUUID(),
      repairRecordId: recordId,
      storageKey: legacy.originalKey,
      mimeType: "image/png",
      sizeBytes: TINY_PNG_BYTES.byteLength,
      sha256Digest: new Uint8Array(pngDigest()),
      sortOrder: 9,
      uploadedByUserId: userId,
      createdAt: SEED_TIME,
    },
  });

  const report = await pruneBackfilledOriginals({ manifest, apply: false });
  assert.equal(report.byStatus["still-referenced"], 1);
  assert.ok((await localRepairPhotoStorage.open(legacy.originalKey)).byteLength > 0);
});

dbTest("prune 跳过行已变化、变体缺失、原图摘要不符的项", async () => {
  const { manifest } = await backfillOne();
  const photo = manifest.photos[0]!;

  await getDb().repairPhoto.update({
    where: { id: photo.photoId },
    data: { width: photo.width + 1 },
  });
  let report = await pruneBackfilledOriginals({ manifest, apply: false });
  assert.equal(report.byStatus["row-changed"], 1);

  await getDb().repairPhoto.update({
    where: { id: photo.photoId },
    data: { width: photo.width },
  });
  await writeFile(join(uploadRoot(), photo.originalKey), Buffer.alloc(photo.originalSizeBytes, 1));
  report = await pruneBackfilledOriginals({ manifest, apply: false });
  assert.equal(report.byStatus["digest-mismatch"], 1);

  await writeFile(join(uploadRoot(), photo.originalKey), TINY_PNG_BYTES);
  await writeFile(join(uploadRoot(), photo.displayKey), "tampered");
  report = await pruneBackfilledOriginals({ manifest, apply: false });
  assert.equal(report.byStatus["missing-variant"], 1);
  assert.ok((await localRepairPhotoStorage.open(photo.originalKey)).byteLength > 0);
});

dbTest("prune 拒绝来自其他数据库的回填清单", async () => {
  const { manifest } = await backfillOne();
  await assert.rejects(
    () =>
      pruneBackfilledOriginals({
        manifest: { ...manifest, database: "other:3306/other" },
        apply: false,
      }),
    /数据库不匹配/,
  );
});
