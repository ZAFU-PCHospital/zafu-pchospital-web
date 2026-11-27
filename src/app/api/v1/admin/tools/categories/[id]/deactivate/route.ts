import { toolCategoryAdminService } from "@/features/tools/tool-admin-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/** 停用工具分类：整组从公开页消失，组内网站与排序都保留，可再次启用。 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    return apiSuccess(
      await toolCategoryAdminService.setActive((await params).id, false, actor),
      requestId,
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
