import { bodyOneOf } from "@/features/admin/admin-http";
import { repairCategoryService } from "@/features/repairs/repair-category-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";
import { ReorderDirection } from "@/types/contracts";

export const runtime = "nodejs";

/** M6：把故障分类上移 / 下移一格。与技能标签同一实现。 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    await repairCategoryService.reorder(
      (await params).id,
      bodyOneOf(body, "direction", ReorderDirection),
      actor,
    );
    return apiSuccess({ reordered: true }, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
