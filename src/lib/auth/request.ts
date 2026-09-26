import { AppError } from "@/lib/api/errors";
import { clientIp } from "@/lib/api/client-ip";
import { getServerEnv } from "@/lib/env";
import { authService } from "@/features/auth/auth-service";
import type { AuthorizedActor, PublicRequestContext, SessionPrincipal } from "@/types/contracts";

export const SESSION_COOKIE_NAME = "pc_hospital_session";

export function requestContext(request: Request, requestId: string): PublicRequestContext {
  return {
    requestId,
    ipAddress: clientIp(request),
    userAgent: request.headers.get("user-agent") ?? undefined,
  };
}

export function readSessionToken(request: Request): string {
  const cookie = request.headers.get("cookie") ?? "";
  return (
    cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`))
      ?.slice(SESSION_COOKIE_NAME.length + 1) ?? ""
  );
}

export async function authenticateRequest(
  request: Request,
  requestId: string,
  allowForcedPasswordChange = false,
): Promise<{
  principal: SessionPrincipal & { sessionId: string; expiresAt: string };
  actor: AuthorizedActor;
  token: string;
}> {
  const context = requestContext(request, requestId);
  const token = readSessionToken(request);
  if (!token) throw new AppError("UNAUTHENTICATED", "请先登录");
  const principal = await authService.authenticate(token);
  if (principal.mustChangePassword && !allowForcedPasswordChange)
    throw new AppError("PASSWORD_CHANGE_REQUIRED", "请先修改初始密码");
  return {
    principal,
    token,
    actor: {
      ...context,
      actorType: "USER",
      userId: principal.userId,
      userStatus: "ACTIVE",
      permissions: principal.permissions,
      mustChangePassword: principal.mustChangePassword,
    },
  };
}

/** 允许的请求来源：APP_BASE_URL（生产是站点正式域名）及其 www 变体。 */
function allowedOrigins(): Set<string> {
  let base: URL;
  try {
    base = new URL(getServerEnv().APP_BASE_URL);
  } catch {
    throw new AppError("INTERNAL_ERROR", "APP_BASE_URL 配置无效", { status: 500 });
  }
  const host = base.hostname.toLowerCase();
  const alternate = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
  const port = base.port ? `:${base.port}` : "";
  return new Set([`${base.protocol}//${host}${port}`, `${base.protocol}//${alternate}${port}`]);
}

/**
 * 写接口的 CSRF 防线：Origin 必须落在允许来源白名单内。
 *
 * 不要拿 Origin 去比请求自身的 Host / X-Forwarded-Host —— 那两个值由请求方控制，
 * 伪造 `Host: evil.com` + `Origin: https://evil.com` 就能通过（2026-09 安全审计 F4 实测），
 * DNS rebinding 下可直接打穿全部写接口。
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) throw new AppError("FORBIDDEN", "请求来源无效");
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new AppError("FORBIDDEN", "请求来源无效");
  }
  const candidate = `${parsed.protocol}//${parsed.hostname.toLowerCase()}${
    parsed.port ? `:${parsed.port}` : ""
  }`;
  if (!allowedOrigins().has(candidate)) throw new AppError("FORBIDDEN", "请求来源无效");
}

export function sessionCookie(token: string, expiresAt: string) {
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: new Date(expiresAt),
  };
}
