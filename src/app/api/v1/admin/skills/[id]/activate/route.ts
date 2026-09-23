import { skillAdminService } from "@/features/skills/skill-admin-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/** M6 批次 2：重新启用技能标签。误停用后必须能恢复，否则只能新建同名标签。 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    return apiSuccess(await skillAdminService.setActive((await params).id, true, actor), requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
