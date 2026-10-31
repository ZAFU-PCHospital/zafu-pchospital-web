import { randomUUID } from "node:crypto";

import { AppError } from "@/lib/api/errors";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { permissionsForRoles } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { normalizeQq } from "@/lib/security/normalization";
import { isPasswordLengthValid, passwordLengthMessage } from "@/lib/security/password-policy";
import {
  digestAccountThrottleKey,
  digestLoginThrottleKey,
  digestSessionToken,
  generateSessionToken,
  hashPassword,
  verifyPassword,
} from "@/lib/security/secrets";
import { TEMPORARY_SESSION_MAX_MS } from "@/lib/security/temporary-password";
import type {
  AuthSessionResult,
  ChangePasswordInput,
  LoginInput,
  PublicRequestContext,
  RoleCode,
  SessionPrincipal,
} from "@/types/contracts";

const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const REMEMBERED_SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1_000;
const THROTTLE_WINDOW_MS = 15 * 60 * 1_000;
const THROTTLE_BLOCK_MS = 15 * 60 * 1_000;
const THROTTLE_MAX_FAILURES = 5;
const THROTTLE_PURGE_INTERVAL_MS = 60 * 60 * 1_000;
let lastThrottlePurgeAt = 0;
let placeholderHash: Promise<string> | undefined;

export class AuthService {
  async login(input: LoginInput, context: PublicRequestContext): Promise<AuthSessionResult> {
    if (input.rememberMe !== undefined && typeof input.rememberMe !== "boolean")
      throw new AppError("VALIDATION_FAILED", "rememberMe 必须为布尔值");
    const qq = safeNormalizeQq(input.qq);
    const keyDigest = digestLoginThrottleKey(qq ?? input.qq.trim(), context.ipAddress ?? "unknown");
    await assertNotThrottled(keyDigest);

    const identity = qq
      ? await getDb().userIdentity.findUnique({
          where: { type_identifierNormalized: { type: "QQ", identifierNormalized: qq } },
          include: { user: { include: { passwordCredential: true } } },
        })
      : null;
    const credential = identity?.deletedAt ? null : identity?.user.passwordCredential;

    // —— 临时凭据分支：先判定「是否临时凭据」再校验期限与消费状态。
    // `temporaryExpiresAt` 非空的凭据即使已过期 / 已消费，也不能落回普通密码分支 ——
    // 否则一个到期的临时口令会被当作普通密码继续可用。
    if (identity && !identity.deletedAt && credential && credential.temporaryExpiresAt !== null) {
      return this.loginWithTemporaryPassword(
        identity.userId,
        credential,
        input.password,
        keyDigest,
        context,
      );
    }

    const passwordValid = await verifyPassword(
      input.password,
      credential?.passwordHash ?? (await getPlaceholderHash()),
    );
    if (!identity || !credential || !passwordValid) {
      await recordFailure([keyDigest], context);
      throw new AppError("AUTH_INVALID_CREDENTIALS", "QQ 号或密码错误");
    }
    if (identity.user.deletedAt || identity.user.status !== "ACTIVE") {
      await auditAuth(context, "auth.login.denied", identity.userId, "ACCOUNT_DISABLED");
      throw new AppError("AUTH_INVALID_CREDENTIALS", "QQ 号或密码错误");
    }

    let principal: SessionPrincipal;
    try {
      principal = await this.readPrincipal(identity.userId);
    } catch (error) {
      if (
        error instanceof AppError &&
        (error.code === "ACCOUNT_DISABLED" || error.code === "MEMBER_PROFILE_INACTIVE")
      ) {
        await auditAuth(context, "auth.login.denied", identity.userId, error.code);
        throw new AppError("AUTH_INVALID_CREDENTIALS", "QQ 号或密码错误");
      }
      throw error;
    }

    await getDb().loginThrottle.deleteMany({ where: { keyDigest } });
    const token = generateSessionToken();
    const now = new Date();
    const rememberMe = input.rememberMe === true;
    const expiresAt = new Date(now.getTime() + sessionLifetime(rememberMe));
    const sessionId = randomUUID();
    const verifiedVersion = credential.credentialVersion;
    await inSerializableTransaction(async (tx) => {
      // 建 Session 前复核凭据代次：验密之后、本事务之前若有管理员重置，
      // 旧哈希换来的一次校验结果绝不能给新一代凭据建立有效会话。
      await tx.$queryRaw`SELECT user_id FROM password_credentials WHERE user_id = ${identity.userId} FOR UPDATE`;
      const fresh = await tx.passwordCredential.findUnique({ where: { userId: identity.userId } });
      if (!fresh || fresh.credentialVersion !== verifiedVersion)
        throw new AppError("AUTH_INVALID_CREDENTIALS", "QQ 号或密码错误");
      await tx.authSession.create({
        data: {
          id: sessionId,
          userId: identity.userId,
          tokenDigest: digestSessionToken(token),
          createdAt: now,
          lastSeenAt: now,
          expiresAt,
          rememberMe,
          ipDigest: context.ipAddress
            ? digestLoginThrottleKey(identity.userId, context.ipAddress)
            : undefined,
          userAgentDigest: context.userAgent
            ? digestLoginThrottleKey(identity.userId, context.userAgent)
            : undefined,
        },
      });
      await appendAuditLog(tx, {
        actor: context,
        actorType: "SYSTEM",
        action: "auth.login.succeeded",
        targetType: "User",
        targetId: identity.userId,
        result: "SUCCESS",
      });
    });
    return { ...principal, sessionId, token, expiresAt: expiresAt.toISOString() };
  }

