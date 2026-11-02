import type { Prisma } from "@/generated/prisma/client";
import { integrationAudit } from "@/lib/auth/machine";
import { randomUUID } from "node:crypto";

import { repairActivityConsentVersion } from "@/config/repair-activities";
import {
  issueRegistrationEditToken,
  verifyRegistrationEditToken,
} from "@/features/repair-activities/edit-token";
import { maskActivityPhone } from "@/features/repair-activities/phone-mask";
import {
  activityEndExclusive,
  assertActivityTimeRules,
  assertValidCapacity,
  assertValidDeviceModel,
  assertValidIssueType,
  assertValidRegistrantName,
  assertValidTitle,
  canCancelRegistration,
  canEditIssueType,
  deriveRepairActivityStatus,
  EFFECTIVE_REGISTRATION_STATUSES,
  remainingCapacity,
  type RepairActivityIssueType,
  type RepairActivityStatus,
} from "@/features/repair-activities/repair-activity-validation";
import { pickNonEndedRepairActivitiesForHomePreview } from "@/features/repair-activities/repair-activity-sort";
import { startOfShanghaiDay } from "@/lib/academic-term";
import { AppError } from "@/lib/api/errors";
import { paginationMeta } from "@/lib/api/pagination";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { requirePermission } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { normalizePhone } from "@/lib/security/normalization";
import type {
  AuthorizedActor,
  PaginationInput,
  PaginationMeta,
  PublicRequestContext,
} from "@/types/contracts";

export type RepairActivityPublicView = {
  id: string;
  title: string;
  activityAt: string;
  capacity: number;
  signupOpensAt: string;
  signupClosesAt: string;
  status: RepairActivityStatus;
  registeredCount: number;
  remaining: number;
};

/** 公开排队汇总；null 表示签到尚未开放，不代表查询失败或无人等候。 */
export type RepairActivityQueueView = {
  waitingCount: number | null;
  observedAt: string;
};

export type RepairActivityPublicListResult = {
  items: RepairActivityPublicView[];
  pagination: PaginationMeta;
};

export type RepairActivityAdminView = RepairActivityPublicView & {
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  /**
   * 本场已出勤成员数：成员签到即计入，系统无签退，
   * 历史场次为累计值；只回计数，不下发出勤成员明细。
   */
  attendedCount: number;
};

export type CreateRepairActivityInput = {
  title: string;
  activityAt: Date;
  capacity: number;
  signupOpensAt: Date;
  signupClosesAt: Date;
};

export type UpdateRepairActivityInput = {
  title?: string;
  activityAt?: Date;
  capacity?: number;
  signupOpensAt?: Date;
  signupClosesAt?: Date;
};

export type RegistrationPublicView = {
  id: string;
  activityId: string;
  name: string;
  phoneMasked: string;
  issueType: RepairActivityIssueType;
  /** 机型，选填。 */
  deviceModel: string | null;
  status: string;
  createdAt: string;
};

export type RegistrationLookupView = RegistrationPublicView & {
  editToken: string;
  editTokenExpiresAt: string;
};

export type RegistrationAdminView = {
  id: string;
  activityId: string;
  name: string;
  phone: string;
  issueType: RepairActivityIssueType;
  /** 机型，选填。 */
  deviceModel: string | null;
  status: string;
  createdAt: string;
  deletedAt: string | null;
  /** 本场还有其他同名有效报名，供管理员人工核对；不参与唯一性。 */
  hasSameNameActive: boolean;
};

export type UpdateRegistrationInput = {
  name?: string;
  phone?: string;
  issueType?: unknown;
};

type ActivityRow = {
  id: string;
  title: string;
  activityAt: Date;
  capacity: number;
  signupOpensAt: Date;
  signupClosesAt: Date;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

const effectiveStatusFilter = {
  deletedAt: null as null,
  status: { in: [...EFFECTIVE_REGISTRATION_STATUSES] },
};

/** 公开列表两段的 SQL 排序；首页预览复用未结束段，避免两处 tie-break 漂移。 */
const PUBLIC_ACTIVE_ORDER_BY = [
  { activityAt: "asc" },
  { createdAt: "asc" },
  { id: "asc" },
] satisfies Prisma.RepairActivityOrderByWithRelationInput[];
const PUBLIC_ENDED_ORDER_BY = [
  { activityAt: "desc" },
  { createdAt: "asc" },
  { id: "asc" },
] satisfies Prisma.RepairActivityOrderByWithRelationInput[];

function publicActiveWhere(todayStart: Date): Prisma.RepairActivityWhereInput {
  return { deletedAt: null, activityAt: { gte: todayStart } };
}

function publicEndedWhere(todayStart: Date): Prisma.RepairActivityWhereInput {
  return { deletedAt: null, activityAt: { lt: todayStart } };
}

async function countEffectiveRegistrations(activityId: string): Promise<number> {
  return getDb().repairActivityRegistration.count({
    where: { activityId, ...effectiveStatusFilter },
  });
}

function toPublicView(
  row: ActivityRow,
  registeredCount: number,
  now: Date,
): RepairActivityPublicView {
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
  };
}

