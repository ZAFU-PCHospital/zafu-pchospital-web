import type { SessionPrincipal } from "@/types/contracts";

export function loginDestination(
  principal: Pick<SessionPrincipal, "mustChangePassword" | "roles">,
): string {
  if (principal.mustChangePassword) return "/account/change-password";
  return principal.roles.includes("ADMIN") ? "/admin" : "/member";
}
