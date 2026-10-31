"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { accountMenuCopy } from "@/config/auth";
import { cn } from "@/lib/utils";
import type { SessionPrincipal } from "@/types/contracts";
import { getClientSession, sessionMutationFetch } from "@/lib/auth/client-session";

/**
 * AccountMenu —— 登录后账号菜单
 *
 * 挂点：成员 / 管理侧栏足部（`variant="nav"`）。工作台 hero 不再挂一份，避免与侧栏重复。
 * 菜单项：双角色壳层切换（成员⇄管理）+ 修改密码 / 退出登录。
 *
 * 触发按钮是**紧凑账号栏**：头像（`displayName` 首字符生成的圆形）+ 用户名 + 角色标签，
 * 不再用 `.btn` 大按钮、也不常驻展开操作列表。点击后以 Popover 浮层（不参与布局）
 * 弹出三项操作，避免展开时撑动侧栏布局。
 *
 * 会话来源是 `GET /api/v1/me`：
 * - 成功 → 用 `displayName`（空则降级「成员」）作为触发文案；
 * - 未登录（`UNAUTHENTICATED`）或请求失败 → **静默不渲染**，绝不 toast
 *   （公开页若误挂本组件也不会闪错）。
 *
 * 双角色判定（与 LoginForm / 成员空态一致）：
 * - `roles` 含 `ADMIN` **且** `memberProfileId` 非空 → 可在菜单内切换壳层；
 * - 仅管理员（无成员档案）或仅成员 → 不显示切换项，避免送进空态或无权限页。
 *
 * 退出走同站 `POST /api/v1/auth/logout`（服务端有 `assertSameOrigin`），
 * 成功清 cookie 后 `router.replace("/login")` + `refresh`。
 */

export type AccountMenuProps = {
  /** `hero`：成员欢迎区行动列；`nav`：管理侧栏足部（面板就地展开，避免被侧栏 overflow 裁切） */
  variant?: "hero" | "nav";
  /**
   * 服务端已认证时传入的展示名，仅用于首屏乐观渲染触发按钮。
   * 仍以 `/api/v1/me` 结果为准；公开页不要传这个，避免未登录时误显示。
   */
  initialDisplayName?: string | null;
  className?: string;
};

function isDualRole(principal: SessionPrincipal): boolean {
  return (
    principal.roles.includes("ADMIN") &&
    typeof principal.memberProfileId === "string" &&
    principal.memberProfileId.length > 0
  );
}

