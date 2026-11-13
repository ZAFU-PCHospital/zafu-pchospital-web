import {
  TELEMETRY_BOUNDARIES,
  TELEMETRY_RATINGS,
  TELEMETRY_VITAL_NAMES,
  type TelemetryBoundary,
  type TelemetryRating,
  type TelemetryVitalName,
  telemetryConfig,
} from "@/config/telemetry";
import { AppError } from "@/lib/api/errors";

export type TelemetryWebVitalPayload = {
  kind: "web-vital";
  route: string;
  release?: string;
  metric: TelemetryVitalName;
  value: number;
  rating?: TelemetryRating;
};

export type TelemetryErrorPayload = {
  kind: "error";
  route: string;
  release?: string;
  boundary: TelemetryBoundary;
  /** 只保留错误类型名；message / stack 含用户输入与实现细节，禁止上报。 */
  name: string;
  digest?: string;
};

export type TelemetryPayload = TelemetryWebVitalPayload | TelemetryErrorPayload;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NUMERIC_SEGMENT_PATTERN = /^\d{1,20}$/;
const RELEASE_PATTERN = /^[0-9a-f]{7,40}$/i;
const ERROR_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$.-]{0,63}$/;
const DIGEST_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

export function sanitizeRoute(input: unknown): string {
  if (typeof input !== "string") return "/";
  let path = input.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (path === "") return "/";
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return "/";
    }
  }
  path = (path.split(/[?#]/)[0] ?? "/") || "/";
  if (!path.startsWith("/")) path = `/${path}`;
  const normalized = path
    .split("/")
    .map((segment) =>
      UUID_PATTERN.test(segment) || NUMERIC_SEGMENT_PATTERN.test(segment) ? "[id]" : segment,
    )
    .join("/");
  return normalized.length > telemetryConfig.limits.maxRouteLength
    ? normalized.slice(0, telemetryConfig.limits.maxRouteLength)
    : normalized;
}

export function sanitizeRelease(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const release = input.trim().toLowerCase();
  return RELEASE_PATTERN.test(release) ? release : undefined;
}

function isVitalName(value: string): value is TelemetryVitalName {
  return (TELEMETRY_VITAL_NAMES as readonly string[]).includes(value);
}

function isBoundary(value: string): value is TelemetryBoundary {
  return (TELEMETRY_BOUNDARIES as readonly string[]).includes(value);
}

function isRating(value: string): value is TelemetryRating {
  return (TELEMETRY_RATINGS as readonly string[]).includes(value);
}

function sanitizeErrorName(input: string): string {
  const name = input.trim();
  return ERROR_NAME_PATTERN.test(name) ? name : "Error";
}

function sanitizeDigest(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  return DIGEST_PATTERN.test(input) ? input : undefined;
}

function errorDigest(error: unknown): string | undefined {
  if (error === null || typeof error !== "object" || !("digest" in error)) return undefined;
  return sanitizeDigest((error as { digest?: unknown }).digest);
}

export function buildWebVitalPayload(
  metric: { name: string; value: number; rating?: string },
  route: string,
  release?: string,
): TelemetryWebVitalPayload | null {
  if (!isVitalName(metric.name)) return null;
  if (!Number.isFinite(metric.value) || metric.value < 0) return null;
  const normalizedRelease = sanitizeRelease(release);
  return {
    kind: "web-vital",
    route: sanitizeRoute(route),
    ...(normalizedRelease ? { release: normalizedRelease } : {}),
    metric: metric.name,
    value: Math.round(metric.value * 1000) / 1000,
    ...(metric.rating && isRating(metric.rating) ? { rating: metric.rating } : {}),
  };
}

export function buildErrorPayload(
  error: unknown,
  boundary: TelemetryBoundary,
  route: string,
  release?: string,
): TelemetryErrorPayload {
  const name = error instanceof Error ? error.name : "";
  const digest = errorDigest(error);
  const normalizedRelease = sanitizeRelease(release);
  return {
    kind: "error",
    route: sanitizeRoute(route),
    ...(normalizedRelease ? { release: normalizedRelease } : {}),
    boundary,
    name: sanitizeErrorName(name),
    ...(digest ? { digest } : {}),
  };
}

export function telemetryCodeForBoundary(boundary: TelemetryBoundary): string {
  switch (boundary) {
    case "route":
      return "ROUTE_ERROR";
    case "global":
      return "GLOBAL_ERROR";
    case "window":
      return "WINDOW_ERROR";
    case "unhandledrejection":
      return "UNHANDLED_REJECTION";
  }
}

function invalidPayload(): AppError {
  return new AppError("VALIDATION_FAILED", "遥测内容格式不正确");
}

/**
 * 服务端白名单解析：只接受与日志字段一一对应的键，未知字段一律丢弃。
 * 客户端已做一次规整，这里再做一次 —— 请求体由请求方控制，不能只信客户端。
 */
export function parseTelemetryPayload(input: unknown): TelemetryPayload {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw invalidPayload();
  const record = input as Record<string, unknown>;
  if (typeof record.route !== "string" || record.route.trim() === "") throw invalidPayload();
  const route = sanitizeRoute(record.route);
  const release = sanitizeRelease(record.release);

  if (record.kind === "web-vital") {
    if (typeof record.metric !== "string" || !isVitalName(record.metric)) throw invalidPayload();
    if (typeof record.value !== "number" || !Number.isFinite(record.value) || record.value < 0) {
      throw invalidPayload();
    }
    return {
      kind: "web-vital",
      route,
      ...(release ? { release } : {}),
      metric: record.metric,
      value: Math.round(record.value * 1000) / 1000,
      ...(typeof record.rating === "string" && isRating(record.rating)
        ? { rating: record.rating }
        : {}),
    };
  }

  if (record.kind === "error") {
    if (typeof record.boundary !== "string" || !isBoundary(record.boundary)) throw invalidPayload();
    const digest = sanitizeDigest(record.digest);
    return {
      kind: "error",
      route,
      ...(release ? { release } : {}),
      boundary: record.boundary,
      name: sanitizeErrorName(typeof record.name === "string" ? record.name : ""),
      ...(digest ? { digest } : {}),
    };
  }

  throw invalidPayload();
}
