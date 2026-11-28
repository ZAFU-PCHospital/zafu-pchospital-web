import { bodyOptionalString, bodyString } from "@/features/admin/admin-http";
import { toolCategoryAdminService } from "@/features/tools/tool-admin-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/**
 * 工具导航分类（公开 `/tools` 页的分组）。
 *
 * `GET` 返回**含已停用**的分类并带启用网站数，供后台列表提示「停用这一组会隐藏几个」。
 */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    return apiSuccess(await toolCategoryAdminService.list(actor), requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    const result = await toolCategoryAdminService.create(
      {
        code: bodyOptionalString(body, "code") ?? undefined,
        name: bodyString(body, "name"),
        labelEn: bodyOptionalString(body, "labelEn"),
        description: bodyOptionalString(body, "description"),
      },
      actor,
    );
    return apiSuccess(result, requestId, { status: 201 });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
