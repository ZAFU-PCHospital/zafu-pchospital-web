import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { joinApplicationService } from "@/features/recruitment/join-application-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  try {
    enforceRateLimit(`join:${ipAddress}`);
    const body = (await request.json()) as Record<string, unknown>;
    const receipt = await joinApplicationService.submit(
      {
        recruitmentCycle: process.env.RECRUITMENT_CYCLE ?? "configure-before-opening",
        realName: String(body.realName ?? ""),
        qq: String(body.qq ?? ""),
        phone: String(body.phone ?? ""),
        selfIntroduction: optionalString(body.selfIntroduction),
        preferredDirection: optionalString(body.preferredDirection),
        privacyConsent: body.privacyConsent === true,
      },
      { requestId, ipAddress, userAgent: request.headers.get("user-agent") ?? undefined },
    );
    return apiSuccess(receipt, requestId, { status: receipt.duplicate ? 200 : 201 });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
