import { requirePermission } from "@/lib/auth/permissions";
import { memberProfileRepository } from "@/features/member-profile/member-profile-repository";
import { memberProfilePolicy } from "@/features/member-profile/member-profile-policy";
import {
  loadMemberOverview,
  type MemberOverviewResult,
} from "@/features/member-dashboard/member-overview-provider";
import { skillRepository } from "@/features/skills/skill-repository";
import { toSkillView } from "@/features/skills/skill-service";
import { summarizeFavorites } from "@/features/community/favorite-service";
import { summarizeNotifications } from "@/features/community/notification-service";
import { rankingService } from "@/features/analytics/ranking-service";
import { listPendingServesForMember } from "@/features/repair-activities/repair-activity-staff-service";
import {
  settleCommunity,
  toFavoriteSummary,
  toNotificationSummary,
  toRankingPreview,
} from "@/features/member-dashboard/community-summary";
import type {
  AuthorizedActor,
  MemberDashboard,
  MemberDashboardDegraded,
  MemberDashboardServiceContract,
  MemberRepairSummary,
  MemberWorkQueue,
} from "@/types/contracts";
import { MEMBER_RECENT_REPAIR_LIMIT } from "@/types/contracts";

/**
 * 成员工作台聚合服务（M3 任务书 §6.3、§9、§12.1；M4 接入通知与收藏摘要）。
 *
 * 只接受 actor 推导出的身份，**不接受客户端传入 memberProfileId**。
 * M5 起排行接入位返回真实的本学年维修数量榜预览（`ranking`）。
 */

export const memberDashboardService: MemberDashboardServiceContract = {
  async getDashboard(actor: AuthorizedActor, now: Date = new Date()): Promise<MemberDashboard> {
    requirePermission(actor, "member.profile.read_self");
    const row = await memberProfileRepository.activeForUser(actor.userId);

    const [skills, overview, notifications, favorites, ranking, pendingServes] = await Promise.all([
      skillRepository.listMemberSkills(row.id),
      loadMemberOverview({
        memberProfileId: row.id,
        now,
        recentLimit: MEMBER_RECENT_REPAIR_LIMIT,
      }),
      settleCommunity(summarizeNotifications(row.id, actor)),
      settleCommunity(summarizeFavorites(row.id)),
      settleCommunity(rankingService.getYearPreview(row.id, actor, now)),
      settleCommunity(listPendingServesForMember(row.id)),
    ]);

    return {
      profile: memberProfilePolicy.toSummary(row, skills.map(toSkillView)),
      repairSummary:
        overview.repairSummary.status === "ready" ? overview.repairSummary.data : EMPTY_SUMMARY,
      workQueue: overview.workQueue.status === "ready" ? overview.workQueue.data : EMPTY_QUEUE,
      pendingServes: pendingServes.status === "ready" ? pendingServes.data : [],
      recentRepairs: overview.recentRepairs.status === "ready" ? overview.recentRepairs.data : [],
      recentActivity:
        overview.recentActivity.status === "ready" ? overview.recentActivity.data : [],
      degraded: [
        ...degradedSections(overview),
        ...(pendingServes.status === "failed" ? (["pendingServes"] as const) : []),
        ...(notifications.status === "failed" ? (["notifications"] as const) : []),
        ...(favorites.status === "failed" ? (["favorites"] as const) : []),
        ...(ranking.status === "failed" ? (["ranking"] as const) : []),
      ],
      notifications: toNotificationSummary(notifications),
      favorites: toFavoriteSummary(favorites),
      ranking: toRankingPreview(ranking),
    };
  },
};

/**
 * 空摘要：**只在区块失败时**作为结构占位，且所有 MetricValue 标为 `UNAVAILABLE`，
 * 保证前端渲染出「暂不可用」而不是伪造的 0。
 *
 * `source` 与正常路径保持一致（M5 起正式统计由 Analytics 提供服务）。
 */
const EMPTY_SUMMARY: MemberRepairSummary = {
  totalApprovedCount: { value: null, status: "UNAVAILABLE" },
  yearApprovedCount: { value: null, status: "UNAVAILABLE" },
  monthApprovedCount: { value: null, status: "UNAVAILABLE" },
  totalApprovedDurationMinutes: { value: null, status: "UNAVAILABLE" },
  source: "M5_ANALYTICS",
  generatedAt: new Date(0).toISOString(),
};

const EMPTY_QUEUE: MemberWorkQueue = { draftCount: 0, pendingCount: 0, rejectedCount: 0 };

/** 列出失败的区块名，供页面做局部错误展示。 */
function degradedSections(overview: MemberOverviewResult): MemberDashboardDegraded[] {
  const degraded: MemberDashboardDegraded[] = [];
  if (overview.repairSummary.status === "failed") degraded.push("repairSummary");
  if (overview.workQueue.status === "failed") degraded.push("workQueue");
  if (overview.recentRepairs.status === "failed") degraded.push("recentRepairs");
  if (overview.recentActivity.status === "failed") degraded.push("recentActivity");
  return degraded;
}
