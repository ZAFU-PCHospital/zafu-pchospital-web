import { memberService } from "@/features/members/member-service";
import { nullableText, requiredVersion } from "@/features/members/member-http";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

/** M6 成员详情：**唯一**返回 QQ / 手机号明文的管理端接口，读取会写审计。 */
export async function GET(request: Request, { params }: Context) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    return apiSuccess(await memberService.getDetail((await params).id, actor), requestId, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

/** M6 编辑成员：实名 / 学号 / 班级 / 昵称，带乐观锁。 */
export async function PATCH(request: Request, { params }: Context) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    return apiSuccess(
      await memberService.update(
        (await params).id,
        {
          realName: nullableText(body.realName) ?? undefined,
          studentId: nullableText(body.studentId),
          className: nullableText(body.className),
          nickname: nullableText(body.nickname),
          version: requiredVersion(body),
        },
        actor,
      ),
      requestId,
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
