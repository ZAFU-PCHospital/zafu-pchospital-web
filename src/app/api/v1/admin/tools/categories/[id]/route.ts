import { bodyOptionalString } from "@/features/admin/admin-http";
import { toolCategoryAdminService } from "@/features/tools/tool-admin-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/** 修改工具分类。`code` 不可改 —— 它是稳定机器码，审计与脚本按它检索。 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    const result = await toolCategoryAdminService.update(
      (await params).id,
      {
        name: bodyOptionalString(body, "name") ?? undefined,
        labelEn: bodyOptionalString(body, "labelEn"),
        description: bodyOptionalString(body, "description"),
        expectedUpdatedAt: bodyOptionalString(body, "expectedUpdatedAt") ?? undefined,
      },
      actor,
    );
    return apiSuccess(result, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

/** 删除工具分类（软删除）。分类下还有网站时 409，提示先移走或删除网站。 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    await toolCategoryAdminService.remove((await params).id, actor);
    return apiSuccess({ removed: true }, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
