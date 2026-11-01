import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { gzipSync } from "node:zlib";

import { cleanRepairPhotoOrphans } from "../../src/features/repairs/repair-photo-orphan-service";
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
const PREFIX = "PHOTO326";
const SEED_TIME = new Date("2026-11-01T00:00:00.000Z");
const OLD_TIME = new Date("2026-10-30T00:00:00.000Z");

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

function hasTar(): boolean {
  return spawnSync("tar", ["--version"], { stdio: "ignore" }).status === 0;
}

const cliTest = enabled && hasTar() ? test : test.skip;

async function createReferencedPhoto(options: { deletedAt?: Date } = {}) {
  const display = await localRepairPhotoStorage.put({
    bytes: TINY_PNG_BYTES,
    mimeType: "image/png",
  });
  const thumbnail = await localRepairPhotoStorage.put({
    bytes: TINY_PNG_BYTES,
    mimeType: "image/png",
  });
  const photo = await getDb().repairPhoto.create({
    data: {
      id: randomUUID(),
      repairRecordId: recordId,
      storageKey: display.storageKey,
      thumbnailKey: thumbnail.storageKey,
      originalName: "referenced.png",
      mimeType: "image/webp",
      sizeBytes: TINY_PNG_BYTES.byteLength,
      sha256Digest: new Uint8Array(pngDigest()),
      width: 8,
      height: 8,
      sortOrder: 0,
      uploadedByUserId: userId,
      createdAt: SEED_TIME,
      deletedAt: options.deletedAt,
    },
  });
  return { photo, displayKey: display.storageKey, thumbnailKey: thumbnail.storageKey };
}

async function createOrphanFile(modifiedAt: Date): Promise<string> {
  const stored = await localRepairPhotoStorage.put({
    bytes: TINY_PNG_BYTES,
    mimeType: "image/png",
  });
  const path = join(uploadRoot(), stored.storageKey);
  await utimes(path, modifiedAt, modifiedAt);
  return stored.storageKey;
}

async function createMissingReference(): Promise<string> {
  const key = `repairs/zz/missing-${randomUUID()}.webp`;
  await getDb().repairPhoto.create({
    data: {
      id: randomUUID(),
      repairRecordId: recordId,
      storageKey: key,
      originalName: "missing.png",
      mimeType: "image/webp",
      sizeBytes: 1,
      sha256Digest: new Uint8Array(pngDigest()),
      sortOrder: 0,
      uploadedByUserId: userId,
      createdAt: SEED_TIME,
    },
  });
  return key;
}

