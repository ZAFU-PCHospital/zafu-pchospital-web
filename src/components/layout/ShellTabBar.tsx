"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useFocusTrap } from "@/components/ui/useFocusTrap";
import { Icon, type IconName } from "@/components/ui/Icon";
import type { NavItem } from "@/config/navigation";

/**
 * ShellTabBar —— 成员 / 管理外壳共用的窄屏底部标签栏
 *
 * 手机上绝大多数操作发生在拇指区：把 4–5 个最高频目的地固定在屏幕底部，
 * 其余入口（管理端 6 个低频模块）收进「更多」抽屉。桌面（≥1100px）由 CSS 整体隐藏，
 * 左侧栏接管导航。
 *
 * 角标（待审核数 / 未读数）由调用方传入：导航组件挂在 layout 里，切页不重建，
 * 因此角标只需在挂载时取一次、事件触发时刷新。
 *
 * 「更多」抽屉打开时按 Escape 或点遮罩关闭；切页自动关闭。
 */

export type ShellTab = {
  href: string;
  label: string;
  icon: IconName;
  /** 精确匹配高亮（首页类入口），否则按前缀匹配 */
  exact?: boolean;
  /** 待办 / 未读数；大于 0 才渲染角标 */
  badge?: number | null;
  /** 居中凸起的主行动按钮（成员端「新增维修」）。不参与 `aria-current` —— 否则
   *  `/member/repairs` 前缀会同时点亮「维修」与「新增」两个键。 */
  primary?: boolean;
};

export type ShellMoreGroup = {
  id: string;
  title: string;
  items: readonly NavItem[];
};

export type ShellTabBarProps = {
  tabs: readonly ShellTab[];
  ariaLabel: string;
  more?: {
    label: string;
    menuLabel: string;
    closeLabel: string;
    groups: readonly ShellMoreGroup[];
  };
};

function isCurrent(pathname: string, tab: ShellTab): boolean {
  if (tab.exact) return pathname === tab.href;
  return pathname === tab.href || pathname.startsWith(`${tab.href}/`);
}

export function ShellTabBar({ tabs, ariaLabel, more }: ShellTabBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, () => setMoreOpen(false), moreOpen);

  const moreActive =
    more !== undefined &&
    more.groups.some((group) =>
      group.items.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)),
    );

  return (
    <>
      <nav className="shell-tabbar" aria-label={ariaLabel}>
        {tabs.map((tab) => {
          const current = isCurrent(pathname, tab);
          const badge = typeof tab.badge === "number" && tab.badge > 0 ? tab.badge : null;
          return (
            <Link
              key={tab.href}
              className={`shell-tabbar__tab ${tab.primary ? "shell-tabbar__tab--primary" : ""}`}
              href={tab.href}
              prefetch={false}
              onTouchStart={() => router.prefetch(tab.href)}
              onMouseEnter={() => router.prefetch(tab.href)}
              onFocus={() => router.prefetch(tab.href)}
              aria-current={current && !tab.primary ? "page" : undefined}
            >
              <span className="shell-tabbar__icon">
                <Icon name={tab.icon} />
                {badge !== null ? (
                  <span className="shell-tabbar__badge">{badge > 99 ? "99+" : badge}</span>
                ) : null}
              </span>
              <span className="shell-tabbar__label">{tab.label}</span>
            </Link>
          );
        })}
        {more ? (
          <button
            type="button"
            className="shell-tabbar__tab"
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            aria-current={moreActive ? "page" : undefined}
            onClick={() => setMoreOpen((value) => !value)}
          >
            <span className="shell-tabbar__icon">
              <Icon name="menu" />
            </span>
            <span className="shell-tabbar__label">{more.label}</span>
          </button>
        ) : null}
      </nav>

      {more && moreOpen ? (
        <div className="shell-more">
          <button
            type="button"
            className="shell-more__backdrop"
            aria-hidden="true"
            tabIndex={-1}
            aria-label={more.closeLabel}
            onClick={() => setMoreOpen(false)}
          />
          <div
            ref={panelRef}
            className="shell-more__panel"
            role="dialog"
            aria-modal="true"
            aria-label={more.menuLabel}
            tabIndex={-1}
          >
            {more.groups.map((group) => (
              <div className="shell-more__group" key={group.id}>
                <p className="shell-more__group-title">{group.title}</p>
                <ul className="shell-more__list">
                  {group.items.map((item) => {
                    const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
                    return (
                      <li key={item.href}>
                        <Link
                          className="shell-more__link"
                          href={item.href}
                          prefetch={false}
                          aria-current={current ? "page" : undefined}
                        >
                          <span className="eyebrow">{item.index}</span>
                          <span>{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
