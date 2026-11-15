import { bodyRequiredStringId } from "@/features/repair-activities/repair-activity-http";
import { repairActivityService } from "@/features/repair-activities/repair-activity-service";
import { AppError } from "@/lib/api/errors";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const { id } = await params;
    if (!id) throw new AppError("VALIDATION_FAILED", "活动 ID 无效");
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    await repairActivityService.softDeleteRegistration(
      id,
      bodyRequiredStringId(body, "registrationId"),
      body.reason,
      actor,
      "activity_board",
    );
    return apiSuccess({ deleted: true }, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
