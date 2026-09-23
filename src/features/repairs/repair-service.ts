import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { AppError } from "@/lib/api/errors";
import { requirePermission } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { assertCanEditRepair } from "./repair-policy";
import { repairDetailInclude, repairRepository } from "./repair-repository";
import {
  normalizeDraftFields,
  parseRepairDate,
  validateDraftFields,
  validateSubmission,
} from "./repair-validation";
import { toRepairView } from "./repair-view";
import { assertRepairTransition } from "./repair-state";
import type { RepairDraftFields, RepairServiceContract } from "@/types/contracts";

export const repairService: RepairServiceContract = {
  async createDraft(input, actor) {
    requirePermission(actor, "repair:create");
    const member = await repairRepository.activeMemberForUser(actor.userId);
    const key = input.idempotencyKey.trim();
    if (!key || key.length > 128) throw new AppError("VALIDATION_FAILED", "Idempotency-Key 无效");
    const existing = await getDb().repairRecord.findUnique({
      where: { createRequestKey: key },
      include: repairDetailInclude,
    });
    if (existing) {
      if (existing.memberProfileId !== member.id)
        throw new AppError("IDEMPOTENCY_CONFLICT", "幂等键已被使用");
      return toRepairView(existing);
    }
    const fields = normalizeDraftFields(input);
    validateDraftFields(fields);
    const now = new Date();
    const record = await inSerializableTransaction(async (tx) => {
      const created = await tx.repairRecord.create({
        data: {
          id: randomUUID(),
          memberProfileId: member.id,
          status: "DRAFT",
          createRequestKey: key,
          ...dataFields(fields),
          createdAt: now,
        },
        include: repairDetailInclude,
      });
      await timeline(tx, created.id, actor.userId, "CREATED", { status: "DRAFT" }, now);
      return tx.repairRecord.findUniqueOrThrow({
        where: { id: created.id },
        include: repairDetailInclude,
      });
    });
    return toRepairView(record);
  },

  async update(recordId, input, actor) {
    const record = await repairRepository.getById(recordId);
    assertCanEditRepair(actor, record);
    if (record.version !== input.version)
      throw new AppError("REPAIR_VERSION_CONFLICT", "记录已被更新，请刷新后重试");
    const fields = normalizeDraftFields(input);
    validateDraftFields(fields);
    const changes = changedFields(record, fields);
    const updated = await inSerializableTransaction(async (tx) => {
      const result = await tx.repairRecord.updateMany({
        where: { id: recordId, version: input.version, deletedAt: null },
        data: { ...dataFields(fields), version: { increment: 1 } },
      });
      if (result.count !== 1)
        throw new AppError("REPAIR_VERSION_CONFLICT", "记录已被更新，请刷新后重试");
      await timeline(tx, recordId, actor.userId, "UPDATED", { fields: changes }, new Date());
      return tx.repairRecord.findUniqueOrThrow({
        where: { id: recordId },
        include: repairDetailInclude,
      });
    });
    return toRepairView(updated);
  },

  async submit(recordId, input, actor) {
    requirePermission(actor, "repair:submit");
    const record = await repairRepository.getById(recordId);
    const retry = record.timeline.find((event) => {
      if (event.eventType !== "SUBMITTED" && event.eventType !== "RESUBMITTED") return false;
      const summary = event.summary as { idempotencyKey?: unknown } | null;
      return summary?.idempotencyKey === input.idempotencyKey;
    });
    if (record.status === "PENDING" && retry) return toRepairView(record);
    assertCanEditRepair(actor, record);
    if (record.version !== input.version)
      throw new AppError("REPAIR_VERSION_CONFLICT", "记录已被更新，请刷新后重试");
    if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 128)
      throw new AppError("VALIDATION_FAILED", "Idempotency-Key 无效");
    const category = record.categoryId
      ? await getDb().repairCategory.findFirst({
          where: { id: record.categoryId, deletedAt: null },
        })
      : null;
    if (record.categoryId && (!category || !category.isActive))
      throw new AppError("REPAIR_CATEGORY_INACTIVE", "所选分类已停用");
    validateSubmission({ ...record, photoCount: record.photos.length });
    const from = record.status;
    assertRepairTransition(from as "DRAFT" | "REJECTED", "PENDING");
    const now = new Date();
    const updated = await inSerializableTransaction(async (tx) => {
      const result = await tx.repairRecord.updateMany({
        where: { id: recordId, version: input.version, status: from, deletedAt: null },
        data: { status: "PENDING", submittedAt: now, reviewedAt: null, version: { increment: 1 } },
      });
      if (result.count !== 1) throw new AppError("REPAIR_STATE_CONFLICT", "记录状态已变化");
      await timeline(
        tx,
        recordId,
        actor.userId,
        from === "REJECTED" ? "RESUBMITTED" : "SUBMITTED",
        { from, to: "PENDING", idempotencyKey: input.idempotencyKey },
        now,
      );
      return tx.repairRecord.findUniqueOrThrow({
        where: { id: recordId },
        include: repairDetailInclude,
      });
    });
    return toRepairView(updated);
  },

  async softDelete(recordId, reason, actor) {
    requirePermission(actor, "repair:delete");
    const note = reason.trim();
    if (!note || note.length > 2000)
      throw new AppError("VALIDATION_FAILED", "删除原因必填且不能超过 2000 字");
    const record = await repairRepository.getById(recordId);
    const now = new Date();
    await inSerializableTransaction(async (tx) => {
      await tx.repairRecord.update({
        where: { id: recordId },
        data: { deletedAt: now, version: { increment: 1 } },
      });
      await timeline(tx, recordId, actor.userId, "DELETED", { reason: note }, now);
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair.deleted",
        targetType: "RepairRecord",
        targetId: recordId,
        result: "SUCCESS",
        before: { status: record.status },
        after: { deleted: true, reason: note },
      });
    });
  },
};

/** 草稿字段 → 数据库列。管理端编辑（`repair-admin-service`）复用同一映射与 diff 计算。 */
export function dataFields(input: RepairDraftFields) {
  return {
    repairDate: parseRepairDate(input.repairDate),
    durationMinutes: input.durationMinutes,
    categoryId: input.categoryId,
    content: input.content,
    result: input.result,
    remark: input.remark,
  };
}
export function changedFields(
  record: Record<string, unknown>,
  input: Record<string, unknown>,
): string[] {
  return Object.keys(input).filter(
    (key) => input[key] !== undefined && String(record[key] ?? "") !== String(input[key] ?? ""),
  );
}
export async function timeline(
  tx: Prisma.TransactionClient,
  repairRecordId: string,
  actorUserId: string | undefined,
  eventType: string,
  summary: Prisma.InputJsonValue,
  createdAt: Date,
) {
  await tx.repairTimelineEvent.create({
    data: { id: randomUUID(), repairRecordId, actorUserId, eventType, summary, createdAt },
  });
}
