import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { authenticateRequest, sessionCookie } from "@/lib/auth/request";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { principal, token } = await authenticateRequest(request, requestId, true);
    const response = apiSuccess(principal, requestId, {
      headers: { "Cache-Control": "private, no-store" },
    });
    response.cookies.set(sessionCookie(token, principal.expiresAt));
    return response;
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
