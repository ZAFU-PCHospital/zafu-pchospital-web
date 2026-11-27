import { bodyNullableString } from "@/features/admin/admin-http";
import { toolSiteAdminService } from "@/features/tools/tool-admin-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/** 组内拖动排序：`{beforeId: string | null}`。跨组拖动请改 `categoryId`（PATCH）。 */
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
    );
    return apiSuccess({ moved: true }, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
