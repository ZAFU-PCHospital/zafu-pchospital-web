import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { canAccessActivityWorkspace } from "@/lib/auth/activity-workspace-access";
import { enforcePageAccountAccess, requirePagePrincipal } from "@/lib/auth/page-access";

/** 活动对象页使用活动权限；不要求管理员拥有成员档案。 */
export const requireActivityPage = cache(async () => {
  const principal = await requirePagePrincipal();
  await enforcePageAccountAccess(principal);
  if (!canAccessActivityWorkspace(principal.permissions)) {
    redirect("/member");
  }
  return principal;
});
