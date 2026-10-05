/**
 * M5 统计与排行的唯一聚合入口（任务书 §7）。
 *
 * 边界（**本文件的核心约束**）：
 * - 所有聚合、分组、排序与分页都在 GreatSQL 中完成；
 *   绝不调用 `listApprovedRepairsForAnalytics()` 把全量记录拉到 Node.js 再 `filter/reduce/sort`；
 * - 「有效维修记录」的定义**只有一处**：`approvedRepairWhere()`。
 *   原生 SQL 里的谓词由 `approvedRepairSql()` 从同一入口机械翻译而来，
 *   本文件不出现任何重复书写的 `APPROVED` / `deleted_at IS NULL` 字面量；
 * - 所有原生 SQL 均为参数化查询；`scope` / `metric` 只用于在白名单分支间二选一，
 *   任何用户输入都不会拼接进 SQL 文本；
 * - 数值一律显式转换，防止 `BIGINT` / `DECIMAL` 以字符串泄漏（见 `analytics-policy`）。
 *
 * 关于 `repair_date` 的类型（实测结论，勿凭直觉改）：
 * 它是 `DATE`（纯日历日，存的已是 `Asia/Shanghai` 自然日），不是时刻。
 *
 * - **原生 SQL**（本文件的榜单与趋势）：参数按完整时刻比较，M3 的
 *   `[startInclusive, endExclusive)` UTC 区间可以直接用，已被实测确认恰好等价于
 *   「上海自然月的首日到末日」；月度分桶因此直接取 `DATE_FORMAT(repair_date, '%Y-%m')`，
 *   **不加 8 小时偏移**。
 * - **Prisma 查询构造器**（`where` 里的 `repairDate`）：过滤值会被按 **UTC 日历日截断**，
 *   而区间两端是「上海某日 00:00」（UTC 上前一天 16:00）→ 整个区间被向前挪一天：
 *   上月末算进本月、本月末被漏掉（issue #75）。走查询构造器的地方必须先用
 *   `toDateOnlyBounds()` 换成日期边界，否则摘要与榜单会给出两个不同的答案。
 */

import { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/api/errors";
import { getDb } from "@/lib/db/client";
import { toDateOnlyBounds, type UtcRange } from "@/lib/academic-term";
import { approvedRepairWhere, listMemberRepairSummary } from "@/features/repairs/repair-query-service";
import type { RankingMetric } from "@/types/contracts";
import { RANKABLE_MEMBER_STATUS } from "./analytics-policy";

/**
 * `approvedRepairWhere()` 在无附加条件时必须**恰好**产出这些键。
 *
 * 断言「键集合完全一致」而不是逐个检查已知字段：否则将来有人给正式谓词新增
 * 第三个条件（例如排除某类记录），原生 SQL 会**静默忽略**它 ——
 * 界面上的数字与数据库里的口径就悄悄分叉了，而且没有任何报错。
 * 这里宁可让翻译层当场抛错，迫使改动方同时更新 SQL。
 */
const EXPECTED_PREDICATE_KEYS = ["deletedAt", "status"] as const;

/**
 * 把唯一正式谓词翻译成参数化 SQL 片段。
 *
 * 之所以要在这里做一次「谓词 → SQL」的转换，是因为 MySQL 的窗口函数与
 * `DATE_FORMAT` 无法用 Prisma 查询构造器表达，必须走 `$queryRaw`；
 * 但**取值仍来自 `approvedRepairWhere()` 这一唯一入口**。
 *
 * 同时它是一道**断言**：谓词的键集合或取值语义一旦与这里的假设不符就立刻抛错，
 * 而不是让原生 SQL 悄悄用着过时的口径。
 */
export function approvedRepairSql(alias = "rr"): Prisma.Sql {
  const predicate = approvedRepairWhere();

  const keys = Object.keys(predicate).sort();
  if (keys.join(",") !== [...EXPECTED_PREDICATE_KEYS].join(",")) {
    throw new AppError(
      "INTERNAL_ERROR",
      `正式谓词的条件集合已变化（${keys.join(", ")}），原生 SQL 尚未同步`,
    );
  }
  if (typeof predicate.status !== "string") {
    throw new AppError("INTERNAL_ERROR", "正式谓词的状态条件不是字面量");
  }
  if (predicate.deletedAt !== null) {
    throw new AppError("INTERNAL_ERROR", "正式谓词的删除条件不是 IS NULL");
  }
  // status 走参数绑定；别名与本文件其余 SQL 一样是受控字面量。
  return Prisma.sql`${Prisma.raw(`${alias}.status`)} = ${predicate.status} AND ${Prisma.raw(
    `${alias}.deleted_at`,
  )} IS NULL`;
}

/** 只有 `ACTIVE` 且未软删除的成员档案进入当前榜单。 */
function rankableMemberSql(alias = "mp"): Prisma.Sql {
  return Prisma.sql`${Prisma.raw(`${alias}.status`)} = ${RANKABLE_MEMBER_STATUS} AND ${Prisma.raw(
    `${alias}.deleted_at`,
  )} IS NULL`;
}

/** 日期范围 → 参数化 SQL 条件；`null` 表示 `ALL_TIME`，不附加日期条件。 */
function rangeSql(range: UtcRange | null, alias = "rr"): Prisma.Sql {
  if (!range) return Prisma.empty;
  const column = Prisma.raw(`${alias}.repair_date`);
  return Prisma.sql`AND ${column} >= ${range.startInclusive} AND ${column} < ${range.endExclusive}`;
}

/* ------------------------------------------------------------------ 个人摘要 */

/**
 * 个人四项正式指标。
 *
 * **直接委托 M2 已冻结的 `listMemberRepairSummary()`**，而不是在这里重写一遍
 * count/aggregate：那四个指标的「时长缺省按 0」「学期未配置返回 UNCONFIGURED」
 * 等语义已经在 M2/M3 定稿并有测试，重写一遍只会制造第二个真相来源。
 * M5 的贡献是把它的 `source` 标注为 `M5_ANALYTICS`，因为对外契约已改由
 * Analytics Service 提供。
 */
export async function getMemberSummary(
  memberProfileId: string,
  options: { monthRange: UtcRange; termRange?: UtcRange },
) {
  const summary = await listMemberRepairSummary(memberProfileId, options);
  return { ...summary, source: "M5_ANALYTICS" as const };
}

/* -------------------------------------------------------------- 分类分布 */

export type CategoryAggregateRow = {
  categoryId: string | null;
  categoryName: string | null;
  approvedCount: unknown;
  durationMinutes: unknown;
};

/**
 * 按 `categoryId` 在数据库内聚合。
 *
 * 分类名称单独查一次，且**不过滤 `deleted_at`**：分类停用后历史记录仍需
 * 显示其历史名称（任务书 §14），统计不得因停用而改名或消失。
 */
export async function aggregateCategoryDistribution(
  memberProfileId: string,
  range: UtcRange | null,
): Promise<CategoryAggregateRow[]> {
  const db = getDb();
  const grouped = await db.repairRecord.groupBy({
    by: ["categoryId"],
    where: approvedRepairWhere({
      memberProfileId,
      // 同 `listMemberRepairSummary`：`repair_date` 是 DATE 列，区间要先换成日期边界。
      repairDate: range ? toDateOnlyBounds(range) : undefined,
    }),
    _count: { _all: true },
    _sum: { durationMinutes: true },
  });

  const categoryIds = grouped
    .map((row) => row.categoryId)
    .filter((id): id is string => id !== null);
  const names = categoryIds.length
    ? await db.repairCategory.findMany({
        where: { id: { in: categoryIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(names.map((row) => [row.id, row.name]));

  return grouped.map((row) => ({
    categoryId: row.categoryId,
    categoryName: row.categoryId ? (nameById.get(row.categoryId) ?? null) : null,
    approvedCount: row._count._all,
    durationMinutes: row._sum.durationMinutes ?? 0,
  }));
}

/* -------------------------------------------------------------- 月度趋势 */

export type MonthlyAggregateRow = {
  month: string;
  approvedCount: unknown;
  durationMinutes: unknown;
};

/**
 * 指定区间内按上海自然月聚合。
 *
 * `repair_date` 本身已是上海日历日，故**直接取 `%Y-%m`**，不做时区平移。
 */
export async function aggregateMonthlyTrend(
  memberProfileId: string,
  range: UtcRange,
): Promise<MonthlyAggregateRow[]> {
  return getDb().$queryRaw<MonthlyAggregateRow[]>`
    SELECT DATE_FORMAT(rr.repair_date, '%Y-%m') AS month,
           COUNT(*) AS approvedCount,
           COALESCE(SUM(rr.duration_minutes), 0) AS durationMinutes
    FROM repair_records rr
    WHERE rr.member_profile_id = ${memberProfileId}
      AND ${approvedRepairSql("rr")}
      ${rangeSql(range, "rr")}
    GROUP BY month
    ORDER BY month ASC
  `;
}

/* -------------------------------------------------------------- 排行榜 */

export type RankingAggregateRow = {
  memberProfileId: string;
  approvedCount: unknown;
  durationMinutes: unknown;
  rankingPosition: unknown;
};

export type RankingMemberRow = {
  id: string;
  nickname: string | null;
  realName: string | null;
  avatarUrl: string | null;
  displayName: string | null;
};

/** 主指标表达式与展示用次级排序键。**只按白名单分支选取，不接受用户输入拼接。** */
function metricSql(metric: RankingMetric): {
  primary: Prisma.Sql;
  pageTieBreak: Prisma.Sql;
} {
  switch (metric) {
    case "REPAIR_COUNT":
      return {
        primary: Prisma.sql`COUNT(*)`,
        pageTieBreak: Prisma.sql`t.durationMinutes DESC, t.memberProfileId ASC`,
      };
    case "DURATION_MINUTES":
      return {
        primary: Prisma.sql`COALESCE(SUM(rr.duration_minutes), 0)`,
        pageTieBreak: Prisma.sql`t.approvedCount DESC, t.memberProfileId ASC`,
      };
  }
}

/**
 * 聚合子查询：每个成员一行，含竞赛名次（`RANK()` 主指标相同则同名次、后续跳号）。
 *
 * ⚠️ **不要在这里按成员过滤**：`RANK()` 必须建立在**全体有效成员**的集合之上。
 * 一旦把 `member_profile_id = ?` 下推进子查询，窗口函数就只剩一行可排，
 * 名次会恒定返回 1 —— 这正是「我的排名」曾经出错的根因。
 */
function rankedBaseSql(metric: RankingMetric, range: UtcRange | null): Prisma.Sql {
  const { primary } = metricSql(metric);
  return Prisma.sql`
    SELECT rr.member_profile_id AS memberProfileId,
           COUNT(*) AS approvedCount,
           COALESCE(SUM(rr.duration_minutes), 0) AS durationMinutes,
           RANK() OVER (ORDER BY ${primary} DESC) AS rankingPosition
    FROM repair_records rr
    JOIN member_profiles mp ON mp.id = rr.member_profile_id
    WHERE ${approvedRepairSql("rr")}
      AND ${rankableMemberSql("mp")}
      ${rangeSql(range, "rr")}
    GROUP BY rr.member_profile_id
  `;
}

/**
 * 榜单分页。
 *
 * 名次由窗口函数在数据库内算出，分页用 `LIMIT/OFFSET` 下推到数据库；
 * 外层再按「名次 → 次级指标 → memberProfileId」排序，保证同数据下顺序稳定。
 */
export async function listRankingPage(
  metric: RankingMetric,
  range: UtcRange | null,
  skip: number,
  take: number,
): Promise<RankingAggregateRow[]> {
  const { pageTieBreak } = metricSql(metric);
  return getDb().$queryRaw<RankingAggregateRow[]>`
    SELECT t.memberProfileId, t.approvedCount, t.durationMinutes, t.rankingPosition
    FROM (${rankedBaseSql(metric, range)}) t
    ORDER BY t.rankingPosition ASC, ${pageTieBreak}
    LIMIT ${take} OFFSET ${skip}
  `;
}

/** 入榜成员总数（零记录成员不入榜，因此就是分组后的组数）。 */
export async function countRankedMembers(range: UtcRange | null): Promise<number> {
  const rows = await getDb().$queryRaw<Array<{ total: unknown }>>`
    SELECT COUNT(*) AS total FROM (${rankedBaseSql("REPAIR_COUNT", range)}) t
  `;
  const total = rows[0]?.total;
  return typeof total === "bigint" ? Number(total) : Number(total ?? 0);
}

/**
 * 当前成员在指定范围内的聚合值与名次。
 * 返回 `null` 表示该成员在本范围**零条有效记录** ⇒ 不进榜。
 *
 * 名次取自与分页查询**完全相同**的排名子查询（在外层按成员过滤），
 * 因此「我的排名」与榜单里那一行永远一致，且不受分页影响。
 */
export async function getMemberRankingRow(
  metric: RankingMetric,
  range: UtcRange | null,
  memberProfileId: string,
): Promise<RankingAggregateRow | null> {
  const rows = await getDb().$queryRaw<RankingAggregateRow[]>`
    SELECT t.memberProfileId, t.approvedCount, t.durationMinutes, t.rankingPosition
    FROM (${rankedBaseSql(metric, range)}) t
    WHERE t.memberProfileId = ${memberProfileId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** 批次取回展示所需的最小成员字段（**不含 QQ / 手机号 / 学号 / 班级 / userId**）。 */
export async function listRankingMemberInfo(
  memberProfileIds: readonly string[],
): Promise<RankingMemberRow[]> {
  if (memberProfileIds.length === 0) return [];
  const rows = await getDb().memberProfile.findMany({
    where: { id: { in: [...memberProfileIds] } },
    select: {
      id: true,
      nickname: true,
      realName: true,
      avatarUrl: true,
      user: { select: { displayName: true } },
    },
    orderBy: { id: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    nickname: row.nickname,
    realName: row.realName,
    avatarUrl: row.avatarUrl,
    displayName: row.user?.displayName ?? null,
  }));
}
