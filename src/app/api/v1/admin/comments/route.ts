import { queryOneOf, queryString } from "@/features/admin/admin-http";
import { commentAdminService } from "@/features/community/comment-admin-service";
import { parsePagination } from "@/lib/api/pagination";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { authenticateRequest } from "@/lib/auth/request";
import { CommentModerationFilter } from "@/types/contracts";

export const runtime = "nodejs";

/**
 * M6 批次 2：评论管理列表（需求 §37）。
 *
 * 与成员端 `GET /api/v1/repairs/:id/comments` 是两条不同的路径：这条是**跨记录**的，
 * 因此用 `comment:moderate`（仅 ADMIN），不因为「成员也有 comment:read」就放行。
 */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    const params = new URL(request.url).searchParams;
    const result = await commentAdminService.list(
      {
        ...parsePagination(params),
        query: queryString(params, "query"),
        recordId: queryString(params, "recordId"),
        authorMemberProfileId: queryString(params, "authorMemberProfileId"),
        deleted: queryOneOf(params, "deleted", CommentModerationFilter),
        createdFrom: queryString(params, "createdFrom"),
        createdTo: queryString(params, "createdTo"),
      },
      actor,
    );
    return apiSuccess(result.items, requestId, { pagination: result.pagination });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
