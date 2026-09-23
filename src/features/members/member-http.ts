import { AppError } from "@/lib/api/errors";
import { parseFilters } from "@/lib/api/list-filter";
import { sortRules } from "@/lib/api/list-query";
import { MEMBER_FILTERABLE } from "@/features/members/member-filter-fields";
import { MEMBER_SORTABLE } from "@/features/members/member-sort";
import { MemberStatus, RoleCode } from "@/types/contracts";
import type { MemberListInput, RoleCode as RoleCodeType } from "@/types/contracts";

/**
 * 成员管理端路由的入参解析（M6）。
 *
 * 与 M4 `community-http.ts`、M5 `analytics-http.ts` 同一原则：URL 参数 → 受控 Enum
 * 的转换集中一处，**只接受白名单取值**，非法输入返回稳定错误码，
 * 绝不把用户字符串透传给查询。
 *
 * `sort` 沿用同一原则：格式 `sort=joinedAt:desc,realName:asc`，字段必须落在
 * `MEMBER_SORTABLE` 内（`sortRules` 负责校验方向、去重与条数上限）。
 */
export function memberListInput(
  params: URLSearchParams,
  page: number,
  pageSize: number,
): MemberListInput {
  return {
    page,
    pageSize,
    query: params.get("query")?.trim() || undefined,
    status: oneOf(params.get("status"), MemberStatus, "status"),
    role: oneOf(params.get("role"), RoleCode, "role"),
    sort: sortRules(params.get("sort"), MEMBER_SORTABLE),
    // 列级筛选：`filter=<field>:<op>:<value>`，可重复。白名单与运算符在同一模块里校验。
    filters: parseFilters(params.getAll("filter"), MEMBER_FILTERABLE),
  };
}

function oneOf<T extends string>(
  value: string | null,
  values: readonly T[],
  name: string,
): T | undefined {
  if (!value) return undefined;
  if (!(values as readonly string[]).includes(value))
    throw new AppError("VALIDATION_FAILED", `${name} 参数无效`);
  return value as T;
}

/** 角色集合解析：只允许契约里的角色码，且不允许空集合。 */
export function roleSet(body: Record<string, unknown>): RoleCodeType[] {
  const value = body.roles;
  if (!Array.isArray(value)) throw new AppError("MEMBER_ROLE_INVALID", "roles 必须是数组");
  const roles = [...new Set(value.map((item) => (typeof item === "string" ? item : "")))];
  if (roles.length === 0 || roles.some((role) => !(RoleCode as readonly string[]).includes(role)))
    throw new AppError("MEMBER_ROLE_INVALID", "角色集合无效");
  return roles as RoleCodeType[];
}

/** 乐观锁版本号解析。 */
export function requiredVersion(body: Record<string, unknown>): number {
  const value = Number(body.version);
  if (!Number.isInteger(value) || value < 1)
    throw new AppError("VALIDATION_FAILED", "version 必须是正整数");
  return value;
}

/** 可空文本字段：`undefined` = 不改，`null` / 空串 = 清空。 */
export function nullableText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return String(value);
}
