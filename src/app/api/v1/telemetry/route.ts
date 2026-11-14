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

function bodyTooLarge(): AppError {
  return new AppError("VALIDATION_FAILED", "遥测内容过大", { status: 413 });
}

/**
 * 流式读取并累计字节数：超限时立刻取消请求流再抛 413。
 *
 * 只靠 `Content-Length` 挡不住 chunked / 无长度的请求，先 `request.text()` 再量大小
 * 会让匿名端点先把整个 body 读进内存。这里的上限必须在读取过程中生效。
 */
async function readBodyWithinLimit(request: Request, limit: number): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > limit) throw bodyTooLarge();
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw bodyTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

function accepted(requestId: string) {
  return apiSuccess({ accepted: true }, requestId, {
    status: 202,
    headers: { "Cache-Control": "private, no-store" },
  });
}

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
    // 服务端运营开关：停止接收时直接确认，不读正文、不写日志。
    if (process.env.TELEMETRY_DISABLED === "1") return accepted(requestId);
    enforceRateLimit(
      `telemetry:${clientIp(request)}`,
      telemetryConfig.limits.rateLimitPerMinute,
      60_000,
    );

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("application/json"))
      throw new AppError("VALIDATION_FAILED", "遥测内容格式不正确", { status: 415 });

    const text = await readBodyWithinLimit(request, telemetryConfig.limits.maxBodyBytes);

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

    return accepted(requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
