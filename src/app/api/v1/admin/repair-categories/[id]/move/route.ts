import { bodyNullableString } from "@/features/admin/admin-http";
import { repairCategoryService } from "@/features/repairs/repair-category-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/** M6 第五轮：把故障分类拖到指定位置。与技能标签同一实现（`{beforeId}`，`null` = 末尾）。 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    await repairCategoryService.move(
      (await params).id,
      bodyNullableString(body, "beforeId"),
      actor,
    );
    return apiSuccess({ moved: true }, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
