import { bodyOptionalString } from "@/features/admin/admin-http";
import { repairActivityCustomerService } from "@/features/repair-activities/repair-activity-customer-service";
import { AppError } from "@/lib/api/errors";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ blockId: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const blockId = (await params).blockId;
    if (!blockId) throw new AppError("VALIDATION_FAILED", "封锁记录 ID 无效");
    const body = (await request.json()) as Record<string, unknown>;
    await repairActivityCustomerService.lift(
      blockId,
      bodyOptionalString(body, "reason") ?? "",
      actor,
    );
    return apiSuccess({ lifted: true }, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
