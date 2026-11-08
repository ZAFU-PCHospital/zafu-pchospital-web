/**
 * 成员工作台「已接待」区块的标签 class（issue #368）。
 *
 * 为什么不继续用 `repair-tag--${recordStatus.toLowerCase()}`：`PENDING`（待审核）会落到
 * `repair-tag--pending`，与同列表里「待补建」用的警示橙**完全相同**，两行相邻时分不清
 * 「等我们补建」还是「等审核」。这里显式映射，「待审核」改用 `repair-tag--review`（品牌色），
 * 其余状态保持既有语义档位。
 *
 * 只影响成员端渲染：`repair-tag--pending` 的定义与后台调用方（招募列表、公开活动 FULL 标签）
 * 一律不动，避免顺手改掉后台观感。
 */
const RECORD_STATUS_TAG_CLASS: Record<string, string> = {
  DRAFT: "repair-tag repair-tag--draft",
  PENDING: "repair-tag repair-tag--review",
  APPROVED: "repair-tag repair-tag--approved",
  REJECTED: "repair-tag repair-tag--rejected",
};

/** 维修单状态 → 标签 class；未知状态回落到中性档，绝不拼出不存在的类名。 */
export function recordStatusTagClass(status: string): string {
  return RECORD_STATUS_TAG_CLASS[status] ?? "repair-tag repair-tag--draft";
}

/**
 * 「你已出勤」标签：成功色。
 *
 * 原本与「待审核」共用 `admin-tag--accent`（品牌色），两处同屏时语义会串；改成成功色后，
 * 看板上的三种状态（已出勤=绿 / 待补建=橙 / 待审核=品牌色）两两可辨。
 */
export const ATTENDED_TAG_CLASS = "admin-tag admin-tag--served";
