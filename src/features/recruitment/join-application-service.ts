import { randomBytes, randomUUID } from "node:crypto";

import { accountProvisionService } from "@/features/accounts/account-provision-service";
import type { JoinApplication, Prisma } from "@/generated/prisma/client";
import { dateRangeWhere, parseUtcDateFilter } from "@/lib/api/date-filter";
import { AppError } from "@/lib/api/errors";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { maskPhone, maskQq } from "@/lib/audit/redaction";
import { requirePermission } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { normalizePhone, normalizeQq } from "@/lib/security/normalization";
import type {
  AuthorizedActor,
  JoinApplicationDetail,
  JoinApplicationListInput,
  JoinApplicationServiceContract,
  JoinApplicationSummary,
  JoinApplicationView,
  JoinReceipt,
  ProvisionView,
  PublicRequestContext,
  ReviewJoinApplicationInput,
  SubmitJoinApplicationInput,
} from "@/types/contracts";

export class JoinApplicationService implements JoinApplicationServiceContract {
  async list(input: JoinApplicationListInput, actor: AuthorizedActor) {
    requirePermission(actor, "join:read");
    const page = Number.isInteger(input.page) && input.page > 0 ? input.page : 1;
    const pageSize =
      Number.isInteger(input.pageSize) && input.pageSize > 0 && input.pageSize <= 100
        ? input.pageSize
        : 20;
    const where = joinApplicationListWhere(input);
    const [records, total] = await Promise.all([
      getDb().joinApplication.findMany({
        where,
        orderBy: { submittedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      getDb().joinApplication.count({ where }),
    ]);
    const items: JoinApplicationSummary[] = records.map((record) => ({
      ...toView(record),
      ticketNo: record.ticketNo,
      recruitmentCycle: record.recruitmentCycle,
      realName: record.realName,
      qqMasked: maskQq(record.qqNormalized),
      phoneMasked: maskPhone(record.phoneNormalized),
      submittedAt: record.submittedAt.toISOString(),
    }));
    return {
      items,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async get(applicationId: string, actor: AuthorizedActor): Promise<JoinApplicationDetail> {
    requirePermission(actor, "join:read");
    const record = await getDb().joinApplication.findUnique({
      where: { id: applicationId },
      include: { reviews: { orderBy: { createdAt: "desc" } } },
    });
    if (!record || record.deletedAt) throw new AppError("RESOURCE_NOT_FOUND", "报名记录不存在");
    // 需求 §45 明确「查看完整报名敏感信息」必须留痕：`get` 是**唯一**返回报名 QQ / 手机号
    // 明文的入口（列表只给脱敏值），与成员详情的 `member.detail.viewed` 同一处理。
    // 缺这条记录时，谁在什么时候看过报名者的联系方式就无法追溯。
    await inSerializableTransaction((tx) =>
      appendAuditLog(tx, {
        actor,
        actorType: actor.actorType,
        actorUserId: actor.userId,
        action: "join.application.detail.viewed",
        targetType: "JoinApplication",
        targetId: record.id,
        result: "SUCCESS",
        after: { ticketNo: record.ticketNo, recruitmentCycle: record.recruitmentCycle },
      }),
    );
    return {
      ...toView(record),
      ticketNo: record.ticketNo,
      recruitmentCycle: record.recruitmentCycle,
      realName: record.realName,
      qq: record.qqNormalized,
      phone: record.phoneNormalized,
      selfIntroduction: record.selfIntroduction,
      preferredDirection: record.preferredDirection,
      applicantRemark: record.applicantRemark,
      submittedAt: record.submittedAt.toISOString(),
      reviews: record.reviews.map((review) => ({
        id: review.id,
        result: review.result,
        interviewedAt: review.interviewedAt.toISOString(),
        internalNote: review.internalNote,
      })),
    };
  }

  async submit(
    input: SubmitJoinApplicationInput,
    context: PublicRequestContext,
  ): Promise<JoinReceipt> {
    validateSubmission(input);
    const qqNormalized = normalizeQq(input.qq);
    const phoneNormalized = normalizePhone(input.phone);
    const duplicate = await findDuplicate(input.recruitmentCycle, qqNormalized, phoneNormalized);
    if (duplicate) return toReceipt(duplicate, true);

    const now = new Date();
    try {
      return await inSerializableTransaction(async (tx) => {
        const record = await tx.joinApplication.create({
          data: {
            id: randomUUID(),
            ticketNo: `JA-${randomBytes(12).toString("hex").toUpperCase()}`,
            recruitmentCycle: input.recruitmentCycle,
            realName: input.realName.trim(),
            qqNormalized,
            phoneNormalized,
            selfIntroduction: cleanOptional(input.selfIntroduction),
            preferredDirection: cleanOptional(input.preferredDirection),
            applicantRemark: cleanOptional(input.applicantRemark),
            status: "SUBMITTED",
            provisionStatus: "NOT_REQUIRED",
            privacyConsentAt: now,
            submittedAt: now,
            createdAt: now,
            updatedAt: now,
          },
        });
        await appendAuditLog(tx, {
          actor: context,
          actorType: "SYSTEM",
          action: "join.application.submitted",
          targetType: "JoinApplication",
          targetId: record.id,
          result: "SUCCESS",
          after: {
            recruitmentCycle: input.recruitmentCycle,
            qq: qqNormalized,
            phone: phoneNormalized,
          },
        });
        return toReceipt(record, false);
      });
    } catch (error) {
      if (hasPrismaCode(error, "P2002")) {
        const raced = await findDuplicate(input.recruitmentCycle, qqNormalized, phoneNormalized);
        if (raced) return toReceipt(raced, true);
      }
      throw error;
    }
  }

  async review(
    input: ReviewJoinApplicationInput,
    actor: AuthorizedActor,
  ): Promise<JoinApplicationView> {
    requirePermission(actor, "join:review");
    const interviewedAt = new Date(input.interviewedAt);
    if (Number.isNaN(interviewedAt.getTime())) {
      throw new AppError("VALIDATION_FAILED", "面试时间格式无效");
    }
    if (input.internalNote && input.internalNote.length > 2000) {
      throw new AppError("VALIDATION_FAILED", "内部备注不能超过 2000 字");
    }

    const prepared = await inSerializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM join_applications WHERE id = ${input.applicationId} FOR UPDATE`;
      const application = await tx.joinApplication.findUnique({
        where: { id: input.applicationId },
      });
      if (!application || application.deletedAt) {
        throw new AppError("RESOURCE_NOT_FOUND", "报名记录不存在");
      }
      if (application.status === "INTERVIEW_PASSED" && input.result === "PASSED") {
        return application;
      }
      if (application.status !== "SUBMITTED" && application.status !== "INTERVIEW_PENDING") {
        throw new AppError("JOIN_APPLICATION_NOT_REVIEWABLE", "该报名当前不可登记面试结果");
      }

      const nextStatus = input.result === "PASSED" ? "INTERVIEW_PASSED" : "INTERVIEW_REJECTED";
      await tx.joinApplicationReview.create({
        data: {
          id: randomUUID(),
          applicationId: application.id,
          result: input.result,
          interviewedAt,
          reviewerUserId: actor.userId!,
          internalNote: cleanOptional(input.internalNote),
          createdAt: new Date(),
        },
      });
      const updated = await tx.joinApplication.update({
        where: { id: application.id },
        data: {
          status: nextStatus,
          provisionStatus: input.result === "PASSED" ? "PENDING" : "NOT_REQUIRED",
          lastReviewedAt: interviewedAt,
        },
      });
      if (input.result === "PASSED") {
        await tx.accountProvision.create({
          data: {
            id: randomUUID(),
            sourceType: "JOIN_APPLICATION",
            sourceId: application.id,
            idempotencyKey: input.idempotencyKey,
            status: "PENDING",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }
      await appendAuditLog(tx, {
        actor,
        actorType: actor.actorType,
        actorUserId: actor.userId,
        action: "join.review.created",
        targetType: "JoinApplication",
        targetId: application.id,
        result: "SUCCESS",
        before: { status: application.status, provisionStatus: application.provisionStatus },
        after: { status: nextStatus, provisionStatus: updated.provisionStatus },
      });
      return updated;
    });

    let initializationSecret: string | undefined;
    if (input.result === "PASSED" && prepared.provisionStatus !== "SUCCEEDED") {
      const provision = await getDb().accountProvision.findUniqueOrThrow({
        where: { sourceType_sourceId: { sourceType: "JOIN_APPLICATION", sourceId: prepared.id } },
      });
      const result = await accountProvisionService.provisionFromApplication(
        prepared.id,
        provision.idempotencyKey,
      );
      initializationSecret = result.initializationSecret;
    }
    const final = await getDb().joinApplication.findUniqueOrThrow({ where: { id: prepared.id } });
    return { ...toView(final), ...(initializationSecret ? { initializationSecret } : {}) };
  }

  async retryProvision(applicationId: string, actor: AuthorizedActor): Promise<ProvisionView> {
    requirePermission(actor, "member:provision");
    const provision = await getDb().accountProvision.findUnique({
      where: { sourceType_sourceId: { sourceType: "JOIN_APPLICATION", sourceId: applicationId } },
    });
    if (!provision || provision.status !== "FAILED") {
      throw new AppError("STATE_TRANSITION_INVALID", "只有失败的发放任务可以重试");
    }
    const result = await accountProvisionService.provisionFromApplication(
      applicationId,
      provision.idempotencyKey,
    );
    await inSerializableTransaction((tx) =>
      appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "account.provision.retried",
        targetType: "AccountProvision",
        targetId: provision.id,
        result: "SUCCESS",
        after: { status: result.status, attemptCount: result.attemptCount },
      }),
    );
    return result;
  }

  async provision(applicationId: string, actor: AuthorizedActor): Promise<ProvisionView> {
    requirePermission(actor, "member:provision");
    const provision = await getDb().accountProvision.findUnique({
      where: { sourceType_sourceId: { sourceType: "JOIN_APPLICATION", sourceId: applicationId } },
    });
    if (!provision) throw new AppError("RESOURCE_NOT_FOUND", "账号发放任务不存在");
    if (provision.status === "FAILED")
      throw new AppError("STATE_TRANSITION_INVALID", "失败任务请使用重试接口");
    return accountProvisionService.provisionFromApplication(
      applicationId,
      provision.idempotencyKey,
    );
  }
}

function validateSubmission(input: SubmitJoinApplicationInput): void {
  const fieldErrors: Record<string, string[]> = {};
  if (!input.privacyConsent) fieldErrors.privacyConsent = ["必须确认隐私告知"];
  if (!input.recruitmentCycle.trim() || input.recruitmentCycle.length > 32) {
    fieldErrors.recruitmentCycle = ["招募批次无效"];
  }
  if (input.realName.trim().length < 2 || input.realName.trim().length > 64) {
    fieldErrors.realName = ["姓名长度应为 2–64 个字符"];
  }
  if ((input.selfIntroduction?.length ?? 0) > 10_000) fieldErrors.selfIntroduction = ["内容过长"];
  if ((input.preferredDirection?.length ?? 0) > 120) fieldErrors.preferredDirection = ["内容过长"];
  if ((input.applicantRemark?.length ?? 0) > 500) fieldErrors.applicantRemark = ["内容过长"];
  if (Object.keys(fieldErrors).length > 0) {
    throw new AppError("VALIDATION_FAILED", "报名信息未通过校验", { fieldErrors });
  }
}

/**
 * 报名列表的筛选谓词。**导出与列表共用这一份**（与维修导出的 `listWhere` 同一做法），
 * 否则「筛选后导出」会与「界面所见」悄悄分叉。
 *
 * 提交时间是**时刻**（`DATETIME(3)`），因此日期筛选按 `Asia/Shanghai` 自然日解释、
 * 结束日包含全天。原先用 `lte: new Date("2026-09-22")` 会把 9-22 当天 08:00 之后的报名
 * 全部排除，界面上表现为「筛同一天得到 0 条」。
 */
export function joinApplicationListWhere(
  input: Omit<JoinApplicationListInput, "page" | "pageSize">,
): Prisma.JoinApplicationWhereInput {
  const submitted = parseUtcDateFilter(input.submittedFrom, input.submittedTo, "提交时间");
  return {
    deletedAt: null,
    status: input.status,
    provisionStatus: input.provisionStatus,
    submittedAt: dateRangeWhere(submitted),
    OR: buildSearch(input.query),
  };
}

function buildSearch(query: string | undefined): Prisma.JoinApplicationWhereInput[] | undefined {
  const value = query?.trim();
  if (!value) return undefined;
  const normalizedDigits = value.replace(/\D/g, "");
  return [
    { ticketNo: { contains: value } },
    { realName: { contains: value } },
    ...(/^\d{5,11}$/.test(normalizedDigits) ? [{ qqNormalized: normalizedDigits }] : []),
    ...(/^1[3-9]\d{9}$/.test(normalizedDigits) ? [{ phoneNormalized: normalizedDigits }] : []),
  ];
}

async function findDuplicate(cycle: string, qq: string, phone: string) {
  return getDb().joinApplication.findFirst({
    where: {
      recruitmentCycle: cycle,
      deletedAt: null,
      OR: [{ qqNormalized: qq }, { phoneNormalized: phone }],
    },
  });
}

function cleanOptional(value?: string): string | undefined {
  const clean = value?.trim();
  return clean || undefined;
}

function toReceipt(record: JoinApplication, duplicate: boolean): JoinReceipt {
  return {
    id: record.id,
    ticketNo: record.ticketNo,
    status: record.status as JoinReceipt["status"],
    submittedAt: record.submittedAt.toISOString(),
    duplicate,
  };
}

function toView(record: JoinApplication): JoinApplicationView {
  return {
    id: record.id,
    status: record.status as JoinApplicationView["status"],
    provisionStatus: record.provisionStatus as JoinApplicationView["provisionStatus"],
    lastReviewedAt: record.lastReviewedAt?.toISOString() ?? null,
  };
}

function hasPrismaCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export const joinApplicationService = new JoinApplicationService();
