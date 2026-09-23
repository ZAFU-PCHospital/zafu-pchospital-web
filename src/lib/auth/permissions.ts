import { AppError } from "@/lib/api/errors";
import type { AuthorizedActor, Permission, RoleCode } from "@/types/contracts";

export const rolePermissions: Readonly<Record<RoleCode, readonly Permission[]>> = {
  MEMBER: [
    "invite:redeem",
    "repair:create",
    "repair:read",
    "repair:update",
    "repair:submit",
    "member.profile.read_self",
    "member.profile.update_self",
    "member.profile.read_internal",
    "member.skill.assign_self",
    "comment:create",
    "comment:read",
    "favorite:manage",
    "notification:read",
    "analytics:read_internal",
  ],
  ADMIN: [
    "join:read",
    "join:review",
    "member:provision",
    "member:manage",
    "invite:create",
    "invite:read",
    "invite:revoke",
    "audit:read",
    "repair:create",
    "repair:read",
    "repair:update",
    "repair:submit",
    "repair:review",
    "repair:delete",
    "repair:flag",
    "repair:category:manage",
    "member.profile.read_self",
    "member.profile.update_self",
    "member.profile.read_internal",
    "member.skill.assign_self",
    "comment:create",
    "comment:read",
    "comment:delete",
    "favorite:manage",
    "notification:read",
    "analytics:read_internal",
    // M6：导出等于把站内数据带出系统，只给管理员。
    "data:export",
    // M6 批次 2
    "comment:moderate",
    "skill:manage",
    "settings:manage",
  ],
};

export function permissionsForRoles(roles: readonly RoleCode[]): Permission[] {
  return [...new Set(roles.flatMap((role) => rolePermissions[role]))];
}

export function requirePermission(
  actor: AuthorizedActor | null,
  permission: Permission,
): AuthorizedActor {
  if (!actor) throw new AppError("UNAUTHENTICATED", "请先登录");
  if (actor.userStatus !== "ACTIVE") throw new AppError("FORBIDDEN", "账号当前不可用");
  if (actor.actorType === "USER" && !actor.userId) {
    throw new AppError("UNAUTHENTICATED", "登录状态无效");
  }
  if (!actor.permissions.includes(permission)) {
    throw new AppError("FORBIDDEN", "没有执行该操作的权限");
  }
  return actor;
}