  /**
   * 临时密码登录：管理员恢复签发的 6 位口令。
   *
   * 与普通登录的三处本质差别：
   * 1. 账号维度节流 —— 6 位数字可猜，只靠 (QQ, IP) 桶可换 IP 绕过；
   * 2. 首次成功登录**原子消费**：验密结果不是许可，事务内复核未过期 / 未被消费 /
   *    代次未变后盖消费戳并建 Session，并发登录最多一次成功；
   * 3. 受限 Session —— 最长 10 分钟且不越过口令原到期时间，`rememberMe` 强制 false，
   *    不滑动续期；凭据已消费后不能再登录，只能随这个 Session 完成改密。
   */
  private async loginWithTemporaryPassword(
    userId: string,
    credential: {
      passwordHash: string;
      temporaryExpiresAt: Date | null;
      temporaryConsumedAt: Date | null;
      credentialVersion: number;
    },
    password: string,
    keyDigest: Uint8Array<ArrayBuffer>,
    context: PublicRequestContext,
  ): Promise<AuthSessionResult> {
    const accountKeyDigest = digestAccountThrottleKey(userId);
    await assertNotThrottled(accountKeyDigest);
    // 先验密再判状态：无论走哪条拒绝路径都付出同一次 scrypt 成本。
    const passwordValid = await verifyPassword(password, credential.passwordHash);
    const nowMs = Date.now();
    if (
      credential.temporaryExpiresAt === null ||
      credential.temporaryExpiresAt.getTime() <= nowMs ||
      credential.temporaryConsumedAt !== null
    ) {
      // 到期 / 已消费统一按凭据错误拒绝，不暴露账户恢复状态；只计 (QQ, IP) 桶 ——
      // 旧口令的尝试量不该挤占账号桶、连累刚签发的新口令。
      await recordFailure([keyDigest], context);
      throw new AppError("AUTH_INVALID_CREDENTIALS", "QQ 号或密码错误");
    }
    if (!passwordValid) {
      await recordFailure([keyDigest, accountKeyDigest], context);
      throw new AppError("AUTH_INVALID_CREDENTIALS", "QQ 号或密码错误");
    }
    const user = await getDb().user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt || user.status !== "ACTIVE") {
      await auditAuth(context, "auth.login.denied", userId, "ACCOUNT_DISABLED");
      throw new AppError("AUTH_INVALID_CREDENTIALS", "QQ 号或密码错误");
    }
    let principal: SessionPrincipal;
    try {
      principal = await this.readPrincipal(userId);
    } catch (error) {
      if (
        error instanceof AppError &&
        (error.code === "ACCOUNT_DISABLED" || error.code === "MEMBER_PROFILE_INACTIVE")
      ) {
        await auditAuth(context, "auth.login.denied", userId, error.code);
        throw new AppError("AUTH_INVALID_CREDENTIALS", "QQ 号或密码错误");
      }
      throw error;
    }

