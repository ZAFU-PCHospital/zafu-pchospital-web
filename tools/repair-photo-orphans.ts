import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  REPAIR_PHOTO_ORPHAN_MAX_DELETE,
  REPAIR_PHOTO_ORPHAN_MIN_AGE_HOURS,
} from "../src/features/repairs/repair-photo-orphan";
import {
  cleanRepairPhotoOrphans,
  type OrphanReport,
} from "../src/features/repairs/repair-photo-orphan-service";
import {
  verifyBackupManifest,
  verifyUploadsArchiveContains,
} from "../src/features/repairs/repair-photo-backup";
import { disconnectDb } from "../src/lib/db/client";

/**
 * 维修照片 P3+：清理数据库不再引用的存储文件。
 *
 * 用法：
 *   pnpm repair:photos:orphans [--json=<报告路径>] [--min-age-hours=24]
 *   pnpm repair:photos:orphans --apply --backup-manifest=<manifest.txt> \
 *     --expect-db=<库名> --json=<结果路径> [--max-delete=500]
 *
 * - 缺省 dry-run：只扫描和报告，不删除文件；
 * - 只处理 `repairs/` 下、同时不被 `storage_key` / `thumbnail_key` 引用的文件；
 * - 文件修改时间进入安全窗（默认 24h）后才是候选，避免误删刚写入但事务未提交的上传；
 * - apply 前必须提供校验通过的定时备份清单，并确认 uploads 归档包含全部候选文件；
 * - 每个删除写一条 `repair.photo.orphan.pruned` SYSTEM 审计；apply 必须输出 JSON 结果。
 */

type CliOptions = {
  apply: boolean;
  backupManifest: string | null;
  expectDb: string | null;
  jsonPath: string | null;
  minAgeHours: number;
  maxDelete: number;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.apply) assertExpectedDatabase(options.expectDb!);
  const backup = options.apply ? await verifyBackupManifest(options.backupManifest!) : undefined;
  if (backup) {
    console.log(`备份清单：${backup.manifestPath}`);
    console.log(
      `备份时间：${backup.createdAt}；数据库 ${backup.dbTables} 表 / ${backup.dbInserts} INSERT；上传文件 ${backup.uploadsFiles} 个 / ${backup.uploadsBytes}B`,
    );
  }

  const report = await cleanRepairPhotoOrphans({
    apply: options.apply,
    backup,
    verifyBackupUploads: backup ? (keys) => verifyUploadsArchiveContains(backup, keys) : undefined,
    minAgeHours: options.minAgeHours,
    maxDelete: options.maxDelete,
  });
  printReport(report);

  if (options.jsonPath)
    await writeJson(options.jsonPath, {
      kind: options.apply ? "repair-photo-orphan-result" : "repair-photo-orphan-report",
      exportedAt: new Date().toISOString(),
      report,
    });

  if (!options.apply) {
    console.log("\ndry-run 完成，未删除任何文件。确认候选列表后再加 --apply 执行。");
    if (report.scan.missingReferencedFiles > 0 || report.scan.invalidReferencedKeys > 0)
      process.exitCode = 1;
  } else {
    console.log(
      "\n孤儿文件清理完成。请保留备份到观察期结束；审计动作 repair.photo.orphan.pruned。",
    );
    if (
      !report.postCheck?.passed ||
      report.scan.missingReferencedFiles > 0 ||
      report.scan.invalidReferencedKeys > 0
    )
      process.exitCode = 1;
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    backupManifest: null,
    expectDb: null,
    jsonPath: null,
    minAgeHours: REPAIR_PHOTO_ORPHAN_MIN_AGE_HOURS,
    maxDelete: REPAIR_PHOTO_ORPHAN_MAX_DELETE,
  };
  for (const arg of args) {
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    const backup = readArgValue(arg, "--backup-manifest");
    if (backup !== null) {
      options.backupManifest = backup;
      continue;
    }
    const expectDb = readArgValue(arg, "--expect-db");
    if (expectDb !== null) {
      options.expectDb = expectDb;
      continue;
    }
    const json = readArgValue(arg, "--json");
    if (json !== null) {
      options.jsonPath = json;
      continue;
    }
    const minAge = readArgValue(arg, "--min-age-hours");
    if (minAge !== null) {
      options.minAgeHours = parseNumber(minAge, "--min-age-hours");
      continue;
    }
    const maxDelete = readArgValue(arg, "--max-delete");
    if (maxDelete !== null) {
      options.maxDelete = parsePositiveInteger(maxDelete, "--max-delete");
      continue;
    }
    throw new Error(`未知参数：${arg}（--help 查看用法）`);
  }
  if (options.apply && !options.backupManifest)
    throw new Error("--apply 必须同时提供 --backup-manifest=<manifest.txt>");
  if (options.apply && !options.expectDb)
    throw new Error("--apply 必须用 --expect-db=<库名> 确认目标数据库");
  if (options.apply && !options.jsonPath)
    throw new Error("--apply 必须提供 --json=<结果清单路径>，保留删除记录");
  return options;
}

