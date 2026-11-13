import { telemetryConfig } from "@/config/telemetry";
import { clientIp } from "@/lib/api/client-ip";
import { AppError } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { getRequestId } from "@/lib/api/request-id";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/auth/request";
import { buildCommitInfo } from "@/lib/build-info";
import { parseTelemetryPayload, telemetryCodeForBoundary } from "@/lib/telemetry/payload";

export const runtime = "nodejs";

/**
 * 前端遥测的落点：只写结构化 stdout，不入库、不接第三方服务。
 *
 * 隐私边界由 `parseTelemetryPayload` 的白名单把守：只接受路由路径、发布 SHA、
 * 指标名 / 数值与错误类型名。message、stack、查询串、IP、UA 都不在契约里。
 * 请求仍走同源校验与按 IP 限流 —— 这是匿名写接口，不能成为日志注入或刷量的入口。
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    enforceRateLimit(
      `telemetry:${clientIp(request)}`,
      telemetryConfig.limits.rateLimitPerMinute,
      60_000,
    );

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("application/json"))
      throw new AppError("VALIDATION_FAILED", "遥测内容格式不正确", { status: 415 });

    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (declaredLength > telemetryConfig.limits.maxBodyBytes)
      throw new AppError("VALIDATION_FAILED", "遥测内容过大", { status: 413 });

    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > telemetryConfig.limits.maxBodyBytes)
      throw new AppError("VALIDATION_FAILED", "遥测内容过大", { status: 413 });

    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      throw new AppError("VALIDATION_FAILED", "遥测内容格式不正确");
    }

    const payload = parseTelemetryPayload(input);
    const serverRelease = buildCommitInfo.commit || "unknown";
    console.info(
      JSON.stringify({
        event: "client_telemetry",
        time: new Date().toISOString(),
        requestId,
        kind: payload.kind,
        route: payload.route,
        release: serverRelease,
        ...(payload.release && payload.release !== serverRelease
          ? { clientRelease: payload.release }
          : {}),
        ...(payload.kind === "web-vital"
          ? { metric: payload.metric, value: payload.value, rating: payload.rating }
          : {
              code: telemetryCodeForBoundary(payload.boundary),
              boundary: payload.boundary,
              name: payload.name,
              digest: payload.digest,
            }),
      }),
    );

    return apiSuccess({ accepted: true }, requestId, {
      status: 202,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
