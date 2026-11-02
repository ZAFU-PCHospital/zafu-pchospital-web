"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import type { IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

export type ActionMenuItem = {
  label: string;
  icon?: IconName;
  disabled?: boolean;
  onSelect: () => void;
};

/** 轻量动作菜单使用原生 Popover 顶层，避免被列表边界裁切。 */
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

  useEffect(() => {
    if (disabled) panel.current?.hidePopover();
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      panel.current?.hidePopover();
    };
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [open]);

  function focusItem(index: number) {
    const buttons = panel.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
    if (buttons?.length)
      buttons[(index + buttons.length) % buttons.length]?.focus({ preventScroll: true });
  }

  return (
    <span className={cn("action-menu", className)}>
      <Button
        ref={trigger}
        variant="ghost"
        className="action-menu__trigger"
        trailingIcon="chevronDown"
        disabled={disabled}
        popoverTarget={menuId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          panel.current?.showPopover();
          focusItem(event.key === "ArrowUp" ? -1 : 0);
        }}
      >
        {label}
      </Button>
      <div
        ref={panel}
        id={menuId}
        className="action-menu__panel"
        popover="auto"
        role="menu"
        aria-label={title}
        onToggle={(event) => {
          const isOpen = event.newState === "open";
          setOpen(isOpen);
          if (!isOpen || !trigger.current || !panel.current) return;
          const box = trigger.current.getBoundingClientRect();
          const menu = panel.current.getBoundingClientRect();
          const viewport = window.visualViewport;
          const top = viewport?.offsetTop ?? 0;
          const left = viewport?.offsetLeft ?? 0;
          const bottom = top + (viewport?.height ?? innerHeight) - 72;
          panel.current.style.left = `${Math.max(left + 8, Math.min(box.right - menu.width, left + (viewport?.width ?? innerWidth) - menu.width - 8))}px`;
          panel.current.style.top = `${Math.max(top + 8, box.bottom + menu.height + 4 <= bottom ? box.bottom + 4 : box.top - menu.height - 4)}px`;
          if (!panel.current.contains(document.activeElement)) focusItem(0);
        }}
        onKeyDown={(event) => {
          const buttons = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
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
            panel.current?.hidePopover();
            trigger.current?.focus({ preventScroll: true });
          } else if (event.key === "Tab") {
            panel.current?.hidePopover();
          }
        }}
      >
        {title !== label ? <p className="action-menu__title">{title}</p> : null}
        {items.map((item) => (
          <Button
            key={item.label}
            role="menuitem"
            tabIndex={-1}
            variant="ghost"
            icon={item.icon}
            disabled={item.disabled}
            onClick={() => {
              panel.current?.hidePopover();
              trigger.current?.focus({ preventScroll: true });
              item.onSelect();
            }}
          >
            {item.label}
          </Button>
        ))}
      </div>
    </span>
  );
}
