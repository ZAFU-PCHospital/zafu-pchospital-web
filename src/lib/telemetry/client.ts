import {
  type TelemetryBoundary,
  type TelemetryVitalName,
  telemetryConfig,
} from "@/config/telemetry";
import { buildCommitInfo } from "@/lib/build-info";

import {
  buildErrorPayload,
  buildWebVitalPayload,
  sanitizeRoute,
  type TelemetryPayload,
} from "./payload";

export type WebVitalMetric = {
  name: string;
  value: number;
  rating?: string;
};

export type TelemetryReporter = {
  reportWebVital(metric: WebVitalMetric, route?: string): void;
  reportError(error: unknown, boundary: TelemetryBoundary, route?: string): void;
  resetPage(): void;
};

export type TelemetryReporterOptions = {
  send: (payload: TelemetryPayload) => void;
  now?: () => number;
  random?: () => number;
  enabled?: boolean;
  sampleRate?: number;
};

/**
 * 上报节流全部在客户端完成：
 * - Web Vitals 按配置采样，每个页面每种指标最多一条；
 * - 错误不采样（偶发错误采样后就永远看不到），改为按「边界 + 类型 + digest」去重，
 *   每分钟最多 3 条，每页最多 20 条。
 * 服务端只做白名单与按 IP 限流，不能再按客户端采样结果推断「没发生」。
 */
export function createTelemetryReporter(options: TelemetryReporterOptions): TelemetryReporter {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const enabled = options.enabled ?? true;
  const sampleRate = options.sampleRate ?? 1;
  const release = buildCommitInfo.commit || undefined;

  let vitalsCount = 0;
  let pageEventCount = 0;
  let seenVitals = new Set<TelemetryVitalName>();
  let errorTimestamps = new Map<string, number[]>();

  return {
    resetPage() {
      vitalsCount = 0;
      pageEventCount = 0;
      seenVitals = new Set();
      errorTimestamps = new Map();
    },

    reportWebVital(metric, route = "/") {
      if (!enabled) return;
      if (vitalsCount >= telemetryConfig.limits.maxVitalsPerPage) return;
      if (seenVitals.has(metric.name as TelemetryVitalName)) return;
      if (random() >= sampleRate) return;
      const payload = buildWebVitalPayload(metric, route, release);
      if (!payload) return;
      seenVitals.add(payload.metric);
      vitalsCount++;
      options.send(payload);
    },

    reportError(error, boundary, route = "/") {
      if (!enabled) return;
      if (pageEventCount >= telemetryConfig.limits.pageEventMax) return;
      const payload = buildErrorPayload(error, boundary, route, release);
      const signature = `${payload.boundary}:${payload.name}:${payload.digest ?? ""}`;
      const timestamp = now();
      const recent = (errorTimestamps.get(signature) ?? []).filter(
        (at) => timestamp - at < telemetryConfig.limits.errorDedupeWindowMs,
      );
      if (recent.length >= telemetryConfig.limits.errorDedupeMax) {
        errorTimestamps.set(signature, recent);
        return;
      }
      recent.push(timestamp);
      errorTimestamps.set(signature, recent);
      pageEventCount++;
      options.send(payload);
    },
  };
}

/** 只发路径；查询串与 hash 可能带用户输入，优先用 sendBeacon 保证卸载时也能发出。 */
function sendTelemetryPayload(payload: TelemetryPayload): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify(payload);
  const endpoint = telemetryConfig.endpoint;
  if (typeof navigator.sendBeacon === "function") {
    const beacon = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon(endpoint, beacon)) return;
  }
  void fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
    credentials: "same-origin",
    cache: "no-store",
  }).catch(() => {
    // 遥测失败不能影响页面，也不重试：重试会放大故障期间的请求量。
  });
}

let sharedReporter: TelemetryReporter | undefined;

function getSharedReporter(): TelemetryReporter {
  sharedReporter ??= createTelemetryReporter({
    send: sendTelemetryPayload,
    enabled: telemetryConfig.enabled,
    sampleRate: telemetryConfig.vitalsSampleRate,
  });
  return sharedReporter;
}

function currentRoute(): string {
  return typeof window === "undefined" ? "/" : sanitizeRoute(window.location.pathname);
}

export function resetClientTelemetryPage(): void {
  getSharedReporter().resetPage();
}

export function reportClientWebVital(metric: WebVitalMetric): void {
  getSharedReporter().reportWebVital(metric, currentRoute());
}

export function reportClientError(error: unknown, boundary: TelemetryBoundary): void {
  getSharedReporter().reportError(error, boundary, currentRoute());
}
