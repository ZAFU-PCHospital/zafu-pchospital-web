import { bodyNullableString } from "@/features/admin/admin-http";
import { toolCategoryAdminService } from "@/features/tools/tool-admin-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/** 拖动排序：`{beforeId: string | null}`，`null` 表示拖到末尾；落在原位时幂等成功。 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    await toolCategoryAdminService.move(
      (await params).id,
      bodyNullableString(body, "beforeId"),
      actor,
    );
    return apiSuccess({ moved: true }, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
