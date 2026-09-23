import { bodyNullableString } from "@/features/admin/admin-http";
import { memberService } from "@/features/members/member-service";
import { stringArray } from "@/features/repairs/repair-http";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/**
 * M6 第九轮：拖动排序落点（`{memberIds: string[], beforeId: string | null}`）。
 *
 * 一个入口同时覆盖「拖一行」与「勾选多行后一起拖」：多行时保持它们之间的原有先后，
 * 整体插到 `beforeId` 之前（`null` = 末尾）。**一次拖动只写一次库、一条审计**
 * （逐行调用「上移一格」在跨十几行时会写十几次）。
 *
 * 界面是**乐观更新**：松手先按同一套规则改本地顺序，再发这个请求；所以落点没变时
 * 这里回 `{moved: false}` 而不是报错，界面照常展示即可。
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    const moved = await memberService.move(
      stringArray(body, "memberIds"),
      bodyNullableString(body, "beforeId"),
      actor,
    );
    return apiSuccess({ moved }, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
