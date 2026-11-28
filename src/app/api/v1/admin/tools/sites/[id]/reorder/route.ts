import { bodyOneOf } from "@/features/admin/admin-http";
import { toolSiteAdminService } from "@/features/tools/tool-admin-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/** 组内上移 / 下移一格。已在首末位时幂等成功。 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    await toolSiteAdminService.reorder(
      (await params).id,
      bodyOneOf(body, "direction", ["UP", "DOWN"] as const),
      actor,
    );
    return apiSuccess({ reordered: true }, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
