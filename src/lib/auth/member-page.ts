import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { authService } from "@/features/auth/auth-service";
import { SESSION_COOKIE_NAME } from "@/lib/auth/request";

/**
 * 成员页面（`/member/**`）的统一入口守卫。
 *
 * 只负责两件与「身份认证」直接相关的事：未登录 → `/login`；
 * 需要强制改密 → `/account/change-password`。
 *
 * ⚠️ **不要在守卫里再重定向「已登录但没有有效成员档案」的用户**。
 * 曾写成 `redirect("/member")`，而 `/member` 自身也调用本守卫，
 * 于是这类用户会在 `/member` 上无限重定向（重定向自环）。
 * 该情形由 `/member` 页面自行渲染明确的「尚未开通成员身份」空态，
 * 其余 `/member/repairs/**` 页面用下面的 `requireActiveMemberPage()`。
 */
export async function requireMemberPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value ?? "";
  let principal;
  try {
    principal = await authService.authenticate(token);
  } catch {
    redirect("/login?reason=expired");
  }
  if (principal.mustChangePassword) redirect("/account/change-password");
  return principal;
}

/**
 * 在 `requireMemberPage()` 之上再要求「有效成员档案」。
 *
 * 用于必须拥有成员身份才能操作的页面（`/member/repairs/**`）。
 * 此时重定向到 `/account/change-password` 会让用户莫名改密，
 * 而重定向到 `/member` 又可能自环 —— 因此统一回到 `/login`
 * 并让用户重新登录；这不是死循环（`/login` 不调用本守卫）。
 */
export async function requireActiveMemberPage() {
  const principal = await requireMemberPage();
  if (!principal.memberProfileId || principal.memberStatus !== "ACTIVE") {
    redirect("/login");
  }
  return principal;
}
