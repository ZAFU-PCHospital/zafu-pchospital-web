import type { Prisma } from "@/generated/prisma/client";
import { dateRangeWhere, parseUtcDateFilter } from "@/lib/api/date-filter";
import { paginationMeta } from "@/lib/api/pagination";
import { requirePermission } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import { resolveDisplayName } from "@/features/analytics/analytics-policy";
import type {
  AuditActionOption,
  AuditActorType,
  AuditLogEntry,
  AuditLogListInput,
  AuditLogListResult,
  AuditLogServiceContract,
  AuditResult,
  AuthorizedActor,
} from "@/types/contracts";

/** 动作下拉最多列出的项数：审计动作会随模块增长，不给下拉灌进几百条。 */
const ACTION_OPTION_LIMIT = 100;

const auditInclude = {
  actor: {
    select: {
      displayName: true,
      memberProfile: { select: { nickname: true, realName: true } },
    },
  },
} satisfies Prisma.AuditLogInclude;

type AuditRow = Prisma.AuditLogGetPayload<{ include: typeof auditInclude }>;

/**
 * 审计记录查询（M6 批次 2，需求 §45）。
 *
 * `audit:read` 权限码从 M0 起就存在，但**一直没有消费者** —— 后台里看不到审计，
 * 「重要操作留痕」就只能靠直接查库，等于没有兑现需求 §45 的用途（出现数据争议时追踪）。
 *
 * 两条刻意的设计约束：
 *
 * 1. **只读**。审计表不提供任何修改或删除入口 —— 能改的审计等于没有审计。
 * 2. **查看审计不再写审计**。摘要里的 QQ / 手机号在**写入时**就已经过
 *    `redactAuditSummary` 脱敏、凭据类字段整条丢弃，读取不会带来新的 PII 暴露；
 *    若读取也写一条，审计表会变成自我增殖的记录流（每看一次多一行，还是自己看自己）。
 *    与「成员详情读取（明文联系方式）必须写 `member.detail.viewed`」的区别正在于此：
 *    那条路径真的吐出了明文，这条没有。
 */
export const auditLogService: AuditLogServiceContract = {
  async list(input: AuditLogListInput, actor: AuthorizedActor): Promise<AuditLogListResult> {
    requirePermission(actor, "audit:read");
    const created = parseUtcDateFilter(input.createdFrom, input.createdTo, "操作时间");
    const where: Prisma.AuditLogWhereInput = {
      action: input.action,
      actorUserId: input.actorUserId,
      targetType: input.targetType,
      targetId: input.targetId,
      requestId: input.requestId,
      result: input.result,
      createdAt: dateRangeWhere(created),
    };
    const [rows, total] = await Promise.all([
      getDb().auditLog.findMany({
        where,
        include: auditInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      getDb().auditLog.count({ where }),
    ]);
    return { items: rows.map(toEntry), pagination: paginationMeta(input, total) };
  },

  async listActions(actor: AuthorizedActor): Promise<AuditActionOption[]> {
    requirePermission(actor, "audit:read");
    const rows = await getDb().auditLog.groupBy({
      by: ["action"],
      _count: { _all: true },
      orderBy: { _count: { action: "desc" } },
      take: ACTION_OPTION_LIMIT,
    });
    return rows
      .map((row) => ({ action: row.action, count: row._count._all }))
      .sort((a, b) => b.count - a.count || a.action.localeCompare(b.action, "en"));
  },
};

function toEntry(row: AuditRow): AuditLogEntry {
  return {
    id: row.id,
    actorType: row.actorType as AuditActorType,
    actorUserId: row.actorUserId,
    // 系统写入没有 actor；有 actor 但连成员档案都没有时回退到账号展示名，
    // 与站内其它展示名回退（昵称 → 实名 → 账号名 → 「成员」）保持同一条链。
    actorName: row.actor
      ? resolveDisplayName({
          nickname: row.actor.memberProfile?.nickname ?? null,
          realName: row.actor.memberProfile?.realName ?? null,
          displayName: row.actor.displayName,
        })
      : null,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    requestId: row.requestId,
    result: row.result as AuditResult,
    errorCode: row.errorCode,
    beforeSummary: row.beforeSummary ?? null,
    afterSummary: row.afterSummary ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
