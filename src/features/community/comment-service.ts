import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { paginationMeta } from "@/lib/api/pagination";
import { AppError } from "@/lib/api/errors";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { requirePermission } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { assertCanReadRepair } from "@/features/repairs/repair-policy";
import { repairRepository } from "@/features/repairs/repair-repository";
import { collectMemberNames, resolveMentionedMemberIds } from "./mention";
import { toCommentView } from "./community-view";
import type { RepairCommentServiceContract } from "@/types/contracts";
import { COMMENT_BODY_MAX_LENGTH, COMMENT_MENTION_LIMIT } from "@/types/contracts";

const commentInclude = {
  author: { include: { user: { select: { displayName: true } } } },
  mentions: {
    include: { mentioned: { include: { user: { select: { displayName: true } } } } },
  },
} satisfies Prisma.RepairCommentInclude;

type CommentRow = Prisma.RepairCommentGetPayload<{ include: typeof commentInclude }>;

/** C0 控制字符，不含 TAB / LF / CR。 */
function hasIllegalControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31)) return true;
  }
  return false;
}

export function normalizeCommentBody(body: string): string {
  const trimmed = body.replace(/\r\n/g, "\n").trim();
  if (!trimmed) throw new AppError("COMMENT_BODY_INVALID", "评论内容不能为空");
  if ([...trimmed].length > COMMENT_BODY_MAX_LENGTH) {
    throw new AppError("COMMENT_BODY_INVALID", `评论内容不能超过 ${COMMENT_BODY_MAX_LENGTH} 字`);
  }
  if (hasIllegalControlChars(trimmed)) {
    throw new AppError("COMMENT_BODY_INVALID", "评论内容包含非法控制字符");
  }
  return trimmed;
}

async function listActiveMentionMembers() {
  const rows = await getDb().memberProfile.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    select: {
      id: true,
      nickname: true,
      realName: true,
      user: { select: { displayName: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    names: collectMemberNames({
      nickname: row.nickname,
      realName: row.realName,
      displayName: row.user.displayName,
    }),
  }));
}

function notFound(): never {
  throw new AppError("COMMENT_NOT_FOUND", "评论不存在");
}

export const repairCommentService: RepairCommentServiceContract = {
  async list(recordId, input, actor) {
    requirePermission(actor, "comment:read");
    // 可空解析：纯管理员（只有 ADMIN 角色、没有成员档案）在 M6 的记录详情窗口里
    // 也要能读评论 —— 那里是「评论管理 → 所属记录」的落点。
    // `self` 只用于计算每条评论的 `canDelete`；为 null 时该字段退化为按权限判断。
    const self = await repairRepository.findActiveMemberForUser(actor.userId);
    const record = await repairRepository.getById(recordId);
    assertCanReadRepair(actor, record);

    const where: Prisma.RepairCommentWhereInput = {
      repairRecordId: recordId,
      deletedAt: null,
    };
    const start = (input.page - 1) * input.pageSize;
    const rootWhere: Prisma.RepairCommentWhereInput = { ...where, parentCommentId: null };

    // 分页下推到 SQL：只取本页的根评论。
    // 早先的写法是 `findMany({ where })` 不带 take/skip、把**整条记录的评论**
    // （连作者与提及的 join 一起）读进内存再 slice —— 热门记录上这一条就是全量拉取。
    // 页大小由 parsePagination 限制在 1..100，所以 take 有上界。
    const [total, pageRoots] = await Promise.all([
      getDb().repairComment.count({ where: rootWhere }),
      getDb().repairComment.findMany({
        where: rootWhere,
        include: commentInclude,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: start,
        take: input.pageSize,
      }),
    ]);

    // 回复只取本页根评论的那些；本页没有根评论时不必再查。
    // 排序与根评论一致，保证每条根评论下的回复仍是时间升序（与分页前行为等价）。
    const rootIds = pageRoots.map((row) => row.id);
    const replies =
      rootIds.length === 0
        ? []
        : await getDb().repairComment.findMany({
            where: { repairRecordId: recordId, deletedAt: null, parentCommentId: { in: rootIds } },
            include: commentInclude,
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          });

    const selfId = self?.id ?? null;
    const items = pageRoots.map((root) => {
      const view = toCommentView(root, actor, selfId);
      view.replies = replies
        .filter((reply) => reply.parentCommentId === root.id)
        .map((reply) => toCommentView(reply, actor, selfId));
      return view;
    });
    return { items, pagination: paginationMeta(input, total) };
  },

  async create(recordId, input, actor) {
    requirePermission(actor, "comment:create");
    const self = await repairRepository.activeMemberForUser(actor.userId);
    const record = await repairRepository.getById(recordId);
    assertCanReadRepair(actor, record);
    const body = normalizeCommentBody(input.body);
    const members = await listActiveMentionMembers();
    const mentionedIds = resolveMentionedMemberIds({
      body,
      mentionedMemberProfileIds: input.mentionedMemberProfileIds,
      members,
      selfMemberProfileId: self.id,
      limit: COMMENT_MENTION_LIMIT,
    });

    const now = new Date();
    const created = await inSerializableTransaction(async (tx) => {
      const parentId = await normalizeCommentParent(tx, recordId, input.parentCommentId);
      const comment = await tx.repairComment.create({
        data: {
          id: randomUUID(),
          repairRecordId: recordId,
          authorMemberProfileId: self.id,
          parentCommentId: parentId,
          body,
          createdAt: now,
        },
        include: commentInclude,
      });
      if (mentionedIds.length > 0) {
        await tx.commentMention.createMany({
          data: mentionedIds.map((id) => ({
            id: randomUUID(),
            commentId: comment.id,
            mentionedMemberProfileId: id,
            createdAt: now,
          })),
        });
      }
      await notifyCommentAudience(tx, {
        recordId,
        commentId: comment.id,
        ownerMemberProfileId: record.memberProfileId,
        actorMemberProfileId: self.id,
        mentionedIds,
        now,
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair.comment.created",
        targetType: "RepairComment",
        targetId: comment.id,
        result: "SUCCESS",
        after: {
          repairRecordId: recordId,
          parentCommentId: parentId,
          mentionCount: mentionedIds.length,
        },
      });
      return tx.repairComment.findUniqueOrThrow({
        where: { id: comment.id },
        include: commentInclude,
      });
    });
    return toCommentView(created as CommentRow, actor, self.id);
  },

  async softDelete(recordId, commentId, actor) {
    // 可空解析而不是 `activeMemberForUser`：纯管理员（只有 ADMIN 角色、没有成员档案）
    // 也要能删除违规评论，抛 `MEMBER_REQUIRED` 会把管理能力一起挡掉。
    // 没有档案时 `isAuthor` 恒为 false，于是必然走 `comment:delete` —— 只有管理员持有它。
    const self = await repairRepository.findActiveMemberForUser(actor.userId);
    const record = await repairRepository.getById(recordId);
    assertCanReadRepair(actor, record);
    const comment = await getDb().repairComment.findFirst({
      where: { id: commentId, repairRecordId: recordId, deletedAt: null },
    });
    if (!comment) notFound();
    const isAuthor = self !== null && comment.authorMemberProfileId === self.id;
    if (!isAuthor) requirePermission(actor, "comment:delete");
    else requirePermission(actor, "comment:create");

    const now = new Date();
    await inSerializableTransaction(async (tx) => {
      const updated = await tx.repairComment.updateMany({
        where: { id: commentId, repairRecordId: recordId, deletedAt: null },
        data: { deletedAt: now },
      });
      if (updated.count !== 1) notFound();
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair.comment.deleted",
        targetType: "RepairComment",
        targetId: commentId,
        result: "SUCCESS",
        before: { authorMemberProfileId: comment.authorMemberProfileId },
        after: { deleted: true },
      });
    });
  },
};

