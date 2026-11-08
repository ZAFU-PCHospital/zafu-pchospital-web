import type { MemberDashboard, MemberPendingServe, MemberWorkQueue } from "@/types/contracts";

/** 待补单列表与失败状态分开返回，避免把读取失败当成空态。 */
export function pendingServesState(
  data: Pick<MemberDashboard, "pendingServes" | "degraded"> | null,
): { items: MemberPendingServe[]; failed: boolean } {
  return {
    items: data?.pendingServes ?? [],
    failed: data?.degraded.includes("pendingServes") ?? false,
  };
}

/**
 * 「全部完成」只在所有待办区块都已加载且确实为空时出现。
 * 未读为 null 表示通知查询失败，不能当作已清零。
 */
export function isDashboardAllClear(input: {
  queue: MemberWorkQueue | null;
  pendingServeCount: number;
  pendingServesFailed: boolean;
  unread: number | null;
}): boolean {
  return (
    input.queue !== null &&
    input.queue.draftCount === 0 &&
    input.queue.pendingCount === 0 &&
    input.queue.rejectedCount === 0 &&
    input.pendingServeCount === 0 &&
    !input.pendingServesFailed &&
    input.unread === 0
  );
}
