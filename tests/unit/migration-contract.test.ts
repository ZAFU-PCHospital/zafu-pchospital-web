import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../../prisma/migrations/20260915120000_p2_m0_foundation/migration.sql",
  import.meta.url,
);

test("初始 Migration 固定 GreatSQL 字符集、引擎与邀请码计数约束", async () => {
  const sql = await readFile(migrationPath, "utf8");
  const createTables = sql.match(/CREATE TABLE/g) ?? [];
  const collations = sql.match(/DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci/g) ?? [];
  assert.equal(collations.length, createTables.length);
  assert.match(sql, /SET SESSION default_storage_engine = InnoDB/);
  assert.match(
    sql,
    /CHECK \(`max_uses` >= 1 AND `used_count` >= 0 AND `used_count` <= `max_uses`\)/,
  );
  assert.doesNotMatch(sql, /FOREIGN KEY \(`qq_normalized`\)|FOREIGN KEY \(`phone_normalized`\)/);
});
