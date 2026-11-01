import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/api/errors";

export type PhotoWriteInput = { bytes: Uint8Array; mimeType: string };
export type StoredPhoto = { storageKey: string };
export interface RepairPhotoStorage {
  put(input: PhotoWriteInput): Promise<StoredPhoto>;
  open(storageKey: string): Promise<Uint8Array>;
  delete(storageKey: string): Promise<void>;
}

export function uploadLimits() {
  return {
    maxBytes: positiveInt("UPLOAD_MAX_BYTES", 10 * 1024 * 1024),
    maxFiles: positiveInt("UPLOAD_MAX_FILES_PER_REPAIR", 9),
  };
}

export function uploadRoot(): string {
  const root = resolve(process.env.UPLOAD_PATH ?? "./storage/uploads");
  const workspace = resolve(process.cwd());
  const publicDir = resolve(workspace, "public");
  if (root === workspace || root === publicDir || isWithin(publicDir, root))
    throw new AppError("INTERNAL_ERROR", "UPLOAD_PATH 配置不安全");
  return root;
}

export const localRepairPhotoStorage: RepairPhotoStorage = {
  async put(input) {
    const id = randomUUID();
    const extension = extensionFor(input.mimeType);
    const storageKey = `repairs/${id.slice(0, 2)}/${id}${extension}`;
    const target = safePath(storageKey);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, input.bytes, { flag: "wx" });
    return { storageKey };
  },
  async open(storageKey) {
    return readFile(safePath(storageKey));
  },
  async delete(storageKey) {
    try {
      await unlink(safePath(storageKey));
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
        throw error;
    }
  },
};

/** 列出 `repairs/` 下所有普通文件键；不跟随符号链接，目录不存在时返回空。 */
export async function listStoredRepairFiles(): Promise<string[]> {
  const files: string[] = [];
  await walk(join(uploadRoot(), "repairs"), "");
  return files;

  async function walk(dir: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(dir, entry.name), relativePath);
      else if (entry.isFile()) files.push(`repairs/${relativePath}`);
    }
  }
}

/** 维修照片键必须是规范的 `repairs/...` 相对路径，拒绝 `.` / `..` 与空段。 */
export function isRepairStorageKey(storageKey: string): boolean {
  if (
    !storageKey ||
    storageKey.includes("\\") ||
    storageKey.startsWith("/") ||
    isAbsolute(storageKey)
  )
    return false;
  if (storageKey !== posix.normalize(storageKey)) return false;
  const segments = storageKey.split("/");
  return (
    segments.length >= 2 &&
    segments[0] === "repairs" &&
    segments.every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

export function assertRepairStorageKey(storageKey: string): string {
  if (!isRepairStorageKey(storageKey))
    throw new AppError("REPAIR_PHOTO_STORAGE_FAILED", "照片存储路径无效");
  return storageKey;
}

function safePath(storageKey: string): string {
  const root = uploadRoot();
  const target = resolve(root, assertRepairStorageKey(storageKey));
  if (!isWithin(resolve(root, "repairs"), target))
    throw new AppError("REPAIR_PHOTO_STORAGE_FAILED", "照片存储路径无效");
  return target;
}
function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}
function positiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new AppError("INTERNAL_ERROR", `${name} 必须是正整数`);
  return value;
}
function extensionFor(mimeType: string): string {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return extname(mimeType) || ".bin";
}
