"use client";

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

/** 列宽总和保持容器宽，差额由最后一列吸收。拖动时直接更新 DOM，结束后持久化；挂载后读取偏好，避免 hydration 不匹配。 */
export type ColumnSpec = {
  id: string;
  /** 基准宽度（px）。差额由最后一列吸收，所以它只是「起点」，不是最终值。 */
  width: number;
  label: string;
};
export type ColumnBoundary = { id: string; label: string; x: number };

export function useColumnResize({
  storageKey,
  columns,
  minWidth = 48,
  lastColumnMinWidth = minWidth,
}: {
  storageKey: string;
  /** 列定义，顺序必须与 `<colgroup>` / 表头一致。 */
  columns: ColumnSpec[];
  minWidth?: number;
  /** 最后一列承载行内动作时，保留其可操作宽度；其余列仍使用 minWidth。 */
  lastColumnMinWidth?: number;
}) {
  const lastMinWidth = Math.max(minWidth, lastColumnMinWidth);
  const defaults = useMemo(() => columns.map((column) => column.width), [columns]);
  const [widths, setWidths] = useState<number[]>(defaults);
  const [dragging, setDragging] = useState<string | null>(null);
  /**
   * 表格元素用 **state + 回调 ref** 存，不是普通 ref：
   * 首屏数据没回来时表格根本不在 DOM 里（列表先渲染「正在加载」），
   * 用普通 ref 的话定位容器的 effect 在挂载那一刻就跑完了、拿到的是 null，
   * 之后表格出现也不会再跑一次（实测踩到过）。
   */
  const [table, setTable] = useState<HTMLTableElement | null>(null);
  const tableRef = useCallback((node: HTMLTableElement | null) => setTable(node), []);
  /** `<col>` 与竖线的 DOM 引用：拖动时直接改它们，绕开 React 渲染。 */
  const colNodes = useRef<(HTMLTableColElement | null)[]>([]);
  const lineNodes = useRef<(HTMLElement | null)[]>([]);
  /** 拖动中的最新指针位置（每帧只应用一次，避免高频 `pointermove` 把主线程打满）。 */
  const pointerX = useRef(0);
  const frame = useRef(0);
  /**
   * 拖动起点。`left` 是被调整那一列的**左边缘**：相邻两列对冲时它不会动，
   * 所以「指针绝对位置 − 左边缘」就是这一列应有的宽度。
   * `grabOffset` 让按下的一瞬间列宽不变 —— 竖线命中区在边界左侧，不补偿的话
   * 按下去列会先缩掉那几像素。
   */
  const drag = useRef<{ index: number; left: number; grabOffset: number; base: number[] } | null>(
    null,
  );
  /** state 的镜像：拖动过程中 state 不更新，落盘与下一次分栏都读它。 */
  const latest = useRef(widths);
  // 只在**没有拖动**时同步镜像：拖动中它是唯一真相（那一列的宽度只存在于 DOM 里），
  // 被 state 覆盖的话松手落盘的就是拖动前的旧值。
  useLayoutEffect(() => {
    if (!drag.current) latest.current = widths;
  }, [widths]);

  /** 把总宽补齐到容器宽：差额交给最后一列；兜不住时整列等比缩（并保留最小宽度）。 */
  const fill = useCallback(
    (next: number[], container: number) => {
      if (lastMinWidth > minWidth && next.length > 0) {
        const last = next.length - 1;
        const normalized = next.map((width, index) =>
          Math.max(index === last ? lastMinWidth : minWidth, width),
        );
        const total = normalized.reduce((sum, width) => sum + width, 0);
        const tail = normalized[last] + Math.round(container - total);
        if (tail >= lastMinWidth) {
          normalized[last] = tail;
        } else {
          normalized[last] = lastMinWidth;
          const extraBudget = Math.max(0, Math.round(container) - lastMinWidth - last * minWidth);
          const extraTotal = normalized
            .slice(0, last)
            .reduce((sum, width) => sum + width - minWidth, 0);
          let remaining = extraBudget;
          for (let index = 0; index < last; index++) {
            const extra =
              index === last - 1
                ? remaining
                : extraTotal > 0
                  ? Math.floor((extraBudget * (normalized[index] - minWidth)) / extraTotal)
                  : 0;
            normalized[index] = minWidth + extra;
            remaining -= extra;
          }
        }
        return normalized.every((width, index) => width === next[index]) ? next : normalized;
      }
      const total = next.reduce((sum, width) => sum + width, 0);
      const diff = Math.round(container - total);
      if (diff === 0) return next;
      const last = next.length - 1;
      const widest = next[last] + diff;
      if (widest >= minWidth) {
        const out = next.slice();
        out[last] = widest;
        return out;
      }
      const scale = container / total;
      const scaled = next.map((width) => Math.max(minWidth, Math.round(width * scale)));
      return scaled.every((width, index) => width === next[index]) ? next : scaled;
    },
    [lastMinWidth, minWidth],
  );

  // 挂载后读一次列宽偏好，并把总宽对齐到容器宽；容器尺寸变化时重新对齐。
  useLayoutEffect(() => {
    if (!table) return;
    const wrap = table.parentElement;
    if (!wrap) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as Record<string, unknown>;
        setWidths((current) =>
          current.map((width, index) => {
            const value = saved[columns[index].id];
            // 只接受已知列 + 有限数字：存了脏数据也不能把表格搞坏。
            return typeof value === "number" && Number.isFinite(value) ? value : width;
          }),
        );
      }
    } catch {
      // 隐私模式 / 存储被禁用：用默认列宽，不打扰用户。
    }
    const sync = () => {
      if (drag.current) return;
      // 卡片布局没有可见列：不能用手机容器的宽度覆盖桌面列宽。
      if (table.tHead && window.getComputedStyle(table.tHead).display === "none") return;
      const container = Math.round(wrap.clientWidth);
      if (container <= 0) return;
      setWidths((current) => fill(current, container));
    };
    sync();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", sync);
      return () => window.removeEventListener("resize", sync);
    }
    const observer = new ResizeObserver(sync);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [columns, fill, storageKey, table]);

  /** 只改 DOM，不碰 state：拖动期间每帧走这里。 */
  const paint = useCallback((next: number[]) => {
    for (let index = 0; index < next.length; index += 1) {
      const node = colNodes.current[index];
      if (node) node.style.width = `${next[index]}px`;
    }
    let x = next[0];
    for (let index = 1; index < next.length; index += 1) {
      const line = lineNodes.current[index - 1];
      if (line) line.style.insetInlineStart = `${x}px`;
      x += next[index];
    }
  }, []);

  const commit = useCallback(
    (next: number[]) => {
      setWidths(next);
      try {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify(Object.fromEntries(columns.map((column, i) => [column.id, next[i]]))),
        );
      } catch {
        // 写不进去就算了：列宽是偏好，不是数据。
      }
    },
    [columns, storageKey],
  );

  /**
   * 被拖那一列的**行程上限**：差额由最后一列出，所以它能给出多少，这一列就能长多少。
   * 拖最后一条竖线时，最后一列就是右邻列，供体均需保留最后一列的最小宽度。
   */
  const budget = useCallback(
    (base: number[], index: number) => {
      const last = base.length - 1;
      const donor = index === last - 1 ? base[index + 1] : base[last];
      return Math.max(0, donor - lastMinWidth);
    },
    [lastMinWidth],
  );

  /** 拖动中的每一帧：这一列跟着指针长，差额从最后一列扣（总和不变）。 */
  const applyDrag = useCallback(() => {
    frame.current = 0;
    const state = drag.current;
    if (!state) return;
    const { index, left, grabOffset, base } = state;
    const last = base.length - 1;
    const width = Math.max(
      minWidth,
      Math.min(base[index] + budget(base, index), Math.round(pointerX.current - grabOffset - left)),
    );
    const next = base.slice();
    next[last] -= width - base[index];
    next[index] = width;
    latest.current = next;
    paint(next);
  }, [budget, minWidth, paint]);

  const endDrag = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!drag.current) return;
      if (frame.current) {
        cancelAnimationFrame(frame.current);
        applyDrag();
      }
      drag.current = null;
      commit(latest.current);
      setDragging(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [applyDrag, commit],
  );

  /** 恢复某一列的默认宽度（双击 / `Home`），差额同样还给最后一列。 */
  const resetColumn = useCallback(
    (index: number) => {
      const current = latest.current;
      const last = current.length - 1;
      const width = Math.max(
        minWidth,
        Math.min(current[index] + budget(current, index), defaults[index]),
      );
      const next = current.slice();
      next[last] -= width - current[index];
      next[index] = width;
      commit(next);
    },
    [budget, commit, defaults, minWidth],
  );

  /** 键盘：与拖动同一套模型，因此不会把表格撑出容器。 */
  const nudgeColumn = useCallback(
    (index: number, delta: number) => {
      const current = latest.current;
      const last = current.length - 1;
      const width = Math.max(
        minWidth,
        Math.min(current[index] + budget(current, index), current[index] + delta),
      );
      const next = current.slice();
      next[last] -= width - current[index];
      next[index] = width;
      commit(next);
    },
    [budget, commit, minWidth],
  );

  /** `<col>` 的 ref（按列下标）。 */
  const colRefs = useMemo(
    () =>
      columns.map((_, index) => (node: HTMLTableColElement | null) => {
        colNodes.current[index] = node;
      }),
    [columns],
  );

  /** 竖线位置：第 i 条贴在第 i 列的右边缘。总宽恒等于容器宽，所以累加即边界。 */
  const boundaries = useMemo(() => {
    const out: ColumnBoundary[] = [];
    let x = 0;
    for (let index = 0; index < columns.length - 1; index += 1) {
      x += widths[index];
      out.push({ id: columns[index].id, label: columns[index].label, x });
    }
    return out;
  }, [columns, widths]);

  /** 竖线的属性；`id` 是**被调整的那一列**（竖线贴在它的右边缘）。 */
  const lineProps = useCallback(
    (id: string, label: string) => {
      const index = columns.findIndex((column) => column.id === id);
      return {
        ref: (node: HTMLElement | null) => {
          lineNodes.current[index] = node;
        },
        role: "separator" as const,
        tabIndex: 0,
        "aria-orientation": "vertical" as const,
        "aria-label": `调整「${label}」列宽`,
        "aria-valuenow": widths[index],
        "aria-valuemin": minWidth,
        title: "拖动调整列宽；双击恢复默认",
        className: dragging === id ? "admin-colline is-active" : "admin-colline",
        onPointerDown: (event: PointerEvent<HTMLElement>) => {
          // 只处理主键；右键菜单里拖不算。
          if (event.button !== 0) return;
          const cell = table?.querySelectorAll<HTMLTableCellElement>("thead th")[index];
          const rect = cell?.getBoundingClientRect();
          if (!rect) return;
          drag.current = {
            index,
            left: rect.left,
            grabOffset: event.clientX - rect.right,
            base: latest.current.slice(),
          };
          pointerX.current = event.clientX;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(id);
          event.preventDefault();
        },
        onPointerMove: (event: PointerEvent<HTMLElement>) => {
          if (!drag.current) return;
          pointerX.current = event.clientX;
          if (!frame.current) frame.current = window.requestAnimationFrame(applyDrag);
        },
        onPointerUp: endDrag,
        onPointerCancel: endDrag,
        onDoubleClick: () => resetColumn(index),
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
          const step = event.shiftKey ? 32 : 8;
          if (event.key === "ArrowLeft") nudgeColumn(index, -step);
          else if (event.key === "ArrowRight") nudgeColumn(index, step);
          else if (event.key === "Home") resetColumn(index);
          else return;
          event.preventDefault();
        },
      };
    },
    [applyDrag, columns, dragging, endDrag, minWidth, nudgeColumn, resetColumn, table, widths],
  );

  const reset = useCallback(() => {
    const container =
      table?.tHead && window.getComputedStyle(table.tHead).display !== "none"
        ? table.parentElement?.clientWidth
        : undefined;
    commit(fill([...defaults], container ?? defaults.reduce((sum, width) => sum + width, 0)));
  }, [commit, defaults, fill, table]);
  return { widths, tableRef, colRefs, boundaries, lineProps, dragging, reset };
}
