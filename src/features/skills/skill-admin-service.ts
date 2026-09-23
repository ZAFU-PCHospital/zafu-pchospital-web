import { randomUUID } from "node:crypto";

import { toSkillView } from "@/features/skills/skill-service";
import { nextSortOrder, movedIds, reorderedIds } from "@/features/admin/reorder";
import { AppError } from "@/lib/api/errors";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { requirePermission } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { stableCodeFromName } from "@/lib/stable-code";
import type {
  AuthorizedActor,
  CreateSkillInput,
  SkillAdminServiceContract,
  SkillAdminView,
  ReorderDirection,
  SkillView,
  UpdateSkillInput,
} from "@/types/contracts";

/**
 * 技能标签库管理（M6 批次 2，需求 §4.4「管理技能标签」）。
 *
 * M3 只开放了只读的 `skillService.listActive()`（成员选择用），写能力一直留给 M6。
 *
 * 两条与故障分类**刻意保持一致**的规则：
 * 1. **不做物理删除**，只停用 / 启用。技能标签被 `user_skills` 引用，删掉会让历史
 *    成员标签无声消失；停用后成员不能再新选，已有的关联仍然回显。
 * 2. 重复 code 先查重再写，返回稳定的 `SKILL_CODE_CONFLICT`（409），
 *    不让唯一键冲突冒泡成 500 —— 管理界面需要拿到「这个 code 已被占用」这个可操作信息。
 */
