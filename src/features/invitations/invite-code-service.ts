import { randomUUID } from "node:crypto";

import {
  ensureMemberProfile,
  grantMemberRole,
  resolveOrCreateUser,
  setInitialPassword,
} from "@/features/accounts/account-repository";
import type { InviteCode } from "@/generated/prisma/client";
import { AppError } from "@/lib/api/errors";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { requirePermission } from "@/lib/auth/permissions";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { normalizePhone, normalizeQq } from "@/lib/security/normalization";
import { digestInviteCode, generateInviteCode } from "@/lib/security/secrets";
import type {
  AuthorizedActor,
  CreateInviteCodeInput,
  CreateInviteCodeResult,
  InviteCodeEffectiveStatus,
  InviteCodeServiceContract,
  InviteCodeView,
  MemberRegistrationResult,
  PublicRequestContext,
  RedeemInviteCodeInput,
  UpdateInviteCodeInput,
} from "@/types/contracts";

export function getInviteCodeEffectiveStatus(
  code: Pick<InviteCode, "status" | "activeFrom" | "expiresAt" | "maxUses" | "usedCount">,
  now = new Date(),
): InviteCodeEffectiveStatus {
  if (code.status === "REVOKED") return "REVOKED";
  if (code.activeFrom && code.activeFrom > now) return "NOT_STARTED";
  if (code.expiresAt && code.expiresAt <= now) return "EXPIRED";
  if (code.usedCount >= code.maxUses) return "EXHAUSTED";
  return "ACTIVE";
}

export class InviteCodeService implements InviteCodeServiceContract {
  async create(
    input: CreateInviteCodeInput,
    actor: AuthorizedActor,
  ): Promise<CreateInviteCodeResult> {
    requirePermission(actor, "invite:create");
    validateInvitePolicy(input);
    const plainCode = generateInviteCode();
    const now = new Date();
    const record = await inSerializableTransaction(async (tx) => {
      const created = await tx.inviteCode.create({
        data: {
          id: randomUUID(),
          codeDigest: digestInviteCode(plainCode),
          displayPrefix: plainCode.slice(0, 8),
          status: "ACTIVE",
          activeFrom: parseOptionalDate(input.activeFrom),
          expiresAt: parseOptionalDate(input.expiresAt),
          maxUses: input.maxUses,
          usedCount: 0,
          boundQqNormalized: input.boundQq ? normalizeQq(input.boundQq) : undefined,
          boundPhoneNormalized: input.boundPhone ? normalizePhone(input.boundPhone) : undefined,
          createdByUserId: actor.userId!,
          createdAt: now,
          updatedAt: now,
        },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: actor.actorType,
        actorUserId: actor.userId,
        action: "invite.code.created",
        targetType: "InviteCode",
        targetId: created.id,
        result: "SUCCESS",
        after: {
          displayPrefix: created.displayPrefix,
          activeFrom: created.activeFrom,
          expiresAt: created.expiresAt,
          maxUses: created.maxUses,
          boundQq: created.boundQqNormalized,
          boundPhone: created.boundPhoneNormalized,
        },
      });
      return created;
    });
    return { ...toView(record), plainCode };
  }

