import { bodyString } from "@/features/admin/admin-http";
import { repairActivityCustomerService } from "@/features/repair-activities/repair-activity-customer-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

/** 活动管理里的客户黑名单/未到场记录。GET 会先按当前学年补齐历史事件。 */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    return apiSuccess(await repairActivityCustomerService.list(actor), requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

/** 管理员人工加入黑名单；封到本学年结束。 */
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    return apiSuccess(
      await repairActivityCustomerService.block(
        {
          name: bodyString(body, "name"),
          phone: bodyString(body, "phone"),
          reason: bodyString(body, "reason"),
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
