import { bodyOptionalString } from "@/features/admin/admin-http";
import { repairActivityCustomerService } from "@/features/repair-activities/repair-activity-customer-service";
import { AppError } from "@/lib/api/errors";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const eventId = (await params).eventId;
    if (!eventId) throw new AppError("VALIDATION_FAILED", "未到场记录 ID 无效");
    const body = (await request.json()) as Record<string, unknown>;
    await repairActivityCustomerService.exempt(
      eventId,
      bodyOptionalString(body, "note") ?? "",
      actor,
    );
    return apiSuccess({ exempted: true }, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
