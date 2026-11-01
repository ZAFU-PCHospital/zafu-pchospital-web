import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";

import { maskActivityPhone } from "@/features/repair-activities/phone-mask";
import {
  canCheckInRegistration,
  assertActivityStaffOpen,
  canServeRegistration,
  canWithdrawRegistration,
  deriveRepairActivityStatus,
  EFFECTIVE_REGISTRATION_STATUSES,
  mapIssueTypeToCategoryCode,
  remainingCapacity,
  repairActivityIssueTypeLabels,
  shanghaiCalendarDay,
  sortQueueByCheckedInAt,
  type RepairActivityIssueType,
  type RepairActivityStatus,
  assertValidIssueType,
  validateCheckInIssueTypeUpdates,
  type StaffCheckInIssueTypeUpdate,
} from "@/features/repair-activities/repair-activity-validation";
import { resolveDisplayName } from "@/features/analytics/analytics-policy";
import { createServedRepairRecord } from "@/features/repairs/repair-service";
import { localRepairPhotoStorage } from "@/features/repairs/repair-photo-storage";
import { repairRepository } from "@/features/repairs/repair-repository";
import { toRepairView } from "@/features/repairs/repair-view";
import { AppError } from "@/lib/api/errors";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { requirePermission } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import type {
  AuthorizedActor,
  RepairDraftFields,
  RepairMemberOption,
  RepairStatus,
  RepairView,
} from "@/types/contracts";

export type StaffActivityListItem = {
  id: string;
  title: string;
  activityAt: string;
  capacity: number;
  signupOpensAt: string;
  signupClosesAt: string;
  status: RepairActivityStatus;
  registeredCount: number;
  remaining: number;
  attended: boolean;
};

export type StaffRegistrationView = {
  id: string;
  activityId: string;
  name: string;
  phoneMasked: string;
  issueType: RepairActivityIssueType;
  issueTypeLabel: string;
  /** 机型，选填：接待落单时随维修记录一起带过去。 */
  deviceModel: string | null;
  status: string;
  checkedInAt: string | null;
  servedAt: string | null;
  repairRecordId: string | null;
  createdAt: string;
};

/** 已接待行：报名视图 + 对应维修单状态（`null` = 记录缺失、已软删除或尚未建单）。 */
export type StaffServedRow = StaffRegistrationView & {
  recordStatus: RepairStatus | null;
  /** 当前操作者能否撤销这次接待：未建单，且是接待者本人或活动管理员。 */
  canRevert: boolean;
  /** 只有接待者本人、且还没建单时才能「继续填写」。 */
  canFill: boolean;
};

/** 待补建的接待：登记已接待，但维修单还没创建。 */
export type StaffPendingServe = {
  registrationId: string;
  name: string;
  activityId: string;
  activityTitle: string;
};

/** 存量接待草稿撤销时会删除未提交草稿及照片。 */
export type RevertServeResultView = {
  registration: StaffRegistrationView;
  deletedRecordId?: string;
};

/**
 * 出勤成员条目：只下发展示名与签到时间，
 * 不含 QQ、手机号、学号等身份字段。
 */
export type StaffAttendanceMemberView = {
  memberProfileId: string;
  name: string;
  checkedInAt: string;
};

export type StaffBoardView = {
  activity: StaffActivityListItem;
  attended: boolean;
  attendanceCheckedInAt: string | null;
  /**
   * 当前账号是否具备活动管理员权限（`activity:admin`）：
   * 决定「待签到」区与「撤回」按钮的可见性；签到 / 撤回接口同样只对管理员开放。
   */
  canAdmin: boolean;
  /**
   * 本场出勤成员（按签到时间升序）。仅对管理员下发，
   * 成员恒为空数组（数据最小化）。
   */
  attendanceMembers: StaffAttendanceMemberView[];
  /** 可签到（REGISTERED）。仅对管理员下发，成员恒为空数组（数据最小化）。 */
  eligible: StaffRegistrationView[];
  /** 排队（CHECKED_IN，按 checkedInAt ASC） */
  queue: StaffRegistrationView[];
  /** 本场已接待（按 servedAt 倒序）；常驻区块的数据来源。 */
  served: StaffServedRow[];
  /** 全局拦截：本成员存在「已接待但未建单」的登记时非 null。 */
  pendingServeRegistration: StaffPendingServe | null;
};

/** 高频快照不携带低频明细；计数始终遵循当前角色的可见范围。 */
export type StaffLiveBoardView = Omit<StaffBoardView, "served" | "attendanceMembers"> & {
  servedCount: number;
  attendanceCount: number | null;
};
export type StaffServedBoardView = { served: StaffServedRow[] };
export type StaffAttendanceBoardView = { attendanceMembers: StaffAttendanceMemberView[] };

