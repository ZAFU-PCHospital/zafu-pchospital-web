import {
  checkedFilters,
  dateFilter,
  textFilter,
  numberFilter,
  enumFilter,
} from "@/lib/table/filter-value";
import { checkedGroup, groupSummary } from "@/lib/table/group-summary";
import { REPAIR_FILTERABLE, TABLE_GROUPS } from "@/features/admin/table-fields";
import { RepairStatus, RepairResult } from "@/types/contracts";
import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/api/errors";
import { paginationMeta } from "@/lib/api/pagination";
import { shanghaiDayToDateOnly, toDateOnlyBounds, type UtcRange } from "@/lib/academic-term";
import { requirePermission } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import { assertCanReadRepair } from "./repair-policy";
import { repairListInclude, repairRepository } from "./repair-repository";
import { repairOrderBy } from "./repair-sort";
import { toRepairDetail, toRepairView } from "./repair-view";
import { isFavorited } from "@/features/community/favorite-service";
import type {
  AuthorizedActor,
  MemberRecentActivity,
  MemberRecentRepair,
  MemberRepairSummary,
  MemberWorkQueue,
  MetricValue,
  RepairListInput,
  RepairMemberOption,
  RepairQueryServiceContract,
} from "@/types/contracts";

export const repairQueryService: RepairQueryServiceContract = {
  async list(input, actor) {
    requirePermission(actor, "repair:read");
    if (input.groupBy) requirePermission(actor, "repair:review");
    // 只有成员视角才需要「我自己是谁」——`listWhere` 会按 `repair:review` 决定可见范围。
    // 纯管理员账号（有 ADMIN 角色但没有成员档案）必须能进管理端列表，
    // 否则 `GET /api/v1/admin/repairs` 会对它永久返回 403 MEMBER_REQUIRED。
    if (!actor.permissions.includes("repair:review")) {
      await repairRepository.activeMemberForUser(actor.userId);
    }
    const where = listWhere(input, actor);
    const group = checkedGroup(input.groupBy, TABLE_GROUPS.repairs);
    const [total, rows, summary] = await Promise.all([
      getDb().repairRecord.count({ where }),
      getDb().repairRecord.findMany({
        where,
        // 列表 DTO 不返回审核记录 / 时间线，只读取列表需要的关联。
        include: repairListInclude,
        // 用户点过表头就按用户的选择排（白名单与映射见 `repair-sort.ts`），否则按
        // 维修日期倒序；两条路径都由 `repairOrderBy` 补 `id` 兜底 ——
        // 主排序键重复时没有确定名次，`skip` / `take` 的分页就会重复或漏行。
        orderBy: repairOrderBy(input.sort),
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      group
        ? getDb()
            .repairRecord.groupBy({
              by: [group as "status" | "result"],
              where,
              _count: { _all: true },
            })
            .then((rows) =>
              groupSummary(
                group,
                rows.map((row) => ({
                  value: group === "status" ? row.status : row.result,
                  count: row._count._all,
                })),
              ),
            )
        : undefined,
    ]);
    // ❗ 管理端列表（`/admin/repairs` 走同一入口）必须对 `repair:review` 下发完整机主电话：
    // 管理弹窗编辑表单以列表行数据为 `defaultValue`，列表不下发就会在保存其它字段时把号码清空。
    return {
      items: rows.map((row) =>
        toRepairView(row, { canViewOwnerPhone: actor.permissions.includes("repair:review") }),
      ),
      summary,
      pagination: paginationMeta(input, total),
    };
  },
  async getById(recordId, actor) {
    const record = await repairRepository.getById(recordId);
    assertCanReadRepair(actor, record);
    let favorited = false;
    if (actor.userId) {
      const member = await getDb().memberProfile.findFirst({
        where: { userId: actor.userId, status: "ACTIVE", deletedAt: null },
        select: { id: true },
      });
      if (member) favorited = await isFavorited(member.id, recordId);
    }
    return toRepairDetail(record, actor, { isFavorited: favorited });
  },
};

/**
 * 正式维修记录的唯一查询谓词。
 *
 * M2 分析入口与 M3 成员摘要都必须从这里组合附加条件，禁止各自重复
 * `APPROVED AND deletedAt IS NULL`，避免 M5 接入前出现统计口径漂移。
 */
export function approvedRepairWhere(
  scope: Omit<Prisma.RepairRecordWhereInput, "status" | "deletedAt"> = {},
): Prisma.RepairRecordWhereInput {
  return { ...scope, status: "APPROVED", deletedAt: null };
}

export async function listApprovedRepairsForAnalytics(input: { from?: Date; to?: Date } = {}) {
  return getDb().repairRecord.findMany({
    where: approvedRepairWhere({ repairDate: { gte: input.from, lte: input.to } }),
    select: {
      id: true,
      memberProfileId: true,
      repairDate: true,
      durationMinutes: true,
      categoryId: true,
      isDifficult: true,
      isTypical: true,
    },
    orderBy: [{ repairDate: "desc" }, { id: "desc" }],
  });
}

export async function listRepairMemberOptions(
  actor: AuthorizedActor,
): Promise<RepairMemberOption[]> {
  requirePermission(actor, "repair:read");
  await repairRepository.activeMemberForUser(actor.userId);
  const rows = await getDb().memberProfile.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    select: { id: true, realName: true, nickname: true, user: { select: { displayName: true } } },
    orderBy: [{ realName: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.nickname || row.realName || row.user.displayName || "成员",
    realName: row.realName,
    nickname: row.nickname,
  }));
}

// ---------------------------------------------------------------------------
// M3 成员维修摘要（任务书 §7）
//
// 这里**不重写**「有效维修记录」的定义：统一复用上面已冻结的
// `APPROVED AND deletedAt IS NULL` 语义，只在其上追加 `memberProfileId` 归属过滤。
// ---------------------------------------------------------------------------

/**
 * 正式摘要只在唯一正式谓词上追加**参与关系**与可选日期范围。
 *
 *  起，统计归属从「维修人单字段」切到「参与关系」：参与人也计入自己的
 * 次数与时长（时长不分人，记录上的 `duration_minutes` 对全部参与者生效）。
 * 关系过滤用 `some`，一条记录只会命中一次，值不会因参与行重复而放大。
 */
function approvedForMember(
  memberProfileId: string,
  range?: UtcRange,
): Prisma.RepairRecordWhereInput {
  return approvedRepairWhere({
    participants: { some: { memberProfileId } },
    // `repair_date` 是 DATE 列：区间必须换成日期边界再交给查询构造器，
    // 否则本月/学年统计会被整体挪一天。
    repairDate: range ? toDateOnlyBounds(range) : undefined,
  });
}

/**
 * 成员维修摘要。`yearRange` 缺省只出现在直接调用（页面路径都会传入固定的学年区间），
 * 此时 `yearApprovedCount` 返回 `{ value: null, status: "UNAVAILABLE" }`，**绝不回退为 0**。
 */
export async function listMemberRepairSummary(
  memberProfileId: string,
  options: { monthRange?: UtcRange; yearRange?: UtcRange } = {},
): Promise<MemberRepairSummary> {
  const db = getDb();
  const generatedAt = new Date().toISOString();

  const [totalApprovedCount, monthApprovedCount, durationAggregate, yearApprovedCount] =
    await Promise.all([
      db.repairRecord.count({ where: approvedForMember(memberProfileId) }),
      options.monthRange
        ? db.repairRecord.count({ where: approvedForMember(memberProfileId, options.monthRange) })
        : Promise.resolve(0),
      db.repairRecord.aggregate({
        where: approvedForMember(memberProfileId),
        _sum: { durationMinutes: true },
      }),
      options.yearRange
        ? db.repairRecord.count({ where: approvedForMember(memberProfileId, options.yearRange) })
        : Promise.resolve(null),
    ]);

  return {
    totalApprovedCount: available(totalApprovedCount),
    yearApprovedCount:
      yearApprovedCount === null
        ? { value: null, status: "UNAVAILABLE" }
        : available(yearApprovedCount),
    monthApprovedCount: available(monthApprovedCount),
    // 时长为空表示该成员尚无已通过记录；有记录但时长为空则合计为 0 分钟（真实值）。
    totalApprovedDurationMinutes: available(durationAggregate._sum.durationMinutes ?? 0),
    source: "M2_APPROVED_REPAIRS",
    generatedAt,
  };
}

/**
 * 成员最近**已通过**维修记录（个人主页与内部主页使用）。
 * 只返回最小字段集，不带照片二进制、审核备注或内部时间线。
 */
export async function listMemberRecentRepairs(
  memberProfileId: string,
  limit: number,
): Promise<MemberRecentRepair[]> {
  const rows = await getDb().repairRecord.findMany({
    where: approvedForMember(memberProfileId),
    select: {
      id: true,
      repairDate: true,
      durationMinutes: true,
      result: true,
      content: true,
      remark: true,
      updatedAt: true,
      category: { select: { name: true } },
    },
    orderBy: [{ repairDate: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return rows.map((row) => ({
    id: row.id,
    repairDate: row.repairDate ? row.repairDate.toISOString().slice(0, 10) : null,
    durationMinutes: row.durationMinutes,
    categoryName: row.category?.name ?? null,
    result: row.result,
    contentExcerpt: excerpt(row.remark, row.content),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/**
 * 成员工作队列与最近操作。可包含未通过记录，因此与 `listMemberRecentRepairs` 区分开，
 * 返回条目带显式 `status`，禁止冒充「已通过维修」。
 *
 * 口径：仍按**创建人**（`memberProfileId`）—— 草稿/待审/退回都是
 * 「我要去处理的事」，只有创建人能编辑与提交；参与者不该在自己队列里看到别人的作业。
 */
export async function listMemberWorkQueue(memberProfileId: string): Promise<MemberWorkQueue> {
  const db = getDb();
  const base = { deletedAt: null, memberProfileId } as const;
  const [draftCount, pendingCount, rejectedCount] = await Promise.all([
    db.repairRecord.count({ where: { ...base, status: "DRAFT" } }),
    db.repairRecord.count({ where: { ...base, status: "PENDING" } }),
    db.repairRecord.count({ where: { ...base, status: "REJECTED" } }),
  ]);
  return { draftCount, pendingCount, rejectedCount };
}

/** 最近操作（口径：仍按创建人）——「我在弄的记录」的最新动态。 */
export async function listMemberRecentActivity(
  memberProfileId: string,
  limit: number,
): Promise<MemberRecentActivity[]> {
  const rows = await getDb().repairRecord.findMany({
    where: { deletedAt: null, memberProfileId },
    select: {
      id: true,
      status: true,
      repairDate: true,
      content: true,
      remark: true,
      updatedAt: true,
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return rows.map((row) => ({
    id: row.id,
    status: row.status as MemberRecentActivity["status"],
    repairDate: row.repairDate ? row.repairDate.toISOString().slice(0, 10) : null,
    contentExcerpt: excerpt(row.remark, row.content),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

function available(value: number): MetricValue {
  return { value, status: "AVAILABLE" };
}

/**
 * 摘要取值链：备注优先，老记录的 `content` 回退；
 * 两者皆空时占位「未填写备注」。压平换行、截断到 60 个码点，不泄露完整长文本。
 */
function excerpt(remark: string | null, content: string | null): string {
  const flat = (remark?.trim() || content || "").replace(/\s+/g, " ").trim();
  if (!flat) return "未填写备注";
  const chars = [...flat];
  return chars.length > 60 ? `${chars.slice(0, 60).join("")}…` : flat;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` → `DATE` 列可比较的 UTC 零点；日期不存在（如 2 月 30 日）时抛 400。 */
function requireDateOnly(value: string, label: string): Date {
  const parsed = shanghaiDayToDateOnly(value);
  if (!parsed) throw new AppError("VALIDATION_FAILED", `${label}无效`);
  return parsed;
}

/** 次日零点 = 「结束日包含全天」的排他上界。 */
function nextDay(day: Date): Date {
  return new Date(day.getTime() + DAY_MS);
}

/**
 * 维修列表的筛选谓词（含按 `repair:review` 分派的可见范围）。
 *
 * 导出复用它，保证「筛选后导出」与「界面看到的列表」是同一个结果集 ——
 * 各写一套筛选条件是导出功能最容易出的错。
 */
export function listWhere(
  input: RepairListInput,
  actor: { userId?: string; permissions: readonly string[] },
): Prisma.RepairRecordWhereInput {
  if (input.repairDateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(input.repairDateFrom))
    throw new AppError("VALIDATION_FAILED", "起始日期无效");
  if (input.repairDateTo && !/^\d{4}-\d{2}-\d{2}$/.test(input.repairDateTo))
    throw new AppError("VALIDATION_FAILED", "结束日期无效");
  const visibility: Prisma.RepairRecordWhereInput = actor.permissions.includes("repair:review")
    ? {}
    : { OR: [{ memberProfile: { userId: actor.userId } }, { status: "APPROVED" }] };
  // 管理端默认不显示草稿：未显式选择状态时，「全部」= 非草稿；
  // 显式 status=DRAFT 仍可查看 / 导出草稿。成员视角不变（成员必须看到自己的草稿）。
  const status =
    !input.status &&
    !input.filters?.some(
      (rule) => rule.field === "status" && rule.op === "eq" && rule.value === "DRAFT",
    ) &&
    actor.permissions.includes("repair:review")
      ? ({ not: "DRAFT" } as const)
      : input.status;
  const query = input.query?.trim();
  // 案例库准入：并集条件必须经 AND 数组注入 —— 返回值已有顶层 `OR`
  // 承载关键词搜索，Prisma 同一对象内两个同名键后者覆盖前者，另开顶层 `OR`
  // 会把关键词搜索静默顶掉。单条记录维度过滤，双标记录天然只命中一次。
  const conditions: Prisma.RepairRecordWhereInput[] = [
    visibility,
    ...checkedFilters(input.filters, REPAIR_FILTERABLE).map(
      (rule): Prisma.RepairRecordWhereInput => {
        if (rule.field === "repairDate")
          return {
            repairDate:
              rule.op === "gte"
                ? { gte: requireDateOnly(rule.value, "维修日期") }
                : { lt: nextDay(requireDateOnly(rule.value, "维修日期")) },
          };
        if (rule.field === "memberName")
          return {
            participants: {
              some: {
                memberProfile: {
                  OR: [{ realName: textFilter(rule) }, { nickname: textFilter(rule) }],
                },
              },
            },
          };
        if (rule.field === "isDifficult" || rule.field === "isTypical") {
          if (rule.value !== "true" && rule.value !== "false")
            throw new AppError("VALIDATION_FAILED", "标记筛选无效");
          const value = rule.value === "true";
          return { [rule.field]: rule.op === "neq" ? !value : value };
        }
        if (rule.field === "categoryName") return { category: { name: textFilter(rule) } };
        return {
          [rule.field]:
            rule.field === "createdAt"
              ? dateFilter(rule)
              : rule.field === "status"
                ? enumFilter(rule, RepairStatus)
                : rule.field === "result"
                  ? enumFilter(rule, RepairResult)
                  : rule.field === "durationMinutes"
                    ? numberFilter(rule)
                    : textFilter(rule),
        };
      },
    ),
  ];
  if (input.flagged === "ANY") {
    conditions.push({ OR: [{ isTypical: true }, { isDifficult: true }] });
  }
  return {
    deletedAt: null,
    AND: conditions,
    // 「维修成员」筛选：按**参与过**匹配，不是只看创建人 ——
    // 管理端要能查出「某人参与过的全部记录」；创建人恒有参与行，旧口径被完全覆盖。
    participants: input.memberId ? { some: { memberProfileId: input.memberId } } : undefined,
    categoryId: input.categoryId,
    status,
    result: input.result,
    repairDate: {
      // DATE 列按 UTC 日历日比较，须使用日期边界。
      gte: input.repairDateFrom ? requireDateOnly(input.repairDateFrom, "起始日期") : undefined,
      lt: input.repairDateTo ? nextDay(requireDateOnly(input.repairDateTo, "结束日期")) : undefined,
    },
    isDifficult: input.isDifficult,
    isTypical: input.isTypical,
    OR: query
      ? [
          { content: { contains: query } },
          { remark: { contains: query } },
          // 机主姓名可搜；机主电话不参与搜索（隐私口径见任务书 3.3）。
          { ownerName: { contains: query } },
          // 成员名按**任一参与者**匹配；创建人恒有参与行，行为与旧口径兼容。
          {
            participants: {
              some: {
                memberProfile: {
                  OR: [{ realName: { contains: query } }, { nickname: { contains: query } }],
                },
              },
            },
          },
        ]
      : undefined,
  };
}
