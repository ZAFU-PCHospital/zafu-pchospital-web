import type { Prisma } from "@/generated/prisma/client";
import { repairDetailInclude, repairListInclude } from "@/features/repairs/repair-repository";
import { uploadLimits } from "@/features/repairs/repair-photo-storage";
import { canAttachRepairPhotos } from "@/features/repairs/repair-policy";
import type { AuthorizedActor, RepairDetailView, RepairView } from "@/types/contracts";

type RepairListRow = Prisma.RepairRecordGetPayload<{ include: typeof repairListInclude }>;
type RepairDetailRow = Prisma.RepairRecordGetPayload<{ include: typeof repairDetailInclude }>;

/** 展示名回退链：昵称 → 真实姓名 → 账号显示名 → 「成员」。 */
function memberDisplayName(member: {
  nickname: string | null;
  realName: string | null;
  user: { displayName: string | null };
}): string {
  return member.nickname || member.realName || member.user.displayName || "成员";
}

/**
 * `ownerPhone` 的可见性按 fail-closed 处理：默认不下发完整号码（也不下发掩码值，
 * 值为 `null`）—— 只有归属人与 `repair:review` 持有者由调用方显式放行。
 * `ownerName` 在成员区内全站可见，不参与收口。
 */
export function toRepairView(
  record: RepairListRow,
  options: { canViewOwnerPhone?: boolean } = {},
): RepairView {
  const name = memberDisplayName(record.memberProfile);
  // 参与维修人员：`sort_order` 已保证创建人第一，这里再兜一层防御性重排，
  // 防止历史数据将来被人工修出「创建人不在首位」的显示异常。
  const participants = record.participants.map((row) => ({
    id: row.memberProfileId,
    name: memberDisplayName(row.memberProfile),
  }));
  const creatorIndex = participants.findIndex((item) => item.id === record.memberProfile.id);
  if (creatorIndex > 0) {
    participants.unshift(participants.splice(creatorIndex, 1)[0]!);
  }
  return {
    id: record.id,
    member: { id: record.memberProfile.id, name },
    participants,
    repairDate: record.repairDate?.toISOString().slice(0, 10) ?? null,
    durationMinutes: record.durationMinutes,
    category: record.category
      ? {
          id: record.category.id,
          code: record.category.code,
          name: record.category.name,
          description: record.category.description,
          sortOrder: record.category.sortOrder,
          isActive: record.category.isActive,
        }
      : null,
    deviceModel: record.deviceModel,
    ownerName: record.ownerName,
    ownerPhone: options.canViewOwnerPhone === true ? record.ownerPhone : null,
    content: record.content,
    result: record.result as RepairView["result"],
    remark: record.remark,
    status: record.status as RepairView["status"],
    isDifficult: record.isDifficult,
    isTypical: record.isTypical,
    version: record.version,
    submittedAt: record.submittedAt?.toISOString() ?? null,
    reviewedAt: record.reviewedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    photos: record.photos.map((photo) => ({
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
    })),
  };
}

export function toRepairDetail(
  record: RepairDetailRow,
  actor: AuthorizedActor,
  options: { isFavorited?: boolean } = {},
): RepairDetailView {
  const owner = record.memberProfile.userId === actor.userId;
  return {
    ...toRepairView(record, {
      canViewOwnerPhone: owner || actor.permissions.includes("repair:review"),
    }),
    canEdit: owner && (record.status === "DRAFT" || record.status === "REJECTED"),
    /** 审核前补附件：DRAFT / REJECTED 或本人未审核的 PENDING。 */
    canAttachPhotos: canAttachRepairPhotos(actor, record),
    canReview: actor.permissions.includes("repair:review") && record.status === "PENDING",
    canFlag: actor.permissions.includes("repair:flag"),
    isFavorited: options.isFavorited === true,
    photoLimits: uploadLimits(),
    reviews: record.reviews.map((review) => ({
      id: review.id,
      decision: review.decision as "APPROVED" | "REJECTED",
      note: review.note,
      reviewerName: review.reviewer.displayName,
      createdAt: review.createdAt.toISOString(),
    })),
    timeline: record.timeline.map((event) => ({
      id: event.id,
      eventType: event.eventType as RepairDetailView["timeline"][number]["eventType"],
      summary: event.summary,
      actorName: event.actor?.displayName ?? null,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}