  async update(
    inviteCodeId: string,
    input: UpdateInviteCodeInput,
    actor: AuthorizedActor,
  ): Promise<InviteCodeView> {
    requirePermission(actor, "invite:create");
    return inSerializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM invite_codes WHERE id = ${inviteCodeId} FOR UPDATE`;
      const current = await tx.inviteCode.findUnique({ where: { id: inviteCodeId } });
      if (!current || current.deletedAt) throw new AppError("RESOURCE_NOT_FOUND", "邀请码不存在");
      if (
        input.maxUses !== undefined &&
        (!Number.isInteger(input.maxUses) ||
          input.maxUses < Math.max(1, current.usedCount) ||
          input.maxUses > 1_000_000)
      ) {
        throw new AppError("INVITE_CODE_USAGE_LIMIT_INVALID", "最大使用次数不能小于已使用次数");
      }
      const activeFrom =
        input.activeFrom === undefined ? current.activeFrom : parseOptionalDate(input.activeFrom);
      const expiresAt =
        input.expiresAt === undefined ? current.expiresAt : parseOptionalDate(input.expiresAt);
      validateDateRange(activeFrom, expiresAt);
      const updated = await tx.inviteCode.update({
        where: { id: current.id },
        data: { activeFrom, expiresAt, maxUses: input.maxUses },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: actor.actorType,
        actorUserId: actor.userId,
        action: "invite.code.policy_updated",
        targetType: "InviteCode",
        targetId: current.id,
        result: "SUCCESS",
        before: {
          activeFrom: current.activeFrom,
          expiresAt: current.expiresAt,
          maxUses: current.maxUses,
        },
        after: { activeFrom, expiresAt, maxUses: updated.maxUses },
      });
      return toView(updated);
    });
  }

  async revoke(inviteCodeId: string, actor: AuthorizedActor): Promise<InviteCodeView> {
    requirePermission(actor, "invite:revoke");
    return inSerializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM invite_codes WHERE id = ${inviteCodeId} FOR UPDATE`;
      const current = await tx.inviteCode.findUnique({ where: { id: inviteCodeId } });
      if (!current || current.deletedAt) throw new AppError("RESOURCE_NOT_FOUND", "邀请码不存在");
      if (current.status === "REVOKED") return toView(current);
      const updated = await tx.inviteCode.update({
        where: { id: current.id },
        data: { status: "REVOKED", revokedAt: new Date() },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: actor.actorType,
        actorUserId: actor.userId,
        action: "invite.code.revoked",
        targetType: "InviteCode",
        targetId: current.id,
        result: "SUCCESS",
        before: { status: current.status },
        after: { status: updated.status },
      });
      return toView(updated);
    });
  }

  async redeem(
    input: RedeemInviteCodeInput,
    context: PublicRequestContext,
  ): Promise<MemberRegistrationResult> {
    const qq = normalizeQq(input.qq);
    const phone = normalizePhone(input.phone);
    const digest = digestInviteCode(input.code);
    return inSerializableTransaction(async (tx) => {
      const replay = await tx.inviteCodeRedemption.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: {
          inviteCode: { select: { codeDigest: true } },
          user: {
            select: {
              identities: {
                where: { type: { in: ["QQ", "PHONE"] }, deletedAt: null },
                select: { type: true, identifierNormalized: true },
              },
            },
          },
        },
      });
      if (replay) {
        const sameCode = Buffer.from(replay.inviteCode.codeDigest).equals(Buffer.from(digest));
        const sameQq = replay.user.identities.some(
          (identity) => identity.type === "QQ" && identity.identifierNormalized === qq,
        );
        const samePhone = replay.user.identities.some(
          (identity) => identity.type === "PHONE" && identity.identifierNormalized === phone,
        );
        if (!sameCode || !sameQq || !samePhone) {
          throw new AppError("IDEMPOTENCY_CONFLICT", "幂等键已用于另一项注册请求");
        }
        const provision = await tx.accountProvision.findUniqueOrThrow({
          where: {
            sourceType_sourceId: { sourceType: "INVITE_REDEMPTION", sourceId: replay.id },
          },
        });
        return {
          userId: replay.userId,
          memberProfileId: replay.memberProfileId,
          redemptionId: replay.id,
          provisionId: provision.id,
        };
      }

      await tx.$queryRaw`SELECT id FROM invite_codes WHERE code_digest = ${digest} FOR UPDATE`;
      const code = await tx.inviteCode.findUnique({ where: { codeDigest: digest } });
      if (!code || code.deletedAt) throw new AppError("INVITE_CODE_INVALID", "邀请码无效");
      assertRedeemable(code, qq, phone);

      const userId = await resolveOrCreateUser(tx, { qq, phone }, input.realName.trim());
      const memberProfileId = await ensureMemberProfile(tx, {
        userId,
        realName: input.realName.trim(),
        studentId: input.studentId?.trim(),
        className: input.className?.trim(),
      });
      await grantMemberRole(tx, {
        userId,
        sourceType: "INVITE_REDEMPTION",
        sourceId: code.id,
      });
      await setInitialPassword(tx, userId, input.password);

      const consumed = await tx.inviteCode.updateMany({
        where: { id: code.id, status: "ACTIVE", usedCount: { lt: code.maxUses } },
        data: { usedCount: { increment: 1 } },
      });
      if (consumed.count !== 1) throw new AppError("INVITE_CODE_EXHAUSTED", "邀请码已用尽");

      const redemptionId = randomUUID();
      await tx.inviteCodeRedemption.create({
        data: {
          id: redemptionId,
          inviteCodeId: code.id,
          userId,
          memberProfileId,
          idempotencyKey: input.idempotencyKey,
          redeemedAt: new Date(),
        },
      });
      const provision = await tx.accountProvision.create({
        data: {
          id: randomUUID(),
          sourceType: "INVITE_REDEMPTION",
          sourceId: redemptionId,
          idempotencyKey: input.idempotencyKey,
          status: "SUCCEEDED",
          userId,
          memberProfileId,
          attemptCount: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: new Date(),
        },
      });
      await appendAuditLog(tx, {
        actor: context,
        actorType: "SYSTEM",
        action: "invite.code.redeemed",
        targetType: "InviteCode",
        targetId: code.id,
        result: "SUCCESS",
        after: { displayPrefix: code.displayPrefix, userId, memberProfileId },
      });
      return { userId, memberProfileId, redemptionId, provisionId: provision.id };
    });
  }
}

