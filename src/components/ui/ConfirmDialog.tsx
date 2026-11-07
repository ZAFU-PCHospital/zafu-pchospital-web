"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

/** fit 布局关闭时的淡出时长，与 globals.css 里 `receipt-window-out` 保持一致。 */
const EXIT_MS = 170;

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
  closeIconOnly = false,
  titleHidden = false,
  layout = "scroll",
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
  /** 标题栏只留图标 ✕（可访问名仍取 closeLabel）。 */
  closeIconOnly?: boolean;
  /** 标题仅对读屏可见（正文里有更大的可见标题时用）。 */
  titleHidden?: boolean;
  /**
   * scroll（默认）：动作区随正文滚动，窗口填满可用高度。
   * fit：窗口按内容自适应高度、动作区固定在底部不随正文滚动，关闭时播放淡出。
   */
  layout?: "scroll" | "fit";
}) {
  const titleId = useId();
  const windowRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  /** fit 布局的关闭淡出：先播完再真正卸载，其他布局保持同步关闭。 */
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animateExit = layout === "fit";
  const requestClose = useCallback(() => {
    if (!animateExit || closing) {
      onClose();
      return;
    }
    setClosing(true);
    closeTimerRef.current = setTimeout(onClose, EXIT_MS);
  }, [animateExit, closing, onClose]);
  /** 确认动作同样先播完淡出再交给调用方（仅 fit 布局）。 */
  const handleConfirm = useCallback(() => {
    if (!animateExit || closing) {
      onConfirm();
      return;
    }
    setClosing(true);
    closeTimerRef.current = setTimeout(onConfirm, EXIT_MS);
  }, [animateExit, closing, onConfirm]);

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    [],
  );

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
      if (event.key === "Escape" && !busy) requestClose();
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
  }, [busy, requestClose]);

  if (typeof document === "undefined") return null;

  const actions =
    confirmLabel || cancelLabel ? (
      <div className="signup__actions">
        {cancelLabel ? (
          <Button type="button" variant="ghost" onClick={requestClose} disabled={busy}>
            {cancelLabel}
          </Button>
        ) : null}
        {confirmLabel ? (
          <Button
            type="button"
            variant={confirmVariant}
            disabled={busy || confirmDisabled}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </Button>
        ) : null}
      </div>
    ) : null;

  return createPortal(
    <div className="admin-modal">
      <div
        className="admin-modal__veil"
        aria-hidden="true"
        onClick={() => {
          if (!busy) requestClose();
        }}
      />
      <div
        ref={windowRef}
        className={cn(
          "admin-modal__window",
          size === "compact" && "admin-modal__window--compact admin-modal__window--alert",
          size === "narrow" && "admin-modal__window--narrow",
          animateExit && "admin-modal__window--fit",
          closing && "admin-modal__window--closing",
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
                titleHidden && "admin-modal__title--visually-hidden",
              )}
              id={titleId}
            >
              {title}
            </h2>
          </div>
          {showCloseButton ? (
            closeIconOnly ? (
              <Button
                variant="ghost"
                icon="close"
                aria-label={closeLabel}
                className="admin-modal__close-icon"
                onClick={requestClose}
                disabled={busy}
              />
            ) : (
              <Button variant="ghost" icon="close" onClick={requestClose} disabled={busy}>
                {closeLabel}
              </Button>
            )
          ) : null}
        </header>
        <div className="admin-modal__body">
          {children}
          {animateExit ? null : actions}
        </div>
        {animateExit && actions ? (
          <div className="admin-modal__footer">{actions}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
