import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/api/errors";
import { hashPassword } from "@/lib/security/secrets";
import type { ProvisionSourceType } from "@/types/contracts";

type IdentityInput = { qq: string; phone: string };

export async function resolveOrCreateUser(
  tx: Prisma.TransactionClient,
  identity: IdentityInput,
  displayName: string,
): Promise<string> {
  const matches = await tx.userIdentity.findMany({
    where: {
      OR: [
        { type: "QQ", identifierNormalized: identity.qq },
        { type: "PHONE", identifierNormalized: identity.phone },
      ],
    },
    select: { userId: true, type: true, identifierNormalized: true, deletedAt: true },
  });
  const userIds = [...new Set(matches.map((match) => match.userId))];
  if (userIds.length > 1 || matches.some((match) => match.deletedAt !== null)) {
    throw new AppError("ACCOUNT_IDENTITY_CONFLICT", "账号身份信息存在冲突，需要管理员处理");
  }

  const now = new Date();
  const userId = userIds[0] ?? randomUUID();
  if (userIds.length === 0) {
    await tx.user.create({
      data: { id: userId, status: "ACTIVE", displayName, createdAt: now, updatedAt: now },
    });
  } else {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt || user.status !== "ACTIVE") {
      throw new AppError("ACCOUNT_IDENTITY_CONFLICT", "账号身份信息存在冲突，需要管理员处理");
    }
  }

  const userIdentities =
    userIds.length === 0
      ? []
      : await tx.userIdentity.findMany({
          where: { userId, type: { in: ["QQ", "PHONE"] }, deletedAt: null },
          select: { type: true, identifierNormalized: true },
        });

  const requested = [
    { type: "QQ", value: identity.qq },
    { type: "PHONE", value: identity.phone },
  ] as const;
  for (const item of requested) {
    const existing = userIdentities.find((match) => match.type === item.type);
    if (existing && existing.identifierNormalized !== item.value) {
      throw new AppError("ACCOUNT_IDENTITY_CONFLICT", "账号身份信息存在冲突，需要管理员处理");
    }
    if (!existing) {
      await tx.userIdentity.create({
        data: {
          id: randomUUID(),
          userId,
          type: item.type,
          identifierNormalized: item.value,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
  }
  return userId;
}

export async function ensureMemberProfile(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    realName: string;
    studentId?: string;
    className?: string;
  },
): Promise<string> {
  const existing = await tx.memberProfile.findUnique({ where: { userId: input.userId } });
  const now = new Date();
  if (existing) {
    await tx.memberProfile.update({
      where: { id: existing.id },
      data: {
        realName: input.realName,
        studentId: input.studentId,
        className: input.className,
        status: "ACTIVE",
        deletedAt: null,
      },
    });
    return existing.id;
  }
  const id = randomUUID();
  await tx.memberProfile.create({
    data: {
      id,
      userId: input.userId,
      realName: input.realName,
      studentId: input.studentId,
      className: input.className,
      status: "ACTIVE",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  return id;
}

export async function grantMemberRole(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    sourceType: ProvisionSourceType;
    sourceId: string;
    grantedBy?: string;
  },
): Promise<void> {
  const role = await tx.role.findUnique({ where: { code: "MEMBER" } });
  if (!role) throw new AppError("ACCOUNT_PROVISION_FAILED", "基础角色尚未初始化");
  const activeKey = `${input.userId}:${role.id}`;
  await tx.userRole.upsert({
    where: { activeKey },
    update: {},
    create: {
      id: randomUUID(),
      userId: input.userId,
      roleId: role.id,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      grantedBy: input.grantedBy,
      grantedAt: new Date(),
      activeKey,
    },
  });
}

export async function setInitialPassword(
  tx: Prisma.TransactionClient,
  userId: string,
  plainPassword: string,
): Promise<boolean> {
  const existing = await tx.passwordCredential.findUnique({ where: { userId } });
  if (existing) return false;
  const now = new Date();
  const passwordHash = await hashPassword(plainPassword);
  await tx.passwordCredential.create({
    data: {
      userId,
      passwordHash,
      mustChangePassword: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  return true;
}
