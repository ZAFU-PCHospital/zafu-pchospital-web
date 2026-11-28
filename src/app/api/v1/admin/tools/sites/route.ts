import { bodyOptionalString, bodyString } from "@/features/admin/admin-http";
import { toolSiteAdminService } from "@/features/tools/tool-admin-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/**
 * 工具导航收录的网站。
 *
 * `GET` 返回**含已停用**的全部网站（按分组内序号排序），后台列表自己按 `categoryId` 分组。
 */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    return apiSuccess(await toolSiteAdminService.list(actor), requestId);
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
    const result = await toolSiteAdminService.create(
      {
        categoryId: bodyString(body, "categoryId"),
        name: bodyString(body, "name"),
        url: bodyString(body, "url"),
        description: bodyOptionalString(body, "description"),
      },
      actor,
    );
    return apiSuccess(result, requestId, { status: 201 });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
