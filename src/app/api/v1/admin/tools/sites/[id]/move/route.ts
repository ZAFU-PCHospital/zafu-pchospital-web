import { bodyNullableString, bodyOptionalString } from "@/features/admin/admin-http";
import { toolSiteAdminService } from "@/features/tools/tool-admin-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/** 可传 categoryId，原子地更换分类并调整落点。 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    await toolSiteAdminService.move(
      (await params).id,
      bodyNullableString(body, "beforeId"),
      actor,
      bodyOptionalString(body, "categoryId") ?? undefined,
    );
    return apiSuccess({ moved: true }, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
