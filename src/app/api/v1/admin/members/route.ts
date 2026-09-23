import { memberListInput } from "@/features/members/member-http";
import { memberService } from "@/features/members/member-service";
import { parsePagination } from "@/lib/api/pagination";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";
export const runtime = "nodejs";
/** M6 成员列表：分页 + 关键字 + 状态/角色筛选。联系方式在响应里一律脱敏。 */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    const params = new URL(request.url).searchParams;
    const page = parsePagination(params);
    const result = await memberService.list(
      memberListInput(params, page.page, page.pageSize),
      actor,
    );
    return apiSuccess(result.items, requestId, {
      pagination: result.pagination,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    return apiSuccess(
      await memberService.create(
        {
          realName: String(body.realName ?? ""),
          qq: String(body.qq ?? ""),
          phone: String(body.phone ?? ""),
          studentId: optional(body.studentId),
          className: optional(body.className),
          nickname: optional(body.nickname),
          idempotencyKey: String(body.idempotencyKey ?? ""),
        },
        actor,
      ),
      requestId,
      { status: 201 },
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
function optional(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
