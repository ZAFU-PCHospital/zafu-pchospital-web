import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { authService } from "@/features/auth/auth-service";
import { SESSION_COOKIE_NAME } from "@/lib/auth/request";

/**
 * 管理后台页面（`/admin/**`）的统一入口守卫。
 *
 * 与 `member-page.ts` 的三条档位规则一致，只是最后一条换成角色判定：
 * 1. 无有效会话 / 会话失效 → `/login`；
 * 2. 需要强制改密 → `/account/change-password`（未改密的管理员连管理接口都会被
 *    `authenticateRequest` 拒掉，先改密才不会一进后台就处处 403）；
 * 3. 已登录但不是管理员 → `/member`。
 *
 * ⚠️ `/admin` 首页也调用本守卫，因此这里**不能**把非管理员重定向到 `/admin` 自身
 * （会形成重定向自环），必须指向站内另一处合法落点：成员工作台。
 *
 * 这只是「页面能不能渲染」的第一道闸门。所有数据都来自 `/api/v1/admin/*`，
 * 那条链路有独立的 `requirePermission(actor, "…")` 校验 —— 前端守卫被绕过也不会泄漏数据
 * （需求 §41：后端权限校验不能依赖前端按钮是否显示）。
 */
export async function requireAdminPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value ?? "";
  let principal;
  try {
    principal = await authService.authenticate(token);
  } catch {
    redirect("/login");
  }
  if (principal.mustChangePassword) redirect("/account/change-password");
  if (!principal.roles.includes("ADMIN")) redirect("/member");
  return principal;
}
