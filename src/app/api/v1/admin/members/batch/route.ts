import { memberService } from "@/features/members/member-service";
import { requiredBool, stringArray } from "@/features/repairs/repair-http";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";
export const runtime = "nodejs";
/**
 * M6 批量禁用 / 启用成员。
 *
 * 请求体 `{ memberIds: string[], enabled: boolean }`，单次上限 `ADMIN_BATCH_LIMIT`。
 * 逐条调用 `setEnabled`，**允许部分成功**：响应里 `failed` 带稳定错误码，界面需逐条展示。
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    return apiSuccess(
      await memberService.batchSetEnabled(
        { memberIds: stringArray(body, "memberIds"), enabled: requiredBool(body, "enabled") },
        actor,
      ),
      requestId,
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