    const token = generateSessionToken();
    const sessionId = randomUUID();
    const verifiedVersion = credential.credentialVersion;
    /** 受限会话到期时间：由本次事务尝试内的有效检查时间计算（见下）。 */
    let sessionExpiresAt!: Date;
    await inSerializableTransaction(async (tx) => {
      // 行锁 + 复核：并发登录只会有一个事务看到「未消费」，失败事务不消费凭据。
      await tx.$queryRaw`SELECT user_id FROM password_credentials WHERE user_id = ${userId} FOR UPDATE`;
      const fresh = await tx.passwordCredential.findUnique({ where: { userId } });
      // 锁等待 / 序列化重试可能跨过口令期限：必须用**拿到锁之后**的服务端时间复核，
      // 不能沿用事务外取的时间 —— 排队跨过期限的口令不得再被消费。
      const attemptNow = new Date();
      if (
        !fresh ||
        fresh.credentialVersion !== verifiedVersion ||
        fresh.temporaryExpiresAt === null ||
        fresh.temporaryExpiresAt.getTime() <= attemptNow.getTime() ||
        fresh.temporaryConsumedAt !== null
      )
        throw new AppError("AUTH_INVALID_CREDENTIALS", "QQ 号或密码错误");
      await tx.passwordCredential.update({
        where: { userId },
        data: { temporaryConsumedAt: attemptNow },
      });
      // 成功后清双桶；账号桶是独立命名空间，普通登录的清除动作碰不到它。
      await tx.loginThrottle.deleteMany({ where: { keyDigest } });
      await tx.loginThrottle.deleteMany({ where: { keyDigest: accountKeyDigest } });
      // 受限会话 ≤10 分钟且不晚于口令原到期，时间基准与上面的有效检查一致。
      sessionExpiresAt = new Date(
        Math.min(
          attemptNow.getTime() + TEMPORARY_SESSION_MAX_MS,
          fresh.temporaryExpiresAt.getTime(),
        ),
      );
      await tx.authSession.create({
        data: {
          id: sessionId,
          userId,
          tokenDigest: digestSessionToken(token),
          createdAt: attemptNow,
          lastSeenAt: attemptNow,
          expiresAt: sessionExpiresAt,
          rememberMe: false,
          ipDigest: context.ipAddress
            ? digestLoginThrottleKey(userId, context.ipAddress)
            : undefined,
          userAgentDigest: context.userAgent
            ? digestLoginThrottleKey(userId, context.userAgent)
            : undefined,
        },
      });
      await appendAuditLog(tx, {
        actor: context,
        actorType: "SYSTEM",
        action: "auth.login.succeeded",
        targetType: "User",
        targetId: userId,
        result: "SUCCESS",
        after: { temporary: true },
      });
    });
    return { ...principal, sessionId, token, expiresAt: sessionExpiresAt.toISOString() };
  }

  async authenticate(
    token: string,
  ): Promise<SessionPrincipal & { sessionId: string; expiresAt: string; rememberMe: boolean }> {
    if (!token) throw new AppError("AUTH_SESSION_INVALID", "登录状态无效");
    const session = await getDb().authSession.findUnique({
      where: { tokenDigest: digestSessionToken(token) },
    });
    if (!session || session.revokedAt) throw new AppError("AUTH_SESSION_INVALID", "登录状态无效");
    const now = new Date();
    if (session.expiresAt <= now) {
      await getDb().authSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: now },
      });
      throw new AppError("AUTH_SESSION_EXPIRED", "登录已过期，请重新登录");
    }
    const principal = await this.readPrincipal(session.userId);
    const update: { lastSeenAt?: Date } = {};
    if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS)
      update.lastSeenAt = now;
    if (Object.keys(update).length)
      await getDb().authSession.update({ where: { id: session.id }, data: update });
    return {
      ...principal,
      sessionId: session.id,
      expiresAt: session.expiresAt.toISOString(),
      rememberMe: session.rememberMe,
    };
  }

  async logout(token: string, context: PublicRequestContext): Promise<void> {
    const session = await getDb().authSession.findUnique({
      where: { tokenDigest: digestSessionToken(token) },
    });
    if (!session || session.revokedAt) return;
    await inSerializableTransaction(async (tx) => {
      const revoked = await tx.authSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count !== 1) return;
      await appendAuditLog(tx, {
        actor: context,
        actorType: "USER",
        actorUserId: session.userId,
        action: "auth.logout",
        targetType: "AuthSession",
        targetId: session.id,
        result: "SUCCESS",
      });
      await appendAuditLog(tx, {
        actor: context,
        actorType: "USER",
        actorUserId: session.userId,
        action: "auth.session.revoked",
        targetType: "AuthSession",
        targetId: session.id,
        result: "SUCCESS",
      });
    });
  }

  async changePassword(
    token: string,
    input: ChangePasswordInput,
    context: PublicRequestContext,
  ): Promise<AuthSessionResult> {
    if (input.newPassword !== input.newPasswordConfirmation)
      throw new AppError("PASSWORD_CONFIRMATION_MISMATCH", "两次输入的新密码不一致");
    if (!isPasswordLengthValid(input.newPassword))
      throw new AppError("VALIDATION_FAILED", passwordLengthMessage());
    const current = await this.authenticate(token);
    const credential = await getDb().passwordCredential.findUniqueOrThrow({
      where: { userId: current.userId },
    });
    if (!(await verifyPassword(input.currentPassword, credential.passwordHash)))
      throw new AppError("PASSWORD_CURRENT_INVALID", "当前密码错误");
    // 恢复态：当前密码是本次已消费的临时密码。必须持有本次受限 Session
    // （`authenticate` 已校验，会话过期 / 被再次签发撤销都会先失败），且禁止把新密码
    // 设回临时密码 —— 否则「消费一次」的口令会变成永久密码。
    const recovering =
      credential.temporaryExpiresAt !== null && credential.temporaryConsumedAt !== null;
    if (recovering && input.newPassword === input.currentPassword)
      throw new AppError("VALIDATION_FAILED", "新密码不能与本次临时密码相同", {
        fieldErrors: { newPassword: ["新密码不能与本次临时密码相同"] },
      });
    const passwordHash = await hashPassword(input.newPassword);
    const newToken = generateSessionToken();
    // 恢复后建立普通 1 天会话（临时登录强制不保持登录，改密完成重新归用户选择）。
    const rememberMe = recovering ? false : current.rememberMe;
    const sessionId = randomUUID();
    const expectedVersion = credential.credentialVersion;
    /** 新会话到期时间：由本次事务尝试内的有效检查时间计算（见下）。 */
    let sessionExpiresAt!: Date;
    await inSerializableTransaction(async (tx) => {
      // 事务内重查本次会话与凭据代次：管理员再次重置提交在先时，旧代次的改密
      // 不能覆盖新签发的临时密码；会话被并发撤销 / 到期同样在此拦下。
      const session = await tx.authSession.findUnique({ where: { id: current.sessionId } });
      // 锁等待 / 序列化重试可能跨过 Session 期限：用**读锁之后**的服务端时间复核，
      // 不沿用事务外取的时间 —— 排队跨过期限的会话不得再完成改密。
      const attemptNow = new Date();
      if (!session || session.revokedAt || session.expiresAt <= attemptNow)
        throw new AppError("AUTH_SESSION_INVALID", "登录状态无效");
      const updated = await tx.passwordCredential.updateMany({
        where: { userId: current.userId, credentialVersion: expectedVersion },
        data: {
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: attemptNow,
          // 正常改密同样清理临时状态：不残留到期字段误伤后续登录。
          temporaryExpiresAt: null,
          temporaryConsumedAt: null,
          credentialVersion: { increment: 1 },
        },
      });
      if (updated.count !== 1)
        throw new AppError("AUTH_SESSION_INVALID", "密码已被重新设置，请使用最新临时密码重新登录");
      await tx.authSession.updateMany({
        where: { userId: current.userId, revokedAt: null },
        data: { revokedAt: attemptNow },
      });
      sessionExpiresAt = new Date(attemptNow.getTime() + sessionLifetime(rememberMe));
      await tx.authSession.create({
        data: {
          id: sessionId,
          userId: current.userId,
          tokenDigest: digestSessionToken(newToken),
          createdAt: attemptNow,
          lastSeenAt: attemptNow,
          expiresAt: sessionExpiresAt,
          rememberMe,
        },
      });
      await appendAuditLog(tx, {
        actor: context,
        actorType: "USER",
        actorUserId: current.userId,
        action: "auth.session.revoked",
        targetType: "AuthSession",
        targetId: current.sessionId,
        result: "SUCCESS",
      });
      await appendAuditLog(tx, {
        actor: context,
        actorType: "USER",
        actorUserId: current.userId,
        action: "auth.password.changed",
        targetType: "User",
        targetId: current.userId,
        result: "SUCCESS",
      });
    });
    return {
      ...(await this.readPrincipal(current.userId)),
      sessionId,
      token: newToken,
      expiresAt: sessionExpiresAt.toISOString(),
    };
  }

  private async readPrincipal(userId: string): Promise<SessionPrincipal> {
    const user = await getDb().user.findUnique({
      where: { id: userId },
      include: {
        passwordCredential: true,
        memberProfile: true,
        roles: { where: { revokedAt: null }, include: { role: true } },
      },
    });
    if (!user || user.deletedAt || user.status !== "ACTIVE")
      throw new AppError("ACCOUNT_DISABLED", "账号当前不可用");
    const roles = user.roles
      .map((entry) => entry.role.code)
      .filter((role): role is RoleCode => role === "MEMBER" || role === "ADMIN");
    const activeMember =
      user.memberProfile &&
      !user.memberProfile.deletedAt &&
      user.memberProfile.status === "ACTIVE" &&
      roles.includes("MEMBER");
    if (
      !roles.includes("ADMIN") &&
      (user.memberProfile ? !activeMember : roles.includes("MEMBER"))
    ) {
      throw new AppError("MEMBER_PROFILE_INACTIVE", "成员身份当前不可用");
    }
    return {
      userId,
      displayName: user.displayName,
      roles,
      permissions: permissionsForRoles(roles),
      memberProfileId: user.memberProfile?.id ?? null,
      memberStatus:
        user.memberProfile?.status === "ACTIVE" || user.memberProfile?.status === "REVOKED"
          ? user.memberProfile.status
          : null,
      mustChangePassword: user.passwordCredential?.mustChangePassword ?? true,
    };
  }
}

