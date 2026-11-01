import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

export type VerifiedBackup = {
  manifestPath: string;
  directory: string;
  createdAt: string;
  dbTables: number;
  dbInserts: number;
  dbBytes: number;
  uploadsFiles: number;
  uploadsBytes: number;
  dbSha256: string;
  uploadsSha256: string;
};

const execFileAsync = promisify(execFile);

const REQUIRED_FIELDS = [
  "created_at",
  "db_tables",
  "db_inserts",
  "db_bytes",
  "uploads_files",
  "uploads_bytes",
] as const;

/**
 * 校验定时备份 (`tools/backup/backup.sh`) 的 manifest.txt 与两个归档文件。
 *
 * 回填和删除原图都不能拿“看起来有备份”当依据：这里核对文件大小与 SHA256，
 * 并沿用部署脚本的表数底线，避免空库 / 截断备份被当成安全网。
 */
export async function verifyBackupManifest(manifestPath: string): Promise<VerifiedBackup> {
  const absolute = resolve(manifestPath);
  const text = await readFile(absolute, "utf8");
  const fields = parseManifest(text);
  for (const field of REQUIRED_FIELDS) {
    if (!fields.has(field)) throw new Error(`备份清单缺少 ${field}：${absolute}`);
  }

  const createdAt = fields.get("created_at")!;
  if (Number.isNaN(Date.parse(createdAt)))
    throw new Error(`备份清单 created_at 无效：${createdAt}`);

  const dbTables = parseInteger(fields, "db_tables");
  const dbInserts = parseInteger(fields, "db_inserts");
  const dbBytes = parseInteger(fields, "db_bytes");
  const uploadsFiles = parseInteger(fields, "uploads_files");
  const uploadsBytes = parseInteger(fields, "uploads_bytes");
  if (dbTables < 27) throw new Error(`备份只有 ${dbTables} 张表，低于 27，拒绝使用`);
  if (dbInserts <= 0) throw new Error("备份没有任何 INSERT，拒绝使用");
  if (dbBytes <= 0) throw new Error("备份 db_bytes 无效");
  if (uploadsFiles <= 0) throw new Error("备份 uploads_files 为 0，拒绝作为照片删除的备份");
  if (uploadsBytes <= 0) throw new Error("备份 uploads_bytes 无效");

  const dbSha256 = readSha256(fields, "db.sql.gz");
  const uploadsSha256 = readSha256(fields, "uploads.tar.gz");
  for (const [name, digest] of [
    ["db", dbSha256],
    ["uploads", uploadsSha256],
  ] as const) {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`备份清单 ${name} SHA256 格式无效`);
  }

  const directory = dirname(absolute);
  await verifyFile(join(directory, "db.sql.gz"), dbBytes, dbSha256, "db.sql.gz");
  await verifyFile(
    join(directory, "uploads.tar.gz"),
    uploadsBytes,
    uploadsSha256,
    "uploads.tar.gz",
  );

  return {
    manifestPath: absolute,
    directory,
    createdAt,
    dbTables,
    dbInserts,
    dbBytes,
    uploadsFiles,
    uploadsBytes,
    dbSha256,
    uploadsSha256,
  };
}

/**
 * 确认删除前备份的上传归档真的包含待处理原图，而不只是“备份文件本身完整”。
 * 备份脚本把 uploads 目录整体打包，条目形如 `uploads/repairs/...`。
 */
export async function verifyUploadsArchiveContains(
  backup: Pick<VerifiedBackup, "directory">,
  keys: readonly string[],
): Promise<void> {
  if (!keys.length) return;
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      "tar",
      [
        ...(process.platform === "win32" ? ["--force-local"] : []),
        "-tzf",
        join(backup.directory, "uploads.tar.gz"),
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    ));
  } catch (error) {
    throw new Error(
      `无法读取备份 uploads.tar.gz 条目：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const entries = new Set(
    stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((entry) => entry.replace(/^\.\//, "")),
  );
  const missing = keys.filter((key) => !entries.has(`uploads/${key}`));
  if (missing.length)
    throw new Error(`备份 uploads.tar.gz 缺少 ${missing.length} 个待处理原图，拒绝执行`);
}

/**
 * backup.sh 的 manifest 实际写成 `sha256_<备份目录>/db.sql.gz=...`；
 * 早期夹具用 basename 形式。两种都接受，但必须能在清单里找到对应归档。
 */
function readSha256(fields: Map<string, string>, fileName: string): string {
  const direct = fields.get(`sha256_${fileName}`);
  if (direct) return direct;
  for (const [key, value] of fields) {
    if (
      key.startsWith("sha256_") &&
      (key.endsWith(`/${fileName}`) || key.endsWith("\\" + fileName))
    )
      return value;
  }
  throw new Error(`备份清单缺少 ${fileName} SHA256`);
}

function parseManifest(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    fields.set(line.slice(0, index), line.slice(index + 1));
  }
  return fields;
}

function parseInteger(fields: Map<string, string>, name: string): number {
  const raw = fields.get(name)!;
  if (!/^\d+$/.test(raw)) throw new Error(`备份清单 ${name} 不是非负整数`);
  return Number(raw);
}

async function verifyFile(
  path: string,
  expectedBytes: number,
  expectedSha256: string,
  label: string,
): Promise<void> {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw new Error(`备份文件不存在：${label}`);
  if (info.size !== expectedBytes)
    throw new Error(`备份文件大小不符：${label} ${info.size} != ${expectedBytes}`);
  const digest = await sha256File(path);
  if (digest !== expectedSha256)
    throw new Error(`备份文件 SHA256 不符：${label} ${digest.slice(0, 12)}…`);
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}
