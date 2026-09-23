import { skillAdminService } from "@/features/skills/skill-admin-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/**
 * M6 批次 2：停用技能标签。
 *
 * 与故障分类同一策略：**不做物理删除**。标签被 `user_skills` 引用，删掉会让历史成员标签
 * 无声消失；停用后成员不能再新选，已有的关联仍然回显。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    return apiSuccess(
      await skillAdminService.setActive((await params).id, false, actor),
      requestId,
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
