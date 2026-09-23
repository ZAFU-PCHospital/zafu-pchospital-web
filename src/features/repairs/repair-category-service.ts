import { randomUUID } from "node:crypto";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { AppError } from "@/lib/api/errors";
import { requirePermission } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { nextSortOrder, movedIds, reorderedIds } from "@/features/admin/reorder";
import { stableCodeFromName } from "@/lib/stable-code";
import type {
  AuthorizedActor,
  CreateRepairCategoryInput,
  RepairCategoryAdminView,
  RepairCategoryView,
  ReorderDirection,
  UpdateRepairCategoryInput,
} from "@/types/contracts";

export const repairCategoryService = {
  /** 公开/成员侧列表：只给启用中的分类（维修表单下拉用）。 */
  async list(): Promise<RepairCategoryView[]> {
    const rows = await getDb().repairCategory.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    });
    return rows.map(view);
  },
  /**
   * 管理端列表：含已停用分类，并带引用计数。
   *
   * 需求 §65 明确「已被维修记录使用过的分类不建议物理删除」，所以管理界面必须能同时看到
   * 停用分类与它被用了多少次 —— 只看启用中的列表无法回答这个问题。
   */
  async listAll(actor: AuthorizedActor): Promise<RepairCategoryAdminView[]> {
    requirePermission(actor, "repair:category:manage");
    const rows = await getDb().repairCategory.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    });
    const usage = await getDb().repairRecord.groupBy({
      by: ["categoryId"],
      where: { deletedAt: null, categoryId: { not: null } },
      _count: { _all: true },
    });
    const counts = new Map(usage.map((row) => [row.categoryId, row._count._all]));
    return rows.map((row) => ({
      ...view(row),
      usedByRepairCount: counts.get(row.id) ?? 0,
      createdAt: row.createdAt.toISOString(),
    }));
  },
  async create(input: CreateRepairCategoryInput, actor: AuthorizedActor) {
    requirePermission(actor, "repair:category:manage");
    const name = input.name.trim();
    if (!name || name.length > 80) throw new AppError("VALIDATION_FAILED", "分类名称无效");
    // `code` 现在由系统按名称生成（仍接受显式传入，供脚本与迁移使用）。
    const code = (input.code?.trim() || stableCodeFromName(name, "CAT")).toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(code)) {
      throw new AppError("VALIDATION_FAILED", "分类标识无效");
    }
    // 先查重给出稳定错误码：否则唯一键冲突会以 Prisma 错误冒泡成 500 INTERNAL_ERROR，
    // 管理界面拿不到可操作的信息。冲突按**名称**优先判 —— 管理员填的是名称。
    const duplicate = await getDb().repairCategory.findFirst({
      where: { deletedAt: null, OR: [{ name }, { code }] },
    });
    if (duplicate) {
      throw new AppError(
        "REPAIR_CATEGORY_CODE_CONFLICT",
        duplicate.name === name ? "该分类名称已存在" : "该分类标识已被占用",
      );
    }
    const row = await inSerializableTransaction(async (tx) => {
      const created = await tx.repairCategory.create({
        data: {
          id: randomUUID(),
          code,
          name,
          description: input.description?.trim() || null,
          // 不给序号就排到末尾；顺序由列表里的「上移 / 下移」调整。
          sortOrder: input.sortOrder ?? (await nextSortOrder(tx, "repair_categories")),
          createdBy: actor.userId,
          createdAt: new Date(),
        },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair.category.created",
        targetType: "RepairCategory",
        targetId: created.id,
        result: "SUCCESS",
        after: { code, name },
      });
      return created;
    });
    return view(row);
  },
  async update(id: string, input: UpdateRepairCategoryInput, actor: AuthorizedActor) {
    requirePermission(actor, "repair:category:manage");
    const before = await getDb().repairCategory.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new AppError("RESOURCE_NOT_FOUND", "分类不存在");
    if (input.name !== undefined && (!input.name.trim() || input.name.trim().length > 80))
      throw new AppError("VALIDATION_FAILED", "分类名称无效");
    const row = await inSerializableTransaction(async (tx) => {
      const updated = await tx.repairCategory.update({
        where: { id },
        data: {
          name: input.name?.trim(),
          description:
            input.description === undefined ? undefined : input.description?.trim() || null,
          sortOrder: input.sortOrder,
        },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair.category.updated",
        targetType: "RepairCategory",
        targetId: id,
        result: "SUCCESS",
        before,
        after: updated,
      });
      return updated;
    });
    return view(row);
  },
  async deactivate(id: string, actor: AuthorizedActor) {
    requirePermission(actor, "repair:category:manage");
    return setActive(id, false, actor);
  },
  /** M6 新增：误停用后要能恢复，否则只能新建一个同名分类，历史记录会被劈成两份。 */
  async activate(id: string, actor: AuthorizedActor) {
    requirePermission(actor, "repair:category:manage");
    return setActive(id, true, actor);
  },
  /** 上移 / 下移一格（与技能标签同一实现，见 `features/admin/reorder.ts`）。 */
  async reorder(id: string, direction: ReorderDirection, actor: AuthorizedActor): Promise<void> {
    requirePermission(actor, "repair:category:manage");
    await inSerializableTransaction(async (tx) => {
      const rows = await tx.repairCategory.findMany({
        where: { deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
        select: { id: true },
      });
      const order = reorderedIds(
        rows.map((row) => row.id),
        id,
        direction,
        "RESOURCE_NOT_FOUND",
        "分类不存在",
      );
      if (!order) return; // 已在边界：幂等成功，不写审计
      for (const [position, rowId] of order.entries()) {
        await tx.repairCategory.update({ where: { id: rowId }, data: { sortOrder: position } });
      }
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair.category.reordered",
        targetType: "RepairCategory",
        targetId: id,
        result: "SUCCESS",
        after: { direction },
      });
    });
  },
  /**
   * 拖动排序：把 `id` 放到 `beforeId` 之前（`null` = 末尾）。
   * 与技能标签同一实现、同一语义，见 `features/skills/skill-admin-service.ts` 的 `move`。
   */
  async move(id: string, beforeId: string | null, actor: AuthorizedActor): Promise<void> {
    requirePermission(actor, "repair:category:manage");
    await inSerializableTransaction(async (tx) => {
      const rows = await tx.repairCategory.findMany({
        where: { deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
        select: { id: true },
      });
      const order = movedIds(
        rows.map((row) => row.id),
        id,
        beforeId,
        "RESOURCE_NOT_FOUND",
        "分类不存在",
      );
      if (!order) return; // 落点没变：幂等成功，不写审计
      for (const [position, rowId] of order.entries()) {
        await tx.repairCategory.update({ where: { id: rowId }, data: { sortOrder: position } });
      }
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair.category.moved",
        targetType: "RepairCategory",
        targetId: id,
        result: "SUCCESS",
        after: { beforeId },
      });
    });
  },
};

async function setActive(id: string, isActive: boolean, actor: AuthorizedActor) {
  return inSerializableTransaction(async (tx) => {
    // 原实现直接 update，对不存在或已软删除的 id 会抛 Prisma 错误；
    // 这里先锁行读取，统一成 RESOURCE_NOT_FOUND。
    await tx.$queryRaw`SELECT id FROM repair_categories WHERE id = ${id} FOR UPDATE`;
    const current = await tx.repairCategory.findUnique({ where: { id } });
    if (!current || current.deletedAt) throw new AppError("RESOURCE_NOT_FOUND", "分类不存在");
    if (current.isActive === isActive) return view(current);
    const updated = await tx.repairCategory.update({ where: { id }, data: { isActive } });
    await appendAuditLog(tx, {
      actor,
      actorType: "USER",
      actorUserId: actor.userId,
      action: isActive ? "repair.category.activated" : "repair.category.deactivated",
      targetType: "RepairCategory",
      targetId: id,
      result: "SUCCESS",
      before: { isActive: current.isActive },
      after: { isActive },
    });
    return view(updated);
  });
}

function view(row: {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
}): RepairCategoryView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
  };
}