function toAdminView(
  row: ActivityRow,
  registeredCount: number,
  attendedCount: number,
  now: Date,
): RepairActivityAdminView {
  return {
    ...toPublicView(row, registeredCount, now),
    attendedCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdBy: row.createdBy,
  };
}

/** 首页预览返回公开字段；createdAt 只在排序时使用，不进入 Service 返回值。 */
function toHomePreviewView(
  item: RepairActivityPublicView & { createdAt: string },
): RepairActivityPublicView {
  return {
    id: item.id,
    title: item.title,
    activityAt: item.activityAt,
    capacity: item.capacity,
    signupOpensAt: item.signupOpensAt,
    signupClosesAt: item.signupClosesAt,
    status: item.status,
    registeredCount: item.registeredCount,
    remaining: item.remaining,
  };
}

function toRegistrationAdminView(row: {
  id: string;
  activityId: string;
  name: string;
  phone: string;
  issueType: string;
  deviceModel: string | null;
  status: string;
  createdAt: Date;
  deletedAt: Date | null;
}): Omit<RegistrationAdminView, "hasSameNameActive"> {
  return {
    id: row.id,
    activityId: row.activityId,
    name: row.name,
    phone: row.phone,
    issueType: assertValidIssueType(row.issueType),
    deviceModel: row.deviceModel,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

async function loadCounts(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const groups = await getDb().repairActivityRegistration.groupBy({
    by: ["activityId"],
    where: { activityId: { in: ids }, ...effectiveStatusFilter },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.activityId, g._count._all]));
}

/**
 * 各场已出勤成员数。与 `loadCounts` 同一模式：一次 groupBy 批量聚合、
 * 缺省 0。出勤表没有软删列，成员签到即计入、系统无签退，历史场次为累计值。
 */
async function loadAttendanceCounts(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const groups = await getDb().repairActivityAttendance.groupBy({
    by: ["activityId"],
    where: { activityId: { in: ids } },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.activityId, g._count._all]));
}

/** Shared business transaction bodies; authorization belongs to the calling Service. */
export async function createRepairActivityInTransaction(
  tx: Prisma.TransactionClient,
  input: CreateRepairActivityInput,
  actor: AuthorizedActor,
): Promise<RepairActivityAdminView> {
  const title = assertValidTitle(input.title);
  assertValidCapacity(input.capacity);
  assertActivityTimeRules({
    activityAt: input.activityAt,
    signupOpensAt: input.signupOpensAt,
    signupClosesAt: input.signupClosesAt,
  });
  const now = new Date();
  const created = await tx.repairActivity.create({
    data: {
      id: randomUUID(),
      title,
      activityAt: input.activityAt,
      capacity: input.capacity,
      signupOpensAt: input.signupOpensAt,
      signupClosesAt: input.signupClosesAt,
      createdBy: actor.userId ?? null,
      createdAt: now,
    },
  });
  await appendAuditLog(tx, {
    actor,
    actorType: actor.actorType,
    actorUserId: actor.userId,
    action: "repair_activity.created",
    targetType: "RepairActivity",
    targetId: created.id,
    result: "SUCCESS",
    after: {
      title,
      capacity: input.capacity,
      activityAt: input.activityAt.toISOString(),
      signupOpensAt: input.signupOpensAt.toISOString(),
      signupClosesAt: input.signupClosesAt.toISOString(),
      ...integrationAudit(actor),
    },
  });
  return toAdminView(created, 0, 0, now);
}

