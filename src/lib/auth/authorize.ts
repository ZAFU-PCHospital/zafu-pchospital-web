import { AppError } from "@/lib/api/errors";
import { permissionsForRoles } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import { RoleCode } from "@/types/contracts";
import type { AuthorizedActor, RequestContext, RoleCode as RoleCodeType } from "@/types/contracts";

/** Builds an actor from persisted account state; callers must never trust roles supplied by a client. */
export async function authorizeUser(
  userId: string | null | undefined,
  context: RequestContext,
): Promise<AuthorizedActor> {
  if (!userId) throw new AppError("UNAUTHENTICATED", "请先登录");
  const user = await getDb().user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      status: true,
      roles: {
        where: { revokedAt: null },
        select: { role: { select: { code: true } } },
      },
    },
  });
  if (!user) throw new AppError("UNAUTHENTICATED", "登录状态无效");
  if (user.status !== "ACTIVE") throw new AppError("FORBIDDEN", "账号当前不可用");
  const roles = user.roles
    .map((entry) => entry.role.code)
    .filter((code): code is RoleCodeType => RoleCode.includes(code as RoleCodeType));
  return {
    ...context,
    actorType: "USER",
    userId: user.id,
    userStatus: "ACTIVE",
    permissions: permissionsForRoles(roles),
  };
}
