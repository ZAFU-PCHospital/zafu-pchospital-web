import { repairAdminService } from "@/features/repairs/repair-admin-service";
import { stringArray } from "@/features/repairs/repair-http";
import { AppError } from "@/lib/api/errors";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";
import { RepairReviewDecision } from "@/types/contracts";
import type { RepairReviewDecision as Decision } from "@/types/contracts";
export const runtime = "nodejs";
/**
 * M6 批量审核：请求体 `{ recordIds: string[], decision, note?, idempotencyKey }`。
 * 逐条复用单条审核路径，允许部分成功（`failed` 带稳定错误码）。
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    const decision = String(body.decision ?? "");
    if (!(RepairReviewDecision as readonly string[]).includes(decision))
      throw new AppError("VALIDATION_FAILED", "审核结论无效");
    return apiSuccess(
      await repairAdminService.batchReview(
        {
          recordIds: stringArray(body, "recordIds"),
          decision: decision as Decision,
          note: typeof body.note === "string" ? body.note : undefined,
          idempotencyKey: String(body.idempotencyKey ?? ""),
        },
        actor,
      ),
      requestId,
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
