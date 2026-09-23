import { bodyNullableString } from "@/features/admin/admin-http";
import { skillAdminService } from "@/features/skills/skill-admin-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/**
 * M6 第五轮：把技能标签拖到指定位置（`{beforeId: string | null}`）。
 *
 * 与 `POST /reorder`（上移 / 下移一格）并存：拖动会一次跨越任意格数，
 * 用 `reorder` 模拟要发 N 次请求、写 N 条审计，所以单独给一个「落点」入口。
 * `beforeId` 为 `null` 表示拖到末尾；落在原位时幂等成功。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    await skillAdminService.move((await params).id, bodyNullableString(body, "beforeId"), actor);
    return apiSuccess({ moved: true }, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
