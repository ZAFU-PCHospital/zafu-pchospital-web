import { createHash, randomUUID } from "node:crypto";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { AppError } from "@/lib/api/errors";
import { formatBytes } from "@/config/repairs";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { assertCanAttachRepairPhotos, assertCanReadRepair } from "./repair-policy";
import { repairRepository } from "./repair-repository";
import { timeline } from "./repair-service";
import {
  localRepairPhotoStorage,
  type RepairPhotoStorage,
  uploadLimits,
} from "./repair-photo-storage";
import { withRepairPhotoImageSlot } from "./repair-photo-admission";
import { processRepairPhoto } from "./repair-photo-image";
import type { AuthorizedActor, RepairPhotoView } from "@/types/contracts";

export function createRepairPhotoService(storage: RepairPhotoStorage) {
  return {
    async upload(
      recordId: string,
      files: File[],
      actor: AuthorizedActor,
      uploadKey?: string,
    ): Promise<RepairPhotoView[]> {
      const record = await repairRepository.getById(recordId);
      assertCanAttachRepairPhotos(actor, record);
      const limits = uploadLimits();
      if (!files.length) throw new AppError("VALIDATION_FAILED", "请选择照片");
      const baseKey = uploadKey?.trim() ?? "";
      if (baseKey.length > 128) throw new AppError("VALIDATION_FAILED", "Idempotency-Key 无效");
      // 单次请求本身不能超过总上限；实际新增数量在锁后按幂等键去重再核对。
      if (files.length > limits.maxFiles)
        throw new AppError(
          "REPAIR_PHOTO_LIMIT_EXCEEDED",
          `每条记录最多上传 ${limits.maxFiles} 张照片`,
        );
      // 快照预检：真正的新增照片超限时，在读取文件和落盘前就拒绝；
      // 已经存在的幂等键（响应丢失后的重试）不占新名额，必须放行。
      const existingKeys = new Set(
        record.photos.map((photo) => photo.uploadKey).filter((key): key is string => Boolean(key)),
      );
      // 单文件请求沿用原键（客户端逐张上传）；只有批量请求才按序号派生。
      const derivedKeys = baseKey
        ? files.length === 1
          ? [baseKey]
          : files.map((_, index) => `${baseKey}:${index}`)
        : [];
      const newFileCount =
        derivedKeys.length === 0
          ? files.length
          : derivedKeys.filter((key) => !existingKeys.has(key)).length;
      if (record.photos.length + newFileCount > limits.maxFiles)
        throw new AppError(
          "REPAIR_PHOTO_LIMIT_EXCEEDED",
          `每条记录最多上传 ${limits.maxFiles} 张照片`,
        );
      type StoredPhoto = {
        storageKey: string;
        thumbnailKey: string;
        originalName: string | null;
        mimeType: "image/webp";
        sizeBytes: number;
        sha256Digest: Buffer;
        width: number;
        height: number;
        uploadKey: string | null;
      };
      const stored: StoredPhoto[] = [];
      try {
        // 逐张读取、解码、落盘：最多 9 张时也不并发占用多张大图的内存。
        for (const [index, file] of files.entries()) {
          if (file.size > limits.maxBytes)
            throw new AppError(
              "REPAIR_PHOTO_TOO_LARGE",
              `「${file.name}」${formatBytes(file.size)}，超过单张 ${formatBytes(limits.maxBytes)} 的上限`,
            );
          const processed = await withRepairPhotoImageSlot(async () => {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const detected = detectImageType(bytes);
            if (!detected || detected !== file.type)
              throw new AppError(
                "REPAIR_PHOTO_TYPE_UNSUPPORTED",
                "仅支持真实的 JPEG、PNG 或 WebP 图片",
              );
            return processRepairPhoto(bytes);
          });
          const display = await storage.put({
            bytes: processed.display.bytes,
            mimeType: "image/webp",
          });
          let thumbnail: { storageKey: string };
          try {
            thumbnail = await storage.put({
              bytes: processed.thumbnail.bytes,
              mimeType: "image/webp",
            });
          } catch (error) {
            await storage.delete(display.storageKey);
            throw error;
          }
          stored.push({
            storageKey: display.storageKey,
            thumbnailKey: thumbnail.storageKey,
            originalName: file.name.slice(0, 255) || null,
            mimeType: "image/webp",
            sizeBytes: processed.display.bytes.byteLength,
            sha256Digest: processed.display.digest,
            width: processed.display.width,
            height: processed.display.height,
            // 与上面的预检使用同一套派生规则：单文件原键，批量 `<key>:<index>`。
            uploadKey: derivedKeys[index] ?? null,
          });
        }
        const now = new Date();
        /** 与已有照片同摘要的暂存文件在事务成功后删除；事务失败由外层统一清理。 */
        const duplicateKeys: string[] = [];
        const created = await inSerializableTransaction(async (tx) => {
          // 审核与补附件可能并发：锁记录行后复核状态和实际照片数，避免审核通过后照片才落库。
          const locked = await lockRecordForPhotoMutation(tx, recordId);
          assertCanAttachRepairPhotos(actor, locked);
          type LockedPhoto = (typeof locked.photos)[number];
          const byKey = new Map<string, LockedPhoto>();
          for (const photo of locked.photos) if (photo.uploadKey) byKey.set(photo.uploadKey, photo);

          // 幂等键命中视为同一次上传（响应丢失后的重试）：不新建行、不占名额、
          // 不重复写时间线。没有键的请求保持旧语义，每次都是新照片。
          const newCount = stored.filter(
            (entry) => !entry.uploadKey || !byKey.has(entry.uploadKey),
          ).length;
          if (locked.photos.length + newCount > limits.maxFiles)
            throw new AppError(
              "REPAIR_PHOTO_LIMIT_EXCEEDED",
              `每条记录最多上传 ${limits.maxFiles} 张照片`,
            );

          // 先收敛历史空洞 / 重复序号，再把新照片接在有效照片末尾。
          await normalizePhotoSortOrders(tx, locked.photos);
          const rows: LockedPhoto[] = [];
          const createdRows: LockedPhoto[] = [];
          let newIndex = 0;
          for (const entry of stored) {
            const existing = entry.uploadKey ? byKey.get(entry.uploadKey) : undefined;
            if (existing) {
              rows.push(existing);
              duplicateKeys.push(entry.storageKey, entry.thumbnailKey);
              continue;
            }
            const row = await tx.repairPhoto.create({
              data: {
                id: randomUUID(),
                repairRecordId: recordId,
                storageKey: entry.storageKey,
                thumbnailKey: entry.thumbnailKey,
                originalName: entry.originalName,
                mimeType: entry.mimeType,
                sizeBytes: entry.sizeBytes,
                sha256Digest: new Uint8Array(entry.sha256Digest),
                width: entry.width,
                height: entry.height,
                uploadKey: entry.uploadKey,
                sortOrder: locked.photos.length + newIndex,
                uploadedByUserId: actor.userId!,
                createdAt: now,
              },
            });
            newIndex += 1;
            if (entry.uploadKey) byKey.set(entry.uploadKey, row);
            rows.push(row);
            createdRows.push(row);
          }
          if (createdRows.length > 0)
            await timeline(
              tx,
              recordId,
              actor.userId,
              "PHOTO_ADDED",
              { count: createdRows.length, photoIds: createdRows.map((row) => row.id) },
              now,
            );
          return rows;
        });
        if (duplicateKeys.length)
          await Promise.allSettled(duplicateKeys.map((key) => storage.delete(key)));
        return created.map(view);
      } catch (error) {
        await Promise.allSettled(
          stored.flatMap((entry) => [
            storage.delete(entry.storageKey),
            storage.delete(entry.thumbnailKey),
          ]),
        );
        if (error instanceof AppError) throw error;
        throw new AppError("REPAIR_PHOTO_STORAGE_FAILED", "照片保存失败", { cause: error });
      }
    },

    async remove(recordId: string, photoId: string, actor: AuthorizedActor): Promise<void> {
      const record = await repairRepository.getById(recordId);
      assertCanAttachRepairPhotos(actor, record);
      const photo = record.photos.find((item) => item.id === photoId);
      if (!photo) throw new AppError("REPAIR_NOT_FOUND", "照片不存在");
      await inSerializableTransaction(async (tx) => {
        const locked = await lockRecordForPhotoMutation(tx, recordId);
        assertCanAttachRepairPhotos(actor, locked);
        if (!locked.photos.some((item) => item.id === photoId))
          throw new AppError("REPAIR_NOT_FOUND", "照片不存在");
        const now = new Date();
        await tx.repairPhoto.update({
          where: { id: photoId },
          // 释放幂等键：删除后同一键的重试应当能重新落一张，而不是撞唯一索引。
          data: { deletedAt: now, uploadKey: null },
        });
        // 删除后收敛剩余照片，避免补传沿用已释放的序号。
        await normalizePhotoSortOrders(
          tx,
          locked.photos.filter((item) => item.id !== photoId),
        );
        await timeline(tx, recordId, actor.userId, "PHOTO_REMOVED", { photoId }, now);
      });
    },

    async reorder(
      recordId: string,
      photoId: string,
      sortOrder: number,
      actor: AuthorizedActor,
    ): Promise<RepairPhotoView> {
      if (!Number.isInteger(sortOrder) || sortOrder < 0)
        throw new AppError("VALIDATION_FAILED", "照片顺序无效");
      const record = await repairRepository.getById(recordId);
      assertCanAttachRepairPhotos(actor, record);
      const current = record.photos.find((item) => item.id === photoId);
      if (!current) throw new AppError("REPAIR_NOT_FOUND", "照片不存在");
      const target = record.photos[sortOrder];
      if (!target) throw new AppError("VALIDATION_FAILED", "照片顺序无效");
      const updated = await inSerializableTransaction(async (tx) => {
        const locked = await lockRecordForPhotoMutation(tx, recordId);
        assertCanAttachRepairPhotos(actor, locked);
        const from = locked.photos.findIndex((item) => item.id === photoId);
        if (from < 0 || !locked.photos[sortOrder])
          throw new AppError("VALIDATION_FAILED", "照片顺序无效");
        // 按数组位置移动后整体重排 0..n-1：既执行换位，也收敛历史空洞 / 重复序号。
        const photos = [...locked.photos];
        if (from !== sortOrder) {
          const [moved] = photos.splice(from, 1);
          photos.splice(sortOrder, 0, moved!);
        }
        await normalizePhotoSortOrders(tx, photos);
        const photo = await tx.repairPhoto.findUniqueOrThrow({ where: { id: photoId } });
        await timeline(
          tx,
          recordId,
          actor.userId,
          "UPDATED",
          { fields: ["photos.sortOrder"], photoId, sortOrder },
          new Date(),
        );
        return photo;
      });
      return view(updated);
    },

    async open(photoId: string, actor: AuthorizedActor, variant: "display" | "thumb" = "display") {
      const photo = await getDb().repairPhoto.findFirst({
        where: { id: photoId, deletedAt: null },
        include: { record: { include: { memberProfile: true } } },
      });
      if (!photo || photo.record.deletedAt) throw new AppError("REPAIR_NOT_FOUND", "照片不存在");
      assertCanReadRepair(actor, photo.record);
      // 历史照片没有 thumbnailKey；新照片缩略图缺失也回退到展示图，避免 404。
      const candidates =
        variant === "thumb"
          ? [photo.thumbnailKey, photo.storageKey].filter((key): key is string => Boolean(key))
          : [photo.storageKey];
      let lastError: unknown;
      for (const key of candidates) {
        try {
          const bytes = await storage.open(key);
          if (key === photo.storageKey && bytes.byteLength !== photo.sizeBytes)
            throw new Error("stored photo size mismatch");
          return {
            photo,
            bytes,
            mimeType: key === photo.storageKey ? photo.mimeType : "image/webp",
            etag: `"${createHash("sha256")
              .update(`${Buffer.from(photo.sha256Digest).toString("hex")}:${variant}:${key}`)
              .digest("hex")}"`,
          };
        } catch (error) {
          lastError = error;
        }
      }
      await inSerializableTransaction((tx) =>
        appendAuditLog(tx, {
          actor,
          actorType: "USER",
          actorUserId: actor.userId,
          action: "repair.photo.storage_failed",
          targetType: "RepairPhoto",
          targetId: photo.id,
          result: "FAILURE",
          errorCode: "REPAIR_PHOTO_STORAGE_FAILED",
        }),
      );
      throw new AppError("REPAIR_PHOTO_STORAGE_FAILED", "照片暂时不可读取", {
        cause: lastError,
      });
    },
  };
}