export function AccountMenu({ variant = "hero", initialDisplayName, className }: AccountMenuProps) {
  const router = useRouter();
  const pathname = usePathname();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [principal, setPrincipal] = useState<SessionPrincipal | null>(null);
  const [resolved, setResolved] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutUnconfirmed, setLogoutUnconfirmed] = useState(false);
  const [keepMenuAfterLogoutFailure, setKeepMenuAfterLogoutFailure] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await getClientSession();
        if (cancelled) return;
        if (result.ok) {
          setPrincipal(result.data);
        } else if (!result.stale) {
          setPrincipal(null);
        }
      } catch {
        // 公开页 / 网络失败：静默隐藏，不 toast。
        if (!cancelled) setPrincipal(null);
      } finally {
        if (!cancelled) setResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setOpen(false);
    try {
      const response = await sessionMutationFetch("/api/v1/auth/logout", {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
      });
      const payload = (await response.json()) as {
        success?: unknown;
        data?: { loggedOut?: unknown };
      } | null;
      if (!response.ok || payload?.success !== true || payload.data?.loggedOut !== true) {
        throw new Error("Logout not confirmed");
      }
      setLogoutUnconfirmed(false);
      router.replace("/login");
      router.refresh();
    } catch {
      // 失败不代表服务端已撤销会话，保留当前页与重试入口。
      if (!logoutUnconfirmed) {
        rootRef.current?.querySelector<HTMLButtonElement>(".account-menu__trigger")?.focus();
      }
      setLogoutUnconfirmed(true);
    } finally {
      setLoggingOut(false);
    }
  }

  function closeLogoutWarning() {
    setLogoutUnconfirmed(false);
    if (principal) return;
    // 网络不通时保留重试入口；只有 /me 明确返回 401 才隐藏。
    setKeepMenuAfterLogoutFailure(true);
    void getClientSession().then((result) => {
      if (result.ok) {
        setPrincipal(result.data);
        setKeepMenuAfterLogoutFailure(false);
      } else if (!result.stale && result.status === 401) {
        setPrincipal(null);
        setKeepMenuAfterLogoutFailure(false);
      }
    });
  }

  // 公开页：未解析完不渲染；解析后无会话则静默隐藏。
  // 受保护页可带 initialDisplayName 做乐观展示，但仍等 /me 确认后才保持。
  const optimistic = initialDisplayName !== undefined && !resolved;
  if (
    !optimistic &&
    (!resolved || !principal) &&
    !loggingOut &&
    !logoutUnconfirmed &&
    !keepMenuAfterLogoutFailure
  )
    return null;

  const displayName =
    (principal?.displayName ?? initialDisplayName)?.trim() || accountMenuCopy.fallbackName;

  // 头像：取展示名首字符（中文名取首字，英文名取首字母）。
  const avatarChar = [...displayName][0] ?? "?";

  // 角色标签：双角色账号优先显示「管理员」（在管理壳语义正确）；仅成员显示「成员」。
  const roleLabel: string | null = principal
    ? (accountMenuCopy.roleLabels[principal.roles.includes("ADMIN") ? "ADMIN" : "MEMBER"] ?? null)
    : null;

  const dualRole = principal ? isDualRole(principal) : false;
  const inAdminShell = pathname.startsWith("/admin");
  // 双角色：管理壳 → 切成员；成员壳或其它页（如改密）→ 切管理。
  const switchHref = dualRole ? (inAdminShell ? "/member" : "/admin") : null;
  const switchLabel = dualRole
    ? inAdminShell
      ? accountMenuCopy.switchToMember
      : accountMenuCopy.switchToAdmin
    : null;

  return (
    <div
      ref={rootRef}
      className={cn("account-menu", `account-menu--${variant}`, className)}
      data-open={open ? "true" : "false"}
    >
      <button
        className="account-menu__trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={accountMenuCopy.menuLabel}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="account-menu__avatar" aria-hidden="true">
          {avatarChar}
        </span>
        <span className="account-menu__identity">
          <span className="account-menu__name">{displayName}</span>
          {roleLabel ? <span className="account-menu__role">{roleLabel}</span> : null}
        </span>
        <Icon name="chevronDown" />
      </button>

      {open ? (
        <div
          className="account-menu__panel"
          id={menuId}
          role="menu"
          aria-label={accountMenuCopy.menuLabel}
        >
          {switchHref && switchLabel ? (
            <Link
              className="account-menu__item"
              role="menuitem"
              href={switchHref}
              onClick={() => setOpen(false)}
            >
              {switchLabel}
            </Link>
          ) : null}
          <Link
            className="account-menu__item"
            role="menuitem"
            href={`/account/email?returnTo=${encodeURIComponent(pathname)}`}
            onClick={() => setOpen(false)}
          >
            {accountMenuCopy.email}
          </Link>
          <Link
            className="account-menu__item"
            role="menuitem"
            href="/account/change-password"
            onClick={() => setOpen(false)}
          >
            {accountMenuCopy.changePassword}
          </Link>
          <button
            className="account-menu__item account-menu__item--danger"
            type="button"
            role="menuitem"
            disabled={loggingOut}
            onClick={() => void logout()}
          >
            {loggingOut ? accountMenuCopy.loggingOut : accountMenuCopy.logout}
          </button>
        </div>
      ) : null}
      {logoutUnconfirmed ? (
        <ConfirmDialog
          title={accountMenuCopy.logoutUnconfirmed}
          confirmLabel={loggingOut ? accountMenuCopy.loggingOut : accountMenuCopy.retryLogout}
          cancelLabel={accountMenuCopy.closeLogoutWarning}
          onConfirm={() => void logout()}
          onClose={closeLogoutWarning}
          busy={loggingOut}
        >
          <div className="logout-warning">
            <div className="logout-warning__status">
              <span className="logout-warning__icon" aria-hidden="true">
                <Icon name="shield" />
              </span>
              <div>
                <p className="logout-warning__lead">{accountMenuCopy.logoutSessionWarning}</p>
                <p className="logout-warning__hint">{accountMenuCopy.logoutRetryHint}</p>
              </div>
            </div>
            <aside
              className="logout-warning__help"
              aria-label={accountMenuCopy.logoutSharedDeviceTitle}
            >
              <h3>{accountMenuCopy.logoutSharedDeviceTitle}</h3>
              <p>{accountMenuCopy.logoutSharedDeviceHint}</p>
            </aside>
          </div>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
