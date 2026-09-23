import { bodyOptionalInt, bodyOptionalString } from "@/features/admin/admin-http";
import { skillAdminService } from "@/features/skills/skill-admin-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/** M6 批次 2：修改技能标签。`code` 不可改 —— 它是稳定机器码，界面与审计都按它检索。 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    const result = await skillAdminService.update(
      (await params).id,
      {
        name: bodyOptionalString(body, "name") ?? undefined,
        description: bodyOptionalString(body, "description"),
        sortOrder: bodyOptionalInt(body, "sortOrder", { min: 0, max: 1_000_000 }),
      },
      actor,
    );
    return apiSuccess(result, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
