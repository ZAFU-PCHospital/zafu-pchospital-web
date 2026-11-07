import { bodyOptionalString, bodyString } from "@/features/admin/admin-http";
import {
  bodyNullableIsoDate,
  bodyOptionalIsoDate,
  bodyRequiredInt,
} from "@/features/repair-activities/repair-activity-http";
import { REPAIR_ACTIVITY_CAPACITY_MIN } from "@/features/repair-activities/repair-activity-validation";
import { repairActivityService } from "@/features/repair-activities/repair-activity-service";
import { AppError } from "@/lib/api/errors";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    const id = (await params).id;
    if (!id) throw new AppError("VALIDATION_FAILED", "活动 ID 无效");

    const title = "title" in body ? bodyString(body, "title") : undefined;
    // 地点与结束时间都可清空：location 用空串 → null，endsAt 用显式 null；
    // 缺字段一律表示「保持原值」，两条字段的清空行为保持一致。
    const location = bodyOptionalString(body, "location");
    const capacity =
      "capacity" in body
        ? bodyRequiredInt(body, "capacity", { min: REPAIR_ACTIVITY_CAPACITY_MIN, max: 10_000 })
        : undefined;

    const result = await repairActivityService.update(
      id,
      {
        title,
        location,
        capacity,
        activityAt: bodyOptionalIsoDate(body, "activityAt"),
        endsAt: bodyNullableIsoDate(body, "endsAt"),
        signupOpensAt: bodyOptionalIsoDate(body, "signupOpensAt"),
        signupClosesAt: bodyOptionalIsoDate(body, "signupClosesAt"),
      },
      actor,
    );
    return apiSuccess(result, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const id = (await params).id;
    if (!id) throw new AppError("VALIDATION_FAILED", "活动 ID 无效");
    await repairActivityService.softDelete(id, actor);
    return apiSuccess({ deleted: true }, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
