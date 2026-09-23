import { requiredVersion } from "@/features/members/member-http";
import { memberService } from "@/features/members/member-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";
export const runtime = "nodejs";
/**
 * M6 管理员设置成员技能标签：请求体 `{ skillIds: string[], profileVersion: number }`。
 * 与成员自助 `PUT /api/v1/member/profile/skills` 共用同一份实现与上限（12 个）。
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    return apiSuccess(
      await memberService.setSkills(
        (await params).id,
        {
          skillIds: Array.isArray(body.skillIds) ? body.skillIds.map((id) => String(id)) : [],
          profileVersion: requiredVersion({ version: body.profileVersion }),
        },
        actor,
      ),
      requestId,
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
