import { queryOneOf, queryString } from "@/features/admin/admin-http";
import { auditLogService } from "@/features/admin/audit-log-service";
import { parsePagination } from "@/lib/api/pagination";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { authenticateRequest } from "@/lib/auth/request";
import { AuditResult } from "@/types/contracts";

export const runtime = "nodejs";

/**
 * M6 批次 2：审计记录查询（需求 §45）。**只有 GET** —— 审计表不提供任何写入或删除入口。
 *
 * 这里刻意不写「查看审计」的审计记录：摘要中的 QQ / 手机号在写入时已脱敏、凭据类字段
 * 整条丢弃，读取不产生新的 PII 暴露；若读取也留痕，审计表会变成自我增殖的记录流。
 * 对比：成员详情（`member.detail.viewed`）真的吐出了明文，所以那条必须留痕。
 */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    const params = new URL(request.url).searchParams;
    const result = await auditLogService.list(
      {
        ...parsePagination(params),
        action: queryString(params, "action"),
        actorUserId: queryString(params, "actorUserId"),
        targetType: queryString(params, "targetType"),
        targetId: queryString(params, "targetId"),
        requestId: queryString(params, "requestId"),
        result: queryOneOf(params, "result", AuditResult),
        createdFrom: queryString(params, "createdFrom"),
        createdTo: queryString(params, "createdTo"),
      },
      actor,
    );
    return apiSuccess(result.items, requestId, { pagination: result.pagination });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
