import { commentAdminService } from "@/features/community/comment-admin-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/**
 * M6 批次 2：删除违规评论（软删除）。
 *
 * 刻意不复用成员端的 `DELETE /api/v1/repairs/:id/comments/:commentId`：那条路径要先按
 * 记录 ID 做 `assertCanReadRepair`，而管理端是从跨记录列表直接按评论 ID 操作的。
 * 两条路径写的是同一张表、同一套软删除语义，只是入口校验不同。
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    await commentAdminService.softDelete((await params).id, actor);
    return apiSuccess({ deleted: true }, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
