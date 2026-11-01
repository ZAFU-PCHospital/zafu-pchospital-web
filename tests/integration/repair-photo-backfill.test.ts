import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

  const applied = await backfillRepairPhotos({ apply: true, backup: fakeBackup() });
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
  const rerun = await backfillRepairPhotos({ apply: true, backup: fakeBackup() });
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
  const applied = await backfillRepairPhotos({ apply: true, backup: fakeBackup() });
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
  assert.equal((await scanRepairPhotoStorage()).files.includes("repairs/zz/keep.bin"), true);
  assert.equal(await localRepairPhotoStorage.open("not-a-photo.txt").then(() => true), true);

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

  const result = await backfillRepairPhotos({ apply: true, backup: fakeBackup() });
  assert.equal(result.report.byStatus.updated ?? 0, 0);
  assert.equal(result.report.byStatus["missing-original"], 1);
  assert.equal(result.report.byStatus["digest-mismatch"], 1);
  assert.equal(result.manifest?.photos.length, 0);
  assert.equal(
    await getDb().repairPhoto.count({ where: { repairRecordId: recordId, thumbnailKey: null } }),
    2,
  );
});
