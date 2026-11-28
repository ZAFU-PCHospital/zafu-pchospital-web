import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { movedIds, reorderedIds } from "@/features/admin/reorder";
import { toolRepository } from "@/features/tools/tool-repository";
import { AppError } from "@/lib/api/errors";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { requirePermission } from "@/lib/auth/permissions";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { stableCodeFromName } from "@/lib/stable-code";
import type {
  AuthorizedActor,
  CreateToolCategoryInput,
  CreateToolSiteInput,
  ReorderDirection,
  ToolCategoryAdminServiceContract,
  ToolCategoryAdminView,
  ToolCategoryView,
  ToolSiteAdminServiceContract,
  ToolSiteView,
  UpdateToolCategoryInput,
  UpdateToolSiteInput,
} from "@/types/contracts";
import {
  TOOL_CATEGORY_DESCRIPTION_MAX_LENGTH,
  TOOL_CATEGORY_LABEL_EN_MAX_LENGTH,
  TOOL_CATEGORY_NAME_MAX_LENGTH,
  TOOL_SITE_DESCRIPTION_MAX_LENGTH,
  TOOL_SITE_NAME_MAX_LENGTH,
  TOOL_SITE_URL_MAX_LENGTH,
} from "@/types/contracts";

/**
 * 工具导航维护（`/admin/tools`）。
 *
 * 两条与技能标签 / 故障分类刻意不同的规则：
 * 1. **提供删除**（软删除）。技能标签被 `user_skills` 引用，删掉会让历史无声消失；
 *    而工具网站没有任何别的表引用它，「删掉」是使用者的真实意图。
 *    行仍保留（`deleted_at`），审计与排障都还查得到。
 * 2. **分类非空不许删**。外键是 RESTRICT，硬删会被数据库拒绝并冒泡成 500；
 *    这里提前判成 409 并说清楚「先移走或删除该分类下的网站」。
 *
 * 序号一律写成稠密值（`0..n-1`），与技能标签共用 `reorder.ts` 的实现，
 * 否则历史数据里重复的 `sort_order` 会让「上移」看起来没反应。
 */