const registrationSelect = {
  id: true,
  activityId: true,
  name: true,
  phone: true,
  issueType: true,
  deviceModel: true,
  status: true,
  checkedInAt: true,
  servedAt: true,
  repairRecordId: true,
  createdAt: true,
} as const;
const servedRecordSelect = { id: true, status: true, submittedAt: true, deletedAt: true } as const;
type ServedRegistration = Prisma.RepairActivityRegistrationGetPayload<{
  include: { repairRecord: { select: typeof servedRecordSelect } };
}>;

function servedRows(
  rows: ServedRegistration[],
  memberId: string,
  canAdmin: boolean,
): StaffServedRow[] {
  return rows
    .filter(
      (row) => row.status === "SERVED" && (canAdmin || row.servedByMemberProfileId === memberId),
    )
    .sort((a, b) => (b.servedAt?.getTime() ?? 0) - (a.servedAt?.getTime() ?? 0))
    .map((row) => {
      const recordStatus =
        row.repairRecord && !row.repairRecord.deletedAt
          ? (row.repairRecord.status as RepairStatus)
          : null;
      const pendingRecord = row.repairRecordId === null;
      const legacyDraft =
        row.repairRecordId !== null && recordStatus === "DRAFT" && !row.repairRecord?.submittedAt;
      return {
        ...toStaffReg(row),
        recordStatus,
        canRevert:
          (pendingRecord || legacyDraft) && (canAdmin || row.servedByMemberProfileId === memberId),
        canFill: pendingRecord && row.servedByMemberProfileId === memberId,
      };
    });
}

export type ServeResultView = {
  registration: StaffRegistrationView;
};

/** 继续填写时从登记行 / 活动预填的字段：完整电话只下发给接待者本人。 */
export type ServePrefillView = {
  registrationId: string;
  activityId: string;
  activityTitle: string;
  name: string;
  phone: string;
  deviceModel: string | null;
  issueType: RepairActivityIssueType;
  categoryId: string | null;
  repairDate: string;
  /**
   * 参与维修人员候选：仅本场出勤且 ACTIVE 的成员，按出勤时间升序。
   * 姓名与昵称一并下发供搜索，不含 QQ、手机号、学号等身份字段。
   */
  participantOptions: RepairMemberOption[];
};

const effectiveStatusFilter = {
  deletedAt: null as null,
  status: { in: [...EFFECTIVE_REGISTRATION_STATUSES] },
};

function toStaffReg(row: {
  id: string;
  activityId: string;
  name: string;
  phone: string;
  issueType: string;
  deviceModel: string | null;
  status: string;
  checkedInAt: Date | null;
  servedAt: Date | null;
  repairRecordId: string | null;
  createdAt: Date;
}): StaffRegistrationView {
  const issueType = assertValidIssueType(row.issueType);
  return {
    id: row.id,
    activityId: row.activityId,
    name: row.name,
    phoneMasked: maskActivityPhone(row.phone),
    issueType,
    issueTypeLabel: repairActivityIssueTypeLabels[issueType],
    deviceModel: row.deviceModel,
    status: row.status,
    checkedInAt: row.checkedInAt?.toISOString() ?? null,
    servedAt: row.servedAt?.toISOString() ?? null,
    repairRecordId: row.repairRecordId,
    createdAt: row.createdAt.toISOString(),
  };
}

async function requireStaffMember(actor: AuthorizedActor) {
  requirePermission(actor, "activity:staff");
  return repairRepository.activeMemberForUser(actor.userId);
}

/** 签到 / 撤回收紧为活动管理员：权限之外仍要求有效成员档案。 */
async function requireAdminMember(actor: AuthorizedActor) {
  requirePermission(actor, "activity:admin");
  return repairRepository.activeMemberForUser(actor.userId);
}

async function loadActivityOrThrow(activityId: string) {
  const activity = await getDb().repairActivity.findFirst({
    where: { id: activityId, deletedAt: null },
  });
  if (!activity) throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
  return activity;
}

/** 活动锁后读最新窗口并取时；每次事务重试重新判断，避免改期与等锁越界。 */
async function requireStaffOpen(tx: Prisma.TransactionClient, activityId: string) {
  await tx.$queryRaw`SELECT id FROM repair_activities WHERE id = ${activityId} FOR UPDATE`;
  const activity = await tx.repairActivity.findFirst({
    where: { id: activityId, deletedAt: null },
  });
  if (!activity) throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
  const now = new Date();
  assertActivityStaffOpen(activity, now);
  return { activity, now };
}

async function requireAttendance(
  activityId: string,
  memberProfileId: string,
): Promise<{ id: string; checkedInAt: Date }> {
  const attendance = await getDb().repairActivityAttendance.findUnique({
    where: {
      activityId_memberProfileId: { activityId, memberProfileId },
    },
  });
  if (!attendance) {
    throw new AppError("ACTIVITY_ATTENDANCE_REQUIRED", "请先完成本场出勤后再操作");
  }
  return attendance;
}

async function countEffective(activityId: string): Promise<number> {
  return getDb().repairActivityRegistration.count({
    where: { activityId, ...effectiveStatusFilter },
  });
}

