import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  parseBackfillManifest,
  type BackfillManifest,
} from "../src/features/repairs/repair-photo-backfill";
import {
  pruneBackfilledOriginals,
  type PruneReport,
} from "../src/features/repairs/repair-photo-backfill-service";
import { verifyBackupManifest } from "../src/features/repairs/repair-photo-backup";
import { disconnectDb } from "../src/lib/db/client";

/**
 * 维修照片 P1b：删除回填后的旧原图。
 *
 * 用法：
 *   pnpm repair:photos:prune-originals --manifest=<回填清单>
 *   pnpm repair:photos:prune-originals --manifest=<回填清单> --apply \
 *     --backup-manifest=<manifest.txt> --expect-db=<库名> [--json=<报告路径>]
 *
 * - 只处理回填清单中成功更新的照片；清单外文件、备份目录一律不碰；
 * - 删除前逐张复核：当前行仍指向清单中的变体、变体文件摘要一致、原图摘要一致、
 *   且没有任何 repair_photos 行再引用原图键；
 * - 缺省 dry-run 只列出可删除项；apply 仍需一份校验通过的定时备份清单。
 */

type CliOptions = {
  apply: boolean;
  manifestPaths: string[];
  backupManifest: string | null;
  expectDb: string | null;
  jsonPath: string | null;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.apply) assertExpectedDatabase(options.expectDb!);
  const manifest = mergeManifests(
    await Promise.all(
      options.manifestPaths.map(async (path) =>
        parseBackfillManifest(await readFile(path, "utf8")),
      ),
    ),
  );
  const backup = options.apply ? await verifyBackupManifest(options.backupManifest!) : undefined;
  if (backup) {
    console.log(`备份清单：${backup.manifestPath}`);
    console.log(
      `备份时间：${backup.createdAt}；数据库 ${backup.dbTables} 表 / ${backup.dbInserts} INSERT / ${backup.dbBytes}B；上传文件 ${backup.uploadsFiles} 个 / ${backup.uploadsBytes}B`,
    );
  }

  const report = await pruneBackfilledOriginals({
    manifest,
    apply: options.apply,
    backup,
    onProgress: (item) => {
      console.log(
        `- ${item.photoId} [${item.deletedAt ? "已软删除" : "有效"}] ${item.status} ${item.originalKey}${item.message ? `：${item.message}` : ""}`,
      );
    },
  });
  printReport(report);
  if (options.jsonPath)
    await writeJson(options.jsonPath, {
      kind: options.apply ? "repair-photo-prune-result" : "repair-photo-prune-report",
      exportedAt: new Date().toISOString(),
      report,
    });

  if (!options.apply) {
    console.log("\ndry-run 完成，未删除任何文件。确认原图列表后再加 --apply 执行。");
    if (!report.postCheck.passed) process.exitCode = 1;
  } else {
    console.log(
      "\n原图已删除；display/thumbnail 保留。请保留备份到观察期结束，并抽样验证照片内容接口不再 404。",
    );
    if (!report.postCheck.passed) process.exitCode = 1;
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    manifestPaths: [],
    backupManifest: null,
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
    const manifest = readArgValue(arg, "--manifest");
    if (manifest !== null) {
      options.manifestPaths.push(manifest);
      continue;
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
    throw new Error(`未知参数：${arg}（--help 查看用法）`);
  }
  if (!options.manifestPaths.length) throw new Error("必须提供 --manifest=<回填清单>");
  if (options.apply && !options.backupManifest)
    throw new Error("--apply 必须同时提供 --backup-manifest=<manifest.txt>");
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

function mergeManifests(manifests: BackfillManifest[]): BackfillManifest {
  const photos = new Map<string, BackfillManifest["photos"][number]>();
  for (const manifest of manifests) {
    for (const photo of manifest.photos) {
      const existing = photos.get(photo.photoId);
      if (existing && existing.originalKey !== photo.originalKey)
        throw new Error(`同一照片出现在多份清单但原图键不同：${photo.photoId}`);
      photos.set(photo.photoId, photo);
    }
  }
  return {
    ...manifests[0]!,
    runId: manifests.map((manifest) => manifest.runId).join(","),
    photos: [...photos.values()],
  };
}

function printReport(report: PruneReport): void {
  console.log(`\n数据库：${report.database}`);
  console.log(`模式：${report.apply ? "apply（删除文件）" : "dry-run（未删除）"}`);
  console.log(`回填清单：${report.manifestRunId}`);
  console.log(`候选：${report.candidates}；结果：${formatCounts(report.byStatus)}`);
  console.log("事后核对：");
  console.log(`  · 清单原图残留：${report.postCheck.remainingOriginalFiles}（要求 0）`);
  console.log(
    `  · 变体文件：${report.postCheck.remainingVariantFiles}/${report.items.length * 2}（要求全在）`,
  );
  console.log(`  · 未引用文件：${report.postCheck.unreferencedFiles}（信息项）`);
  console.log(`结论：${report.postCheck.passed ? "通过" : "未通过，请检查跳过/失败项"}`);
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries.map(([status, count]) => `${status} ${count}`).join(" / ") : "无";
}

function printUsage(): void {
  console.log(`删除维修照片回填后的旧原图（issue #323）

用法：
  pnpm repair:photos:prune-originals --manifest=<回填清单> [--manifest=<另一份>] [--json=<报告路径>]
  pnpm repair:photos:prune-originals --manifest=<回填清单> --apply \\
    --backup-manifest=<manifest.txt> --expect-db=<库名> [--json=<报告路径>]

说明：
  - 只删除回填清单中成功更新的原图；清单外文件与备份目录不会触碰。
  - 多轮回填产生多份清单时重复 --manifest，按 photoId 去重。
  - 删除前复核数据库引用、变体摘要、原图大小与 SHA256。
  - 缺省 dry-run；--apply 需要校验通过的定时备份清单与目标库确认。`);
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
    console.error("原图删除失败：", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
