import { bodyOptionalString } from "@/features/admin/admin-http";
import { toolSiteAdminService } from "@/features/tools/tool-admin-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/** 修改网站。`categoryId` 可改 —— 后台的「换分类」就是靠它。 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    const result = await toolSiteAdminService.update(
      (await params).id,
      {
        categoryId: bodyOptionalString(body, "categoryId") ?? undefined,
        name: bodyOptionalString(body, "name") ?? undefined,
        url: bodyOptionalString(body, "url") ?? undefined,
        description: bodyOptionalString(body, "description"),
      },
      actor,
    );
    return apiSuccess(result, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

/** 删除网站（软删除）。行保留，审计仍可追溯。 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    await toolSiteAdminService.remove((await params).id, actor);
    return apiSuccess({ removed: true }, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
