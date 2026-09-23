import { repairCategoryService } from "@/features/repairs/repair-category-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";
export const runtime = "nodejs";
/** M6：重新启用被误停用的分类（替代方案只能是新建同名分类，会把历史记录劈成两份）。 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    return apiSuccess(await repairCategoryService.activate((await params).id, actor), requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