/**
 * 「已接待但未建单」判据（看板与 serve 拦截共用）。
 *
 * 接待只占登记行（`SERVED` + 接待人），维修单在成员提交时才创建；
 * `repairRecordId` 为空即表示这次接待还没有补建维修记录。
 */
function pendingServeWhere(memberProfileId: string) {
  return {
    status: "SERVED" as const,
    servedByMemberProfileId: memberProfileId,
    repairRecordId: null,
    deletedAt: null,
  };
}

async function findPendingServe(memberProfileId: string): Promise<StaffPendingServe | null> {
  const registration = await getDb().repairActivityRegistration.findFirst({
    where: pendingServeWhere(memberProfileId),
    orderBy: [{ servedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      name: true,
      activityId: true,
      activity: { select: { title: true } },
    },
  });
  if (!registration) return null;
  return {
    registrationId: registration.id,
    name: registration.name,
    activityId: registration.activityId,
    activityTitle: registration.activity.title,
  };
}

function toListItem(
  row: {
    id: string;
    title: string;
    activityAt: Date;
    capacity: number;
    signupOpensAt: Date;
    signupClosesAt: Date;
  },
  registeredCount: number,
  attended: boolean,
  now: Date,
): StaffActivityListItem {
  const status = deriveRepairActivityStatus({
    now,
    activityAt: row.activityAt,
    signupOpensAt: row.signupOpensAt,
    signupClosesAt: row.signupClosesAt,
    effectiveRegistrationCount: registeredCount,
    capacity: row.capacity,
  });
  return {
    id: row.id,
    title: row.title,
    activityAt: row.activityAt.toISOString(),
    capacity: row.capacity,
    signupOpensAt: row.signupOpensAt.toISOString(),
    signupClosesAt: row.signupClosesAt.toISOString(),
    status,
    registeredCount,
    remaining: remainingCapacity(row.capacity, registeredCount),
    attended,
  };
}

export const repairActivityStaffService = {
  async getRegistrationPhone(
    activityId: string,
    registrationId: string,
    actor: AuthorizedActor,
  ): Promise<{ phone: string }> {
    await requireStaffMember(actor);
    return inSerializableTransaction(async (tx) => {
      const activity = await tx.repairActivity.findFirst({
        where: { id: activityId, deletedAt: null },
        select: { id: true },
      });
      if (!activity) throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
      const registration = await tx.repairActivityRegistration.findFirst({
        where: { id: registrationId, activityId, ...effectiveStatusFilter },
        select: { id: true, phone: true },
      });
      if (!registration) {
        throw new AppError("ACTIVITY_REGISTRATION_NOT_FOUND", "报名不存在");
      }
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair_activity.registration_phone.viewed",
        targetType: "RepairActivityRegistration",
        targetId: registration.id,
        result: "SUCCESS",
        after: { activityId },
      });
      return { phone: registration.phone };
    });
  },

  async listForStaff(actor: AuthorizedActor): Promise<StaffActivityListItem[]> {
    const member = await requireStaffMember(actor);
    const now = new Date();
    const rows = await getDb().repairActivity.findMany({
      where: { deletedAt: null },
      orderBy: [{ activityAt: "asc" }, { createdAt: "asc" }],
    });
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const [countGroups, attendances] = await Promise.all([
      getDb().repairActivityRegistration.groupBy({
        by: ["activityId"],
        where: { activityId: { in: ids }, ...effectiveStatusFilter },
        _count: { _all: true },
      }),
      getDb().repairActivityAttendance.findMany({
        where: { activityId: { in: ids }, memberProfileId: member.id },
        select: { activityId: true },
      }),
    ]);
    const counts = new Map(countGroups.map((g) => [g.activityId, g._count._all]));
    const attendedSet = new Set(attendances.map((a) => a.activityId));
    return rows.map((row) =>
      toListItem(row, counts.get(row.id) ?? 0, attendedSet.has(row.id), now),
    );
  },

  async markAttendance(
    activityId: string,
    actor: AuthorizedActor,
  ): Promise<{ attended: boolean; checkedInAt: string }> {
    const member = await requireStaffMember(actor);
    await loadActivityOrThrow(activityId);

    return inSerializableTransaction(async (tx) => {
      const { now } = await requireStaffOpen(tx, activityId);
      const existing = await tx.repairActivityAttendance.findUnique({
        where: {
          activityId_memberProfileId: { activityId, memberProfileId: member.id },
        },
      });
      if (existing) {
        return { attended: true, checkedInAt: existing.checkedInAt.toISOString() };
      }
      const created = await tx.repairActivityAttendance.create({
        data: {
          id: randomUUID(),
          activityId,
          memberProfileId: member.id,
          checkedInAt: now,
        },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair_activity.attendance_marked",
        targetType: "RepairActivityAttendance",
        targetId: created.id,
        result: "SUCCESS",
        after: { activityId, memberProfileId: member.id },
      });
      return { attended: true, checkedInAt: created.checkedInAt.toISOString() };
    });
  },

  async getLiveBoard(activityId: string, actor: AuthorizedActor): Promise<StaffLiveBoardView> {
    const member = await requireStaffMember(actor);
    const canAdmin = actor.permissions.includes("activity:admin");
    const activity = await loadActivityOrThrow(activityId);
    const [counts, attendance, registrations, pendingServe, attendanceCount, ownServedCount] =
      await Promise.all([
        getDb().repairActivityRegistration.groupBy({
          by: ["status"],
          where: { activityId, ...effectiveStatusFilter },
          _count: { _all: true },
        }),
        getDb().repairActivityAttendance.findUnique({
          where: { activityId_memberProfileId: { activityId, memberProfileId: member.id } },
          select: { checkedInAt: true },
        }),
        getDb().repairActivityRegistration.findMany({
          where: {
            activityId,
            deletedAt: null,
            status: canAdmin ? { in: ["REGISTERED", "CHECKED_IN"] } : "CHECKED_IN",
          },
          select: registrationSelect,
        }),
        findPendingServe(member.id),
        canAdmin
          ? getDb().repairActivityAttendance.count({ where: { activityId } })
          : Promise.resolve(null),
        canAdmin
          ? Promise.resolve(null)
          : getDb().repairActivityRegistration.count({
              where: {
                activityId,
                deletedAt: null,
                status: "SERVED",
                servedByMemberProfileId: member.id,
              },
            }),
      ]);
    const registeredCount = counts.reduce((sum, row) => sum + row._count._all, 0);
    return {
      activity: toListItem(activity, registeredCount, Boolean(attendance), new Date()),
      attended: Boolean(attendance),
      attendanceCheckedInAt: attendance?.checkedInAt.toISOString() ?? null,
      canAdmin,
      attendanceCount,
      servedCount: canAdmin
        ? (counts.find((row) => row.status === "SERVED")?._count._all ?? 0)
        : ownServedCount!,
      eligible: canAdmin
        ? registrations
            .filter((row) => row.status === "REGISTERED")
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            .map(toStaffReg)
        : [],
      queue: sortQueueByCheckedInAt(registrations.filter((row) => row.status === "CHECKED_IN")).map(
        toStaffReg,
      ),
      pendingServeRegistration: pendingServe,
    };
  },

  async getServedBoard(activityId: string, actor: AuthorizedActor): Promise<StaffServedBoardView> {
    const member = await requireStaffMember(actor);
    const canAdmin = actor.permissions.includes("activity:admin");
    await loadActivityOrThrow(activityId);
    const rows = await getDb().repairActivityRegistration.findMany({
      where: {
        activityId,
        deletedAt: null,
        status: "SERVED",
        ...(canAdmin ? {} : { servedByMemberProfileId: member.id }),
      },
      include: { repairRecord: { select: servedRecordSelect } },
    });
    return { served: servedRows(rows, member.id, canAdmin) };
  },

  async getAttendanceBoard(
    activityId: string,
    actor: AuthorizedActor,
  ): Promise<StaffAttendanceBoardView> {
    await requireAdminMember(actor);
    await loadActivityOrThrow(activityId);
    const rows = await getDb().repairActivityAttendance.findMany({
      where: { activityId },
      orderBy: [{ checkedInAt: "asc" }, { id: "asc" }],
      select: {
        memberProfileId: true,
        checkedInAt: true,
        memberProfile: {
          select: { nickname: true, realName: true, user: { select: { displayName: true } } },
        },
      },
    });
    return {
      attendanceMembers: rows.map((row) => ({
        memberProfileId: row.memberProfileId,
        name: resolveDisplayName({
          nickname: row.memberProfile.nickname,
          realName: row.memberProfile.realName,
          displayName: row.memberProfile.user.displayName,
        }),
        checkedInAt: row.checkedInAt.toISOString(),
      })),
    };
  },

  async getBoard(activityId: string, actor: AuthorizedActor): Promise<StaffBoardView> {
    const member = await requireStaffMember(actor);
    const canAdmin = actor.permissions.includes("activity:admin");
    const activity = await loadActivityOrThrow(activityId);
    const now = new Date();
    const [memberCount, attendance, registrations, pendingServe, attendanceRows] =
      await Promise.all([
        // 管理员会读取全部有效报名，可直接计数；成员仍只在库层取排队/已接待的资料。
        canAdmin ? Promise.resolve(null) : countEffective(activityId),
        canAdmin
          ? Promise.resolve(null)
          : getDb().repairActivityAttendance.findUnique({
              where: {
                activityId_memberProfileId: { activityId, memberProfileId: member.id },
              },
            }),
        getDb().repairActivityRegistration.findMany({
          where: {
            activityId,
            deletedAt: null,
            // 成员只取「排队 + **本人**接待」：他人接待的客户资料（含脱敏
            // 电话与记录状态）在库层就不进入成员请求，而不是前端隐藏。管理员仍是全部有效报名。
            ...(canAdmin
              ? { status: { in: [...EFFECTIVE_REGISTRATION_STATUSES] } }
              : {
                  OR: [
                    { status: "CHECKED_IN" },
                    { status: "SERVED", servedByMemberProfileId: member.id },
                  ],
                }),
          },
          include: {
            repairRecord: {
              select: { id: true, status: true, submittedAt: true, deletedAt: true },
            },
          },
        }),
        findPendingServe(member.id),
        // 出勤名单仅管理员视图需要；成员在库层就不取。
        canAdmin
          ? getDb().repairActivityAttendance.findMany({
              where: { activityId },
              orderBy: [{ checkedInAt: "asc" }, { id: "asc" }],
              select: {
                memberProfileId: true,
                checkedInAt: true,
                memberProfile: {
                  select: {
                    nickname: true,
                    realName: true,
                    user: { select: { displayName: true } },
                  },
                },
              },
            })
          : Promise.resolve([]),
      ]);

    const registeredCount = canAdmin ? registrations.length : memberCount!;
    const ownAttendance = canAdmin
      ? attendanceRows.find((row) => row.memberProfileId === member.id)
      : attendance;

    const eligible = canAdmin
      ? registrations
          .filter((r) => r.status === "REGISTERED")
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(toStaffReg)
      : [];

    const queue = sortQueueByCheckedInAt(
      registrations.filter((r) => r.status === "CHECKED_IN"),
    ).map(toStaffReg);

    const served = servedRows(registrations, member.id, canAdmin);

    const attendanceMembers: StaffAttendanceMemberView[] = attendanceRows.map((row) => ({
      memberProfileId: row.memberProfileId,
      name: resolveDisplayName({
        nickname: row.memberProfile.nickname,
        realName: row.memberProfile.realName,
        displayName: row.memberProfile.user.displayName,
      }),
      checkedInAt: row.checkedInAt.toISOString(),
    }));

    return {
      activity: toListItem(activity, registeredCount, Boolean(ownAttendance), now),
      attended: Boolean(ownAttendance),
      attendanceCheckedInAt: ownAttendance?.checkedInAt.toISOString() ?? null,
      canAdmin,
      attendanceMembers,
      eligible,
      queue,
      served,
      pendingServeRegistration: pendingServe,
    };
  },

  async checkIn(
    activityId: string,
    registrationIds: string[],
    actor: AuthorizedActor,
    issueTypeUpdates: StaffCheckInIssueTypeUpdate[] = [],
  ): Promise<{ checkedIn: StaffRegistrationView[] }> {
    const member = await requireAdminMember(actor);
    await loadActivityOrThrow(activityId);
    await requireAttendance(activityId, member.id);

    const uniqueIds = [...new Set(registrationIds.map((id) => id.trim()).filter(Boolean))];
    if (uniqueIds.length === 0) {
      throw new AppError("VALIDATION_FAILED", "请至少选择一条报名记录", {
        fieldErrors: { registrationIds: ["请至少选择一条"] },
      });
    }
    if (uniqueIds.length > 100) {
      throw new AppError("VALIDATION_FAILED", "单次最多签到 100 条");
    }
    const updates = new Map(
      validateCheckInIssueTypeUpdates(issueTypeUpdates, uniqueIds).map((item) => [
        item.registrationId,
        item.issueType,
      ]),
    );

    return inSerializableTransaction(async (tx) => {
      const { now } = await requireStaffOpen(tx, activityId);
      const checkedIn: StaffRegistrationView[] = [];

      for (const registrationId of uniqueIds) {
        const reg = await tx.repairActivityRegistration.findFirst({
          where: { id: registrationId, activityId, deletedAt: null },
        });
        if (!reg) {
          throw new AppError("ACTIVITY_REGISTRATION_NOT_FOUND", "报名记录不存在");
        }
        if (reg.status === "CHECKED_IN") {
          if (updates.has(registrationId) && updates.get(registrationId) !== reg.issueType) {
            throw new AppError(
              "ACTIVITY_REGISTRATION_STATE_INVALID",
              "已入队客户不可在签到重试中修改故障类型",
            );
          }
          checkedIn.push(toStaffReg(reg));
          continue;
        }
        if (!canCheckInRegistration(reg.status)) {
          throw new AppError(
            "ACTIVITY_REGISTRATION_STATE_INVALID",
            `报名「${reg.name}」当前状态不可签到`,
          );
        }
        const updated = await tx.repairActivityRegistration.update({
          where: { id: registrationId },
          data: {
            status: "CHECKED_IN",
            checkedInAt: now,
            ...(updates.has(registrationId) ? { issueType: updates.get(registrationId) } : {}),
          },
        });
        if (updated.issueType !== reg.issueType) {
          await appendAuditLog(tx, {
            actor,
            actorType: "USER",
            actorUserId: actor.userId,
            action: "repair_activity.registration_issue_type_updated",
            targetType: "RepairActivityRegistration",
            targetId: registrationId,
            result: "SUCCESS",
            before: { issueType: reg.issueType },
            after: { issueType: updated.issueType },
          });
        }
        checkedIn.push(toStaffReg(updated));
      }

      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair_activity.registrations_checked_in",
        targetType: "RepairActivity",
        targetId: activityId,
        result: "SUCCESS",
        after: {
          registrationIds: checkedIn.map((r) => r.id),
          memberProfileId: member.id,
        },
      });
      return { checkedIn };
    });
  },

  async withdraw(
    activityId: string,
    registrationId: string,
    actor: AuthorizedActor,
  ): Promise<StaffRegistrationView> {
    const member = await requireAdminMember(actor);
    await loadActivityOrThrow(activityId);
    await requireAttendance(activityId, member.id);
    if (!registrationId.trim()) {
      throw new AppError("VALIDATION_FAILED", "报名 ID 无效");
    }

    return inSerializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repair_activities WHERE id = ${activityId} FOR UPDATE`;
      const reg = await tx.repairActivityRegistration.findFirst({
        where: { id: registrationId, activityId, deletedAt: null },
      });
      if (!reg) {
        throw new AppError("ACTIVITY_REGISTRATION_NOT_FOUND", "报名记录不存在");
      }
      if (reg.status === "SERVED") {
        throw new AppError("ACTIVITY_REGISTRATION_STATE_INVALID", "已接待的报名不可撤回");
      }
      if (!canWithdrawRegistration(reg.status)) {
        throw new AppError("ACTIVITY_REGISTRATION_STATE_INVALID", "当前状态不可撤回排队");
      }
      const updated = await tx.repairActivityRegistration.update({
        where: { id: registrationId },
        data: { status: "REGISTERED", checkedInAt: null },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair_activity.registration_withdrawn",
        targetType: "RepairActivityRegistration",
        targetId: registrationId,
        result: "SUCCESS",
        before: { status: "CHECKED_IN" },
        after: { status: "REGISTERED", memberProfileId: member.id },
      });
      return toStaffReg(updated);
    });
  },

  /**
   * 撤销接待：把接错客户的已接待报名恢复成接待前状态。
   *
   * - 新流程（登记未建单）：直接恢复，没有维修记录 / 照片需要删除；
   * - **旧数据过渡**（之前的接待草稿，登记仍关联 `repairRecordId`）：保留原撤销能力，
   *   仅当记录仍是 `DRAFT` 且未提交时删除草稿及照片，并清理评论 / 收藏 / 通知；
   *   已提交 / 已审核 / 已撤回的接待不能撤销（属于审核流程）。
   *
   * 权限：接待者本人或活动管理员（`activity:admin`）。每一步都写审计。
   */
  async revertServe(
    activityId: string,
    registrationId: string,
    actor: AuthorizedActor,
  ): Promise<RevertServeResultView> {
    const member = await requireStaffMember(actor);
    await loadActivityOrThrow(activityId);
    if (!registrationId.trim()) {
      throw new AppError("VALIDATION_FAILED", "报名 ID 无效");
    }
    const isAdmin = actor.permissions.includes("activity:admin");
    const { cleanup, ...result } = await inSerializableTransaction(async (tx) => {
      const reg = await tx.repairActivityRegistration.findFirst({
        where: { id: registrationId, activityId, deletedAt: null },
      });
      if (!reg) throw new AppError("ACTIVITY_REGISTRATION_NOT_FOUND", "报名记录不存在");
      if (reg.status !== "SERVED")
        throw new AppError("ACTIVITY_REGISTRATION_STATE_INVALID", "该报名当前不是已接待状态");
      if (!isAdmin && reg.servedByMemberProfileId !== member.id)
        throw new AppError("FORBIDDEN", "只有接待者本人或活动管理员可以撤销接待");

      // 接待前的具体状态没有单独留存，用「是否签过到」还原：签过到回排队，否则回待签到。
      const restoredStatus = reg.checkedInAt ? "CHECKED_IN" : "REGISTERED";
      let deleted: {
        id: string;
        photos: number;
        comments: number;
        favorites: number;
        notifications: number;
      } | null = null;
      let cleanup: { recordId: string | null; keys: string[] } = { recordId: null, keys: [] };

      if (reg.repairRecordId) {
        const record = await tx.repairRecord.findFirst({
          where: { id: reg.repairRecordId, deletedAt: null },
          select: { id: true, status: true, submittedAt: true },
        });
        // 已撤回审核的草稿（submittedAt 非空）曾进入审核流程，不允许按「撤销接待」整条删除。
        if (!record || record.status !== "DRAFT" || record.submittedAt)
          throw new AppError(
            "ACTIVITY_REGISTRATION_STATE_INVALID",
            "维修记录已提交或不存在，不能撤销接待",
          );
        const photos = await tx.repairPhoto.findMany({
          where: { repairRecordId: record.id },
          select: { storageKey: true, thumbnailKey: true },
        });
        // 社区与通知子表以 RESTRICT 引用记录：作者能读自己的 DRAFT，就可能留下
        // 评论 / 收藏 / 通知，不先清掉删记录会撞外键、把撤销打成 500。
        const commentIds = (
          await tx.repairComment.findMany({
            where: { repairRecordId: record.id },
            select: { id: true },
          })
        ).map((row) => row.id);
        const favoritesDeleted = await tx.repairFavorite.deleteMany({
          where: { repairRecordId: record.id },
        });
        const notificationsDeleted = await tx.notification.deleteMany({
          where: { OR: [{ repairRecordId: record.id }, { commentId: { in: commentIds } }] },
        });
        await tx.commentMention.deleteMany({ where: { commentId: { in: commentIds } } });
        const repliesDeleted = await tx.repairComment.deleteMany({
          where: { repairRecordId: record.id, parentCommentId: { not: null } },
        });
        const topCommentsDeleted = await tx.repairComment.deleteMany({
          where: { repairRecordId: record.id },
        });
        // 先解除登记对草稿的 RESTRICT 外键，再按外键顺序硬删草稿子表。
        await tx.repairActivityRegistration.update({
          where: { id: reg.id },
          data: { repairRecordId: null },
        });
        await tx.repairRecordParticipant.deleteMany({ where: { repairRecordId: record.id } });
        await tx.repairPhoto.deleteMany({ where: { repairRecordId: record.id } });
        await tx.repairTimelineEvent.deleteMany({ where: { repairRecordId: record.id } });
        await tx.repairRecord.delete({ where: { id: record.id } });
        // 事务只返回最终成功结果的文件键；重试时不会把已回滚尝试写入的键也删掉。
        cleanup = {
          recordId: record.id,
          keys: [
            ...new Set(
              photos
                .flatMap((photo) => [photo.storageKey, photo.thumbnailKey])
                .filter((key): key is string => Boolean(key)),
            ),
          ],
        };
        deleted = {
          id: record.id,
          photos: photos.length,
          comments: repliesDeleted.count + topCommentsDeleted.count,
          favorites: favoritesDeleted.count,
          notifications: notificationsDeleted.count,
        };
      }

      const updated = await tx.repairActivityRegistration.update({
        where: { id: reg.id },
        data: {
          status: restoredStatus,
          servedAt: null,
          servedByMemberProfileId: null,
          repairRecordId: null,
        },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair_activity.registration_serve_reverted",
        targetType: "RepairActivityRegistration",
        targetId: reg.id,
        result: "SUCCESS",
        before: deleted ? { status: "SERVED", repairRecordId: deleted.id } : { status: "SERVED" },
        after: {
          status: restoredStatus,
          memberProfileId: member.id,
          ...(deleted
            ? {
                deletedRecordId: deleted.id,
                photosDeleted: deleted.photos,
                commentsDeleted: deleted.comments,
                favoritesDeleted: deleted.favorites,
                notificationsDeleted: deleted.notifications,
              }
            : {}),
        },
      });
      return {
        registration: toStaffReg(updated),
        ...(deleted ? { deletedRecordId: deleted.id } : {}),
        cleanup,
      };
    });
    // 事务提交后再删磁盘文件：回滚时不会删掉仍被引用的照片。
    await Promise.all(
      cleanup.keys.map((key) =>
        localRepairPhotoStorage.delete(key).catch((error) => {
          console.error(
            `[repairs] 撤销接待清理照片失败 record=${cleanup.recordId ?? "none"} key=${key}`,
            error,
          );
        }),
      ),
    );
    return result;
  },

  /**
   * 「继续填写」的预填：接待者本人从登记行 / 活动读取表单初始值。
   *
   * 只有「已接待且未建单」的登记可读；完整电话沿用按需查看审计
   * （`repair_activity.registration_phone.viewed`）。
   *
   * 同时下发本场出勤且在职的参与人候选，供接待建单的成员选择器
   * 按姓名 / 昵称搜索；不再让该场景使用全局成员名册。
   */
  async getServePrefill(
    activityId: string,
    registrationId: string,
    actor: AuthorizedActor,
  ): Promise<ServePrefillView> {
    const member = await requireStaffMember(actor);
    const activity = await loadActivityOrThrow(activityId);
    if (!registrationId.trim()) {
      throw new AppError("VALIDATION_FAILED", "报名 ID 无效");
    }
    return inSerializableTransaction(async (tx) => {
      const reg = await tx.repairActivityRegistration.findFirst({
        where: { id: registrationId, activityId, deletedAt: null },
      });
      if (!reg) throw new AppError("ACTIVITY_REGISTRATION_NOT_FOUND", "报名记录不存在");
      if (reg.status !== "SERVED" || reg.servedByMemberProfileId !== member.id)
        throw new AppError("FORBIDDEN", "只有接待者本人可以继续填写");
      if (reg.repairRecordId)
        throw new AppError("ACTIVITY_REGISTRATION_STATE_INVALID", "这条接待已创建维修单");

      const issueType = assertValidIssueType(reg.issueType);
      const categoryCode = mapIssueTypeToCategoryCode(issueType);
      const category = await tx.repairCategory.findFirst({
        where: { code: categoryCode, deletedAt: null, isActive: true },
        select: { id: true },
      });
      const attendanceRows = await tx.repairActivityAttendance.findMany({
        where: {
          activityId,
          // 候选必须能作为新增参与人落库：停用 / 软删除的成员即使出勤也不列出。
          memberProfile: { status: "ACTIVE", deletedAt: null },
        },
        orderBy: [{ checkedInAt: "asc" }, { id: "asc" }],
        select: {
          memberProfileId: true,
          memberProfile: {
            select: {
              realName: true,
              nickname: true,
              user: { select: { displayName: true } },
            },
          },
        },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: actor.actorType,
        actorUserId: actor.userId,
        action: "repair_activity.registration_phone.viewed",
        targetType: "RepairActivityRegistration",
        targetId: reg.id,
        result: "SUCCESS",
        after: { activityId },
      });
      return {
        registrationId: reg.id,
        activityId: reg.activityId,
        activityTitle: activity.title,
        name: reg.name,
        phone: reg.phone,
        deviceModel: reg.deviceModel,
        issueType,
        categoryId: category?.id ?? null,
        repairDate: shanghaiCalendarDay(activity.activityAt),
        participantOptions: attendanceRows.map((row) => ({
          id: row.memberProfileId,
          name: resolveDisplayName({
            nickname: row.memberProfile.nickname,
            realName: row.memberProfile.realName,
            displayName: row.memberProfile.user.displayName,
          }),
          realName: row.memberProfile.realName,
          nickname: row.memberProfile.nickname,
        })),
      };
    });
  },

  /**
   * 提交即建单：接待者本人补完表单后，创建 PENDING 维修记录并关联登记。
   *
   * 不落草稿：整个「建记录 + 参与人 + 时间线 + 关联登记」在一条事务里，
   * 并发 / 重试由 `createServedRepairRecord` 的行锁与幂等键兜底。
   */
  async createServeRecord(
    activityId: string,
    registrationId: string,
    input: { idempotencyKey: string; fields: RepairDraftFields },
    actor: AuthorizedActor,
  ): Promise<RepairView> {
    const member = await requireStaffMember(actor);
    await loadActivityOrThrow(activityId);
    if (!registrationId.trim()) {
      throw new AppError("VALIDATION_FAILED", "报名 ID 无效");
    }
    const key = input.idempotencyKey.trim();
    if (!key || key.length > 128) throw new AppError("VALIDATION_FAILED", "Idempotency-Key 无效");
    const record = await inSerializableTransaction((tx) =>
      createServedRepairRecord(
        tx,
        {
          memberProfileId: member.id,
          activityId,
          registrationId,
          idempotencyKey: key,
          fields: input.fields,
        },
        actor,
        new Date(),
      ),
    );
    return toRepairView(record, { canViewOwnerPhone: true });
  },

  async serve(
    activityId: string,
    registrationId: string,
    actor: AuthorizedActor,
  ): Promise<ServeResultView> {
    const member = await requireStaffMember(actor);
    await loadActivityOrThrow(activityId);
    await requireAttendance(activityId, member.id);
    if (!registrationId.trim()) {
      throw new AppError("VALIDATION_FAILED", "报名 ID 无效");
    }

    return inSerializableTransaction(async (tx) => {
      const { now } = await requireStaffOpen(tx, activityId);
      const reg = await tx.repairActivityRegistration.findFirst({
        where: { id: registrationId, activityId, deletedAt: null },
      });
      if (!reg) {
        throw new AppError("ACTIVITY_REGISTRATION_NOT_FOUND", "报名记录不存在");
      }
      if (!canServeRegistration(reg.status)) {
        throw new AppError("ACTIVITY_REGISTRATION_STATE_INVALID", "仅排队中的报名可接待");
      }

      // 全局拦截（按登记行判定）：本成员存在已接待但
      // 还没建单的客户时，任何活动都不能再接单。客户端已先行拦截，这里是并发兜底。
      const pending = await tx.repairActivityRegistration.findFirst({
        where: pendingServeWhere(member.id),
        select: { name: true },
      });
      if (pending) {
        throw new AppError(
          "ACTIVITY_SERVE_PENDING",
          `有已接待但还没建单的客户（「${pending.name}」），请先填写并提交后再接待下一位。`,
        );
      }

      const updated = await tx.repairActivityRegistration.update({
        where: { id: registrationId },
        data: {
          status: "SERVED",
          servedAt: now,
          servedByMemberProfileId: member.id,
          repairRecordId: null,
        },
      });

      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair_activity.registration_served",
        targetType: "RepairActivityRegistration",
        targetId: registrationId,
        result: "SUCCESS",
        after: { status: "SERVED", memberProfileId: member.id },
      });

      return { registration: toStaffReg(updated) };
    });
  },
};
