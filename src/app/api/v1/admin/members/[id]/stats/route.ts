import { analyticsService } from "@/features/analytics/analytics-service";
import { memberService } from "@/features/members/member-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { authenticateRequest } from "@/lib/auth/request";
export const runtime = "nodejs";
/**
 * M6「查看成员统计」。
 *
 * 先走 `getDetail` 的权限与存在性语义（`member:manage`），再取 M5 的同一套统计口径。
 * 允许查看**已禁用**成员的历史统计 —— 成员一旦被禁用其个人页就 404 了，
 * 管理端必须另有一条受控路径，否则「禁用后发现数据不对」就无法核查。
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    const { id } = await params;
    await memberService.assertManageable(id, actor);
    return apiSuccess(await analyticsService.getMemberAnalyticsFor(id, actor), requestId, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
