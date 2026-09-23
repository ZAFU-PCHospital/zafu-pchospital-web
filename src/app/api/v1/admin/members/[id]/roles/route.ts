import { roleSet } from "@/features/members/member-http";
import { memberService } from "@/features/members/member-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";
export const runtime = "nodejs";
/**
 * M6 设置角色：请求体 `{ roles: ["MEMBER", "ADMIN"] }` 是**全量集合**。
 * 撤销最后一个在册管理员会返回 409 `MEMBER_LAST_ADMIN`。
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    return apiSuccess(
      await memberService.setRoles((await params).id, { roles: roleSet(body) }, actor),
      requestId,
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