export const toolCategoryAdminService: ToolCategoryAdminServiceContract = {
  async list(actor: AuthorizedActor): Promise<ToolCategoryAdminView[]> {
    requirePermission(actor, "tool:manage");
    const [rows, counts] = await Promise.all([
      toolRepository.listCategories({ activeOnly: false }),
      toolRepository.countSitesByCategory(),
    ]);
    return rows.map((row) => ({ ...row, siteCount: counts.get(row.id) ?? 0 }));
  },

  async create(input: CreateToolCategoryInput, actor: AuthorizedActor): Promise<ToolCategoryView> {
    requirePermission(actor, "tool:manage");
    const name = input.name.trim();
    if (!name || name.length > TOOL_CATEGORY_NAME_MAX_LENGTH) {
      throw new AppError("VALIDATION_FAILED", "分类名称无效");
    }
    const code = (input.code?.trim() || stableCodeFromName(name, "TC")).toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(code)) {
      throw new AppError("VALIDATION_FAILED", "分类标识无效");
    }
    const fields = categoryText(input);
    return inSerializableTransaction(async (tx) => {
      const duplicate = await tx.toolCategory.findFirst({
        where: { OR: [{ deletedAt: null, name }, { code }] },
        select: { code: true },
      });
      if (duplicate) {
        throw new AppError(
          "TOOL_CATEGORY_CONFLICT",
          duplicate.code === code ? "该分类标识已被占用" : "该分类名称已存在",
        );
      }
      const rows = await orderedCategories(tx);
      await writeCategoryOrder(
        tx,
        rows.map((row) => row.id),
        rows,
      );
      const created = await tx.toolCategory
        .create({
          data: {
            id: randomUUID(),
            code,
            name,
            ...fields,
            sortOrder: rows.length,
            createdBy: actor.userId,
            createdAt: new Date(),
          },
        })
        .catch((error: unknown) => {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "P2002"
          ) {
            throw new AppError("TOOL_CATEGORY_CONFLICT", "该分类标识已被占用");
          }
          throw error;
        });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "tool_category.created",
        targetType: "ToolCategory",
        targetId: created.id,
        result: "SUCCESS",
        after: { code, name },
      });
      return toCategoryView(created);
    });
  },

  async update(
    categoryId: string,
    input: UpdateToolCategoryInput,
    actor: AuthorizedActor,
  ): Promise<ToolCategoryView> {
    requirePermission(actor, "tool:manage");
    const name = input.name?.trim();
    if (name !== undefined && (!name || name.length > TOOL_CATEGORY_NAME_MAX_LENGTH)) {
      throw new AppError("VALIDATION_FAILED", "分类名称无效");
    }
    const fields = categoryText(input);
    return inSerializableTransaction(async (tx) => {
      const before = await tx.toolCategory.findFirst({
        where: { id: categoryId, deletedAt: null },
      });
      if (!before) throw new AppError("RESOURCE_NOT_FOUND", "工具分类不存在");
      if (name !== undefined && name !== before.name) {
        const duplicate = await tx.toolCategory.findFirst({
          where: { deletedAt: null, name, id: { not: categoryId } },
        });
        if (duplicate) throw new AppError("TOOL_CATEGORY_CONFLICT", "该分类名称已存在");
      }
      const updated = await tx.toolCategory.update({
        where: { id: categoryId },
        data: { name, ...fields },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "tool_category.updated",
        targetType: "ToolCategory",
        targetId: categoryId,
        result: "SUCCESS",
        before: { name: before.name, labelEn: before.labelEn },
        after: { name: updated.name, labelEn: updated.labelEn },
      });
      return toCategoryView(updated);
    });
  },

  async setActive(
    categoryId: string,
    isActive: boolean,
    actor: AuthorizedActor,
  ): Promise<ToolCategoryView> {
    requirePermission(actor, "tool:manage");
    return inSerializableTransaction(async (tx) => {
      // 先锁行：直接 update 不存在的 id 会抛 Prisma 错误（500），统一成 404。
      await tx.$queryRaw`SELECT id FROM tool_categories WHERE id = ${categoryId} FOR UPDATE`;
      const current = await tx.toolCategory.findUnique({ where: { id: categoryId } });
      if (!current || current.deletedAt) throw new AppError("RESOURCE_NOT_FOUND", "工具分类不存在");
      if (current.isActive === isActive) return toCategoryView(current);
      const updated = await tx.toolCategory.update({
        where: { id: categoryId },
        data: { isActive },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: isActive ? "tool_category.activated" : "tool_category.deactivated",
        targetType: "ToolCategory",
        targetId: categoryId,
        result: "SUCCESS",
        before: { isActive: current.isActive },
        after: { isActive },
      });
      return toCategoryView(updated);
    });
  },

  async reorder(
    categoryId: string,
    direction: ReorderDirection,
    actor: AuthorizedActor,
  ): Promise<void> {
    requirePermission(actor, "tool:manage");
    await inSerializableTransaction(async (tx) => {
      const rows = await orderedCategories(tx);
      const order = reorderedIds(
        rows.map((row) => row.id),
        categoryId,
        direction,
        "RESOURCE_NOT_FOUND",
        "工具分类不存在",
      );
      if (!order) return; // 已在边界：幂等成功，不写审计
      await writeCategoryOrder(tx, order, rows);
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "tool_category.reordered",
        targetType: "ToolCategory",
        targetId: categoryId,
        result: "SUCCESS",
        after: { direction },
      });
    });
  },

  async move(categoryId: string, beforeId: string | null, actor: AuthorizedActor): Promise<void> {
    requirePermission(actor, "tool:manage");
    await inSerializableTransaction(async (tx) => {
      const rows = await orderedCategories(tx);
      const order = movedIds(
        rows.map((row) => row.id),
        categoryId,
        beforeId,
        "RESOURCE_NOT_FOUND",
        "工具分类不存在",
      );
      if (!order) return;
      await writeCategoryOrder(tx, order, rows);
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "tool_category.moved",
        targetType: "ToolCategory",
        targetId: categoryId,
        result: "SUCCESS",
        after: { beforeId },
      });
    });
  },

  async remove(categoryId: string, actor: AuthorizedActor): Promise<void> {
    requirePermission(actor, "tool:manage");
    await inSerializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tool_categories WHERE id = ${categoryId} FOR UPDATE`;
      const current = await tx.toolCategory.findUnique({ where: { id: categoryId } });
      if (!current || current.deletedAt) throw new AppError("RESOURCE_NOT_FOUND", "工具分类不存在");
      const remaining = await tx.toolSite.count({ where: { categoryId, deletedAt: null } });
      if (remaining > 0) {
        throw new AppError(
          "TOOL_CATEGORY_CONFLICT",
          `该分类下还有 ${remaining} 个网站，请先移走或删除后再删分类`,
        );
      }
      await tx.toolCategory.update({
        where: { id: categoryId },
        data: { deletedAt: new Date(), isActive: false },
      });
      const rows = await orderedCategories(tx);
      await writeCategoryOrder(
        tx,
        rows.map((row) => row.id),
        rows,
      );
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "tool_category.deleted",
        targetType: "ToolCategory",
        targetId: categoryId,
        result: "SUCCESS",
        before: { code: current.code, name: current.name },
      });
    });
  },
};

export const toolSiteAdminService: ToolSiteAdminServiceContract = {
  async list(actor: AuthorizedActor): Promise<ToolSiteView[]> {
    requirePermission(actor, "tool:manage");
    return toolRepository.listSites({ activeOnly: false });
  },

  async create(input: CreateToolSiteInput, actor: AuthorizedActor): Promise<ToolSiteView> {
    requirePermission(actor, "tool:manage");
    const name = input.name.trim();
    const url = normalizeUrl(input.url);
    if (!name || name.length > TOOL_SITE_NAME_MAX_LENGTH) {
      throw new AppError("VALIDATION_FAILED", "网站名称无效");
    }
    if (url.length > TOOL_SITE_URL_MAX_LENGTH) {
      throw new AppError("VALIDATION_FAILED", "网址过长");
    }
    if ((input.description ?? "").length > TOOL_SITE_DESCRIPTION_MAX_LENGTH) {
      throw new AppError("VALIDATION_FAILED", "说明过长");
    }
    return inSerializableTransaction(async (tx) => {
      await lockCategory(tx, input.categoryId);
      await assertUrlNotDuplicated(tx, input.categoryId, url);
      const rows = await orderedSites(tx, input.categoryId);
      await writeSiteOrder(
        tx,
        rows.map((row) => row.id),
        rows,
      );
      const created = await tx.toolSite.create({
        data: {
          id: randomUUID(),
          categoryId: input.categoryId,
          name,
          url,
          description: input.description?.trim() || null,
          sortOrder: rows.length,
          createdBy: actor.userId,
          createdAt: new Date(),
        },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "tool_site.created",
        targetType: "ToolSite",
        targetId: created.id,
        result: "SUCCESS",
        after: { name, url, categoryId: input.categoryId },
      });
      return toSiteView(created);
    });
  },

  async update(
    siteId: string,
    input: UpdateToolSiteInput,
    actor: AuthorizedActor,
  ): Promise<ToolSiteView> {
    requirePermission(actor, "tool:manage");
    const name = input.name === undefined ? undefined : input.name.trim();
    if (name !== undefined && (!name || name.length > TOOL_SITE_NAME_MAX_LENGTH)) {
      throw new AppError("VALIDATION_FAILED", "网站名称无效");
    }
    const url = input.url === undefined ? undefined : normalizeUrl(input.url);
    if (url !== undefined && url.length > TOOL_SITE_URL_MAX_LENGTH) {
      throw new AppError("VALIDATION_FAILED", "网址过长");
    }
    if ((input.description ?? "").length > TOOL_SITE_DESCRIPTION_MAX_LENGTH) {
      throw new AppError("VALIDATION_FAILED", "说明过长");
    }
    return inSerializableTransaction(async (tx) => {
      const before = await lockSite(tx, siteId);
      const categoryId = input.categoryId ?? before.categoryId;
      const changingCategory = categoryId !== before.categoryId;
      const effectiveUrl = url ?? before.url;
      await lockSiteCategories(tx, before.categoryId, categoryId);
      if (changingCategory || effectiveUrl !== before.url) {
        await assertUrlNotDuplicated(tx, categoryId, effectiveUrl, siteId);
      }
      const targetRows = changingCategory ? await orderedSites(tx, categoryId) : null;
      const updated = await tx.toolSite.update({
        where: { id: siteId },
        data: {
          categoryId,
          name,
          url,
          description:
            input.description === undefined ? undefined : input.description?.trim() || null,
          sortOrder: targetRows?.length,
        },
      });
      if (targetRows) {
        const sourceRows = await orderedSites(tx, before.categoryId);
        await writeSiteOrder(
          tx,
          sourceRows.map((row) => row.id),
          sourceRows,
        );
        await writeSiteOrder(
          tx,
          targetRows.map((row) => row.id),
          targetRows,
        );
      }
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "tool_site.updated",
        targetType: "ToolSite",
        targetId: siteId,
        result: "SUCCESS",
        before: { name: before.name, url: before.url, categoryId: before.categoryId },
        after: {
          name: updated.name,
          url: updated.url,
          categoryId: updated.categoryId,
        },
      });
      return toSiteView(updated);
    });
  },

  async setActive(
    siteId: string,
    isActive: boolean,
    actor: AuthorizedActor,
  ): Promise<ToolSiteView> {
    requirePermission(actor, "tool:manage");
    return inSerializableTransaction(async (tx) => {
      const current = await lockSite(tx, siteId);
      if (current.isActive === isActive) return toSiteView(current);
      const updated = await tx.toolSite.update({ where: { id: siteId }, data: { isActive } });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: isActive ? "tool_site.activated" : "tool_site.deactivated",
        targetType: "ToolSite",
        targetId: siteId,
        result: "SUCCESS",
        before: { isActive: current.isActive },
        after: { isActive },
      });
      return toSiteView(updated);
    });
  },

  async reorder(
    siteId: string,
    direction: ReorderDirection,
    actor: AuthorizedActor,
  ): Promise<void> {
    requirePermission(actor, "tool:manage");
    await inSerializableTransaction(async (tx) => {
      const site = await lockSite(tx, siteId);
      await lockCategory(tx, site.categoryId);
      const rows = await orderedSites(tx, site.categoryId);
      const order = reorderedIds(
        rows.map((row) => row.id),
        siteId,
        direction,
        "RESOURCE_NOT_FOUND",
        "网站不存在",
      );
      if (!order) return;
      await writeSiteOrder(tx, order, rows);
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "tool_site.reordered",
        targetType: "ToolSite",
        targetId: siteId,
        result: "SUCCESS",
        after: { direction },
      });
    });
  },

  async move(siteId, beforeId, actor, targetCategoryId) {
    requirePermission(actor, "tool:manage");
    await inSerializableTransaction(async (tx) => {
      const site = await lockSite(tx, siteId);
      const categoryId = targetCategoryId ?? site.categoryId;
      const changingCategory = categoryId !== site.categoryId;
      await lockSiteCategories(tx, site.categoryId, categoryId);
      const rows = await orderedSites(tx, categoryId);
      const ids = rows.map((row) => row.id);
      if (changingCategory) {
        if (beforeId === siteId) throw new AppError("RESOURCE_NOT_FOUND", "目标网站不存在");
        await assertUrlNotDuplicated(tx, categoryId, site.url, siteId);
        ids.push(siteId);
      }
      const order = movedIds(ids, siteId, beforeId, "RESOURCE_NOT_FOUND", "目标网站不存在");
      if (!order && !changingCategory) return;
      if (changingCategory) {
        await tx.toolSite.update({ where: { id: siteId }, data: { categoryId } });
        const sourceRows = await orderedSites(tx, site.categoryId);
        await writeSiteOrder(
          tx,
          sourceRows.map((row) => row.id),
          sourceRows,
        );
      }
      await writeSiteOrder(tx, order ?? ids, [...rows, ...(changingCategory ? [site] : [])]);
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "tool_site.moved",
        targetType: "ToolSite",
        targetId: siteId,
        result: "SUCCESS",
        before: { categoryId: site.categoryId },
        after: { categoryId, beforeId },
      });
    });
  },

  async remove(siteId: string, actor: AuthorizedActor): Promise<void> {
    requirePermission(actor, "tool:manage");
    await inSerializableTransaction(async (tx) => {
      const current = await lockSite(tx, siteId);
      await lockCategory(tx, current.categoryId);
      await tx.toolSite.update({
        where: { id: siteId },
        data: { deletedAt: new Date(), isActive: false },
      });
      const rows = await orderedSites(tx, current.categoryId);
      await writeSiteOrder(
        tx,
        rows.map((row) => row.id),
        rows,
      );
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "tool_site.deleted",
        targetType: "ToolSite",
        targetId: siteId,
        result: "SUCCESS",
        before: { name: current.name, url: current.url },
      });
    });
  },
};

/* ---------------------------------------------------------------- 内部工具 */

type Tx = Prisma.TransactionClient;

function toCategoryView(row: {
  id: string;
  code: string;
  name: string;
  labelEn: string | null;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
}): ToolCategoryView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    labelEn: row.labelEn,
    description: row.description,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
  };
}

function toSiteView(row: {
  id: string;
  categoryId: string;
  name: string;
  url: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
}): ToolSiteView {
  return {
    id: row.id,
    categoryId: row.categoryId,
    name: row.name,
    url: row.url,
    description: row.description,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
  };
}

/**
 * 网址归一化与校验。
 *
 * 只接受 `http` / `https` 绝对地址：`javascript:` 与 `data:` 会被原样渲染成外链，
 * 前者是明确的 XSS 入口，后者在 `target="_blank"` 下行为不可预期。
 * 顺手把协议与主机小写化 —— `HTTPS://Steam.com` 与 `https://steam.com` 是同一条记录。
 */
function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new AppError("VALIDATION_FAILED", "请填写网址");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AppError("VALIDATION_FAILED", "网址格式无效，需要以 http:// 或 https:// 开头");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AppError("VALIDATION_FAILED", "只支持 http / https 网址");
  }
  return parsed.toString();
}

