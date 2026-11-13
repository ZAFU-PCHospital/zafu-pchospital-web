"use client";

import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import { useEffect } from "react";

import {
  reportClientError,
  reportClientWebVital,
  resetClientTelemetryPage,
} from "@/lib/telemetry/client";

/**
 * 全站唯一的遥测挂载点：不渲染任何节点。
 *
 * 路由错误由 `error.tsx` / `global-error.tsx` 自己上报；这里补两个错误边界抓不到的路径：
 * window `error`（chunk 加载失败、事件处理器抛出）与 `unhandledrejection`。
 * 页面切换时重置本页计数，避免用户长时间停留后后续页面失去配额。
 */
export function ClientTelemetry() {
  const pathname = usePathname();

  useEffect(() => {
    resetClientTelemetryPage();
  }, [pathname]);

  useReportWebVitals(reportClientWebVital);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      reportClientError(event.error, "window");
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      reportClientError(event.reason, "unhandledrejection");
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
