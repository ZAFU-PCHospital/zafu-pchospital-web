import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  isBackfillComplete,
  parseBackfillManifest,
} from "../../src/features/repairs/repair-photo-backfill";
import { isRepairStorageKey } from "../../src/features/repairs/repair-photo-storage";
import {
  backfillRepairPhotos,
  pruneBackfilledOriginals,
} from "../../src/features/repairs/repair-photo-backfill-service";
import {
  verifyBackupManifest,
  verifyUploadsArchiveContains,
} from "../../src/features/repairs/repair-photo-backup";

const tempDirs: string[] = [];

after(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function manifestPhoto() {
  return {
    photoId: "photo-1",
    recordId: "record-1",
    originalKey: "repairs/aa/original.jpg",
    originalSizeBytes: 3,
    originalSha256: "a".repeat(64),
    displayKey: "repairs/bb/display.webp",
    displaySizeBytes: 2,
    displaySha256: "b".repeat(64),
    width: 8,
    height: 8,
    thumbnailKey: "repairs/cc/thumb.webp",
    thumbnailSizeBytes: 1,
    thumbnailSha256: "c".repeat(64),
    deletedAt: null,
  };
}

function manifestBody(overrides: Record<string, unknown> = {}) {
  return {
    kind: "repair-photo-backfill",
    version: 1,
    runId: "run-1",
    database: "127.0.0.1:3307/zafu_pchospital",
    startedAt: "2026-11-01T00:00:00.000Z",
    finishedAt: "2026-11-01T00:01:00.000Z",
    backup: {
      manifestPath: "/backups/manifest.txt",
      createdAt: "2026-11-01T00:00:00.000Z",
      dbTables: 39,
      dbInserts: 10,
      dbBytes: 100,
      uploadsFiles: 4,
      uploadsBytes: 100,
      dbSha256: "d".repeat(64),
      uploadsSha256: "e".repeat(64),
    },
    totals: { totalPhotos: 1, legacyPhotos: 1, updated: 1, failed: 0, remainingLegacy: 0 },
    photos: [manifestPhoto()],
    failures: [],
    ...overrides,
  };
}

test("回填清单：读取成功，拒绝类型/版本/路径穿越/重复照片", () => {
  const manifest = parseBackfillManifest(JSON.stringify(manifestBody()));
  assert.equal(manifest.runId, "run-1");
  assert.equal(manifest.photos[0]!.displayKey, "repairs/bb/display.webp");

  assert.throws(
    () =>
      parseBackfillManifest(
        JSON.stringify(manifestBody({ kind: "repair-photo-backfill", version: 2 })),
      ),
    /类型或版本/,
  );
  assert.throws(
    () =>
      parseBackfillManifest(
        JSON.stringify(
          manifestBody({
            photos: [{ ...manifestPhoto(), originalSha256: "" }],
          }),
        ),
      ),
    /originalSha256/,
  );
  assert.throws(
    () =>
      parseBackfillManifest(
        JSON.stringify(
          manifestBody({
            photos: [{ ...manifestPhoto(), originalKey: "repairs/../NOT-A-PHOTO.txt" }],
          }),
        ),
      ),
    /不是规范的 repairs/,
  );
  assert.throws(
    () =>
      parseBackfillManifest(
        JSON.stringify(manifestBody({ photos: [manifestPhoto(), manifestPhoto()] })),
      ),
    /photoId 重复/,
  );
});

test("回填完成判定：空库成功，部分更新失败", () => {
  assert.equal(isBackfillComplete(0, {}), true);
  assert.equal(isBackfillComplete(2, { updated: 2 }), true);
  assert.equal(isBackfillComplete(2, { updated: 1 }), false);
});

test("维修照片键必须是规范 repairs/ 路径", () => {
  assert.equal(isRepairStorageKey("repairs/aa/photo.webp"), true);
  for (const key of [
    "repairs/../NOT-A-PHOTO.txt",
    "repairs/./photo.webp",
    "repairs//photo.webp",
    "repairs",
    "repairs/",
    "/repairs/photo.webp",
    "repairs\photo.webp",
    "../photo.webp",
  ])
    assert.equal(isRepairStorageKey(key), false, key);
});

test("apply 未提供备份时在写库 / 删除前拒绝", async () => {
  await assert.rejects(() => backfillRepairPhotos({ apply: true }), /备份清单/);
  await assert.rejects(
    () =>
      pruneBackfilledOriginals({
        apply: true,
        manifest: {
          kind: "repair-photo-backfill",
          version: 1,
          runId: "run-1",
          database: "test",
          startedAt: new Date(0).toISOString(),
          finishedAt: new Date(0).toISOString(),
          backup: {
            manifestPath: "manifest.txt",
            createdAt: new Date(0).toISOString(),
            dbTables: 39,
            dbInserts: 1,
            dbBytes: 1,
            uploadsFiles: 1,
            uploadsBytes: 1,
            dbSha256: "a".repeat(64),
            uploadsSha256: "b".repeat(64),
          },
          totals: { totalPhotos: 0, legacyPhotos: 0, updated: 0, failed: 0, remainingLegacy: 0 },
          photos: [],
          failures: [],
        },
      }),
    /备份清单/,
  );
});

test("备份清单：校验归档大小与 SHA256，篡改后拒绝", async () => {
  const dir = await mkdtemp(join(tmpdir(), "photo-backup-"));
  tempDirs.push(dir);
  const db = Buffer.from("db-archive");
  const uploads = Buffer.from("uploads-archive");
  const dbSha = hash(db);
  const uploadsSha = hash(uploads);
  await writeFile(join(dir, "db.sql.gz"), db);
  await writeFile(join(dir, "uploads.tar.gz"), uploads);
  await writeFile(
    join(dir, "manifest.txt"),
    [
      "created_at=2026-11-01T00:00:00Z",
      "db_tables=39",
      "db_inserts=10",
      `db_bytes=${db.byteLength}`,
      "uploads_files=4",
      `uploads_bytes=${uploads.byteLength}`,
      `sha256_db.sql.gz=${dbSha}`,
      `sha256_uploads.tar.gz=${uploadsSha}`,
    ].join("\n"),
  );

  const info = await verifyBackupManifest(join(dir, "manifest.txt"));
  assert.equal(info.dbTables, 39);
  assert.equal(info.dbSha256, dbSha);
  assert.equal(info.uploadsFiles, 4);

  await writeFile(join(dir, "uploads.tar.gz"), Buffer.from("tampered"));
  await assert.rejects(() => verifyBackupManifest(join(dir, "manifest.txt")), /大小不符/);

  await writeFile(join(dir, "uploads.tar.gz"), uploads);
  await writeFile(
    join(dir, "manifest.txt"),
    [
      "created_at=2026-11-01T00:00:00Z",
      "db_tables=39",
      "db_inserts=10",
      `db_bytes=${db.byteLength}`,
      "uploads_files=4",
      `uploads_bytes=${uploads.byteLength}`,
      `sha256_db.sql.gz=${dbSha}`,
      `sha256_uploads.tar.gz=${"0".repeat(64)}`,
    ].join("\n"),
  );
  await assert.rejects(() => verifyBackupManifest(join(dir, "manifest.txt")), /SHA256 不符/);
});

test("上传归档必须包含清单中的原图", { skip: !hasTar() }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "photo-tar-"));
  tempDirs.push(dir);
  await mkdir(join(dir, "uploads", "repairs", "aa"), { recursive: true });
  await writeFile(join(dir, "uploads", "repairs", "aa", "photo.webp"), "photo");
  execFileSync("tar", ["-czf", "uploads.tar.gz", "uploads"], { cwd: dir });

  await verifyUploadsArchiveContains({ directory: dir }, ["repairs/aa/photo.webp"]);
  await assert.rejects(
    () => verifyUploadsArchiveContains({ directory: dir }, ["repairs/aa/missing.webp"]),
    /缺少 1 个待处理原图/,
  );

  await mkdir(join(dir, "evil", "repairs", "aa"), { recursive: true });
  await writeFile(join(dir, "evil", "repairs", "aa", "photo.webp"), "photo");
  execFileSync("tar", ["-czf", "uploads.tar.gz", "evil"], { cwd: dir });
  await assert.rejects(
    () => verifyUploadsArchiveContains({ directory: dir }, ["repairs/aa/photo.webp"]),
    /缺少 1 个待处理原图/,
  );
});

test("备份清单：缺字段或表数不足拒绝", async () => {
  const dir = await mkdtemp(join(tmpdir(), "photo-backup-bad-"));
  tempDirs.push(dir);
  await writeFile(join(dir, "db.sql.gz"), "db");
  await writeFile(join(dir, "uploads.tar.gz"), "uploads");
  await writeFile(join(dir, "manifest.txt"), "created_at=2026-11-01T00:00:00Z\n");
  await assert.rejects(() => verifyBackupManifest(join(dir, "manifest.txt")), /缺少 db_tables/);
});

function hasTar(): boolean {
  try {
    execFileSync("tar", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
