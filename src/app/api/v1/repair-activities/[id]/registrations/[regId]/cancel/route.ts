import {
  repairActivityIpRateLimitKey,
  repairActivityPhoneRateLimitKey,
} from "@/features/repair-activities/repair-activity-rate-limit";
import { repairActivityService } from "@/features/repair-activities/repair-activity-service";
import { AppError } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, requestContext } from "@/lib/auth/request";
import { normalizePhone } from "@/lib/security/normalization";

export const runtime = "nodejs";

/**
 * 公开自助取消（issue #345）。
 * 姓名 + 手机号 + 查询返回的改类型 token 三者在 service 内匹配；活动开始前才允许。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; regId: string }> },
) {
  const requestId = getRequestId(request.headers);
  const context = requestContext(request, requestId);
  try {
    assertSameOrigin(request);
    const ip = context.ipAddress ?? "unknown";
    enforceRateLimit(repairActivityIpRateLimitKey(ip), 30, 60_000);
    const { id, regId } = await params;
    if (!id || !regId) throw new AppError("VALIDATION_FAILED", "参数无效");
    const body = (await request.json()) as Record<string, unknown>;
    const phoneRaw = String(body.phone ?? "");
    try {
      const phone = normalizePhone(phoneRaw);
      enforceRateLimit(repairActivityPhoneRateLimitKey(phone), 5, 60_000);
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "VALIDATION_FAILED") throw error;
    }
    return apiSuccess(
      await repairActivityService.cancelRegistration(
        id,
        regId,
        {
          name: String(body.name ?? ""),
          phone: phoneRaw,
          editToken: String(body.editToken ?? ""),
        },
        context,
      ),
      requestId,
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