export async function normalizeCommentParent(
  tx: Prisma.TransactionClient,
  recordId: string,
  parentCommentId: string | null | undefined,
): Promise<string | null> {
  if (!parentCommentId) return null;
  const parent = await tx.repairComment.findFirst({
    where: { id: parentCommentId, repairRecordId: recordId, deletedAt: null },
    select: { id: true, parentCommentId: true },
  });
  if (!parent) throw new AppError("COMMENT_PARENT_INVALID", "回复目标不存在");
  return parent.parentCommentId ?? parent.id;
}

async function notifyCommentAudience(
  tx: Prisma.TransactionClient,
  input: {
    recordId: string;
    commentId: string;
    ownerMemberProfileId: string;
    actorMemberProfileId: string;
    mentionedIds: readonly string[];
    now: Date;
  },
): Promise<void> {
  const recipients = new Map<string, "MENTIONED" | "REPAIR_COMMENTED">();
  for (const id of input.mentionedIds) {
    if (id !== input.actorMemberProfileId) recipients.set(id, "MENTIONED");
  }
  if (input.ownerMemberProfileId !== input.actorMemberProfileId) {
    if (!recipients.has(input.ownerMemberProfileId)) {
      recipients.set(input.ownerMemberProfileId, "REPAIR_COMMENTED");
    }
  }
  if (recipients.size === 0) return;
  await tx.notification.createMany({
    data: [...recipients.entries()].map(([recipientMemberProfileId, type]) => ({
      id: randomUUID(),
      recipientMemberProfileId,
      type,
      status: "UNREAD",
      repairRecordId: input.recordId,
      commentId: input.commentId,
      actorMemberProfileId: input.actorMemberProfileId,
      createdAt: input.now,
    })),
  });
}

export async function createReviewNotification(
  tx: Prisma.TransactionClient,
  input: {
    recordId: string;
    ownerMemberProfileId: string;
    actorMemberProfileId: string | null;
    decision: "APPROVED" | "REJECTED";
    now: Date;
  },
): Promise<void> {
  if (input.actorMemberProfileId && input.actorMemberProfileId === input.ownerMemberProfileId) {
    return;
  }
  await tx.notification.create({
    data: {
      id: randomUUID(),
      recipientMemberProfileId: input.ownerMemberProfileId,
      type: input.decision === "APPROVED" ? "REPAIR_APPROVED" : "REPAIR_REJECTED",
      status: "UNREAD",
      repairRecordId: input.recordId,
      actorMemberProfileId: input.actorMemberProfileId,
      createdAt: input.now,
    },
  });
}
