import type {
  AuthorizedActor,
  FavoriteView,
  NotificationView,
  RepairCommentView,
} from "@/types/contracts";

type MemberNameSource = {
  id: string;
  nickname: string | null;
  realName: string;
  user?: { displayName: string | null } | null;
};

export function memberRef(row: MemberNameSource): { id: string; name: string } {
  return {
    id: row.id,
    name: row.nickname?.trim() || row.realName?.trim() || row.user?.displayName?.trim() || "成员",
  };
}

export function excerptText(content: string | null | undefined, limit = 60): string {
  const flat = (content ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return "未填写维修内容";
  const chars = [...flat];
  return chars.length > limit ? `${chars.slice(0, limit).join("")}…` : flat;
}

type CommentRow = {
  id: string;
  body: string;
  parentCommentId: string | null;
  createdAt: Date;
  authorMemberProfileId: string;
  author: MemberNameSource;
  mentions: Array<{ mentioned: MemberNameSource }>;
};

/**
 * `selfMemberProfileId` 允许为 `null`：管理员可能没有成员档案（纯管理员账号），
 * 此时「是不是我写的」恒为假，`canDelete` 退化为按权限判断。
 */
export function toCommentView(
  row: CommentRow,
  actor: AuthorizedActor,
  selfMemberProfileId: string | null,
): RepairCommentView {
  const author = memberRef(row.author);
  return {
    id: row.id,
    body: row.body,
    author,
    parentCommentId: row.parentCommentId,
    mentions: row.mentions.map((entry) => memberRef(entry.mentioned)),
    createdAt: row.createdAt.toISOString(),
    canDelete:
      (selfMemberProfileId !== null && row.authorMemberProfileId === selfMemberProfileId) ||
      actor.permissions.includes("comment:delete"),
    replies: [],
  };
}

type FavoriteRow = {
  id: string;
  createdAt: Date;
  repairRecordId: string;
  record: {
    repairDate: Date | null;
    content: string | null;
    isDifficult: boolean;
    isTypical: boolean;
    category: { name: string } | null;
    memberProfile: MemberNameSource;
  };
};

export function toFavoriteView(row: FavoriteRow): FavoriteView {
  return {
    id: row.id,
    repairRecordId: row.repairRecordId,
    repairDate: row.record.repairDate ? row.record.repairDate.toISOString().slice(0, 10) : null,
    categoryName: row.record.category?.name ?? null,
    contentExcerpt: excerptText(row.record.content),
    memberName: memberRef(row.record.memberProfile).name,
    isDifficult: row.record.isDifficult,
    isTypical: row.record.isTypical,
    createdAt: row.createdAt.toISOString(),
  };
}

type NotificationRow = {
  id: string;
  type: string;
  status: string;
  repairRecordId: string | null;
  commentId: string | null;
  createdAt: Date;
  readAt: Date | null;
  actor: MemberNameSource | null;
  record: { content: string | null } | null;
};

export function toNotificationView(row: NotificationRow): NotificationView {
  return {
    id: row.id,
    type: row.type as NotificationView["type"],
    status: row.status as NotificationView["status"],
    repairRecordId: row.repairRecordId,
    commentId: row.commentId,
    actor: row.actor ? memberRef(row.actor) : null,
    repairExcerpt: row.record ? excerptText(row.record.content) : null,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  };
}
