import { randomBytes, randomUUID } from "node:crypto";

import { AppError } from "@/lib/api/errors";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { normalizePhone, normalizeQq } from "@/lib/security/normalization";
import type { AccountProvisionServiceContract, ProvisionResult } from "@/types/contracts";
import {
  ensureMemberProfile,
  grantMemberRole,
  resolveOrCreateUser,
  setInitialPassword,
} from "@/features/accounts/account-repository";

export class AccountProvisionService implements AccountProvisionServiceContract {
  async provisionFromApplication(
    applicationId: string,
    idempotencyKey: string,
  ): Promise<ProvisionResult> {
    const existing = await getDb().accountProvision.findUnique({
      where: { sourceType_sourceId: { sourceType: "JOIN_APPLICATION", sourceId: applicationId } },
    });
    if (existing?.status === "SUCCEEDED") return toResult(existing);

    const initializationSecret = randomBytes(18).toString("base64url");
    try {
      const result = await inSerializableTransaction(async (tx) => {
        const application = await tx.joinApplication.findUnique({ where: { id: applicationId } });
        if (!application || application.deletedAt) {
          throw new AppError("RESOURCE_NOT_FOUND", "报名记录不存在");
        }
        if (application.status !== "INTERVIEW_PASSED") {
          throw new AppError("STATE_TRANSITION_INVALID", "报名尚未通过面试");
        }
        const provision = await tx.accountProvision.upsert({
          where: {
            sourceType_sourceId: { sourceType: "JOIN_APPLICATION", sourceId: applicationId },
          },
          update: { status: "PENDING", attemptCount: { increment: 1 }, lastErrorCode: null },
          create: {
            id: randomUUID(),
            sourceType: "JOIN_APPLICATION",
            sourceId: applicationId,
            idempotencyKey,
            status: "PENDING",
            attemptCount: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
        if (provision.idempotencyKey !== idempotencyKey) {
          throw new AppError("IDEMPOTENCY_CONFLICT", "幂等键与已有发放任务不一致");
        }

        const userId = await resolveOrCreateUser(
          tx,
          {
            qq: normalizeQq(application.qqNormalized),
            phone: normalizePhone(application.phoneNormalized),
          },
          application.realName,
        );
        const memberProfileId = await ensureMemberProfile(tx, {
          userId,
          realName: application.realName,
        });
        await grantMemberRole(tx, {
          userId,
          sourceType: "JOIN_APPLICATION",
          sourceId: applicationId,
        });
        const passwordCreated = await setInitialPassword(tx, userId, initializationSecret);
        const completed = await tx.accountProvision.update({
          where: { id: provision.id },
          data: { status: "SUCCEEDED", userId, memberProfileId, completedAt: new Date() },
        });
        await tx.joinApplication.update({
          where: { id: applicationId },
          data: { provisionStatus: "SUCCEEDED" },
        });
        await appendAuditLog(tx, {
          actor: { requestId: `provision:${provision.id}` },
          actorType: "SYSTEM",
          action: "account.provision.succeeded",
          targetType: "AccountProvision",
          targetId: provision.id,
          result: "SUCCESS",
          after: {
            sourceType: provision.sourceType,
            sourceId: applicationId,
            userId,
            memberProfileId,
          },
        });
        return { completed, passwordCreated };
      });
      return {
        ...toResult(result.completed),
        ...(result.passwordCreated ? { initializationSecret } : {}),
      };
    } catch (error) {
      const code = error instanceof AppError ? error.code : "ACCOUNT_PROVISION_FAILED";
      await getDb().accountProvision.updateMany({
        where: { sourceType: "JOIN_APPLICATION", sourceId: applicationId },
        data: { status: "FAILED", lastErrorCode: code, attemptCount: { increment: 1 } },
      });
      await getDb().joinApplication.updateMany({
        where: { id: applicationId, status: "INTERVIEW_PASSED" },
        data: { provisionStatus: "FAILED" },
      });
      await inSerializableTransaction((tx) =>
        appendAuditLog(tx, {
          actor: { requestId: `provision:${applicationId}` },
          actorType: "SYSTEM",
          action: "account.provision.failed",
          targetType: "AccountProvision",
          targetId: applicationId,
          result: "FAILURE",
          errorCode: code,
        }),
      );
      throw error;
    }
  }

  async provisionFromInvite(
    redemptionId: string,
    idempotencyKey: string,
  ): Promise<ProvisionResult> {
    const provision = await getDb().accountProvision.findUnique({
      where: { sourceType_sourceId: { sourceType: "INVITE_REDEMPTION", sourceId: redemptionId } },
    });
    if (!provision || provision.idempotencyKey !== idempotencyKey) {
      throw new AppError("RESOURCE_NOT_FOUND", "邀请码发放记录不存在");
    }
    return toResult(provision);
  }
}

function toResult(provision: {
  id: string;
  status: string;
  userId: string | null;
  memberProfileId: string | null;
  attemptCount: number;
  lastErrorCode: string | null;
}): ProvisionResult {
  return {
    id: provision.id,
    status: provision.status as ProvisionResult["status"],
    userId: provision.userId,
    memberProfileId: provision.memberProfileId,
    attemptCount: provision.attemptCount,
    lastErrorCode: provision.lastErrorCode,
  };
}

export const accountProvisionService = new AccountProvisionService();