export async function updateRepairActivityInTransaction(
  tx: Prisma.TransactionClient,
  activityId: string,
  input: UpdateRepairActivityInput,
  actor: AuthorizedActor,
  expectedVersion?: number,
): Promise<RepairActivityAdminView> {
  await tx.$queryRaw`SELECT id FROM repair_activities WHERE id = ${activityId} FOR UPDATE`;
  const before = await tx.repairActivity.findUnique({ where: { id: activityId } });
  if (!before || before.deletedAt) {
    throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
  }
  if (expectedVersion !== undefined && before.version !== expectedVersion) {
    throw new AppError("STATE_TRANSITION_INVALID", "活动已变化，请重新查询并确认", { status: 409 });
  }
  const title = input.title !== undefined ? assertValidTitle(input.title) : before.title;
  const capacity = input.capacity !== undefined ? input.capacity : before.capacity;
  assertValidCapacity(capacity);
  const activityAt = input.activityAt ?? before.activityAt;
  const signupOpensAt = input.signupOpensAt ?? before.signupOpensAt;
  const signupClosesAt = input.signupClosesAt ?? before.signupClosesAt;
  assertActivityTimeRules({ activityAt, signupOpensAt, signupClosesAt });

  const effectiveCount = await tx.repairActivityRegistration.count({
    where: { activityId, ...effectiveStatusFilter },
  });
  if (capacity < effectiveCount) {
    throw new AppError(
      "ACTIVITY_CAPACITY_TOO_LOW",
      `人数上限不能低于当前有效报名数（${effectiveCount}）`,
    );
  }
  // 出勤人数：编辑响应要带回真实计数，不能沿用旧值。
  const attendedCount = await tx.repairActivityAttendance.count({
    where: { activityId },
  });

  const updated = await tx.repairActivity.update({
    where: { id: activityId },
    data: { title, capacity, activityAt, signupOpensAt, signupClosesAt, version: { increment: 1 } },
  });
  await appendAuditLog(tx, {
    actor,
    actorType: actor.actorType,
    actorUserId: actor.userId,
    action: "repair_activity.updated",
    targetType: "RepairActivity",
    targetId: activityId,
    result: "SUCCESS",
    before: {
      title: before.title,
      capacity: before.capacity,
      activityAt: before.activityAt.toISOString(),
      signupOpensAt: before.signupOpensAt.toISOString(),
      signupClosesAt: before.signupClosesAt.toISOString(),
    },
    after: {
      title: updated.title,
      capacity: updated.capacity,
      activityAt: updated.activityAt.toISOString(),
      signupOpensAt: updated.signupOpensAt.toISOString(),
      signupClosesAt: updated.signupClosesAt.toISOString(),
      ...integrationAudit(actor),
    },
  });
  return toAdminView(updated, effectiveCount, attendedCount, new Date());
}

