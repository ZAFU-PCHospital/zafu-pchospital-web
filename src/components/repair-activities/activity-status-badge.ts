import type { RepairActivityStatus } from "@/features/repair-activities/repair-activity-validation";

/**
 * 公开维修活动五态 → `.repair-tag` 语义 class（T-FE-3 映射；列表与详情共用）。
 * OPEN 可行动 / FULL 警告 / UPCOMING·CLOSED 中性 / ENDED 结果中性。
 */
export function repairActivityStatusBadgeClass(status: string): string {
  switch (status as RepairActivityStatus) {
    case "OPEN":
      return "repair-tag repair-tag--approved";
    case "FULL":
      return "repair-tag repair-tag--pending";
    case "UPCOMING":
    case "CLOSED":
      return "repair-tag repair-tag--draft";
    case "ENDED":
      return "repair-tag repair-tag--result";
    default:
      return "repair-tag repair-tag--draft";
  }
}

/**
 * 成员端状态标签（issue #239 / #367）：报名状态本身一律中性。
 *
 * issue #367 起签到窗口（活动开始前 30 分钟）与报名截止解耦，`CLOSED` 不再等于
 * 「可出勤」，所以不再按状态强调；改成按**签到窗口是否已开放**强调，
 * 与「现在能不能操作」一致。文案见 `memberRepairActivityStatusLabels`。
 */
export function memberRepairActivityStatusBadgeClass(
  status: string,
  checkInOpen = false,
): string {
  return checkInOpen && status !== "ENDED" ? "admin-tag admin-tag--accent" : "admin-tag";
}
