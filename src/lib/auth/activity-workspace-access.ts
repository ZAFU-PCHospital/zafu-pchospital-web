import type { Permission } from "@/types/contracts";

/** 仅单个活动对象页可使用活动权限；列表和其他后台路径仍要求管理员。 */
export function isActivityObjectPath(pathname: string | null) {
  return /^\/admin\/repair-activities\/[^/]+$/.test(pathname ?? "");
}

export function canAccessActivityWorkspace(permissions: readonly Permission[]) {
  return permissions.includes("activity:admin") || permissions.includes("activity:staff");
}