export const skillAdminService: SkillAdminServiceContract = {
  /** 管理端列表：含已停用，并带当前生效的成员关联计数。 */
  async list(actor: AuthorizedActor): Promise<SkillAdminView[]> {
    requirePermission(actor, "skill:manage");
    const rows = await getDb().skill.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    });
    // 只统计未软删除的关联：软删除代表成员已经取消选择，不该再计入「有多少人在用」。
    const usage = await getDb().userSkill.groupBy({
      by: ["skillId"],
      where: { deletedAt: null },
      _count: { _all: true },
    });
    const counts = new Map(usage.map((row) => [row.skillId, row._count._all]));
    return rows.map((row) => ({
      ...toSkillView(row),
      usedByMemberCount: counts.get(row.id) ?? 0,
    }));
  },

  async create(input: CreateSkillInput, actor: AuthorizedActor): Promise<SkillView> {
    requirePermission(actor, "skill:manage");
    const name = input.name.trim();
    if (!name || name.length > 80) throw new AppError("VALIDATION_FAILED", "技能名称无效");
    // `code` 现在由系统生成（留空时），仍然接受显式传入以便脚本/迁移使用。
    const code = (input.code?.trim() || stableCodeFromName(name, "SK")).toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(code)) {
      throw new AppError("VALIDATION_FAILED", "技能标识无效");
    }
    // 冲突先按**名称**判：管理员填的是名称，报「该名称已存在」才是他能处理的信息。
    // 代码是从名称派生的，因此名称重复必然代码重复；反过来（两个不同名称、同一个显式 code）
    // 走下面那条判断。
    const duplicate = await getDb().skill.findFirst({
      where: { deletedAt: null, OR: [{ name }, { code }] },
    });
    if (duplicate) {
      throw new AppError(
        "SKILL_CODE_CONFLICT",
        duplicate.name === name ? "该技能名称已存在" : "该技能标识已被占用",
      );
    }
    return inSerializableTransaction(async (tx) => {
      const created = await tx.skill.create({
        data: {
          id: randomUUID(),
          code,
          name,
          description: input.description?.trim() || null,
          // 不给序号就排到末尾：顺序由列表里的「上移 / 下移」调整，不需要人填数字。
          sortOrder: input.sortOrder ?? (await nextSortOrder(tx, "skills")),
          createdBy: actor.userId,
          createdAt: new Date(),
        },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "skill.created",
        targetType: "Skill",
        targetId: created.id,
        result: "SUCCESS",
        after: { code, name },
      });
      return toSkillView(created);
    });
  },

  async update(
    skillId: string,
    input: UpdateSkillInput,
    actor: AuthorizedActor,
  ): Promise<SkillView> {
    requirePermission(actor, "skill:manage");
    const before = await getDb().skill.findFirst({ where: { id: skillId, deletedAt: null } });
    if (!before) throw new AppError("SKILL_NOT_FOUND", "技能标签不存在");
    if (input.name !== undefined && (!input.name.trim() || input.name.trim().length > 80)) {
      throw new AppError("VALIDATION_FAILED", "技能名称无效");
    }
    return inSerializableTransaction(async (tx) => {
      const updated = await tx.skill.update({
        where: { id: skillId },
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
        action: "skill.updated",
        targetType: "Skill",
        targetId: skillId,
        result: "SUCCESS",
        before: { name: before.name, description: before.description, sortOrder: before.sortOrder },
        after: {
          name: updated.name,
          description: updated.description,
          sortOrder: updated.sortOrder,
        },
      });
      return toSkillView(updated);
    });
  },

  async reorder(
    skillId: string,
    direction: ReorderDirection,
    actor: AuthorizedActor,
  ): Promise<void> {
    requirePermission(actor, "skill:manage");
    await inSerializableTransaction(async (tx) => {
      const rows = await tx.skill.findMany({
        where: { deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
        select: { id: true },
      });
      const order = reorderedIds(
        rows.map((row) => row.id),
        skillId,
        direction,
        "SKILL_NOT_FOUND",
        "技能标签不存在",
      );
      if (!order) return; // 已在边界：幂等成功，不写审计
      // 重排成稠密序号：历史数据里序号可能全是 0 或者 10/20/30 的间隙，
      // 只交换两行的话「上移」在重复序号下会看起来没反应。
      for (const [position, id] of order.entries()) {
        await tx.skill.update({ where: { id }, data: { sortOrder: position } });
      }
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "skill.reordered",
        targetType: "Skill",
        targetId: skillId,
        result: "SUCCESS",
        after: { direction },
      });
    });
  },

  /**
   * 拖动排序（M6 第五轮验收）：把 `skillId` 放到 `beforeId` 之前，`beforeId` 为 `null`
   * 表示拖到末尾。
   *
   * 与 `reorder` 的关系：`reorder` 是「一格一格挪」，本方法是「一次拖到位」。
   * 拖动会跨越任意格数，因此这里一次算出最终顺序、一次写库、一条审计；
   * 沿用同一个稠密序号写法，两个入口的结果完全一致。
   */
  async move(skillId: string, beforeId: string | null, actor: AuthorizedActor): Promise<void> {
    requirePermission(actor, "skill:manage");
    await inSerializableTransaction(async (tx) => {
      const rows = await tx.skill.findMany({
        where: { deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
        select: { id: true },
      });
      const order = movedIds(
        rows.map((row) => row.id),
        skillId,
        beforeId,
        "SKILL_NOT_FOUND",
        "技能标签不存在",
      );
      if (!order) return; // 落点没变：幂等成功，不写审计
      for (const [position, id] of order.entries()) {
        await tx.skill.update({ where: { id }, data: { sortOrder: position } });
      }
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "skill.moved",
        targetType: "Skill",
        targetId: skillId,
        result: "SUCCESS",
        after: { beforeId },
      });
    });
  },

  async setActive(skillId: string, isActive: boolean, actor: AuthorizedActor): Promise<SkillView> {
    requirePermission(actor, "skill:manage");
    return inSerializableTransaction(async (tx) => {
      // 先锁行读取：直接 update 对不存在或已软删除的 id 会抛 Prisma 错误（500），
      // 这里统一成 SKILL_NOT_FOUND（404），与故障分类同一处理。
      await tx.$queryRaw`SELECT id FROM skills WHERE id = ${skillId} FOR UPDATE`;
      const current = await tx.skill.findUnique({ where: { id: skillId } });
      if (!current || current.deletedAt) {
        throw new AppError("SKILL_NOT_FOUND", "技能标签不存在");
      }
      if (current.isActive === isActive) return toSkillView(current);
      const updated = await tx.skill.update({ where: { id: skillId }, data: { isActive } });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: isActive ? "skill.activated" : "skill.deactivated",
        targetType: "Skill",
        targetId: skillId,
        result: "SUCCESS",
        before: { isActive: current.isActive },
        after: { isActive },
      });
      return toSkillView(updated);
    });
  },
};