export const repairActivityService = {
  // ---------- Admin ----------
  async listAdmin(actor: AuthorizedActor): Promise<RepairActivityAdminView[]> {
    requirePermission(actor, "activity:admin");
    const now = new Date();
    const rows = await getDb().repairActivity.findMany({
      where: { deletedAt: null },
      // 管理端按活动时间倒序，最新在前；同时间用创建时间与 id 稳定兜底。
      orderBy: [{ activityAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });
    const counts = await loadCounts(rows.map((r) => r.id));
    const attendanceCounts = await loadAttendanceCounts(rows.map((r) => r.id));
    return rows.map((row) =>
      toAdminView(row, counts.get(row.id) ?? 0, attendanceCounts.get(row.id) ?? 0, now),
    );
  },

  async listRegistrations(
    activityId: string,
    actor: AuthorizedActor,
  ): Promise<RegistrationAdminView[]> {
    requirePermission(actor, "activity:admin");
    const activity = await getDb().repairActivity.findFirst({
      where: { id: activityId, deletedAt: null },
    });
    if (!activity) throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
    const rows = await getDb().repairActivityRegistration.findMany({
      where: { activityId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const activeNameCounts = new Map<string, number>();
    for (const row of rows) {
      if (row.deletedAt) continue;
      activeNameCounts.set(row.name, (activeNameCounts.get(row.name) ?? 0) + 1);
    }
    return rows.map((row) => ({
      ...toRegistrationAdminView(row),
      hasSameNameActive: !row.deletedAt && (activeNameCounts.get(row.name) ?? 0) > 1,
    }));
  },

  async updateRegistration(
    activityId: string,
    registrationId: string,
    input: UpdateRegistrationInput,
    actor: AuthorizedActor,
  ): Promise<RegistrationAdminView> {
    requirePermission(actor, "activity:admin");
    return inSerializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repair_activities WHERE id = ${activityId} FOR UPDATE`;
      const activity = await tx.repairActivity.findUnique({ where: { id: activityId } });
      if (!activity || activity.deletedAt) {
        throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
      }
      if (new Date().getTime() >= activityEndExclusive(activity.activityAt).getTime()) {
        throw new AppError("ACTIVITY_ENDED", "活动已结束");
      }
      const before = await tx.repairActivityRegistration.findFirst({
        where: { id: registrationId, activityId },
      });
      if (!before || before.deletedAt) {
        throw new AppError("ACTIVITY_REGISTRATION_NOT_FOUND", "报名记录不存在或已删除");
      }
      const name = input.name !== undefined ? assertValidRegistrantName(input.name) : before.name;
      const phone = input.phone !== undefined ? normalizePhone(input.phone) : before.phone;
      const issueType =
        input.issueType !== undefined
          ? assertValidIssueType(input.issueType)
          : assertValidIssueType(before.issueType);
      if (phone !== before.phone) {
        const duplicate = await tx.repairActivityRegistration.findFirst({
          where: { activityId, phone, deletedAt: null, id: { not: registrationId } },
        });
        if (duplicate)
          throw new AppError("ACTIVITY_REGISTRATION_DUPLICATE", "该手机号已报名本场活动");
      }
      const updated = await tx.repairActivityRegistration.update({
        where: { id: registrationId },
        data: { name, phone, phoneLast4: phone.slice(-4), issueType },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair_activity.registration_updated",
        targetType: "RepairActivityRegistration",
        targetId: registrationId,
        result: "SUCCESS",
        before: {
          activityId,
          name: before.name,
          phoneMasked: maskActivityPhone(before.phone),
          issueType: before.issueType,
        },
        after: { activityId, name, phoneMasked: maskActivityPhone(phone), issueType },
      });
      const sameNameActiveCount = await tx.repairActivityRegistration.count({
        where: { activityId, name, deletedAt: null },
      });
      return {
        ...toRegistrationAdminView(updated),
        hasSameNameActive: sameNameActiveCount > 1,
      };
    });
  },

  async softDeleteRegistration(
    activityId: string,
    registrationId: string,
    actor: AuthorizedActor,
  ): Promise<void> {
    requirePermission(actor, "activity:admin");
    await inSerializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repair_activities WHERE id = ${activityId} FOR UPDATE`;
      const activity = await tx.repairActivity.findUnique({ where: { id: activityId } });
      if (!activity || activity.deletedAt) {
        throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
      }
      const current = await tx.repairActivityRegistration.findFirst({
        where: { id: registrationId, activityId },
      });
      if (!current || current.deletedAt) {
        throw new AppError("ACTIVITY_REGISTRATION_NOT_FOUND", "报名记录不存在或已删除");
      }
      const now = new Date();
      await tx.repairActivityRegistration.update({
        where: { id: registrationId },
        data: { deletedAt: now },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair_activity.registration_deleted",
        targetType: "RepairActivityRegistration",
        targetId: registrationId,
        result: "SUCCESS",
        before: {
          activityId,
          name: current.name,
          phoneMasked: maskActivityPhone(current.phone),
          issueType: current.issueType,
          status: current.status,
        },
        after: { deletedAt: now.toISOString() },
      });
    });
  },

  async create(
    input: CreateRepairActivityInput,
    actor: AuthorizedActor,
  ): Promise<RepairActivityAdminView> {
    requirePermission(actor, "activity:admin");
    return inSerializableTransaction((tx) => createRepairActivityInTransaction(tx, input, actor));
  },

  async update(
    activityId: string,
    input: UpdateRepairActivityInput,
    actor: AuthorizedActor,
  ): Promise<RepairActivityAdminView> {
    requirePermission(actor, "activity:admin");
    return inSerializableTransaction((tx) =>
      updateRepairActivityInTransaction(tx, activityId, input, actor),
    );
  },

  async softDelete(activityId: string, actor: AuthorizedActor): Promise<void> {
    requirePermission(actor, "activity:admin");
    await inSerializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repair_activities WHERE id = ${activityId} FOR UPDATE`;
      const current = await tx.repairActivity.findUnique({ where: { id: activityId } });
      if (!current || current.deletedAt) {
        throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
      }
      const now = new Date();
      await tx.repairActivity.update({
        where: { id: activityId },
        data: { deletedAt: now, version: { increment: 1 } },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair_activity.deleted",
        targetType: "RepairActivity",
        targetId: activityId,
        result: "SUCCESS",
        before: { title: current.title },
      });
    });
  },

  // ---------- Public ----------
  async listPublic(
    input: PaginationInput,
    now: Date = new Date(),
  ): Promise<RepairActivityPublicListResult> {
    const db = getDb();
    const todayStart = startOfShanghaiDay(now);
    const activeWhere = publicActiveWhere(todayStart);
    const endedWhere = publicEndedWhere(todayStart);

    const [total, activeCount] = await Promise.all([
      db.repairActivity.count({ where: { deletedAt: null } }),
      db.repairActivity.count({ where: activeWhere }),
    ]);
    const endedCount = total - activeCount;
    const offset = (input.page - 1) * input.pageSize;

    let rows: ActivityRow[] = [];
    if (offset < activeCount) {
      const activeTake = Math.min(input.pageSize, activeCount - offset);
      rows = await db.repairActivity.findMany({
        where: activeWhere,
        orderBy: PUBLIC_ACTIVE_ORDER_BY,
        skip: offset,
        take: activeTake,
      });
      const remaining = input.pageSize - activeTake;
      if (remaining > 0 && endedCount > 0) {
        rows.push(
          ...(await db.repairActivity.findMany({
            where: endedWhere,
            orderBy: PUBLIC_ENDED_ORDER_BY,
            take: remaining,
          })),
        );
      }
    } else {
      rows = await db.repairActivity.findMany({
        where: endedWhere,
        orderBy: PUBLIC_ENDED_ORDER_BY,
        skip: offset - activeCount,
        take: input.pageSize,
      });
    }

    const counts = await loadCounts(rows.map((row) => row.id));
    return {
      items: rows.map((row) => toPublicView(row, counts.get(row.id) ?? 0, now)),
      pagination: paginationMeta(input, total),
    };
  },

  /**
   * 首页近场活动预览（issue #288）：只查未结束活动，避免复用公开列表的分页查询。
   * 返回顺序仍由 `pickNonEndedRepairActivitiesForHomePreview` 决定（OPEN → UPCOMING →
   * FULL → CLOSED，同档 activityAt 升序）；未结束活动通常很少，计数按候选集聚合。
   * 若未来未结束活动长期超过 200 条，再改为单条 SQL 按优先级取前 N，不在此提前加限制。
   */
  async listPublicForHomePreview(
    limit = 3,
    now: Date = new Date(),
  ): Promise<RepairActivityPublicView[]> {
    const db = getDb();
    const todayStart = startOfShanghaiDay(now);
    const rows = await db.repairActivity.findMany({
      where: publicActiveWhere(todayStart),
      orderBy: PUBLIC_ACTIVE_ORDER_BY,
    });
    const counts = await loadCounts(rows.map((row) => row.id));
    // 同 activityAt / 同状态时，优先级函数按 createdAt 再按 id 排序；toPublicView 不含
    // createdAt，这里补上后再喂给纯函数，返回前再收窄回公开字段。
    const sortable = rows.map((row) => ({
      ...toPublicView(row, counts.get(row.id) ?? 0, now),
      createdAt: row.createdAt.toISOString(),
    }));
    return pickNonEndedRepairActivitiesForHomePreview(sortable, limit).map(toHomePreviewView);
  },

  /**
   * 首页没有未结束活动时的兜底（issue #317）：只查已结束活动，按公开列表
   * 已结束段的顺序取最近 N 场；已结束详情不可用，调用方不应提供详情链接。
   */
  async listPublicEndedForHomePreview(
    limit = 3,
    now: Date = new Date(),
  ): Promise<RepairActivityPublicView[]> {
    const todayStart = startOfShanghaiDay(now);
    const take = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 3;
    const rows = await getDb().repairActivity.findMany({
      where: publicEndedWhere(todayStart),
      orderBy: PUBLIC_ENDED_ORDER_BY,
      take,
    });
    const counts = await loadCounts(rows.map((row) => row.id));
    return rows.map((row) => toPublicView(row, counts.get(row.id) ?? 0, now));
  },

  async getPublic(activityId: string): Promise<RepairActivityPublicView> {
    const now = new Date();
    const row = await getDb().repairActivity.findFirst({
      where: { id: activityId, deletedAt: null },
    });
    if (!row) throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
    const count = await countEffectiveRegistrations(activityId);
    const view = toPublicView(row, count, now);
    if (view.status === "ENDED") {
      throw new AppError("ACTIVITY_ENDED", "活动已结束");
    }
    return view;
  },

  async getPublicQueue(activityId: string): Promise<RepairActivityQueueView> {
    const row = await getDb().repairActivity.findFirst({
      where: { id: activityId, deletedAt: null },
      select: { activityAt: true, signupClosesAt: true },
    });
    if (!row) throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
    const end = activityEndExclusive(row.activityAt).getTime();
    const assertNotEnded = (now: Date) => {
      if (now.getTime() >= end) throw new AppError("ACTIVITY_ENDED", "活动已结束");
    };
    let now = new Date();
    assertNotEnded(now);
    if (now < row.signupClosesAt) {
      return { waitingCount: null, observedAt: now.toISOString() };
    }
    // 只做聚合，不读取报名人员资料；与接待台的 CHECKED_IN 队列口径相同。
    const waitingCount = await getDb().repairActivityRegistration.count({
      where: { activityId, deletedAt: null, status: "CHECKED_IN" },
    });
    now = new Date();
    assertNotEnded(now);
    return { waitingCount, observedAt: now.toISOString() };
  },

  async register(
    activityId: string,
    input: {
      name: string;
      phone: string;
      issueType: unknown;
      deviceModel?: unknown;
      consentAccepted?: boolean;
    },
    context: PublicRequestContext,
    /** 本设备已提交的报名（来自签名 cookie，issue #304）；记录已删除时视为没有。 */
    device: { registrationId: string } | null = null,
  ): Promise<RegistrationPublicView> {
    const name = assertValidRegistrantName(input.name);
    const phone = normalizePhone(input.phone);
    const issueType = assertValidIssueType(input.issueType);
    const deviceModel = assertValidDeviceModel(input.deviceModel);
    // 免责声明必须由报名者本人点过。
    // 前端弹层只是「把这件事问清楚」，真正拦住绕过弹层直接打接口的是这一句 ——
    // 报名接口是公开的，只在界面上拦等于没拦。
    // 顺序：先报字段问题、再报缺同意，否则一个手机号填错的人会先看到「请先同意免责声明」。
    if (input.consentAccepted !== true) {
      throw new AppError("ACTIVITY_CONSENT_REQUIRED", "请先阅读并同意报名须知与免责声明");
    }

    return inSerializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repair_activities WHERE id = ${activityId} FOR UPDATE`;
      const activity = await tx.repairActivity.findUnique({ where: { id: activityId } });
      if (!activity || activity.deletedAt) {
        throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
      }
      const now = new Date();
      if (now.getTime() >= activityEndExclusive(activity.activityAt).getTime()) {
        throw new AppError("ACTIVITY_ENDED", "活动已结束");
      }
      const effectiveCount = await tx.repairActivityRegistration.count({
        where: { activityId, ...effectiveStatusFilter },
      });
      const status = deriveRepairActivityStatus({
        now,
        activityAt: activity.activityAt,
        signupOpensAt: activity.signupOpensAt,
        signupClosesAt: activity.signupClosesAt,
        effectiveRegistrationCount: effectiveCount,
        capacity: activity.capacity,
      });
      if (status === "ENDED") throw new AppError("ACTIVITY_ENDED", "活动已结束");
      // 本设备已报过本场：先于窗口 / 名额判断返回，否则用户会看到「已截止」「名额已满」
      // 这种不指向真实原因的提示。记录被管理员删除后，这里查不到 → 自动解锁重新报名。
      if (device) {
        const deviceRegistration = await tx.repairActivityRegistration.findFirst({
          where: { id: device.registrationId, activityId, deletedAt: null },
        });
        if (deviceRegistration) {
          throw new AppError(
            "ACTIVITY_DEVICE_ALREADY_REGISTERED",
            "本设备已提交过本场报名，请使用「已经报名？」查询，或联系管理员",
          );
        }
      }
      // 报名窗口未开始 / 已截止时，先告知窗口状态；窗口内再对已报名者优先返回重复。
      if (status === "UPCOMING") {
        throw new AppError("ACTIVITY_NOT_OPEN", "报名尚未开始");
      }
      if (status === "CLOSED") {
        throw new AppError("ACTIVITY_NOT_OPEN", "报名已截止");
      }
      const duplicate = await tx.repairActivityRegistration.findFirst({
        where: { activityId, phone, deletedAt: null },
      });
      if (duplicate) {
        throw new AppError("ACTIVITY_REGISTRATION_DUPLICATE", "你已报名本场活动，无需重复提交");
      }
      if (status === "FULL") throw new AppError("ACTIVITY_FULL", "活动名额已满");

      const created = await tx.repairActivityRegistration.create({
        data: {
          id: randomUUID(),
          activityId,
          name,
          phone,
          phoneLast4: phone.slice(-4),
          issueType,
          deviceModel,
          status: "REGISTERED",
          consentVersion: repairActivityConsentVersion,
          consentAcceptedAt: now,
          createdAt: now,
        },
      });
      await appendAuditLog(tx, {
        actor: context,
        actorType: "SYSTEM",
        action: "repair_activity.registration_created",
        targetType: "RepairActivityRegistration",
        targetId: created.id,
        result: "SUCCESS",
        after: {
          activityId,
          issueType,
          deviceModel,
          phoneMasked: maskActivityPhone(phone),
          consentVersion: repairActivityConsentVersion,
        },
      });
      return {
        id: created.id,
        activityId,
        name: created.name,
        phoneMasked: maskActivityPhone(phone),
        issueType,
        deviceModel,
        status: created.status,
        createdAt: created.createdAt.toISOString(),
      };
    });
  },

  /**
   * 活动自然日结束时间（设备凭证的有效期上限）：只读、轻量。
   * 报名成功后用它收紧 cookie，避免凭证比活动多活很久。
   */
  async publicActivityEnd(activityId: string): Promise<Date> {
    const activity = await getDb().repairActivity.findFirst({
      where: { id: activityId, deletedAt: null },
      select: { activityAt: true },
    });
    if (!activity) throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
    return activityEndExclusive(activity.activityAt);
  },

  async lookup(
    activityId: string,
    input: { name: string; phone: string },
    context: PublicRequestContext,
  ): Promise<RegistrationLookupView> {
    // 姓名 + 手机号都对才返回记录（issue #304）：既避免填错联系方式后误以为没报上，
    // 也让单凭手机号枚举姓名 / 拿查询 token 的路径消失。
    const name = assertValidRegistrantName(input.name);
    const phone = normalizePhone(input.phone);
    const activity = await getDb().repairActivity.findFirst({
      where: { id: activityId, deletedAt: null },
    });
    if (!activity) throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
    const now = new Date();
    if (now.getTime() >= activityEndExclusive(activity.activityAt).getTime()) {
      throw new AppError("ACTIVITY_ENDED", "活动已结束");
    }
    const reg = await getDb().repairActivityRegistration.findFirst({
      where: { activityId, phone, name, deletedAt: null },
    });
    if (!reg) {
      // 不区分是姓名还是电话不匹配：避免把「某手机号存在」变成可探测信息。
      throw new AppError(
        "ACTIVITY_REGISTRATION_NOT_FOUND",
        "未找到报名记录，请核对姓名与电话，或联系管理员",
      );
    }
    const token = issueRegistrationEditToken(reg.id, activityId, now);
    await inSerializableTransaction(async (tx) => {
      await appendAuditLog(tx, {
        actor: context,
        actorType: "SYSTEM",
        action: "repair_activity.registration_lookup",
        targetType: "RepairActivityRegistration",
        targetId: reg.id,
        result: "SUCCESS",
        after: { activityId, phoneMasked: maskActivityPhone(phone) },
      });
    });
    return {
      id: reg.id,
      activityId,
      name: reg.name,
      phoneMasked: maskActivityPhone(phone),
      issueType: assertValidIssueType(reg.issueType),
      deviceModel: reg.deviceModel,
      status: reg.status,
      createdAt: reg.createdAt.toISOString(),
      editToken: token.editToken,
      editTokenExpiresAt: token.expiresAt,
    };
  },

  /**
   * 设备级报名状态（issue #304）：凭签名 cookie 里的 registrationId 取回摘要，
   * 用于刷新后显示「本设备已提交」面板。记录已删除时返回 null（自动解锁）。
   */
  async deviceRegistration(
    activityId: string,
    registrationId: string,
  ): Promise<RegistrationPublicView | null> {
    const activity = await getDb().repairActivity.findFirst({
      where: { id: activityId, deletedAt: null },
    });
    if (!activity) throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
    const reg = await getDb().repairActivityRegistration.findFirst({
      where: { id: registrationId, activityId, deletedAt: null },
    });
    if (!reg) return null;
    return {
      id: reg.id,
      activityId,
      name: reg.name,
      phoneMasked: maskActivityPhone(reg.phone),
      issueType: assertValidIssueType(reg.issueType),
      deviceModel: reg.deviceModel,
      status: reg.status,
      createdAt: reg.createdAt.toISOString(),
    };
  },

  async updateIssueType(
    activityId: string,
    registrationId: string,
    input: { issueType: unknown; phone: string; editToken: string },
    context: PublicRequestContext,
  ): Promise<RegistrationPublicView> {
    const issueType = assertValidIssueType(input.issueType);
    normalizePhone(input.phone);
    if (typeof input.editToken !== "string" || !input.editToken.trim()) {
      throw new AppError("ACTIVITY_EDIT_TOKEN_INVALID", "查询凭证无效或已过期，请重新查询");
    }
    verifyRegistrationEditToken(input.editToken.trim(), { registrationId, activityId });

    return inSerializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repair_activities WHERE id = ${activityId} FOR UPDATE`;
      const activity = await tx.repairActivity.findUnique({ where: { id: activityId } });
      if (!activity || activity.deletedAt) {
        throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
      }
      const now = new Date();
      const effectiveCount = await tx.repairActivityRegistration.count({
        where: { activityId, ...effectiveStatusFilter },
      });
      const activityStatus = deriveRepairActivityStatus({
        now,
        activityAt: activity.activityAt,
        signupOpensAt: activity.signupOpensAt,
        signupClosesAt: activity.signupClosesAt,
        effectiveRegistrationCount: effectiveCount,
        capacity: activity.capacity,
      });
      if (activityStatus === "ENDED") {
        throw new AppError("ACTIVITY_ENDED", "活动已结束");
      }

      const reg = await tx.repairActivityRegistration.findFirst({
        where: { id: registrationId, activityId, deletedAt: null },
      });
      if (!reg) {
        throw new AppError("ACTIVITY_REGISTRATION_NOT_FOUND", "报名记录不存在");
      }
      if (!canEditIssueType({ registrationStatus: reg.status, activityStatus })) {
        throw new AppError("ACTIVITY_REGISTRATION_NOT_EDITABLE", "当前状态不可修改故障类型");
      }

      const updated = await tx.repairActivityRegistration.update({
        where: { id: registrationId },
        data: { issueType },
      });
      await appendAuditLog(tx, {
        actor: context,
        actorType: "SYSTEM",
        action: "repair_activity.registration_issue_type_updated",
        targetType: "RepairActivityRegistration",
        targetId: registrationId,
        result: "SUCCESS",
        before: { issueType: reg.issueType },
        after: { issueType },
      });
      return {
        id: updated.id,
        activityId,
        name: updated.name,
        phoneMasked: maskActivityPhone(updated.phone),
        issueType,
        deviceModel: updated.deviceModel,
        status: updated.status,
        createdAt: updated.createdAt.toISOString(),
      };
    });
  },

  /**
   * 客户自助取消（issue #345）：活动开始前、报名尚未签到/接待时可取消。
   * 软删释放名额；姓名/手机号/查询 token 三者都必须匹配，避免拿错凭证取消他人报名。
   */
  async cancelRegistration(
    activityId: string,
    registrationId: string,
    input: { name: string; phone: string; editToken: string },
    context: PublicRequestContext,
  ): Promise<{ cancelled: true }> {
    const name = assertValidRegistrantName(input.name);
    const phone = normalizePhone(input.phone);
    if (typeof input.editToken !== "string" || !input.editToken.trim()) {
      throw new AppError("ACTIVITY_EDIT_TOKEN_INVALID", "查询凭证无效或已过期，请重新查询");
    }
    verifyRegistrationEditToken(input.editToken.trim(), { registrationId, activityId });

    return inSerializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repair_activities WHERE id = ${activityId} FOR UPDATE`;
      const activity = await tx.repairActivity.findUnique({ where: { id: activityId } });
      if (!activity || activity.deletedAt) {
        throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
      }
      const now = new Date();
      // 包含已软删行：取消响应丢失后客户端重试应幂等成功，而不是被迫刷新页面。
      const reg = await tx.repairActivityRegistration.findFirst({
        where: { id: registrationId, activityId },
      });
      if (!reg || reg.name !== name || reg.phone !== phone) {
        throw new AppError("ACTIVITY_REGISTRATION_NOT_FOUND", "报名记录不存在或信息不匹配");
      }
      if (reg.deletedAt) return { cancelled: true as const };
      if (reg.status !== "REGISTERED") {
        throw new AppError(
          "ACTIVITY_REGISTRATION_STATE_INVALID",
          "已签到或已接待的报名不能自助取消，请联系活动管理员",
        );
      }
      if (
        !canCancelRegistration({
          registrationStatus: reg.status,
          activityAt: activity.activityAt,
          now,
        })
      ) {
        throw new AppError(
          "ACTIVITY_REGISTRATION_STATE_INVALID",
          "活动已开始，不能自助取消，请联系活动管理员",
        );
      }

      await tx.repairActivityRegistration.update({
        where: { id: registrationId },
        data: { deletedAt: now },
      });
      await appendAuditLog(tx, {
        actor: context,
        actorType: "SYSTEM",
        action: "repair_activity.registration_cancelled",
        targetType: "RepairActivityRegistration",
        targetId: registrationId,
        result: "SUCCESS",
        before: {
          activityId,
          status: reg.status,
          phoneMasked: maskActivityPhone(phone),
        },
        after: { activityId, deletedAt: now.toISOString() },
      });
      return { cancelled: true as const };
    });
  },
};