function sessionLifetime(rememberMe: boolean): number {
  return rememberMe ? REMEMBERED_SESSION_LIFETIME_MS : SESSION_LIFETIME_MS;
}

function safeNormalizeQq(value: string): string | null {
  try {
    return normalizeQq(value);
  } catch {
    return null;
  }
}

async function getPlaceholderHash(): Promise<string> {
  placeholderHash ??= hashPassword("invalid-login-placeholder-password");
  return placeholderHash;
}

async function assertNotThrottled(keyDigest: Uint8Array<ArrayBuffer>): Promise<void> {
  const throttle = await getDb().loginThrottle.findUnique({ where: { keyDigest } });
  if (throttle?.blockedUntil && throttle.blockedUntil > new Date())
    throw new AppError("AUTH_RATE_LIMITED", "登录尝试过于频繁，请稍后再试");
}

/**
 * 记录一次登录失败。支持多个节流键：临时凭据的密码错误要同时计入
 * `(QQ, IP)` 桶与账号桶，但**只写一条审计** —— 同一次请求在审计里只应看到一次失败。
 */
async function recordFailure(
  keyDigests: Uint8Array<ArrayBuffer>[],
  context: PublicRequestContext,
): Promise<void> {
  const now = new Date();
  await inSerializableTransaction(async (tx) => {
    for (const keyDigest of keyDigests) {
      await tx.$queryRaw`SELECT key_digest FROM login_throttles WHERE key_digest = ${keyDigest} FOR UPDATE`;
      const current = await tx.loginThrottle.findUnique({ where: { keyDigest } });
      const reset =
        !current || now.getTime() - current.windowStartedAt.getTime() >= THROTTLE_WINDOW_MS;
      const failedCount = reset ? 1 : current.failedCount + 1;
      await tx.loginThrottle.upsert({
        where: { keyDigest },
        create: {
          keyDigest,
          failedCount,
          windowStartedAt: now,
          blockedUntil:
            failedCount >= THROTTLE_MAX_FAILURES
              ? new Date(now.getTime() + THROTTLE_BLOCK_MS)
              : null,
          updatedAt: now,
        },
        update: {
          failedCount,
          windowStartedAt: reset ? now : current!.windowStartedAt,
          blockedUntil:
            failedCount >= THROTTLE_MAX_FAILURES
              ? new Date(now.getTime() + THROTTLE_BLOCK_MS)
              : null,
          updatedAt: now,
        },
      });
    }
    await appendAuditLog(tx, {
      actor: context,
      actorType: "SYSTEM",
      action: "auth.login.failed",
      targetType: "User",
      targetId: "00000000-0000-0000-0000-000000000000",
      result: "FAILURE",
      errorCode: "AUTH_INVALID_CREDENTIALS",
    });
  });
  await purgeInertThrottles(now);
}

