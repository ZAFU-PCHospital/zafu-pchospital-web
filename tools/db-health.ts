import { disconnectDb, getDb } from "../src/lib/db/client";

async function main(): Promise<void> {
  try {
    const rows = await getDb().$queryRaw<
      Array<{ databaseName: string; timeZone: string; characterSet: string; collation: string }>
    >`SELECT DATABASE() AS databaseName, @@session.time_zone AS timeZone, @@character_set_database AS characterSet, @@collation_database AS collation`;
    const health = rows[0];
    if (!health || health.timeZone !== "+00:00" || health.characterSet !== "utf8mb4") {
      throw new Error(`GreatSQL 会话基线不符合要求：${JSON.stringify(health)}`);
    }
    const nonInnoDb = await getDb().$queryRaw<Array<{ tableName: string; engine: string }>>`
      SELECT table_name AS tableName, engine
      FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' AND engine <> 'InnoDB'
    `;
    if (nonInnoDb.length > 0) {
      throw new Error(`发现非 InnoDB 业务表：${JSON.stringify(nonInnoDb)}`);
    }
    process.stdout.write(`${JSON.stringify({ ok: true, ...health })}\n`);
  } finally {
    await disconnectDb();
  }
}

void main();
