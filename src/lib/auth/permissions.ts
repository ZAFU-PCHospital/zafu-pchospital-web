import { AppError } from "@/lib/api/errors";
import type { AuthorizedActor, Permission, RoleCode } from "@/types/contracts";

export const rolePermissions: Readonly<Record<RoleCode, readonly Permission[]>> = {
  MEMBER: ["invite:redeem"],
  ADMIN: [
    "join:read",
    "join:review",
    "member:provision",
    "invite:create",
    "invite:read",
    "invite:revoke",
    "audit:read",
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
