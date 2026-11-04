"use client";

import { useRef } from "react";
import { createPortal } from "react-dom";

import { Icon } from "@/components/ui/Icon";

/** 页面级错误固定浮条：不参与页面布局，也不自动消失。 */
export function PageAlert({
  message,
  closeLabel,
  onClose,
}: {
  message: string;
  closeLabel?: string;
  onClose?: () => void;
}) {
  const alertRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  if (typeof document === "undefined") return null;

  const dismiss = () => {
    if (!onClose) return;
    if (alertRef.current?.contains(document.activeElement)) {
      const fallback =
        document.querySelector<HTMLElement>("main input:not([disabled])") ??
        document.querySelector<HTMLElement>("main button:not([disabled])") ??
        document.querySelector<HTMLElement>("main a[href]");
      const target = returnFocusRef.current?.isConnected ? returnFocusRef.current : fallback;
      target?.focus({ preventScroll: true });
    }
    onClose();
  };

  return createPortal(
    <div className="page-alert">
      <div
        ref={alertRef}
        className="card page-alert__body"
        role="alert"
        onFocusCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            returnFocusRef.current =
              event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null;
          }
        }}
      >
        <Icon name="close" />
        <p className="page-alert__text">{message}</p>
        {onClose && closeLabel ? (
          <button type="button" className="page-alert__close" onClick={dismiss}>
            {closeLabel}
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