async function resetPhotos(): Promise<void> {
  if (!recordId) return;
  const db = getDb();
  await db.auditLog.deleteMany({
    where: {
      action: "repair.photo.orphan.pruned",
      targetType: "RepairPhotoStorage",
      requestId: { startsWith: "photo-orphan:" },
    },
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
  uploadTestRoot = await mkdtemp(join(tmpdir(), "photo326-"));
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

dbTest("孤儿清理：dry-run 不删，apply 只删安全窗外孤儿并写审计，重跑幂等", async () => {
  const active = await createReferencedPhoto();
  const softDeleted = await createReferencedPhoto({ deletedAt: SEED_TIME });
  const oldOrphan = await createOrphanFile(OLD_TIME);
  const newOrphan = await createOrphanFile(new Date());
  const runId = "photo-orphans-test-flow";

  const dry = await cleanRepairPhotoOrphans({ apply: false, runId });
  assert.equal(dry.scan.files, 6);
  assert.equal(dry.scan.referencedKeys, 4);
  assert.equal(dry.scan.referencedFilesPresent, 4);
  assert.equal(dry.scan.missingReferencedFiles, 0);
  assert.equal(dry.scan.orphanFiles, 2);
  assert.equal(dry.scan.candidates, 1);
  assert.equal(dry.scan.tooNewFiles, 1);
  assert.equal(dry.items.find((item) => item.key === oldOrphan)?.status, "candidate");
  assert.equal(dry.items.find((item) => item.key === newOrphan)?.status, "too-new");
  await localRepairPhotoStorage.open(oldOrphan);

  const verified: string[] = [];
  const applied = await cleanRepairPhotoOrphans({
    apply: true,
    backup: fakeBackup(),
    runId,
    verifyBackupUploads: async (keys) => {
      verified.push(...keys);
    },
  });
  assert.deepEqual(verified, [oldOrphan]);
  assert.equal(applied.byStatus.deleted, 1);
  assert.equal(applied.postCheck?.deleted, 1);
  assert.equal(applied.postCheck?.passed, true);
  await assert.rejects(() => localRepairPhotoStorage.open(oldOrphan), { code: "ENOENT" });
  await localRepairPhotoStorage.open(newOrphan);
  for (const key of [
    active.displayKey,
    active.thumbnailKey,
    softDeleted.displayKey,
    softDeleted.thumbnailKey,
  ])
    await localRepairPhotoStorage.open(key);

  const audits = await getDb().auditLog.findMany({
    where: { action: "repair.photo.orphan.pruned", requestId: `photo-orphan:${runId}` },
  });
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.targetType, "RepairPhotoStorage");
  assert.equal((audits[0]!.beforeSummary as { storageKey?: string } | null)?.storageKey, oldOrphan);

  const rerun = await cleanRepairPhotoOrphans({ apply: false, runId: `${runId}-rerun` });
  assert.equal(rerun.scan.candidates, 0);
  assert.equal(rerun.scan.tooNewFiles, 1);

  const rerunApply = await cleanRepairPhotoOrphans({
    apply: true,
    backup: fakeBackup(),
    runId: `${runId}-rerun-apply`,
    verifyBackupUploads: async () => {},
  });
  assert.equal(rerunApply.postCheck?.deleted, 0);
  assert.equal(rerunApply.postCheck?.passed, true);
  assert.equal(
    await getDb().auditLog.count({
      where: {
        action: "repair.photo.orphan.pruned",
        requestId: `photo-orphan:${runId}-rerun-apply`,
      },
    }),
    0,
  );
});

dbTest("孤儿清理：候选超过 maxDelete 或备份不含文件时拒绝删除", async () => {
  const first = await createOrphanFile(OLD_TIME);
  const second = await createOrphanFile(OLD_TIME);

  await assert.rejects(
    () =>
      cleanRepairPhotoOrphans({
        apply: true,
        backup: fakeBackup(),
        maxDelete: 1,
        verifyBackupUploads: async () => {},
      }),
    /max-delete/,
  );
  await localRepairPhotoStorage.open(first);
  await localRepairPhotoStorage.open(second);

  await assert.rejects(
    () =>
      cleanRepairPhotoOrphans({
        apply: true,
        backup: fakeBackup(),
        verifyBackupUploads: async () => {
          throw new Error("备份 uploads 缺少候选文件");
        },
      }),
    /备份 uploads 缺少候选文件/,
  );
  await localRepairPhotoStorage.open(first);
  await localRepairPhotoStorage.open(second);
  assert.equal(
    await getDb().auditLog.count({
      where: {
        action: "repair.photo.orphan.pruned",
        requestId: { startsWith: "photo-orphan:" },
      },
    }),
    0,
  );
});

dbTest("孤儿清理：数据库引用缺失文件时在报告中列出缺失，不误删其它孤儿", async () => {
  await createReferencedPhoto();
  const missingKey = await createMissingReference();
  const orphan = await createOrphanFile(OLD_TIME);

  const dry = await cleanRepairPhotoOrphans({ apply: false });
  assert.equal(dry.scan.missingReferencedFiles, 1);
  assert.equal(dry.scan.referencedFilesPresent, 2);
  assert.equal(dry.scan.candidates, 1);
  assert.equal(dry.items.find((item) => item.key === orphan)?.status, "candidate");
  assert.ok(!dry.items.some((item) => item.key === missingKey));
  await localRepairPhotoStorage.open(orphan);
});

cliTest("CLI：真实备份归档校验通过后删除孤儿并写审计", async () => {
  const orphan = await createOrphanFile(OLD_TIME);
  const dir = await mkdtemp(join(tmpdir(), "photo326-cli-"));
  try {
    const backupDir = join(dir, "backup");
    await mkdir(backupDir, { recursive: true });
    const stage = join(dir, "stage");
    const staged = join(stage, "uploads", orphan);
    await mkdir(dirname(staged), { recursive: true });
    await copyFile(join(uploadRoot(), orphan), staged);
    const tarResult = spawnSync(
      "tar",
      [
        ...(process.platform === "win32" ? ["--force-local"] : []),
        "-czf",
        join(backupDir, "uploads.tar.gz"),
        "-C",
        stage,
        "uploads",
      ],
      { encoding: "utf8" },
    );
    assert.equal(tarResult.status, 0, tarResult.stderr);

    const dbDump = gzipSync(
      Buffer.from(
        `${Array.from({ length: 27 }, (_, index) => `CREATE TABLE t${index} (id int);`).join("\n")}\nINSERT INTO t0 VALUES (1);\n`,
      ),
    );
    await writeFile(join(backupDir, "db.sql.gz"), dbDump);
    const uploads = await readFile(join(backupDir, "uploads.tar.gz"));
    const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
    const manifestPath = join(backupDir, "manifest.txt");
    await writeFile(
      manifestPath,
      [
        "created_at=2026-11-01T00:00:00Z",
        "db_tables=27",
        "db_inserts=1",
        `db_bytes=${dbDump.byteLength}`,
        "uploads_files=1",
        `uploads_bytes=${uploads.byteLength}`,
        `sha256_db.sql.gz=${sha(dbDump)}`,
        `sha256_uploads.tar.gz=${sha(uploads)}`,
      ].join("\n"),
    );

    const dbName = new URL(process.env.DATABASE_URL!).pathname.replace(/^\/+/, "");
    const resultPath = join(dir, "result.json");
    const cli = spawnSync(
      process.execPath,
      [
        join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"),
        "tools/repair-photo-orphans.ts",
        "--apply",
        `--backup-manifest=${manifestPath}`,
        `--expect-db=${dbName}`,
        `--json=${resultPath}`,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, UPLOAD_PATH: uploadTestRoot },
        encoding: "utf8",
      },
    );
    assert.equal(cli.status, 0, `${cli.stdout}\n${cli.stderr}`);
    const result = JSON.parse(await readFile(resultPath, "utf8")) as {
      report: { runId: string; postCheck?: { passed: boolean; deleted: number } };
    };
    assert.equal(result.report.postCheck?.passed, true);
    assert.equal(result.report.postCheck?.deleted, 1);
    await assert.rejects(() => localRepairPhotoStorage.open(orphan), { code: "ENOENT" });
    assert.equal(
      await getDb().auditLog.count({
        where: {
          action: "repair.photo.orphan.pruned",
          requestId: `photo-orphan:${result.report.runId}`,
        },
      }),
      1,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
