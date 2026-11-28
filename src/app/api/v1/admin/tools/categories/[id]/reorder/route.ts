import { bodyOneOf } from "@/features/admin/admin-http";
import { toolCategoryAdminService } from "@/features/tools/tool-admin-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/** 上移 / 下移一格。已在首末位时**幂等成功**，不报错、不写审计。 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    await toolCategoryAdminService.reorder(
      (await params).id,
      bodyOneOf(body, "direction", ["UP", "DOWN"] as const),
      actor,
    );
    return apiSuccess({ reordered: true }, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
