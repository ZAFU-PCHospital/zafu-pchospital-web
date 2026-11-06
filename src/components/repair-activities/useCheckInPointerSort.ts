"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";

type Pending = {
  id: string;
  pointerId: number;
  x: number;
  y: number;
  active: boolean;
  timer: ReturnType<typeof setTimeout>;
};

type Target = { id: string; after: boolean };

/** 确认窗内的空白标题行负责长按拖动；正文、按钮和下拉框保留原有操作。 */
export function useCheckInPointerSort(
  ids: readonly string[],
  onMove: (id: string, beforeId: string | null) => void,
  disabled: boolean,
) {
  const listRef = useRef<HTMLOListElement>(null);
  const pending = useRef<Pending | null>(null);
  const frame = useRef<number | null>(null);
  const position = useRef({ y: 0 });
  const target = useRef<Target | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<Target | null>(null);

  const cancel = useCallback(() => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    target.current = null;
    setDraggingId(null);
    setDropTarget(null);
  }, []);

  useEffect(() => () => cancel(), [cancel]);
  useEffect(() => {
    if (disabled) cancel();
  }, [disabled, cancel]);

  function locate(y: number) {
    const list = listRef.current;
    if (!list || !pending.current?.active) return;
    const rows = [...list.querySelectorAll<HTMLElement>(":scope > li[data-check-in-id]")];
    const row = rows.find((item) => y < item.getBoundingClientRect().bottom) ?? rows.at(-1);
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const next: Target = {
      id: row.dataset.checkInId!,
      after: y > rect.top + rect.height / 2,
    };
    target.current = next;
    setDropTarget((current) =>
      current?.id === next.id && current.after === next.after ? current : next,
    );
  }

  function scroll() {
    const current = pending.current;
    if (!current?.active) return;
    const body = listRef.current?.closest<HTMLElement>(".admin-modal__body");
    if (body) {
      const rect = body.getBoundingClientRect();
      const edge = 48;
      const y = position.current.y;
      const speed = y < rect.top + edge ? -16 : y > rect.bottom - edge ? 16 : 0;
      if (speed) body.scrollTop += speed;
    }
    locate(position.current.y);
    frame.current = requestAnimationFrame(scroll);
  }

  function headerProps(id: string) {
    return {
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (disabled || pending.current || (event.pointerType === "mouse" && event.button !== 0))
          return;
        if ((event.target as Element).closest("button")) return;
        const source = event.currentTarget;
        const entry: Pending = {
          id,
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          active: false,
          timer: setTimeout(
            () => {
              if (pending.current !== entry) return;
              entry.active = true;
              setDraggingId(id);
              locate(position.current.y);
              frame.current = requestAnimationFrame(scroll);
            },
            event.pointerType === "touch" ? 450 : 250,
          ),
        };
        pending.current = entry;
        source.setPointerCapture(entry.pointerId);
        position.current = { y: event.clientY };
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        const current = pending.current;
        if (!current || current.pointerId !== event.pointerId) return;
        position.current = { y: event.clientY };
        if (!current.active) {
          if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 8) cancel();
          return;
        }
        event.preventDefault();
        locate(event.clientY);
      },
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
        const current = pending.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const landing = target.current;
        const shouldMove = current.active && landing;
        cancel();
        if (!shouldMove) return;
        const start = ids.indexOf(landing.id) + (landing.after ? 1 : 0);
        const beforeId = ids.slice(start).find((candidate) => candidate !== current.id) ?? null;
        if (beforeId !== current.id) onMove(current.id, beforeId);
      },
      onPointerCancel: cancel,
    };
  }

  function rowClass(id: string) {
    if (draggingId === id) return "is-dragging";
    if (dropTarget?.id === id) return dropTarget.after ? "is-drop-after" : "is-drop-before";
    return "";
  }

  return { listRef, headerProps, rowClass };
}
