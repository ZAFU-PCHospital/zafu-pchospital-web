/**
 * 前端遥测配置。
 *
 * 关闭与采样走 `NEXT_PUBLIC_*` 构建期内联；服务端只做白名单校验与按 IP 限流，
 * 不读客户端采样结果，避免把“没收到”误判成“没发生”。
 */

export const TELEMETRY_VITAL_NAMES = ["CLS", "FCP", "INP", "LCP", "TTFB"] as const;
export type TelemetryVitalName = (typeof TELEMETRY_VITAL_NAMES)[number];

export const TELEMETRY_BOUNDARIES = ["route", "global", "window", "unhandledrejection"] as const;
export type TelemetryBoundary = (typeof TELEMETRY_BOUNDARIES)[number];

export const TELEMETRY_RATINGS = ["good", "needs-improvement", "poor"] as const;
export type TelemetryRating = (typeof TELEMETRY_RATINGS)[number];

export function parseSampleRate(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 1;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 1;
}

export const telemetryConfig = {
  endpoint: "/api/v1/telemetry",
  enabled: process.env.NEXT_PUBLIC_TELEMETRY_DISABLED !== "1",
  /** 0–1；只作用于 Web Vitals。错误由签名去重与同页上限保护，不采样。 */
  vitalsSampleRate: parseSampleRate(process.env.NEXT_PUBLIC_TELEMETRY_SAMPLE_RATE),
  limits: {
    maxBodyBytes: 4096,
    maxRouteLength: 200,
    errorDedupeWindowMs: 60_000,
    errorDedupeMax: 3,
    pageEventMax: 20,
    maxVitalsPerPage: 10,
    rateLimitPerMinute: 120,
  },
} as const;