export const repairPhotoService = createRepairPhotoService(localRepairPhotoStorage);

/**
 * 有效照片的顺序不变量：始终为 0..n-1 的连续序号。
 *
 * 只在新上传 / 删除 / 换序后调用（同一记录行锁内），不改读路径；
 * 历史数据里的空洞或重复序号会在下一次写操作后自然收敛。
 */
async function normalizePhotoSortOrders(
  tx: Prisma.TransactionClient,
  photos: ReadonlyArray<{ id: string; sortOrder: number }>,
): Promise<void> {
  for (const [index, photo] of photos.entries()) {
    if (photo.sortOrder === index) continue;
    await tx.repairPhoto.update({ where: { id: photo.id }, data: { sortOrder: index } });
  }
}

/**
 * 锁定维修记录并按真实状态复核照片权限。
 *
 * 审核服务更新同一行状态；这里先 `FOR UPDATE` 再读，保证「审核已通过」不会被并发补传绕过。
 */
async function lockRecordForPhotoMutation(tx: Prisma.TransactionClient, recordId: string) {
  await tx.$queryRaw`SELECT id FROM repair_records WHERE id = ${recordId} FOR UPDATE`;
  const record = await tx.repairRecord.findFirst({
    where: { id: recordId, deletedAt: null },
    include: {
      memberProfile: true,
      photos: {
        where: { deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!record) throw new AppError("REPAIR_NOT_FOUND", "维修记录不存在");
  return record;
}

export function detectImageType(
  bytes: Uint8Array,
): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes
      .slice(0, 8)
      .every((value, index) => value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index])
  )
    return "image/png";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}
function view(photo: {
  id: string;
  originalName: string | null;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  sortOrder: number;
  createdAt: Date;
}): RepairPhotoView {
  return {
    id: photo.id,
    contentUrl: `/api/v1/repair-photos/${photo.id}/content`,
    thumbnailUrl: `/api/v1/repair-photos/${photo.id}/content?variant=thumb`,
    originalName: photo.originalName,
    mimeType: photo.mimeType,
    sizeBytes: photo.sizeBytes,
    width: photo.width,
    height: photo.height,
    sortOrder: photo.sortOrder,
    createdAt: photo.createdAt.toISOString(),
  };
}
