"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/Button";
import { tableCopy } from "@/config/admin-tables";
import { cn } from "@/lib/utils";

/** 列表工具栏：左侧放选择与批量操作，右侧显示数量。 */
export function AdminListToolbar({
  children,
  count,
  refreshing = false,
  previous = false,
  selection,
}: {
  /** 默认操作：导出与页面已有入口。 */
  children?: ReactNode;
  count: number;
  refreshing?: boolean;
  previous?: boolean;
  selection?: {
    count: number;
    /** 仅在整批操作成功后递增，不将零选择误判为完成。 */
    completed?: number;
    disabled: boolean;
    onClear: () => void;
    renderTools: (onCancel: () => void) => ReactNode;
  };
}) {
  const [choosing, setChoosing] = useState(false);
  const selectButton = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const completed = useRef(selection?.completed);
  const returnFocus = useRef(false);
  const selecting = Boolean(selection && (choosing || selection.count > 0));
  useEffect(() => {
    if (selection?.count) setChoosing(true);
  }, [selection?.count]);
  useLayoutEffect(() => {
    if (completed.current === selection?.completed) return;
    completed.current = selection?.completed;
    returnFocus.current =
      Boolean(root.current?.contains(document.activeElement)) ||
      document.activeElement === document.body;
    setChoosing(false);
  }, [selection?.completed]);
  useLayoutEffect(() => {
    if (!returnFocus.current || selecting || selection?.disabled) return;
    returnFocus.current = false;
    const button = selectButton.current;
    if (button && !button.disabled && button.getClientRects().length)
      button.focus({ preventScroll: true });
    else root.current?.focus({ preventScroll: true });
  }, [selecting, selection?.disabled, selection?.completed]);
  const label = (
    refreshing ? tableCopy.updating : previous ? tableCopy.previousCount : tableCopy.count
  ).replace("{count}", String(count));
  const shortLabel = (
    refreshing
      ? tableCopy.updatingShort
      : previous
        ? tableCopy.previousCountShort
        : tableCopy.countShort
  ).replace("{count}", String(count));

  function cancelSelection() {
    if (!selection || selection.disabled) return;
    selection.onClear();
    setChoosing(false);
    requestAnimationFrame(() => {
      if (selectButton.current?.getClientRects().length)
        selectButton.current.focus({ preventScroll: true });
    });
  }

  return (
    <div
      ref={root}
      tabIndex={-1}
      className={cn("admin-toolbar", selecting && "admin-toolbar--selecting")}
    >
      <div className="admin-toolbar__actions">
        {selection ? (
          <div className="admin-toolbar__batch">{selection.renderTools(cancelSelection)}</div>
        ) : null}
        <div className="admin-toolbar__browse">
          {selection ? (
            <Button
              ref={selectButton}
              variant="ghost"
              className="admin-toolbar__mobile-only"
              disabled={selection.disabled || count === 0}
              onClick={() => {
                setChoosing(true);
                requestAnimationFrame(() =>
                  root.current
                    ?.querySelector<HTMLButtonElement>(".admin-batch-tools__cancel-mobile")
                    ?.focus({ preventScroll: true }),
                );
              }}
            >
              {tableCopy.select}
            </Button>
          ) : null}
          {children}
        </div>
      </div>
      <p className="admin-toolbar__count" aria-label={label} title={label}>
        <span className="admin-toolbar__desktop-only">{label}</span>
        <span className="admin-toolbar__mobile-only">{shortLabel}</span>
      </p>
    </div>
  );
}
