"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AdminToast, type AdminToastMessage } from "@/components/admin/AdminToast";
import { loginCopy } from "@/config/auth";

/** 到期提醒独立于页面数据请求，停留页面或后台标签恢复时也会检查。 */
export function SessionMonitor() {
  const pathname = usePathname();
  const [toast, setToast] = useState<AdminToastMessage | null>(null);

  useEffect(() => {
    if (pathname === "/login") {
      if (new URL(window.location.href).searchParams.get("reason") === "expired")
        setToast({ text: loginCopy.sessionExpired, tone: "neutral" });
      return;
    }
    if (!/^\/(member|admin|account)(\/|$)/.test(pathname)) return;

    let cancelled = false;
    let checking = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expiresAt: number | undefined;

    function expired() {
      if (cancelled) return;
      cancelled = true;
      window.location.replace("/login?reason=expired");
    }

    async function check() {
      if (cancelled || checking) return;
      if (expiresAt !== undefined && expiresAt <= Date.now()) {
        expired();
        return;
      }
      checking = true;
      clearTimeout(timer);
      try {
        const response = await fetch("/api/v1/me", { cache: "no-store" });
        if (cancelled) return;
        if (response.status === 401) {
          expired();
          return;
        }
        const payload = (await response.json()) as {
          success?: boolean;
          data?: { expiresAt?: string };
        };
        if (response.ok && payload.success && payload.data?.expiresAt) {
          const deadline = Date.parse(payload.data.expiresAt);
          if (Number.isFinite(deadline)) expiresAt = deadline;
        }
      } catch {
        // 网络异常不等于会话失效，继续按已知到期时间检查。
      } finally {
        checking = false;
        if (!cancelled)
          timer = setTimeout(
            () => void check(),
            expiresAt === undefined
              ? 60_000
              : Math.max(0, Math.min(expiresAt - Date.now(), 86_400_000)),
          );
      }
    }

    function onVisible() {
      if (document.visibilityState === "visible") void check();
    }
    void check();
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pathname]);

  return <AdminToast toast={toast} onDismiss={() => setToast(null)} />;
}
