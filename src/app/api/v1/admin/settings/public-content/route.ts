import { bodyBool, bodyOneOf } from "@/features/admin/admin-http";
import { publicContentSettingsService } from "@/features/admin/public-content-settings-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";
import { RankingDisplayNameMode } from "@/types/contracts";

export const runtime = "nodejs";

/** M6 批次 2：读取公开内容与展示策略（需求 §31 / §32 / §74）。 */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    return apiSuccess(await publicContentSettingsService.get(actor), requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

/**
 * 整体替换语义（四个字段一起提交）：这是**一份策略**，不是可局部打补丁的字段集合。
 * 缺字段一律 400，避免「只改展示名」的调用把三个开关悄悄关掉。
 */
export async function PUT(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    const result = await publicContentSettingsService.update(
      {
        publicRepairStatsEnabled: bodyBool(body, "publicRepairStatsEnabled"),
        publicRepairStatsDetailEnabled: bodyBool(body, "publicRepairStatsDetailEnabled"),
        publicRankingsEnabled: bodyBool(body, "publicRankingsEnabled"),
        rankingDisplayName: bodyOneOf(body, "rankingDisplayName", RankingDisplayNameMode),
      },
      actor,
    );
    return apiSuccess(result, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
