import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { parseBackfillManifest } from "../../src/features/repairs/repair-photo-backfill";
import {
  backfillRepairPhotos,
  pruneBackfilledOriginals,
} from "../../src/features/repairs/repair-photo-backfill-service";
import { verifyBackupManifest } from "../../src/features/repairs/repair-photo-backup";

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

test("回填清单：读取成功，拒绝类型/版本/字段不完整", () => {
  const manifest = parseBackfillManifest(
    JSON.stringify({
      kind: "repair-photo-backfill",
      version: 1,
      runId: "run-1",
      photos: [manifestPhoto()],
    }),
  );
  assert.equal(manifest.runId, "run-1");
  assert.equal(manifest.photos[0]!.displayKey, "repairs/bb/display.webp");

  assert.throws(
    () =>
      parseBackfillManifest(
        JSON.stringify({ kind: "repair-photo-backfill", version: 2, photos: [] }),
      ),
    /类型或版本/,
  );
  assert.throws(
    () =>
      parseBackfillManifest(
        JSON.stringify({
          kind: "repair-photo-backfill",
          version: 1,
          photos: [{ ...manifestPhoto(), originalSha256: "" }],
        }),
      ),
    /originalSha256/,
  );
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

test("备份清单：缺字段或表数不足拒绝", async () => {
  const dir = await mkdtemp(join(tmpdir(), "photo-backup-bad-"));
  tempDirs.push(dir);
  await writeFile(join(dir, "db.sql.gz"), "db");
  await writeFile(join(dir, "uploads.tar.gz"), "uploads");
  await writeFile(join(dir, "manifest.txt"), "created_at=2026-11-01T00:00:00Z\n");
  await assert.rejects(() => verifyBackupManifest(join(dir, "manifest.txt")), /缺少 db_tables/);
});

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
