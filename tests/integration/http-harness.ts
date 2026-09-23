import { randomUUID } from "node:crypto";

import { SESSION_COOKIE_NAME } from "../../src/lib/auth/request";
import { getDb } from "../../src/lib/db/client";
import { digestSessionToken } from "../../src/lib/security/secrets";
import type { RoleCode } from "../../src/types/contracts";

/**
 * 路由级集成测试的极小装置。
 *
 * 本仓库没有 HTTP 测试基础设施，也不需要为它起一个 next server：路由处理函数就是普通
 * 函数，传一个 `Request` 进去即可（M3 起就这么做，这里抽出来给后续用例复用，
 * 免得每个文件各抄一份）。
 */

/**
 * 直接调用路由处理函数。
 *
 * 写接口会走 `assertSameOrigin()`：它要求 origin 与 host 同时存在且一致。
 * undici 的 `Request` 不允许手工覆盖 `host`（会被剥离），因此这里给 `assertSameOrigin`
 * 优先读取的 `x-forwarded-host`。
 */
export async function callRoute(
  handler: (request: Request, context?: never) => Promise<Response>,
  url: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const parsed = new URL(url);
  const request = new Request(url, {
    method: init.method ?? "GET",
    headers: {
      origin: parsed.origin,
      "x-forwarded-host": parsed.host,
      host: parsed.host,
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const response = await handler(request);
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

/**
 * 给某个用户造一个能通过 `authenticateRequest` 的会话，返回可直接放进 `cookie` 头的值。
 *
 * 两件事必须同时成立，否则测到的是鉴权分支而不是业务分支：
 *
 * 1. **有角色**（管理员接口要求 ADMIN）；
 * 2. **不是「首次登录必须改密」** —— 这种账号 `authenticateRequest` 一律 403
 *    （`PASSWORD_CHANGE_REQUIRED`），`memberService.create` 造出来的账号正好是这种。
 */
export async function sessionCookie(userId: string, roleCode: RoleCode = "ADMIN"): Promise<string> {
  const db = getDb();
  const now = new Date();
  const role = await db.role.findUnique({ where: { code: roleCode } });
  if (!role) throw new Error(`角色 ${roleCode} 不存在，先跑一次 pnpm db:seed`);
  await db.userRole.create({
    data: {
      id: randomUUID(),
      userId,
      roleId: role.id,
      sourceType: "ADMIN_CREATED",
      sourceId: userId,
      grantedAt: now,
      activeKey: `${userId}:${role.id}`,
    },
  });
  await db.passwordCredential.updateMany({
    where: { userId },
    data: { mustChangePassword: false, passwordChangedAt: now },
  });
  const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  await db.authSession.create({
    data: {
      id: randomUUID(),
      userId,
      tokenDigest: digestSessionToken(token),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    },
  });
  return `${SESSION_COOKIE_NAME}=${token}`;
}
