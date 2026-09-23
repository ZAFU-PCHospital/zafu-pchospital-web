import { queryOneOf, queryString } from "@/features/admin/admin-http";
import { inviteCodeService } from "@/features/invitations/invite-code-service";
import { parsePagination } from "@/lib/api/pagination";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";
import { InviteCodeEffectiveStatus } from "@/types/contracts";
export const runtime = "nodejs";
/**
 * 邀请码列表。M6 批次 2 之前是硬编码 `take: 100` 的裸数组：没有分页元数据，
 * 第 101 条之后直接消失且界面看不出来。现在返回标准分页信封。
 *
 * `status` 过滤的是**生效状态**（含派生的过期 / 用尽 / 未生效），不是库里的存储状态。
 */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    const params = new URL(request.url).searchParams;
    const result = await inviteCodeService.list(
      {
        ...parsePagination(params),
        status: queryOneOf(params, "status", InviteCodeEffectiveStatus),
        query: queryString(params, "query"),
      },
      actor,
    );
    return apiSuccess(result.items, requestId, { pagination: result.pagination });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    return apiSuccess(
      await inviteCodeService.create(
        {
          activeFrom: optionalDate(body.activeFrom),
          expiresAt: optionalDate(body.expiresAt),
          maxUses: Number(body.maxUses),
          boundQq: optional(body.boundQq),
          boundPhone: optional(body.boundPhone),
        },
        actor,
      ),
      requestId,
      { status: 201 },
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
function optional(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
function optionalDate(value: unknown): string | null | undefined {
  return value === null ? null : optional(value);
}
