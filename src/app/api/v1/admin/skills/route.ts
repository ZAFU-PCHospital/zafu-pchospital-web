import { bodyOptionalInt, bodyOptionalString, bodyString } from "@/features/admin/admin-http";
import { skillAdminService } from "@/features/skills/skill-admin-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/**
 * M6 批次 2：技能标签库。
 *
 * `GET` 返回**含已停用**的标签并带选用成员计数（成员侧 `/api/v1/skills` 只给启用中的）。
 */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    return apiSuccess(await skillAdminService.list(actor), requestId);
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
    const result = await skillAdminService.create(
      {
        code: bodyString(body, "code"),
        name: bodyString(body, "name"),
        description: bodyOptionalString(body, "description"),
        sortOrder: bodyOptionalInt(body, "sortOrder", { min: 0, max: 1_000_000 }),
      },
      actor,
    );
    return apiSuccess(result, requestId, { status: 201 });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
