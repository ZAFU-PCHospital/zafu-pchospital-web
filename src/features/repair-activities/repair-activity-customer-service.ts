import { randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { shanghaiAcademicYearRange } from "@/lib/academic-term";
import { AppError } from "@/lib/api/errors";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { requirePermission } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { normalizePhone } from "@/lib/security/normalization";
import type { AuthorizedActor } from "@/types/contracts";

import { maskActivityPhone } from "./phone-mask";
import {
  CUSTOMER_NO_SHOW_BLOCK_THRESHOLD,
  customerBlockStatus,
  isCustomerBlockActive,
  isNoShowCandidate,
  normalizeCustomerName,
  type CustomerBlockStatus,
} from "./repair-activity-no-show";
import { activityEndExclusive, assertValidRegistrantName } from "./repair-activity-validation";

export type CustomerBlockView = {
  id: string;
  name: string;
  phone: string;
  phoneLast4: string;
  status: CustomerBlockStatus;
  source: "AUTO" | "MANUAL";
  reason: string;
  blockedUntil: string;
  liftedAt: string | null;
  liftedReason: string | null;
  noShowCount: number;
  lastNoShowAt: string | null;
};

export type NoShowEventView = {
  id: string;
  registrationId: string;
  activityId: string;
  activityTitle: string;
  activityAt: string;
  name: string;
  phone: string;
  phoneLast4: string;
  state: string;
  source: string;
  detectedAt: string;
  confirmedAt: string | null;
  excusedAt: string | null;
  note: string | null;
};

export type CustomerBlacklistView = {
  academicYear: string;
  blocks: CustomerBlockView[];
  events: NoShowEventView[];
};

type SyncOptions = {
  now?: Date;
  /** 报名前只同步当前客户，避免把全站历史都塞进报名事务。 */
  customer?: { nameNormalized: string; phone: string; excludeActivityId?: string };
};

const AUTO_BLOCK_REASON = "本学年活动未到场";

/**
 * 把当前学年的 no-show 候选同步为事件，并按 1 次阈值维护自动封锁。
 *
 * 历史数据不单独迁移：首次报名 / 管理端打开黑名单时，按当前学年把已结束活动补齐；
 * 这样上线前已有的未签到记录也会被计入，不需要另造学年工具或定时任务。
 */
export async function syncCurrentYearNoShows(options: SyncOptions = {}): Promise<void> {
  const now = options.now ?? new Date();
  const year = shanghaiAcademicYearRange(now);
  const db = getDb();
  const activities = await db.repairActivity.findMany({
    where: {
      deletedAt: null,
      activityAt: { gte: year.startInclusive, lt: year.endExclusive },
    },
    select: { id: true, activityAt: true },
  });
  const ended = activities.filter(
    (activity) => activityEndExclusive(activity.activityAt).getTime() <= now.getTime(),
  );

  const endByActivity = new Map(
    ended.map((activity) => [activity.id, activityEndExclusive(activity.activityAt)] as const),
  );
  const registrations = await db.repairActivityRegistration.findMany({
    where: {
      activityId: { in: [...endByActivity.keys()] },
      status: "REGISTERED",
      ...(options.customer ? { phone: options.customer.phone } : {}),
    },
    select: {
      id: true,
      activityId: true,
      name: true,
      phone: true,
      phoneLast4: true,
      deletedAt: true,
    },
  });
  const candidateIds = registrations
    .filter((registration) => {
      if (
        options.customer &&
        (normalizeCustomerName(registration.name) !== options.customer.nameNormalized ||
          registration.activityId === options.customer.excludeActivityId)
      )
        return false;
      const activityEnd = endByActivity.get(registration.activityId);
      return Boolean(
        activityEnd &&
        isNoShowCandidate({
          status: "REGISTERED",
          deletedAt: registration.deletedAt,
          activityEnd,
        }),
      );
    })
    .map((registration) => registration.id);

  await inSerializableTransaction(async (tx) => {
    // 事务外读到的候选只作为初筛；进入事务后重新锁活动与报名并复核，
    // 避免“候选已读出、管理员随即软删/签到”之间把已取消的报名记成 no-show。
    const activityIds = [...endByActivity.keys()];
    if (activityIds.length > 0) {
      await tx.$queryRaw`SELECT id FROM repair_activities WHERE id IN (${Prisma.join(activityIds)}) FOR UPDATE`;
    }
    const lockedActivities = await tx.repairActivity.findMany({
      where: {
        id: { in: activityIds },
        deletedAt: null,
        activityAt: { gte: year.startInclusive, lt: year.endExclusive },
      },
      select: { id: true, activityAt: true },
    });
    const lockedEndByActivity = new Map(
      lockedActivities.map(
        (activity) => [activity.id, activityEndExclusive(activity.activityAt)] as const,
      ),
    );
    if (candidateIds.length > 0) {
      await tx.$queryRaw`SELECT id FROM repair_activity_registrations WHERE id IN (${Prisma.join(candidateIds)}) FOR UPDATE`;
    }
    const lockedRegistrations = await tx.repairActivityRegistration.findMany({
      where: { id: { in: candidateIds } },
      select: {
        id: true,
        activityId: true,
        status: true,
        name: true,
        phone: true,
        phoneLast4: true,
        deletedAt: true,
      },
    });
    const lockedCandidates = lockedRegistrations.filter((registration) => {
      if (
        options.customer &&
        (normalizeCustomerName(registration.name) !== options.customer.nameNormalized ||
          registration.phone !== options.customer.phone ||
          registration.activityId === options.customer.excludeActivityId)
      )
        return false;
      const activityEnd = lockedEndByActivity.get(registration.activityId);
      return Boolean(
        activityEnd &&
        activityEnd.getTime() <= now.getTime() &&
        isNoShowCandidate({
          status: registration.status,
          deletedAt: registration.deletedAt,
          activityEnd,
        }),
      );
    });

    for (const registration of lockedCandidates) {
      await tx.repairActivityNoShowEvent.upsert({
        where: { registrationId: registration.id },
        create: {
          id: randomUUID(),
          registrationId: registration.id,
          activityId: registration.activityId,
          name: registration.name,
          nameNormalized: normalizeCustomerName(registration.name),
          phone: registration.phone,
          phoneLast4: registration.phoneLast4,
          state: "CONFIRMED",
          source: "AUTO",
          detectedAt: now,
          confirmedAt: now,
          createdAt: now,
          updatedAt: now,
        },
        update: {},
      });
    }

    const confirmedEvents = await tx.repairActivityNoShowEvent.findMany({
      where: {
        state: "CONFIRMED",
        activityId: { in: [...lockedEndByActivity.keys()] },
        ...(options.customer
          ? {
              phone: options.customer.phone,
              nameNormalized: options.customer.nameNormalized,
            }
          : {}),
      },
      select: {
        name: true,
        nameNormalized: true,
        phone: true,
        phoneLast4: true,
        confirmedAt: true,
      },
    });
    const byCustomer = new Map<
      string,
      {
        name: string;
        nameNormalized: string;
        phone: string;
        phoneLast4: string;
        latest: Date;
        count: number;
      }
    >();
    for (const event of confirmedEvents) {
      const key = `${event.nameNormalized}\u0000${event.phone}`;
      const current = byCustomer.get(key);
      const confirmedAt = event.confirmedAt ?? now;
      if (!current) {
        byCustomer.set(key, {
          name: event.name,
          nameNormalized: event.nameNormalized,
          phone: event.phone,
          phoneLast4: event.phoneLast4,
          latest: confirmedAt,
          count: 1,
        });
      } else {
        current.count += 1;
        if (confirmedAt > current.latest) {
          current.latest = confirmedAt;
          current.name = event.name;
        }
      }
    }

    for (const customer of byCustomer.values()) {
      if (customer.count < CUSTOMER_NO_SHOW_BLOCK_THRESHOLD) continue;
      const block = await tx.repairActivityCustomerBlock.findUnique({
        where: {
          nameNormalized_phone: {
            nameNormalized: customer.nameNormalized,
            phone: customer.phone,
          },
        },
      });
      if (block?.source === "MANUAL" && isCustomerBlockActive(block, now)) continue;
      if (block?.blockedUntil && block.blockedUntil.getTime() > now.getTime() && !block.liftedAt)
        continue;
      if (block?.liftedAt && customer.latest.getTime() <= block.liftedAt.getTime()) continue;

      const data = {
        name: customer.name,
        nameNormalized: customer.nameNormalized,
        phone: customer.phone,
        phoneLast4: customer.phoneLast4,
        reason: AUTO_BLOCK_REASON,
        source: "AUTO" as const,
        blockedUntil: year.endExclusive,
        liftedAt: null,
        liftedByUserId: null,
        liftedReason: null,
        updatedAt: now,
      };
      const createId = randomUUID();
      const saved = block
        ? await tx.repairActivityCustomerBlock.update({ where: { id: block.id }, data })
        : await tx.repairActivityCustomerBlock.upsert({
            where: {
              nameNormalized_phone: {
                nameNormalized: customer.nameNormalized,
                phone: customer.phone,
              },
            },
            create: { id: createId, ...data, createdAt: now },
            // 并发 sync 已创建同一客户时保留先写入的那条（可能是人工封锁）。
            update: {},
          });
      // 只有本次真正创建才写审计；并发 upsert 命中已有行时由创建方负责。
      if (!block && (saved.id !== createId || saved.source === "MANUAL")) continue;
      await appendAuditLog(tx, {
        actor: { requestId: `repair-activity-no-show:${randomUUID()}` },
        actorType: "SYSTEM",
        action: "repair_activity.customer_blocked",
        targetType: "RepairActivityCustomerBlock",
        targetId: saved.id,
        result: "SUCCESS",
        before: block
          ? { source: block.source, liftedAt: block.liftedAt?.toISOString() ?? null }
          : undefined,
        after: {
          source: "AUTO",
          name: customer.name,
          phoneMasked: maskActivityPhone(customer.phone),
          blockedUntil: year.endExclusive.toISOString(),
          reason: AUTO_BLOCK_REASON,
        },
      });
    }

    const autoBlocks = await tx.repairActivityCustomerBlock.findMany({
      where: {
        source: "AUTO",
        liftedAt: null,
        blockedUntil: { gt: now },
        ...(options.customer
          ? {
              phone: options.customer.phone,
              nameNormalized: options.customer.nameNormalized,
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        nameNormalized: true,
        phone: true,
        blockedUntil: true,
      },
    });
    for (const block of autoBlocks) {
      if (byCustomer.has(`${block.nameNormalized}\u0000${block.phone}`)) continue;
      await tx.repairActivityCustomerBlock.update({
        where: { id: block.id },
        data: {
          liftedAt: now,
          liftedReason: "当前学年没有有效未到场记录",
          updatedAt: now,
        },
      });
      await appendAuditLog(tx, {
        actor: { requestId: `repair-activity-no-show:${randomUUID()}` },
        actorType: "SYSTEM",
        action: "repair_activity.customer_unblocked",
        targetType: "RepairActivityCustomerBlock",
        targetId: block.id,
        result: "SUCCESS",
        before: {
          name: block.name,
          phoneMasked: maskActivityPhone(block.phone),
          source: "AUTO",
          blockedUntil: block.blockedUntil.toISOString(),
        },
        after: { liftedAt: now.toISOString(), reason: "当前学年没有有效未到场记录" },
      });
    }
  });
}

/** 报名前调用：只补齐当前客户的当前学年事件/封锁。 */
export async function syncCustomerForRegistration(
  name: string,
  phone: string,
  activityId: string,
  now: Date = new Date(),
): Promise<void> {
  await syncCurrentYearNoShows({
    now,
    // 当前活动若已结束，报名会在事务内被拒；不在这次失败请求里为它生成 no-show 事件。
    customer: {
      nameNormalized: normalizeCustomerName(name),
      phone,
      excludeActivityId: activityId,
    },
  });
}

/** 报名事务内复核封锁；只拦新报名，不影响已有报名签到/接待。 */
export async function assertCustomerNotBlocked(
  tx: Prisma.TransactionClient,
  name: string,
  phone: string,
  now: Date = new Date(),
): Promise<void> {
  const block = await tx.repairActivityCustomerBlock.findUnique({
    where: {
      nameNormalized_phone: {
        nameNormalized: normalizeCustomerName(name),
        phone,
      },
    },
  });
  if (isCustomerBlockActive(block, now))
    throw new AppError(
      "ACTIVITY_CUSTOMER_BLOCKED",
      "该姓名与手机号的近期报名记录暂不能报名，请联系活动管理员",
    );
}

export const repairActivityCustomerService = {
  async list(actor: AuthorizedActor, now: Date = new Date()): Promise<CustomerBlacklistView> {
    requirePermission(actor, "activity:admin");
    await syncCurrentYearNoShows({ now });
    const year = shanghaiAcademicYearRange(now);
    const [blocks, events] = await Promise.all([
      getDb().repairActivityCustomerBlock.findMany({
        orderBy: [{ blockedUntil: "desc" }, { updatedAt: "desc" }],
      }),
      getDb().repairActivityNoShowEvent.findMany({
        where: {
          activity: {
            deletedAt: null,
            activityAt: { gte: year.startInclusive, lt: year.endExclusive },
          },
        },
        include: {
          activity: { select: { title: true, activityAt: true } },
        },
        orderBy: [{ activity: { activityAt: "desc" } }, { createdAt: "desc" }],
      }),
    ]);
    const confirmedByCustomer = new Map<string, { count: number; latest: Date | null }>();
    for (const event of events) {
      if (event.state !== "CONFIRMED") continue;
      const key = `${event.nameNormalized}\u0000${event.phone}`;
      const current = confirmedByCustomer.get(key) ?? { count: 0, latest: null };
      current.count += 1;
      if (!current.latest || (event.confirmedAt && event.confirmedAt > current.latest))
        current.latest = event.confirmedAt;
      confirmedByCustomer.set(key, current);
    }
    return {
      academicYear: year.label,
      blocks: blocks
        .map((block) => {
          const counts = confirmedByCustomer.get(`${block.nameNormalized}\u0000${block.phone}`);
          return {
            id: block.id,
            name: block.name,
            phone: block.phone,
            phoneLast4: block.phoneLast4,
            status: customerBlockStatus(block, now),
            source: block.source as "AUTO" | "MANUAL",
            reason: block.reason,
            blockedUntil: block.blockedUntil.toISOString(),
            liftedAt: block.liftedAt?.toISOString() ?? null,
            liftedReason: block.liftedReason,
            noShowCount: counts?.count ?? 0,
            lastNoShowAt: counts?.latest?.toISOString() ?? null,
          };
        })
        .sort((left, right) => {
          const active = Number(right.status === "ACTIVE") - Number(left.status === "ACTIVE");
          return active || left.name.localeCompare(right.name, "zh-CN");
        }),
      events: events.map((event) => ({
        id: event.id,
        registrationId: event.registrationId,
        activityId: event.activityId,
        activityTitle: event.activity.title,
        activityAt: event.activity.activityAt.toISOString(),
        name: event.name,
        phone: event.phone,
        phoneLast4: event.phoneLast4,
        state: event.state,
        source: event.source,
        detectedAt: event.detectedAt.toISOString(),
        confirmedAt: event.confirmedAt?.toISOString() ?? null,
        excusedAt: event.excusedAt?.toISOString() ?? null,
        note: event.note,
      })),
    };
  },

  async block(
    input: { name: string; phone: string; reason: string },
    actor: AuthorizedActor,
    now: Date = new Date(),
  ): Promise<{ id: string }> {
    requirePermission(actor, "activity:admin");
    const name = assertValidRegistrantName(input.name);
    const phone = normalizePhone(input.phone);
    const reason = input.reason.trim();
    if (reason.length < 2 || reason.length > 500)
      throw new AppError("VALIDATION_FAILED", "封禁原因须为 2–500 个字符");
    const year = shanghaiAcademicYearRange(now);
    return inSerializableTransaction(async (tx) => {
      const normalized = normalizeCustomerName(name);
      const block = await tx.repairActivityCustomerBlock.upsert({
        where: {
          nameNormalized_phone: { nameNormalized: normalized, phone },
        },
        create: {
          id: randomUUID(),
          name,
          nameNormalized: normalized,
          phone,
          phoneLast4: phone.slice(-4),
          reason,
          source: "MANUAL",
          blockedUntil: year.endExclusive,
          createdByUserId: actor.userId ?? null,
          createdAt: now,
          updatedAt: now,
        },
        update: {
          name,
          phoneLast4: phone.slice(-4),
          reason,
          source: "MANUAL",
          blockedUntil: year.endExclusive,
          liftedAt: null,
          liftedByUserId: null,
          liftedReason: null,
          updatedAt: now,
        },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair_activity.customer_blocked",
        targetType: "RepairActivityCustomerBlock",
        targetId: block.id,
        result: "SUCCESS",
        before: block.createdAt.getTime() === now.getTime() ? undefined : { source: "EXISTING" },
        after: {
          name,
          phoneMasked: maskActivityPhone(phone),
          source: "MANUAL",
          blockedUntil: year.endExclusive.toISOString(),
          reason,
        },
      });
      return { id: block.id };
    });
  },

  async lift(
    blockId: string,
    reason: string,
    actor: AuthorizedActor,
    now: Date = new Date(),
  ): Promise<void> {
    requirePermission(actor, "activity:admin");
    const note = reason.trim();
    if (note.length > 500) throw new AppError("VALIDATION_FAILED", "解除原因不能超过 500 字");
    await inSerializableTransaction(async (tx) => {
      const block = await tx.repairActivityCustomerBlock.findUnique({ where: { id: blockId } });
      if (!block) throw new AppError("RESOURCE_NOT_FOUND", "客户封锁记录不存在");
      if (block.liftedAt) return;
      await tx.repairActivityCustomerBlock.update({
        where: { id: block.id },
        data: {
          liftedAt: now,
          liftedByUserId: actor.userId ?? null,
          liftedReason: note || "管理员解除",
          updatedAt: now,
        },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair_activity.customer_unblocked",
        targetType: "RepairActivityCustomerBlock",
        targetId: block.id,
        result: "SUCCESS",
        before: {
          name: block.name,
          phoneMasked: maskActivityPhone(block.phone),
          source: block.source,
          blockedUntil: block.blockedUntil.toISOString(),
        },
        after: { liftedAt: now.toISOString(), reason: note || "管理员解除" },
      });
    });
  },

  async exempt(
    eventId: string,
    note: string,
    actor: AuthorizedActor,
    now: Date = new Date(),
  ): Promise<void> {
    requirePermission(actor, "activity:admin");
    const text = note.trim();
    if (text.length > 500) throw new AppError("VALIDATION_FAILED", "豁免说明不能超过 500 字");
    const year = shanghaiAcademicYearRange(now);
    await inSerializableTransaction(async (tx) => {
      const event = await tx.repairActivityNoShowEvent.findUnique({ where: { id: eventId } });
      if (!event) throw new AppError("RESOURCE_NOT_FOUND", "未到场记录不存在");
      if (event.state === "EXCUSED") return;
      await tx.repairActivityNoShowEvent.update({
        where: { id: event.id },
        data: {
          state: "EXCUSED",
          excusedAt: now,
          excusedByUserId: actor.userId ?? null,
          note: text || "管理员豁免",
          updatedAt: now,
        },
      });
      const block = await tx.repairActivityCustomerBlock.findUnique({
        where: {
          nameNormalized_phone: {
            nameNormalized: event.nameNormalized,
            phone: event.phone,
          },
        },
      });
      if (block?.source === "AUTO") {
        const remaining = await tx.repairActivityNoShowEvent.count({
          where: {
            nameNormalized: event.nameNormalized,
            phone: event.phone,
            state: "CONFIRMED",
            activity: {
              deletedAt: null,
              activityAt: { gte: year.startInclusive, lt: year.endExclusive },
            },
          },
        });
        if (remaining === 0) {
          await tx.repairActivityCustomerBlock.update({
            where: { id: block.id },
            data: {
              liftedAt: now,
              liftedByUserId: actor.userId ?? null,
              liftedReason: text || "未到场记录已豁免",
              updatedAt: now,
            },
          });
          await appendAuditLog(tx, {
            actor,
            actorType: "USER",
            actorUserId: actor.userId,
            action: "repair_activity.customer_unblocked",
            targetType: "RepairActivityCustomerBlock",
            targetId: block.id,
            result: "SUCCESS",
            before: {
              name: block.name,
              phoneMasked: maskActivityPhone(block.phone),
              source: "AUTO",
              blockedUntil: block.blockedUntil.toISOString(),
            },
            after: {
              liftedAt: now.toISOString(),
              reason: text || "未到场记录已豁免",
            },
          });
        }
      }
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair_activity.no_show.excused",
        targetType: "RepairActivityNoShowEvent",
        targetId: event.id,
        result: "SUCCESS",
        before: { state: event.state, registrationId: event.registrationId },
        after: {
          state: "EXCUSED",
          phoneMasked: maskActivityPhone(event.phone),
          note: text || "管理员豁免",
        },
      });
    });
  },
};
