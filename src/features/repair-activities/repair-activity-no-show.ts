/** 客户身份暂以规范化姓名 + 手机号精确匹配；不关联 users / member_profiles。 */
export function normalizeCustomerName(name: string): string {
  return name.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

export const CUSTOMER_NO_SHOW_BLOCK_THRESHOLD = 1;

export const RepairActivityNoShowState = ["CANDIDATE", "CONFIRMED", "EXCUSED"] as const;
export type RepairActivityNoShowState = (typeof RepairActivityNoShowState)[number];

export type NoShowCandidateInput = {
  status: string;
  deletedAt: Date | null;
  activityEnd: Date;
};

/**
 * 只有活动上海自然日结束仍未签到才算 no-show。
 * 结束前软删是取消；结束后才软删仍保留未到场事实。
 */
export function isNoShowCandidate(input: NoShowCandidateInput): boolean {
  if (input.status !== "REGISTERED") return false;
  if (!input.deletedAt) return true;
  return input.deletedAt.getTime() >= input.activityEnd.getTime();
}

export type CustomerBlockState = {
  blockedUntil: Date;
  liftedAt: Date | null;
};

export type CustomerBlockStatus = "ACTIVE" | "LIFTED" | "EXPIRED";

export function customerBlockStatus(
  block: CustomerBlockState,
  now: Date = new Date(),
): CustomerBlockStatus {
  if (block.liftedAt) return "LIFTED";
  return block.blockedUntil.getTime() > now.getTime() ? "ACTIVE" : "EXPIRED";
}

export function isCustomerBlockActive(
  block: CustomerBlockState | null | undefined,
  now: Date = new Date(),
): boolean {
  return Boolean(block && customerBlockStatus(block, now) === "ACTIVE");
}
