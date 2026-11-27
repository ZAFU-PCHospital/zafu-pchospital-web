import { toolSiteAdminService } from "@/features/tools/tool-admin-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/** 停用网站：从公开页隐藏，但保留行与组内顺序，可随时再启用。 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    return apiSuccess(
      await toolSiteAdminService.setActive((await params).id, false, actor),
      requestId,
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