function assertRedeemable(code: InviteCode, qq: string, phone: string): void {
  const effective = getInviteCodeEffectiveStatus(code);
  if (effective === "NOT_STARTED") throw new AppError("INVITE_CODE_NOT_ACTIVE", "邀请码尚未生效");
  if (effective === "REVOKED") throw new AppError("INVITE_CODE_REVOKED", "邀请码已撤销");
  if (effective === "EXPIRED") throw new AppError("INVITE_CODE_EXPIRED", "邀请码已失效");
  if (effective === "EXHAUSTED") throw new AppError("INVITE_CODE_EXHAUSTED", "邀请码已用尽");
  if (
    (code.boundQqNormalized && code.boundQqNormalized !== qq) ||
    (code.boundPhoneNormalized && code.boundPhoneNormalized !== phone)
  ) {
    throw new AppError("INVITE_CODE_BINDING_MISMATCH", "邀请码与登记信息不匹配");
  }
}

function validateInvitePolicy(input: CreateInviteCodeInput): void {
  if (!Number.isInteger(input.maxUses) || input.maxUses < 1 || input.maxUses > 1_000_000) {
    throw new AppError("INVITE_CODE_USAGE_LIMIT_INVALID", "最大使用次数必须是正整数");
  }
  validateDateRange(parseOptionalDate(input.activeFrom), parseOptionalDate(input.expiresAt));
}

function parseOptionalDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new AppError("VALIDATION_FAILED", "时间格式无效");
  return parsed;
}

function validateDateRange(activeFrom: Date | null, expiresAt: Date | null): void {
  if (activeFrom && expiresAt && expiresAt <= activeFrom) {
    throw new AppError("VALIDATION_FAILED", "失效时间必须晚于生效时间");
  }
}

function toView(record: InviteCode): InviteCodeView {
  return {
    id: record.id,
    displayPrefix: record.displayPrefix,
    status: getInviteCodeEffectiveStatus(record),
    activeFrom: record.activeFrom?.toISOString() ?? null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    maxUses: record.maxUses,
    usedCount: record.usedCount,
  };
}

export const inviteCodeService = new InviteCodeService();
