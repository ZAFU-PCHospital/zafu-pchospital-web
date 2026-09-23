import { repairAdminService } from "@/features/repairs/repair-admin-service";
import { requiredBool } from "@/features/repairs/repair-http";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";
export const runtime = "nodejs";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    return apiSuccess(
      await repairAdminService.updateFlags(
        (await params).id,
        {
          // 两个标记必须显式给出：漏传不再被静默当成 false（见 requiredBool 注释）。
          isDifficult: requiredBool(body, "isDifficult"),
          isTypical: requiredBool(body, "isTypical"),
        },
        actor,
      ),
      requestId,
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