function readArgValue(arg: string, name: string): string | null {
  const prefix = `${name}=`;
  if (!arg.startsWith(prefix)) return null;
  const value = arg.slice(prefix.length).trim();
  if (!value) throw new Error(`${name} 不能为空`);
  return value;
}

function parseNumber(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 24 * 365)
    throw new Error(`${name} 必须是 0–8760 之间的数字`);
  return value;
}

function parsePositiveInteger(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} 必须是正整数`);
  return value;
}

function assertExpectedDatabase(expected: string): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("未设置 DATABASE_URL");
  const actualName = new URL(raw).pathname.replace(/^\/+/, "");
  const actualLabel = `${new URL(raw).hostname}:${new URL(raw).port || "3306"}${new URL(raw).pathname}`;
  const matched = expected.includes("/") ? expected === actualLabel : expected === actualName;
  if (!matched)
    throw new Error(
      `目标库不匹配：当前为「${actualLabel}」，--expect-db 为「${expected}」。已拒绝执行。`,
    );
}

function printReport(report: OrphanReport): void {
  console.log(`\n数据库：${report.database}`);
  console.log(`模式：${report.apply ? "apply（删除文件）" : "dry-run（未删除）"}`);
  console.log(`安全窗：${report.minAgeHours} 小时；单轮删除上限：${report.maxDelete}`);
  console.log(
    `扫描：${report.scan.files} 个文件 / ${report.scan.bytes}B；引用键 ${report.scan.referencedKeys}（存在 ${report.scan.referencedFilesPresent}，缺失 ${report.scan.missingReferencedFiles}，非法 ${report.scan.invalidReferencedKeys}）`,
  );
  console.log(
    `孤儿：${report.scan.orphanFiles} 个 / ${report.scan.orphanBytes}B；候选 ${report.scan.candidates} / ${report.scan.candidateBytes}B；安全窗内 ${report.scan.tooNewFiles} / ${report.scan.tooNewBytes}B`,
  );
  console.log(`结果：${formatCounts(report.byStatus)}`);
  for (const item of report.items.slice(0, 100)) {
    console.log(
      `- ${item.key} ${item.sizeBytes}B ${item.modifiedAt} ${item.status}${item.message ? `：${item.message}` : ""}`,
    );
  }
  if (report.items.length > 100)
    console.log(`- 其余 ${report.items.length - 100} 条见 --json 报告`);
  if (report.scan.missingReferencedFiles > 0)
    console.warn("WARN：存在数据库引用但存储缺失的文件，请先排查，不要直接删除其它文件。");
  if (report.scan.invalidReferencedKeys > 0)
    console.warn("WARN：存在非规范 repairs/ 路径的数据库引用，请检查数据。");

  if (report.postCheck) {
    console.log("事后核对：");
    console.log(`  · 已删除：${report.postCheck.deleted}`);
    console.log(`  · 失败：${report.postCheck.failed}`);
    console.log(`  · 剩余候选：${report.postCheck.remainingCandidates}（要求 0）`);
    console.log(`  · 剩余孤儿（含安全窗内）：${report.postCheck.remainingOrphanFiles}`);
    console.log(`结论：${report.postCheck.passed ? "通过" : "未通过，请检查失败/剩余候选"}`);
  }
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries.map(([status, count]) => `${status} ${count}`).join(" / ") : "无";
}

function printUsage(): void {
  console.log(`清理维修照片存储中的孤儿文件（issue #326）

用法：
  pnpm repair:photos:orphans [--json=<报告路径>] [--min-age-hours=24] [--max-delete=500]
  pnpm repair:photos:orphans --apply --backup-manifest=<manifest.txt> \\
    --expect-db=<库名> --json=<结果路径> [--min-age-hours=24] [--max-delete=500]

说明：
  - 只扫描 UPLOAD_PATH/repairs/ 下、不被任何 repair_photos 行引用的文件。
  - 缺省 dry-run；文件修改时间需早于 --min-age-hours（默认 24）才会成为候选。
  - --apply 必须先跑一次定时备份，并提供校验通过的 manifest.txt；备份归档必须包含全部候选。
  - --apply 会逐文件复核引用、大小、修改时间并写 repair.photo.orphan.pruned 审计，必须输出 JSON 结果。
  - 超过 --max-delete（默认 500）直接拒绝执行，防止配置错误导致大批量删除。`);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

main()
  .catch((error: unknown) => {
    console.error("孤儿清理失败：", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