/**
 * 清掉已经失效的节流记录。键是 `(qq, ip)`，被刷时会不断建新行把表撑大（审计 F2）。
 * `blocked_until` 最多是 `updated_at + THROTTLE_BLOCK_MS`，所以早于该时刻的行不再拦截任何请求，
 * 删除是安全的。最多每小时扫一次，避免每次登录失败都在失败路径上做全表比较。
 */
async function purgeInertThrottles(now: Date): Promise<void> {
  if (now.getTime() - lastThrottlePurgeAt < THROTTLE_PURGE_INTERVAL_MS) return;
  lastThrottlePurgeAt = now.getTime();
  try {
    await getDb().loginThrottle.deleteMany({
      where: { updatedAt: { lt: new Date(now.getTime() - THROTTLE_BLOCK_MS) } },
    });
  } catch (error) {
    // 清理失败不能把「密码错误」变成 500；下个小时会再试一次
    console.error("[auth] 清理失效登录节流记录失败", error);
  }
}

async function auditAuth(
  context: PublicRequestContext,
  action: string,
  targetId: string,
  errorCode: string,
): Promise<void> {
  await inSerializableTransaction((tx) =>
    appendAuditLog(tx, {
      actor: context,
      actorType: "SYSTEM",
      action,
      targetType: "User",
      targetId,
      result: "FAILURE",
      errorCode,
    }),
  );
}

export const authService = new AuthService();
