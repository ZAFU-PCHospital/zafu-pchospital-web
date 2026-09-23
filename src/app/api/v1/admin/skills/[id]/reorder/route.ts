import { bodyOneOf } from "@/features/admin/admin-http";
import { skillAdminService } from "@/features/skills/skill-admin-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";
import { ReorderDirection } from "@/types/contracts";

export const runtime = "nodejs";

/**
 * M6：把技能标签上移 / 下移一格（`{direction: "UP" | "DOWN"}`）。
 *
 * 取代原来「让管理员填排序数字」的做法。已在首/末位时幂等成功 —— 点了一个不会改变
 * 任何东西的按钮不该收到错误。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    await skillAdminService.reorder(
      (await params).id,
      bodyOneOf(body, "direction", ReorderDirection),
      actor,
    );
    return apiSuccess({ reordered: true }, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
