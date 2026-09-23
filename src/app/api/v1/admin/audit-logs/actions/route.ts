import { auditLogService } from "@/features/admin/audit-log-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/**
 * M6 批次 2：审计动作清单（带出现次数）。
 *
 * 单独一个端点是为了让筛选下拉是**可选项列表**而不是让管理员手打 `repair.exported`
 * 这类动作名 —— 动作命名规则（点分小写 vs 历史遗留的大写下划线）不该由使用者记。
 */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    return apiSuccess(await auditLogService.listActions(actor), requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
