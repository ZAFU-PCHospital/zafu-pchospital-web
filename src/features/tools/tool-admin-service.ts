import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { movedIds, nextSortOrder, reorderedIds } from "@/features/admin/reorder";
import { toolRepository } from "@/features/tools/tool-repository";
import { AppError } from "@/lib/api/errors";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { requirePermission } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
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
    const duplicate = await getDb().toolCategory.findFirst({
      where: { deletedAt: null, OR: [{ name }, { code }] },
    });
    if (duplicate) {
      throw new AppError(
        "TOOL_CATEGORY_CONFLICT",
        duplicate.name === name ? "该分类名称已存在" : "该分类标识已被占用",
      );
    }
    return inSerializableTransaction(async (tx) => {
      const created = await tx.toolCategory.create({
        data: {
          id: randomUUID(),
          code,
          name,
          labelEn: input.labelEn?.trim() || null,
          description: input.description?.trim() || null,
          // 不给序号就排到末尾：顺序由列表里的上移 / 下移与拖动调整。
          sortOrder: input.sortOrder ?? (await nextSortOrder(tx, "tool_categories")),
          createdBy: actor.userId,
          createdAt: new Date(),
        },
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
    const before = await getDb().toolCategory.findFirst({
      where: { id: categoryId, deletedAt: null },
    });
    if (!before) throw new AppError("RESOURCE_NOT_FOUND", "工具分类不存在");
    if (
      input.name !== undefined &&
      (!input.name.trim() || input.name.trim().length > TOOL_CATEGORY_NAME_MAX_LENGTH)
    ) {
      throw new AppError("VALIDATION_FAILED", "分类名称无效");
    }
    if (input.name !== undefined && input.name.trim() !== before.name) {
      const duplicate = await getDb().toolCategory.findFirst({
        where: { deletedAt: null, name: input.name.trim(), id: { not: categoryId } },
      });
      if (duplicate) throw new AppError("TOOL_CATEGORY_CONFLICT", "该分类名称已存在");
    }
    return inSerializableTransaction(async (tx) => {
      const updated = await tx.toolCategory.update({
        where: { id: categoryId },
        data: {
          name: input.name?.trim(),
          labelEn: input.labelEn === undefined ? undefined : input.labelEn?.trim() || null,
          description:
            input.description === undefined ? undefined : input.description?.trim() || null,
          sortOrder: input.sortOrder,
        },
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
      const updated = await tx.toolCategory.update({ where: { id: categoryId }, data: { isActive } });
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
      const rows = await tx.toolCategory.findMany({
        where: { deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
        select: { id: true },
      });
      const order = reorderedIds(
        rows.map((row) => row.id),
        categoryId,
        direction,
        "RESOURCE_NOT_FOUND",
        "工具分类不存在",
      );
      if (!order) return; // 已在边界：幂等成功，不写审计
      await writeCategoryOrder(tx, order);
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
      const rows = await tx.toolCategory.findMany({
        where: { deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
        select: { id: true },
      });
      const order = movedIds(
        rows.map((row) => row.id),
        categoryId,
        beforeId,
        "RESOURCE_NOT_FOUND",
        "工具分类不存在",
      );
      if (!order) return;
      await writeCategoryOrder(tx, order);
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
      // 分组里还有网站时不允许删：外键 RESTRICT 会拒绝写入并变成 500，
      // 这里提前给出「先移走或删除」这个可操作的信息。
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
    const category = await getDb().toolCategory.findFirst({
      where: { id: input.categoryId, deletedAt: null },
      select: { id: true },
    });
    if (!category) throw new AppError("VALIDATION_FAILED", "请选择有效的分类");
    await assertUrlNotDuplicated(input.categoryId, url);
    return inSerializableTransaction(async (tx) => {
      // 序号在**组内**追加到末尾：不同分组各自从 0 开始，
      // 组间顺序由分类表的 sortOrder 决定，与网站序号无关。
      const max = await tx.toolSite.aggregate({
        where: { categoryId: input.categoryId, deletedAt: null },
        _max: { sortOrder: true },
      });
      const created = await tx.toolSite.create({
        data: {
          id: randomUUID(),
          categoryId: input.categoryId,
          name,
          url,
          description: input.description?.trim() || null,
          sortOrder: input.sortOrder ?? (max._max.sortOrder ?? -1) + 1,
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

  async update(siteId: string, input: UpdateToolSiteInput, actor: AuthorizedActor): Promise<ToolSiteView> {
    requirePermission(actor, "tool:manage");
    const before = await getDb().toolSite.findFirst({ where: { id: siteId, deletedAt: null } });
    if (!before) throw new AppError("RESOURCE_NOT_FOUND", "网站不存在");
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
    if (input.categoryId !== undefined) {
      const category = await getDb().toolCategory.findFirst({
        where: { id: input.categoryId, deletedAt: null },
        select: { id: true },
      });
      if (!category) throw new AppError("VALIDATION_FAILED", "请选择有效的分类");
    }
    const effectiveCategoryId = input.categoryId ?? before.categoryId;
    const effectiveUrl = url ?? before.url;
    if (effectiveCategoryId !== before.categoryId || effectiveUrl !== before.url) {
      await assertUrlNotDuplicated(effectiveCategoryId, effectiveUrl, siteId);
    }
    return inSerializableTransaction(async (tx) => {
      const updated = await tx.toolSite.update({
        where: { id: siteId },
        data: {
          categoryId: input.categoryId,
          name,
          url,
          description:
            input.description === undefined ? undefined : input.description?.trim() || null,
          sortOrder: input.sortOrder,
        },
      });
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

  async setActive(siteId: string, isActive: boolean, actor: AuthorizedActor): Promise<ToolSiteView> {
    requirePermission(actor, "tool:manage");
    return inSerializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tool_sites WHERE id = ${siteId} FOR UPDATE`;
      const current = await tx.toolSite.findUnique({ where: { id: siteId } });
      if (!current || current.deletedAt) throw new AppError("RESOURCE_NOT_FOUND", "网站不存在");
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

  async reorder(siteId: string, direction: ReorderDirection, actor: AuthorizedActor): Promise<void> {
    requirePermission(actor, "tool:manage");
    const target = await getDb().toolSite.findFirst({
      where: { id: siteId, deletedAt: null },
      select: { categoryId: true },
    });
    if (!target) throw new AppError("RESOURCE_NOT_FOUND", "网站不存在");
    await inSerializableTransaction(async (tx) => {
      const order = await siteOrder(tx, target.categoryId, siteId, (ids) =>
        reorderedIds(ids, siteId, direction, "RESOURCE_NOT_FOUND", "网站不存在"),
      );
      if (!order) return;
      await writeSiteOrder(tx, order);
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

  async move(siteId: string, beforeId: string | null, actor: AuthorizedActor): Promise<void> {
    requirePermission(actor, "tool:manage");
    const target = await getDb().toolSite.findFirst({
      where: { id: siteId, deletedAt: null },
      select: { categoryId: true },
    });
    if (!target) throw new AppError("RESOURCE_NOT_FOUND", "网站不存在");
    await inSerializableTransaction(async (tx) => {
      const order = await siteOrder(tx, target.categoryId, siteId, (ids) =>
        movedIds(ids, siteId, beforeId, "RESOURCE_NOT_FOUND", "网站不存在"),
      );
      if (!order) return;
      await writeSiteOrder(tx, order);
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "tool_site.moved",
        targetType: "ToolSite",
        targetId: siteId,
        result: "SUCCESS",
        after: { beforeId },
      });
    });
  },

  async remove(siteId: string, actor: AuthorizedActor): Promise<void> {
    requirePermission(actor, "tool:manage");
    await inSerializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tool_sites WHERE id = ${siteId} FOR UPDATE`;
      const current = await tx.toolSite.findUnique({ where: { id: siteId } });
      if (!current || current.deletedAt) throw new AppError("RESOURCE_NOT_FOUND", "网站不存在");
      await tx.toolSite.update({
        where: { id: siteId },
        data: { deletedAt: new Date(), isActive: false },
      });
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
  categoryId: string,
  url: string,
  excludeId?: string,
): Promise<void> {
  const duplicate = await getDb().toolSite.findFirst({
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

/** 分类的稠密序号写入。 */
async function writeCategoryOrder(tx: Tx, order: readonly string[]): Promise<void> {
  for (const [position, id] of order.entries()) {
    await tx.toolCategory.update({ where: { id }, data: { sortOrder: position } });
  }
}

/** 网站的稠密序号写入（组内）。 */
async function writeSiteOrder(tx: Tx, order: readonly string[]): Promise<void> {
  for (const [position, id] of order.entries()) {
    await tx.toolSite.update({ where: { id }, data: { sortOrder: position } });
  }
}

/**
 * 按组取网站顺序再算出新顺序。
 *
 * 网站排序是**组内**的：跨组拖动的语义是「换分类」，那要走 `PATCH` 改 `categoryId`，
 * 而不是在别人的组里插一行 —— 所以这里先按 `categoryId` 收窄全集。
 */
async function siteOrder(
  tx: Tx,
  categoryId: string,
  siteId: string,
  compute: (ids: string[]) => string[] | null,
): Promise<string[] | null> {
  const rows = await tx.toolSite.findMany({
    where: { categoryId, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true },
  });
  return compute(rows.map((row) => row.id));
}