/** 同一分组内不允许重复收录同一个网址（换分组不算重复）。 */
async function assertUrlNotDuplicated(
  tx: Tx,
  categoryId: string,
  url: string,
  excludeId?: string,
): Promise<void> {
  const duplicate = await tx.toolSite.findFirst({
    where: {
      categoryId,
      url,
      deletedAt: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (duplicate) throw new AppError("TOOL_SITE_CONFLICT", "该分类下已经收录了这个网址");
}

function categoryText(input: Pick<UpdateToolCategoryInput, "labelEn" | "description">) {
  const labelEn = input.labelEn?.trim() || (input.labelEn === undefined ? undefined : null);
  const description =
    input.description?.trim() || (input.description === undefined ? undefined : null);
  if ((labelEn?.length ?? 0) > TOOL_CATEGORY_LABEL_EN_MAX_LENGTH) {
    throw new AppError("VALIDATION_FAILED", "分类英文名过长");
  }
  if ((description?.length ?? 0) > TOOL_CATEGORY_DESCRIPTION_MAX_LENGTH) {
    throw new AppError("VALIDATION_FAILED", "分类说明过长");
  }
  return { labelEn, description };
}

/** 分类行锁保护组内去重和排序，并与分类删除互斥。 */
async function lockCategory(tx: Tx, categoryId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM tool_categories
    WHERE id = ${categoryId} AND deleted_at IS NULL FOR UPDATE`;
  if (rows.length === 0) throw new AppError("VALIDATION_FAILED", "请选择有效的分类");
}

async function lockSiteCategories(tx: Tx, source: string, target: string) {
  for (const id of [...new Set([source, target])].sort()) await lockCategory(tx, id);
}

async function lockSite(tx: Tx, siteId: string) {
  await tx.$queryRaw`SELECT id FROM tool_sites WHERE id = ${siteId} FOR UPDATE`;
  const site = await tx.toolSite.findUnique({ where: { id: siteId } });
  if (!site || site.deletedAt) throw new AppError("RESOURCE_NOT_FOUND", "网站不存在");
  return site;
}

function orderedCategories(tx: Tx) {
  return tx.toolCategory.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    select: { id: true, sortOrder: true },
  });
}

function orderedSites(tx: Tx, categoryId: string) {
  return tx.toolSite.findMany({
    where: { categoryId, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
    select: { id: true, sortOrder: true },
  });
}

type OrderedRow = { id: string; sortOrder: number };

async function writeCategoryOrder(tx: Tx, order: readonly string[], rows: OrderedRow[]) {
  const previous = new Map(rows.map((row) => [row.id, row.sortOrder]));
  for (const [sortOrder, id] of order.entries()) {
    if (previous.get(id) !== sortOrder) {
      await tx.toolCategory.update({ where: { id }, data: { sortOrder } });
    }
  }
}

async function writeSiteOrder(tx: Tx, order: readonly string[], rows: OrderedRow[]) {
  const previous = new Map(rows.map((row) => [row.id, row.sortOrder]));
  for (const [sortOrder, id] of order.entries()) {
    if (previous.get(id) !== sortOrder) {
      await tx.toolSite.update({ where: { id }, data: { sortOrder } });
    }
  }
}
