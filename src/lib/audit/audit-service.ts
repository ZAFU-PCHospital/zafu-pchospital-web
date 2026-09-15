import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { redactAuditSummary, digestAuditValue } from "@/lib/audit/redaction";
import { getServerEnv } from "@/lib/env";
import type { AuthorizedActor, PublicRequestContext } from "@/types/contracts";

export type AuditEvent = {
  actor: AuthorizedActor | PublicRequestContext;
  actorType: "USER" | "SYSTEM";
  actorUserId?: string;
  action: string;
  targetType: string;
  targetId: string;
  result: "SUCCESS" | "FAILURE";
  before?: unknown;
  after?: unknown;
  errorCode?: string;
};

export async function appendAuditLog(
  tx: Prisma.TransactionClient,
  event: AuditEvent,
): Promise<void> {
  const pepper = getServerEnv().PII_AUDIT_PEPPER;
  await tx.auditLog.create({
    data: {
      id: randomUUID(),
      actorType: event.actorType,
      actorUserId: event.actorUserId,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      requestId: event.actor.requestId,
      result: event.result,
      beforeSummary: toJson(event.before),
      afterSummary: toJson(event.after),
      errorCode: event.errorCode,
      ipDigest: event.actor.ipAddress ? digestAuditValue(event.actor.ipAddress, pepper) : undefined,
      userAgentDigest: event.actor.userAgent
        ? digestAuditValue(event.actor.userAgent, pepper)
        : undefined,
      createdAt: new Date(),
    },
  });
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return redactAuditSummary(value) as Prisma.InputJsonValue;
}
