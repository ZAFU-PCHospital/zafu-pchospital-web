"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

/**
 * ConfirmDialog —— 破坏操作二次确认（UX R3 / R4 / C7）。
 *
 * 与 AdminModal 同构：Portal 到 body、Esc 关闭、关闭后焦点归还触发按钮。
 * 不使用 `window.confirm`。视觉复用 `.admin-modal` 令牌，避免第三套浮层样式。
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel,
  closeLabel = "关闭",
  onConfirm,
  onClose,
  busy = false,
  confirmDisabled = false,
  confirmVariant = "solid",
  size = "default",
  titleTone = "default",
  showCloseButton = true,
}: {
  title: string;
  children: ReactNode;
  /** 传 `null` 隐藏确认按钮（如只读的成功凭条）；关闭仍走 ✕ / Esc / 遮罩。 */
  confirmLabel?: string | null;
  /** 仅需知晓的提醒可省略取消按钮；关闭与 Esc 仍可用。 */
  cancelLabel?: string;
  /** 标题栏关闭按钮文案（默认可访问名「关闭」） */
  closeLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
  /** 只禁用确认，保留取消 / Esc（例如操作窗口已结束）。 */
  confirmDisabled?: boolean;
  confirmVariant?: "solid" | "outline" | "ghost";
  /** 短确认 / Alert 用紧凑窗口；详情表单仍用默认宽高；narrow 为 640px 窄档。 */
  size?: "default" | "compact" | "narrow";
  /** success 把标题染成成功色；状态仍由标题文字表达，不只靠颜色。 */
  titleTone?: "default" | "success";
  /** 已有底部确认动作时可隐藏标题栏关闭按钮；Esc 仍然可用。 */
  showCloseButton?: boolean;
}) {
  const titleId = useId();
  const windowRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    windowRef.current?.focus();

    return () => {
      document.body.style.overflow = "";
      returnFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    // 同一窗口从确认切换为成功提醒时，从正文开头阅读并重新宣告标题。
    windowRef.current?.focus();
    windowRef.current?.querySelector(".admin-modal__body")?.scrollTo(0, 0);
  }, [title]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
      if (event.key !== "Tab" || !windowRef.current) return;
      const controls = [
        ...windowRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
        ),
      ].filter((element) => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) {
        event.preventDefault();
        windowRef.current.focus();
      } else if (
        !controls.includes(document.activeElement as HTMLElement) ||
        (event.shiftKey && document.activeElement === first) ||
        (!event.shiftKey && document.activeElement === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="admin-modal">
      <div
        className="admin-modal__veil"
        aria-hidden="true"
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <div
        ref={windowRef}
        className={cn(
          "admin-modal__window",
          size === "compact" && "admin-modal__window--compact admin-modal__window--alert",
          size === "narrow" && "admin-modal__window--narrow",
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="admin-modal__head">
          <div>
            <h2
              className={cn(
                "admin-modal__title",
                titleTone === "success" && "admin-modal__title--success",
              )}
              id={titleId}
            >
              {title}
            </h2>
          </div>
          {showCloseButton ? (
            <Button variant="ghost" icon="close" onClick={onClose} disabled={busy}>
              {closeLabel}
            </Button>
          ) : null}
        </header>
        <div className="admin-modal__body">
          {children}
          {confirmLabel || cancelLabel ? (
            <div className="signup__actions">
              {cancelLabel ? (
                <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                  {cancelLabel}
                </Button>
              ) : null}
              {confirmLabel ? (
                <Button
                  type="button"
                  variant={confirmVariant}
                  disabled={busy || confirmDisabled}
                  onClick={onConfirm}
                >
                  {confirmLabel}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
