import { AppError } from "@/lib/api/errors";
import {
  assertValidIssueType,
  validateCheckInIssueTypeUpdates,
  type RepairActivityIssueType,
} from "@/features/repair-activities/repair-activity-validation";

export function bodyRequiredInt(
  body: Record<string, unknown>,
  key: string,
  range: { min: number; max: number },
): number {
  const value = Number(body[key]);
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    throw new AppError("VALIDATION_FAILED", `${key} 必须是 ${range.min}–${range.max} 的整数`);
  }
  return value;
}

export function bodyCheckInIssueTypeUpdates(
  body: Record<string, unknown>,
  registrationIds: string[],
) {
  return validateCheckInIssueTypeUpdates(body.issueTypeUpdates, registrationIds);
}

export function bodyRequiredIsoDate(body: Record<string, unknown>, key: string): Date {
  const raw = body[key];
  if (typeof raw !== "string" || !raw.trim()) {
    throw new AppError("VALIDATION_FAILED", `${key} 不能为空`);
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new AppError("VALIDATION_FAILED", `${key} 时间格式无效`);
  }
  return date;
}

export function bodyOptionalIsoDate(body: Record<string, unknown>, key: string): Date | undefined {
  if (!(key in body) || body[key] === undefined || body[key] === null) return undefined;
  return bodyRequiredIsoDate(body, key);
}

/**
 * 选填时间的「三态」解析：缺字段 → `undefined`（保持原值），`null` → `null`（显式清空），
 * 字符串 → 按必填格式解析。`bodyOptionalIsoDate` 把 `null` 当成未提供，无法表达清空，
 * 因此需要清空的字段（如活动结束时间）用本函数。
 */
export function bodyNullableIsoDate(
  body: Record<string, unknown>,
  key: string,
): Date | null | undefined {
  if (!(key in body)) return undefined;
  if (body[key] === null) return null;
  return bodyRequiredIsoDate(body, key);
}

export function bodyIssueType(body: Record<string, unknown>): RepairActivityIssueType {
  return assertValidIssueType(body.issueType);
}

export function bodyRequiredStringId(body: Record<string, unknown>, key: string): string {
  const raw = body[key];
  if (typeof raw !== "string" || !raw.trim()) {
    throw new AppError("VALIDATION_FAILED", `${key} 不能为空`);
  }
  return raw.trim();
}

export function bodyRegistrationIds(body: Record<string, unknown>): string[] {
  const raw = body.registrationIds;
  if (!Array.isArray(raw)) {
    throw new AppError("VALIDATION_FAILED", "registrationIds 必须是数组", {
      fieldErrors: { registrationIds: ["请选择报名记录"] },
    });
  }
  const ids = raw.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  if (ids.length === 0) {
    throw new AppError("VALIDATION_FAILED", "请至少选择一条报名记录", {
      fieldErrors: { registrationIds: ["请至少选择一条"] },
    });
  }
  if (ids.some((id) => id.length > 36)) {
    throw new AppError("VALIDATION_FAILED", "报名 ID 无效");
  }
  return ids;
}
