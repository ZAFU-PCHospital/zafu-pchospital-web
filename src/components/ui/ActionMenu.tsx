"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/Button";
import type { IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

export type ActionMenuItem = {
  label: string;
  icon?: IconName;
  disabled?: boolean;
  onSelect: () => void;
};

/** 状态控制的动作菜单通过 Portal 避免裁切，不依赖浏览器的 Popover API。 */
export function ActionMenu({
  label,
  title = label,
  items,
  disabled,
  className,
}: {
  label: string;
  title?: string;
  items: readonly ActionMenuItem[];
  disabled?: boolean;
  className?: string;
}) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const initialItem = useRef(0);

  const closeMenu = useCallback((restoreFocus = true) => {
    if (restoreFocus && panel.current?.contains(document.activeElement)) {
      const button = trigger.current;
      const target =
        button && !button.disabled && button.getClientRects().length
          ? button
          : button?.closest<HTMLElement>('[tabindex="-1"]');
      target?.focus({ preventScroll: true });
    }
    setOpen(false);
  }, []);

  const focusItem = useCallback((index: number) => {
    const buttons = panel.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
    if (buttons?.length)
      buttons[(index + buttons.length) % buttons.length]?.focus({ preventScroll: true });
    else panel.current?.querySelector<HTMLElement>('[role="menu"]')?.focus({ preventScroll: true });
  }, []);

  function openMenu(index = 0) {
    if (disabled) return;
    initialItem.current = index;
    if (open) focusItem(index);
    setOpen(true);
  }

  useLayoutEffect(() => {
    if (!open || !panel.current || !trigger.current) return;
    const box = trigger.current.getBoundingClientRect();
    const menu = panel.current.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop ?? 0;
    const left = viewport?.offsetLeft ?? 0;
    const bottom = top + (viewport?.height ?? innerHeight) - 72;
    panel.current.style.left = `${Math.max(left + 8, Math.min(box.right - menu.width, left + (viewport?.width ?? innerWidth) - menu.width - 8))}px`;
    panel.current.style.top = `${Math.max(top + 8, box.bottom + menu.height + 4 <= bottom ? box.bottom + 4 : box.top - menu.height - 4)}px`;
    focusItem(initialItem.current);
  }, [open, focusItem]);

  useEffect(() => {
    if (disabled) closeMenu();
  }, [disabled, closeMenu]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (
        !(event.target instanceof Node) ||
        panel.current?.contains(event.target) ||
        trigger.current?.contains(event.target)
      )
        return;
      closeMenu(event.type !== "focusin");
    };
    const closeOnMove = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      closeMenu();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("scroll", closeOnMove, true);
    window.addEventListener("resize", closeOnMove);
    window.visualViewport?.addEventListener("resize", closeOnMove);
    window.visualViewport?.addEventListener("scroll", closeOnMove);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("scroll", closeOnMove, true);
      window.removeEventListener("resize", closeOnMove);
      window.visualViewport?.removeEventListener("resize", closeOnMove);
      window.visualViewport?.removeEventListener("scroll", closeOnMove);
    };
  }, [open, closeMenu]);

  return (
    <span className={cn("action-menu", className)}>
      <Button
        ref={trigger}
        variant="ghost"
        className="action-menu__trigger"
        trailingIcon="chevronDown"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          openMenu(event.key === "ArrowUp" ? -1 : 0);
        }}
      >
        {label}
      </Button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panel}
              className="action-menu__panel"
              onKeyDown={(event) => {
                const buttons = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button:not(:disabled)",
                  ),
                ];
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                  event.preventDefault();
                  focusItem(
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? -1
                        : index + (event.key === "ArrowDown" ? 1 : -1),
                  );
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  closeMenu();
                } else if (event.key === "Tab") {
                  // Portal 在 body 末尾，Tab 从触发按钮所在位置继续，而不是跳到页面末尾。
                  const candidates = [
                    ...document.querySelectorAll<HTMLElement>(
                      'button, input, select, textarea, a[href], [tabindex], summary, iframe, [contenteditable="true"]',
                    ),
                  ]
                    .filter(
                      (node) =>
                        node.tabIndex >= 0 &&
                        !node.matches(":disabled") &&
                        !node.closest("[inert]") &&
                        node.getClientRects().length &&
                        !panel.current?.contains(node),
                    )
                    .sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
                  const next = candidates[candidates.indexOf(trigger.current!) + 1];
                  if (event.shiftKey || next) {
                    event.preventDefault();
                    closeMenu();
                    if (!event.shiftKey) next?.focus();
                  } else closeMenu();
                }
              }}
            >
              {title !== label ? (
                <p className="action-menu__title" id={`${menuId}-title`}>
                  {title}
                </p>
              ) : null}
              <div
                id={menuId}
                role="menu"
                tabIndex={-1}
                aria-label={title === label ? title : undefined}
                aria-labelledby={title !== label ? `${menuId}-title` : undefined}
              >
                {items.map((item) => (
                  <Button
                    key={item.label}
                    role="menuitem"
                    tabIndex={-1}
                    variant="ghost"
                    icon={item.icon}
                    disabled={item.disabled}
                    onClick={() => {
                      closeMenu();
                      item.onSelect();
                    }}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
