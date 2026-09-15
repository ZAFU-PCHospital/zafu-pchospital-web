import { getDb } from "@/lib/db/client";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    await getDb().$queryRaw`SELECT 1`;
    return apiSuccess({ status: "ok", database: "reachable" }, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
