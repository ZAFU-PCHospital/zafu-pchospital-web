"use client";

import {
  canAccessActivityWorkspace,
  isActivityObjectPath,
} from "@/lib/auth/activity-workspace-access";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { AdminToast, type AdminToastMessage } from "@/components/admin/AdminToast";
import { loginCopy } from "@/config/auth";
import { isAccountStepPage } from "@/lib/auth/account-steps";
import {
  checkClientSession,
  invalidateClientSession,
  refreshClientSession,
  watchClientSession,
} from "@/lib/auth/client-session";

/** 成功复查之间的等待封顶。它是**上限**，不是下限。 */
const MAX_WAIT_MS = 86_400_000;

/**
 * 退避 / 兜底的复查间隔。
 *
 * 两个来源：
 * - **上一次检查失败**（网络异常、非 2xx、失败信封）：无论手里还留着多远的 Session
 *   到期时间，都按这个间隔重试 —— 否则一次抖动会变成几小时没人复查；
 * - 首次还没拿到任何会话时间。
 * 更早的真实到期点仍然优先（到期就由失效分支处理）。过期豁免不参与排期，
 * 所以不会出现 0 毫秒连发，也不因此把有效会话报成过期。
 */
const RETRY_WAIT_MS = 60_000;

/**
 * 到期提醒与统一门禁的客户端跟随。
 *
 * - 只有 401 才算会话失效；门禁拒绝、业务错误、网络异常一律不当作过期。
 * - 受限状态按服务端给的 `destination` 整页跳转（重新走文档请求 = 重新判定），
 *   已经在**允许停留**的步骤页时不跳（`isAccountStepPage`，与服务端守卫同一份语义）。
 * - 请求 `/api/v1/me` 时把**候选**回跳目标一起交出去（步骤页带着链条里的 `returnTo`，
 *   业务页带着当前 pathname），服务端才可能在受限状态下给出带链条的落点。
 *   候选只是候选：放行与否只看数据库，目标由服务端按白名单与当前角色重判。
 * - 会话失效（本地已知到期，或 `/me` 返回 401）转登录页时同样带上这个候选，
 *   与页面守卫的交接口径一致，不把原目标丢在中间。
 * - 下一次复查按「最近的一个未来到期时间」安排，只封顶不抬底；豁免比会话更早到期时
 *   提前复查，不引入新的高频轮询。
 */
