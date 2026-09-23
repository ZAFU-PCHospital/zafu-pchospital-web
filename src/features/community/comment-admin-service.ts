import type { Prisma } from "@/generated/prisma/client";
import { dateRangeWhere, parseUtcDateFilter } from "@/lib/api/date-filter";
import { paginationMeta } from "@/lib/api/pagination";
import { AppError } from "@/lib/api/errors";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { requirePermission } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { memberRef } from "@/features/community/community-view";
import type {
  AdminCommentEntry,
  AdminCommentListInput,
  AdminCommentListResult,
  AuthorizedActor,
  CommentAdminServiceContract,
  RepairStatus,
} from "@/types/contracts";

const adminCommentInclude = {
  author: { include: { user: { select: { displayName: true } } } },
  record: {
    select: {
      id: true,
      repairDate: true,
      status: true,
      memberProfile: { include: { user: { select: { displayName: true } } } },
    },
  },
  _count: { select: { replies: { where: { deletedAt: null } }, mentions: true } },
} satisfies Prisma.RepairCommentInclude;

type AdminCommentRow = Prisma.RepairCommentGetPayload<{ include: typeof adminCommentInclude }>;

/**
 * 评论管理（M6 批次 2，需求 §37：管理员可以删除违规评论、查看评论所属维修记录）。
 *
 * 为什么另开一个管理端 Service，而不是把成员端的 `repairCommentService.list` 放宽：
 *
 * 1. 成员端列表**按记录**取（`GET /api/v1/repairs/:id/comments`），并且每条都要过
 *    `assertCanReadRepair`；管理端要的是**跨记录**的全局视角，用成员权限放行会绕过
 *    记录可见性，所以这里用独立的 `comment:moderate`（仅 ADMIN）。
 * 2. 成员端的 `canDelete` 是「以当前成员视角」算出来的，管理端的动作由权限决定，
 *    条目里不该出现这种字段（否则界面会误以为按钮该由数据控制）。
 *
 * 删除复用与成员端**同一张表、同一套软删除语义**（写 `deleted_at`，正文保留供审计），
 * 只是不再要求操作者拥有成员档案 —— 纯管理员账号（只有 ADMIN 角色、没有成员档案）
 * 正是这一批要打通的场景，它此前会被 `MEMBER_REQUIRED` 挡住。
 */
export const commentAdminService: CommentAdminServiceContract = {
  async list(
    input: AdminCommentListInput,
    actor: AuthorizedActor,
  ): Promise<AdminCommentListResult> {
    requirePermission(actor, "comment:moderate");
    const created = parseUtcDateFilter(input.createdFrom, input.createdTo, "评论时间");
    const where: Prisma.RepairCommentWhereInput = {
      // 默认只看未删除；`DELETED` / `ALL` 用于复核「刚才那条是不是真的删掉了」。
      ...(input.deleted === "DELETED"
        ? { deletedAt: { not: null } }
        : input.deleted === "ALL"
          ? {}
          : { deletedAt: null }),
      repairRecordId: input.recordId,
      authorMemberProfileId: input.authorMemberProfileId,
      createdAt: dateRangeWhere(created),
      OR: buildSearch(input.query),
    };
    const [rows, total] = await Promise.all([
      getDb().repairComment.findMany({
        where,
        include: adminCommentInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      getDb().repairComment.count({ where }),
    ]);
    return {
      items: rows.map(toEntry),
      pagination: paginationMeta(input, total),
    };
  },

  async softDelete(commentId: string, actor: AuthorizedActor): Promise<void> {
    requirePermission(actor, "comment:moderate");
    const comment = await getDb().repairComment.findUnique({ where: { id: commentId } });
    if (!comment || comment.deletedAt) {
      throw new AppError("COMMENT_NOT_FOUND", "评论不存在或已删除");
    }
    const now = new Date();
    await inSerializableTransaction(async (tx) => {
      const updated = await tx.repairComment.updateMany({
        where: { id: commentId, deletedAt: null },
        data: { deletedAt: now },
      });
      if (updated.count !== 1) throw new AppError("COMMENT_NOT_FOUND", "评论不存在或已删除");
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair.comment.moderated",
        targetType: "RepairComment",
        targetId: commentId,
        result: "SUCCESS",
        before: {
          repairRecordId: comment.repairRecordId,
          authorMemberProfileId: comment.authorMemberProfileId,
        },
        after: { deleted: true },
      });
    });
  },
};

function toEntry(row: AdminCommentRow): AdminCommentEntry {
  return {
    id: row.id,
    body: row.body,
    author: memberRef(row.author),
    record: {
      id: row.record.id,
      memberName: memberRef(row.record.memberProfile).name,
      repairDate: row.record.repairDate?.toISOString().slice(0, 10) ?? null,
      status: row.record.status as RepairStatus,
    },
    parentCommentId: row.parentCommentId,
    replyCount: row._count.replies,
    mentionCount: row._count.mentions,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

/**
 * 关键字检索：正文、作者展示名、所属记录 ID。
 *
 * 作者名走「昵称 / 实名 / 账号展示名」三选一，与 `memberRef` 的回退一致；
 * 不做全文索引以外的模糊匹配以外的事 —— 评论量级不需要额外索引。
 */
function buildSearch(query: string | undefined): Prisma.RepairCommentWhereInput[] | undefined {
  const value = query?.trim();
  if (!value) return undefined;
  return [
    { body: { contains: value } },
    { author: { nickname: { contains: value } } },
    { author: { realName: { contains: value } } },
    { author: { user: { displayName: { contains: value } } } },
    { repairRecordId: value },
  ];
}
