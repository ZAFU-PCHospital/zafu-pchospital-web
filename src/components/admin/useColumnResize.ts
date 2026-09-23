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

/**
 * 表格列宽拖拽（第七轮引入；第八轮改全局竖线；第九轮从反馈里定了模型）。
 *
 * 为什么值得做：列宽是**用的人**才清楚的事 —— 查学号的人想把学号列拉宽，
 * 看技能的人想压缩班级。写死宽度永远照顾不到所有人；让人自己拖一次，选择权就交回去了。
 *
 * 五条实现约定，每一条都是被用户骂出来的：
 *
 * 1. **竖线跟着指针走，它右边的列整体平移，差额由最后一列吸收。**
 *    前三版都是「把被拖的那一列宽度改成指针位置」。问题在于表格总宽恒定（`width: 100%`），
 *    多出来的宽度必须有列让出来 —— 于是浏览器把差额塞给了「没有写死宽度」的那一列。
 *    实测（1440px，拖「技能标签」右边界 +120px）：那一列宽度确实 +120，可它**左边缘同时左移 120**，
 *    右边缘与竖线**一动不动**（成员列从 165px 被压到 45px）。用户看到的是「我拖了半天线不动，
 *    列却变形得厉害」→ 反馈「拖动距离被数倍放大」。拖吸附列更糟：表格总宽直接涨到容器外。
 *    第四版改成「相邻两列对冲（左 +Δ、右 −Δ）」，方向对了但**行程太短**：实测拖「技能标签」
 *    只走了 44px 就顶住 —— 右邻学号已经到 48px 下限，用户照样会觉得「拖不动」。
 *    现在这版是 Excel 那一套：被拖的那条线严格跟随指针，**它右边的列整体平移**，
 *    差额由**最后一列**吸收。于是 `新宽度 = 指针位置 − 该列左边缘`（左边缘在拖动中不变）
 *    就是唯一真相，1px 就是 1px；行程 = 最后一列宽 − 最小宽（默认 102px），
 *    而且反向拖回来会原样还回去。
 * 2. **宽度总和恒定等于容器宽**：挂载与容器尺寸变化时由最后一列吸收差额。总宽 == 容器宽，
 *    就不会出现横向滚动条，也就没有「滚动条一出现、可用宽度又变了」的抖动，
 *    表格右侧也不会留一条空带。
 * 3. **拖动过程中不重渲染整张表**：`pointermove` 只改 `<col>` 与竖线的行内样式（`paint`），
 *    `pointerup` 才落到 state 与 `localStorage`。之前每帧 `setState` 会重渲染 60 行 × 9 列，
 *    用户反馈「拉动特别卡」。
 * 4. **竖线位置由列宽累加算出来**（`boundaries`），不再去量 DOM：总宽恒定时两者等价，
 *    但省掉了 `ResizeObserver` + `useLayoutEffect` 的来回测量（旧版还因此踩过
 *    「表格晚挂载 → ref 是 null → 竖线一条都没有」）。
 * 5. **首帧不读 `localStorage`**：`useState` 的初始值必须服务端与客户端一致，
 *    否则 `<col style>` 会 hydration 不匹配。挂载后由 effect 读一次并覆盖。
 *
 * 键盘：竖线可聚焦（`role="separator"`），←/→ 改 8px、`Shift` 加倍、
 * `Home` 或双击把这一列恢复默认宽度。
 */
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
}: {
  storageKey: string;
  /** 列定义，顺序必须与 `<colgroup>` / 表头一致。 */
  columns: ColumnSpec[];
  minWidth?: number;
}) {
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
    [minWidth],
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
   * 拖最后一条竖线时，最后一列就是右邻列，两个说法是同一个（`base[last] − minWidth`）。
   */
  const budget = useCallback(
    (base: number[], index: number) => {
      const last = base.length - 1;
      const donor = index === last - 1 ? base[index + 1] : base[last];
      return Math.max(0, donor - minWidth);
    },
    [minWidth],
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

  return { widths, tableRef, colRefs, boundaries, lineProps, dragging };
}
