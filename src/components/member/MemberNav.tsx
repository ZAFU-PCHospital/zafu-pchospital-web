"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AccountMenu } from "@/components/layout/AccountMenu";
import { ShellHomeLink } from "@/components/layout/ShellHomeLink";
import { ShellTabBar, type ShellTab } from "@/components/layout/ShellTabBar";
import { Icon } from "@/components/ui/Icon";
import {
  MEMBER_NOTIFICATIONS_CHANGED_EVENT,
  memberCopy,
  memberNav,
  memberTabs,
} from "@/config/member";

/**
 * 成员持久导航。
 *
 * 底部标签栏的「活动」直接进入维修活动页（issue #334）；「消息通知」不再占
 * 底部标签，但工作台快捷操作与桌面侧栏仍保留入口。通知事件只刷新侧栏未读角标。
 */

export type MemberNavProps = {
  /** 服务端已认证的展示名，交给账号菜单做首屏乐观渲染 */
  displayName?: string | null;
};

function isCurrent(pathname: string, href: string): boolean {
  if (href === "/member") return pathname === "/member";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MemberNav({ displayName = null }: MemberNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const shell = memberCopy.shell;
  const [unread, setUnread] = useState<number | null>(null);

  const loadUnread = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/member/notifications?status=UNREAD&pageSize=1", {
        cache: "no-store",
      });
      const json = await response.json();
      if (json?.success && typeof json.data?.unreadCount === "number") {
        setUnread(json.data.unreadCount);
      }
    } catch {
      // 角标是增强信息：失败静默，不影响导航本身。
    }
  }, []);

  useEffect(() => {
    void loadUnread();
    const onChanged = () => void loadUnread();
    window.addEventListener(MEMBER_NOTIFICATIONS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(MEMBER_NOTIFICATIONS_CHANGED_EVENT, onChanged);
  }, [loadUnread]);

  const tabs: readonly ShellTab[] = memberTabs;

  return (
    <>
      <nav className="member-nav" aria-label={shell.navLabel}>
        <Link className="member-nav__brand" href="/member" prefetch={false}>
          <span className="member-nav__brand-en">{shell.titleEn}</span>
          <span className="member-nav__brand-cn">{shell.title}</span>
        </Link>

        <div className="member-nav__groups">
          {memberNav.map((group) => (
            <div key={group.id} className="member-nav__group">
              <p className="member-nav__group-title">{group.title}</p>
              <ul className="member-nav__list">
                {group.items.map((item) => {
                  const current = isCurrent(pathname, item.href);
                  const badge =
                    item.href === "/member/notifications" && unread !== null && unread > 0
                      ? unread
                      : null;
                  return (
                    <li key={item.href}>
                      <Link
                        className="member-nav__link"
                        href={item.href}
                        prefetch={false}
                        onMouseEnter={() => router.prefetch(item.href)}
                        onFocus={() => router.prefetch(item.href)}
                        aria-current={current ? "page" : undefined}
                      >
                        <span className="nav-icon">
                          <Icon name={item.icon ?? "fileText"} />
                        </span>
                        <span className="member-nav__label">{item.label}</span>
                        {badge !== null ? (
                          <span className="nav-badge">{badge > 99 ? "99+" : badge}</span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <div className="member-nav__foot shell-nav-actions">
          <ShellHomeLink />
          <AccountMenu variant="nav" initialDisplayName={displayName ?? null} />
        </div>
      </nav>

      <ShellTabBar tabs={tabs} ariaLabel={shell.tabbarLabel} />
    </>
  );
}
