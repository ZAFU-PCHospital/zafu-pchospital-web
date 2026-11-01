import assert from "node:assert/strict";
import test from "node:test";

import { classifyOrphanFiles } from "../../src/features/repairs/repair-photo-orphan";
import { cleanRepairPhotoOrphans } from "../../src/features/repairs/repair-photo-orphan-service";

const now = new Date("2026-11-01T12:00:00.000Z");
const old = new Date("2026-10-30T12:00:00.000Z");
const recent = new Date("2026-11-01T06:00:00.000Z");

test("孤儿分类：引用文件保留，过期孤儿成为候选，安全窗内标记过新", () => {
  const result = classifyOrphanFiles({
    files: [
      { key: "repairs/aa/ref-display.webp", sizeBytes: 100, modifiedAt: old },
      { key: "repairs/aa/ref-thumb.webp", sizeBytes: 50, modifiedAt: old },
      { key: "repairs/bb/orphan-old.webp", sizeBytes: 200, modifiedAt: old },
      { key: "repairs/cc/orphan-new.webp", sizeBytes: 300, modifiedAt: recent },
    ],
    referencedKeys: new Set([
      "repairs/aa/ref-display.webp",
      "repairs/aa/ref-thumb.webp",
      "repairs/dd/missing.webp",
    ]),
    invalidReferencedKeys: ["repairs/../bad.webp"],
    nowMs: now.getTime(),
    minAgeMs: 24 * 60 * 60 * 1000,
  });

  assert.deepEqual(
    result.candidates.map((file) => file.key),
    ["repairs/bb/orphan-old.webp"],
  );
  assert.deepEqual(
    result.tooNew.map((file) => file.key),
    ["repairs/cc/orphan-new.webp"],
  );
  assert.deepEqual(result.summary, {
    files: 4,
    bytes: 650,
    referencedKeys: 3,
    referencedFilesPresent: 2,
    missingReferencedFiles: 1,
    invalidReferencedKeys: 1,
    orphanFiles: 2,
    orphanBytes: 500,
    tooNewFiles: 1,
    tooNewBytes: 300,
    candidates: 1,
    candidateBytes: 200,
  });
});

test("apply 未提供备份清单时在读取数据库前拒绝", async () => {
  await assert.rejects(() => cleanRepairPhotoOrphans({ apply: true }), /备份清单/);
});

test("安全窗与删除上限参数非法时拒绝", async () => {
  await assert.rejects(
    () => cleanRepairPhotoOrphans({ apply: false, minAgeHours: -1 }),
    /minAgeHours/,
  );
  await assert.rejects(() => cleanRepairPhotoOrphans({ apply: false, maxDelete: 0 }), /maxDelete/);
});
