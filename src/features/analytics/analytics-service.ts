/**
 * M5 个人正式统计 Service（任务书 §9.1）。
 *
 * 本人版本只接受由 Session 推导出的身份，**不接受客户端传入 `memberProfileId`** ——
 * 否则就能通过改参数遍历他人统计（任务书 §11）。M6 的「查看成员统计」另开
 * `getMemberAnalyticsFor`，两者共用 `computeMemberAnalytics`，不写第二套口径。
 */

import { AppError } from "@/lib/api/errors";
import { requirePermission } from "@/lib/auth/permissions";
import { memberProfileRepository } from "@/features/member-profile/member-profile-repository";
import { recentShanghaiMonths, shanghaiDateToUtc } from "@/lib/academic-term";
import { resolveMemberRanges } from "@/features/member-dashboard/member-overview-provider";
import {
  ANALYTICS_TREND_MONTHS,
  type MemberAnalytics,
  type MemberAnalyticsServiceContract,
} from "@/types/contracts";
import {
  aggregateCategoryDistribution,
  aggregateMonthlyTrend,
  getMemberSummary,
} from "./analytics-repository";
import { buildMonthlyTrend, toCategoryDistribution } from "./analytics-view";

export const analyticsService: MemberAnalyticsServiceContract = {
  async getMemberAnalytics(actor): Promise<MemberAnalytics> {
    requirePermission(actor, "analytics:read_internal");
    const self = await memberProfileRepository.activeForUser(actor.userId);
    return computeMemberAnalytics(self.id);
  },

  /**
   * M6「查看成员统计」。
   *
   * 与被查成员是否 `ACTIVE` 无关：管理员要能查看**已禁用**成员的历史统计，
   * 所以这里用 `findById`（只排除软删除），而不是要求 `activeForUser`。
   * 权限码仍是 `analytics:read_internal`，且 `member.profile.read_internal` 的
   * 读取审计由路由层负责（见 `GET /api/v1/admin/members/:id/stats`）。
   */
  async getMemberAnalyticsFor(memberProfileId, actor): Promise<MemberAnalytics> {
    requirePermission(actor, "analytics:read_internal");
    const member = await memberProfileRepository.findById(memberProfileId);
    if (!member) throw new AppError("MEMBER_PROFILE_NOT_FOUND", "成员不存在");
    return computeMemberAnalytics(member.id);
  },
};

/** 个人统计的唯一实现：本人版本与管理端版本都必须走这里，禁止各写一套口径。 */
async function computeMemberAnalytics(memberProfileId: string): Promise<MemberAnalytics> {
  const now = new Date();
  // 与工作台/个人主页共用同一套日期口径；学期配置非法时由它按 M3 规则抛出。
  const { monthRange, termRange } = resolveMemberRanges(now);

  const months = recentShanghaiMonths(now, ANALYTICS_TREND_MONTHS);
  const trendStart = shanghaiDateToUtc(`${months[0]}-01`);
  if (!trendStart) throw new Error("趋势窗口起点异常");

  const [summary, categoryRows, trendRows] = await Promise.all([
    getMemberSummary(memberProfileId, { monthRange, termRange }),
    // 分类分布不附加日期条件：它描述的是「该成员的累计构成」。
    aggregateCategoryDistribution(memberProfileId, null),
    aggregateMonthlyTrend(memberProfileId, {
      startInclusive: trendStart,
      endExclusive: monthRange.endExclusive,
    }),
  ]);

  return {
    summary,
    categoryDistribution: toCategoryDistribution(categoryRows),
    monthlyTrend: buildMonthlyTrend(months, trendRows),
    generatedAt: summary.generatedAt,
  };
}
