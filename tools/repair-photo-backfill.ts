import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  backfillRepairPhotos,
  type BackfillReport,
} from "../src/features/repairs/repair-photo-backfill-service";
import { verifyBackupManifest } from "../src/features/repairs/repair-photo-backup";
import { disconnectDb } from "../src/lib/db/client";

/**
 * 维修照片 P1b：存量回填。
 *
 * 用法：
 *   pnpm repair:photos:backfill [--json=<报告路径>]
 *   pnpm repair:photos:backfill --apply --backup-manifest=<manifest.txt> \
 *     --manifest-out=<结果清单路径> --expect-db=<库名> [--json=<报告路径>]
 *
 * - 缺省 dry-run：读取原图、核对大小/摘要并实际解码，不写文件或数据库；
 * - apply 前必须提供 `tools/backup/backup.sh` 生成的 manifest.txt，且归档大小/SHA256
 *   必须校验通过；结果清单供删除原图工具使用；
 * - 每张照片先写 display/thumb，再以 `thumbnail_key IS NULL` 条件更新；失败/并发跳过时
 *   清理刚写的变体，原图保留；
 * - 幂等：已回填的照片不会再被选中；重跑只处理剩余项。
 */

type CliOptions = {
  apply: boolean;
  backupManifest: string | null;
  manifestOut: string | null;
  expectDb: string | null;
  jsonPath: string | null;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.apply) assertExpectedDatabase(options.expectDb!);
  const backup = options.apply ? await verifyBackupManifest(options.backupManifest!) : undefined;
  if (backup) {
    console.log(`备份清单：${backup.manifestPath}`);
    console.log(
      `备份时间：${backup.createdAt}；数据库 ${backup.dbTables} 表 / ${backup.dbInserts} INSERT / ${backup.dbBytes}B；上传文件 ${backup.uploadsFiles} 个 / ${backup.uploadsBytes}B`,
    );
  }

  const result = await backfillRepairPhotos({
    apply: options.apply,
    backup,
    onProgress: (item) => {
      const detail =
        item.status === "ready" || item.status === "updated"
          ? ` ${item.display?.width}×${item.display?.height} / ${item.display?.sizeBytes}B，thumb ${item.thumbnail?.sizeBytes}B`
          : item.message
            ? `：${item.message}`
            : "";
      console.log(
        `- ${item.photoId} [${item.deletedAt ? "已软删除" : "有效"}] ${item.status}${detail}`,
      );
    },
  });
  printReport(result.report);

  const publicResult = {
    kind: options.apply ? "repair-photo-backfill-result" : "repair-photo-backfill-report",
    exportedAt: new Date().toISOString(),
    report: result.report,
  };
  if (options.jsonPath) await writeJson(options.jsonPath, publicResult);
  if (options.apply) {
    if (!result.manifest) throw new Error("apply 未生成回填清单，拒绝继续");
    await writeJson(options.manifestOut!, result.manifest);
    console.log(`\n回填清单：${resolve(options.manifestOut!)}`);
    console.log(
      "下一步：先对清单做 prune dry-run；确认原图列表后再执行删除。观察期内不要删除备份。",
    );
    if (result.report.byStatus.updated !== result.report.legacyPhotos) process.exitCode = 1;
    if (result.report.postCheck && !result.report.postCheck.passed) process.exitCode = 1;
  } else {
    const notReady = result.report.items.filter((item) => item.status !== "ready").length;
    if (notReady) process.exitCode = 1;
    console.log("\ndry-run 完成，未写文件或数据库。确认报告后再加 --apply 执行。");
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    backupManifest: null,
    manifestOut: null,
    expectDb: null,
    jsonPath: null,
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
    const manifestOut = readArgValue(arg, "--manifest-out");
    if (manifestOut !== null) {
      options.manifestOut = manifestOut;
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
    throw new Error(`未知参数：${arg}（--help 查看用法）`);
  }
  if (options.apply && !options.backupManifest)
    throw new Error("--apply 必须同时提供 --backup-manifest=<manifest.txt>");
  if (options.apply && !options.manifestOut)
    throw new Error("--apply 必须同时提供 --manifest-out=<结果清单路径>");
  if (options.apply && !options.expectDb)
    throw new Error("--apply 必须用 --expect-db=<库名> 确认目标数据库");
  return options;
}

function readArgValue(arg: string, name: string): string | null {
  const prefix = `${name}=`;
  if (!arg.startsWith(prefix)) return null;
  const value = arg.slice(prefix.length).trim();
  if (!value) throw new Error(`${name} 不能为空`);
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

function printReport(report: BackfillReport): void {
  console.log(`\n数据库：${report.database}`);
  console.log(`模式：${report.apply ? "apply（写库）" : "dry-run（未写库）"}`);
  console.log(
    `照片总数：${report.totalPhotos}；待回填：${report.legacyPhotos}；原图合计 ${report.totalBytes}B`,
  );
  console.log(`结果：${formatCounts(report.byStatus)}`);
  if (report.postCheck) {
    const check = report.postCheck;
    console.log("事后核对：");
    console.log(`  · 剩余待回填：${check.remainingLegacy}（要求 0）`);
    console.log(`  · 变体文件缺失/摘要不符：${check.missingVariantFiles}（要求 0）`);
    console.log(`  · 数据库行与清单不一致：${check.mismatchedRows}（要求 0）`);
    console.log(
      `  · 原图文件：${check.expectedOriginalFiles} 个仍保留，等待单独删除；未引用文件总数 ${check.unreferencedFiles}（其中清单外 ${check.unexpectedUnreferencedFiles}）`,
    );
    console.log(`结论：${check.passed ? "通过" : "未通过，请检查失败项后重跑"}`);
  }
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries.map(([status, count]) => `${status} ${count}`).join(" / ") : "无";
}

function printUsage(): void {
  console.log(`维修照片存量回填（issue #323）

用法：
  pnpm repair:photos:backfill [--json=<报告路径>]
  pnpm repair:photos:backfill --apply --backup-manifest=<manifest.txt> \\
    --manifest-out=<结果清单路径> --expect-db=<库名> [--json=<报告路径>]

说明：
  - 缺省 dry-run，只读取 / 校验 / 解码，不写文件或数据库。
  - --backup-manifest 指向 tools/backup/backup.sh 生成的 manifest.txt；
    其 db.sql.gz / uploads.tar.gz 的大小与 SHA256 必须和清单一致。
  - --expect-db 可写库名或完整 host:port/库名。
  - apply 后软删除照片同样回填；原图保留到修复后的原图删除步骤。`);
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
    console.error("照片回填失败：", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