export function SessionMonitor() {
  const pathname = usePathname();
  const [toast, setToast] = useState<AdminToastMessage | null>(null);

  useEffect(() => {
    if (pathname === "/login") {
      if (new URL(window.location.href).searchParams.get("reason") === "expired")
        setToast({ text: loginCopy.sessionExpired, tone: "neutral" });
      return;
    }
    if (pathname === "/account/forgot-password") return;
    if (!/^\/(member|admin|account)(\/|$)/.test(pathname)) return;

    let cancelled = false;
    let checking = false;
    let recheck = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sessionExpiresAt: number | undefined;
    /** 豁免到期时间：比会话更早到时，只用来提前复查，不代表会话失效。 */
    let gateDeadline: number | undefined;
    /** 上一次检查没拿到可信状态（网络异常 / 非 2xx / 失败信封）——下一次按固定退避重试。 */
    let retryAfterFailure = false;

    /**
     * 会话失效 → 登录页。与页面守卫同一口径：把当前业务页 / 步骤链条里已有的目标作为
     * **候选**带上，登录后仍由服务端按白名单与当次角色复核（候选不是通行证，账号步骤
     * 本身也不会被当成终点 —— `returnCandidate()` 只给链条值或 `/member`·`/admin` 路径）。
     * 「本地已知到期」与「`/me` 返回 401」共用这一条，不分两套跳转。
     */
    function expired() {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(timer);
      const candidate = returnCandidate();
      invalidateClientSession();
      window.location.replace(
        candidate
          ? `/login?reason=expired&returnTo=${encodeURIComponent(candidate)}`
          : "/login?reason=expired",
      );
    }

    function gotoStep(destination: string) {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(timer);
      window.location.replace(destination);
    }

    /**
     * 只让**未来**的到期时间参与排期：已过期的（含异常响应后残留的那个）一律忽略。
     *
     * 两种排期要分开：
     * - 成功检查：按最近的一个未来到期时间安排，最长 24 小时（上限不是下限）。
     * - 失败检查：按固定退避（60 秒）重试 —— 不能因为「手里还留着两小时后的 Session
     *   时间」就把一次网络异常放大成几小时无人复查；更早的真实到期点仍然优先。
     */
    function nextDelay() {
      const now = Date.now();
      const upcoming = [sessionExpiresAt, gateDeadline].filter(
        (deadline): deadline is number => deadline !== undefined && deadline > now,
      );
      const nearest = upcoming.length === 0 ? undefined : Math.min(...upcoming) - now;
      if (retryAfterFailure) return Math.min(RETRY_WAIT_MS, nearest ?? RETRY_WAIT_MS);
      return Math.min(nearest ?? RETRY_WAIT_MS, MAX_WAIT_MS);
    }

    /**
     * 候选回跳目标：步骤页带着链条里已有的 `returnTo`，业务页带着当前 pathname。
     * 值本身不作任何判定 —— `resolveAccountAccess` 按白名单与当前角色重判。
     */
    function returnCandidate() {
      const fromQuery = new URL(window.location.href).searchParams.get("returnTo");
      if (fromQuery) return fromQuery;
      return pathname.startsWith("/member") || pathname.startsWith("/admin") ? pathname : "";
    }

    async function check() {
      if (cancelled || checking) return;
      if (sessionExpiresAt !== undefined && sessionExpiresAt <= Date.now()) {
        expired();
        return;
      }
      checking = true;
      clearTimeout(timer);
      const candidate = returnCandidate();
      try {
        const result = await checkClientSession(candidate);
        if (cancelled) return;
        if (!result.ok && result.status === 401) {
          expired();
          return;
        }
        if (!result.ok) {
          retryAfterFailure = true;
          return;
        }
        retryAfterFailure = false;
        const access = result.data.accountAccess;
        const parsed = (value: string | null | undefined) => {
          const time = value ? Date.parse(value) : Number.NaN;
          return Number.isFinite(time) ? time : undefined;
        };
        sessionExpiresAt = parsed(result.data.expiresAt) ?? sessionExpiresAt;
        gateDeadline = parsed(access?.exemptionExpiresAt);
        if (!access) return;
        if (
          (access.state !== "READY" && !isAccountStepPage(access.state, pathname)) ||
          (pathname.startsWith("/admin") &&
            !result.data.roles.includes("ADMIN") &&
            !(
              isActivityObjectPath(pathname) && canAccessActivityWorkspace(result.data.permissions)
            ))
        )
          gotoStep(access.destination);
      } catch {
        // 网络异常不等于会话失效；按固定退避重试，已过期的到期时间也不参与排期。
        retryAfterFailure = true;
      } finally {
        checking = false;
        if (!cancelled) {
          const delay = recheck ? 0 : nextDelay();
          recheck = false;
          timer = setTimeout(() => void check(), delay);
        }
      }
    }

    function onVisible() {
      if (document.visibilityState === "visible") refreshClientSession();
    }
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) refreshClientSession();
    }
    const unwatch = watchClientSession((event) => {
      if (cancelled) return;
      if (event.type === "change") {
        // 整页重判清除旧身份的组件状态、草稿与 Next 客户端路由缓存。
        gotoStep(window.location.href);
        return;
      }
      sessionExpiresAt = undefined;
      gateDeadline = undefined;
      if (!event.recheck) return;
      if (checking) recheck = true;
      else void check();
    });
    void check();
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unwatch();
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pathname]);

  return <AdminToast toast={toast} onDismiss={() => setToast(null)} />;
}
