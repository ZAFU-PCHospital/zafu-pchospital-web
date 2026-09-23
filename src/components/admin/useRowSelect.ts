"use client";

import { useCallback, useRef, type ChangeEvent } from "react";

/**
 * 行首「序号 → 复选框」的勾选与范围选择（第八轮引入，第九轮定稿）。
 *
 * 视觉与交互照飞书多维表格那一套：
 * - 平时行首显示**序号**（比一排复选框安静，也便于「第几行」的口头沟通）；
 * - 指针进入这一行（或键盘焦点可见地落进来）时，序号换成**复选框**；
 * - 复选框点一下选中一行，`Shift` 点击选中两行之间的一整段。
 *
 * 三条实现约定：
 *
 * 1. **序号与复选框占同一个盒子，用 `opacity` 换，不用 `display`**：
 *    切换时两者尺寸相同，行高、列宽都不会动（`AGENTS.md` 的硬规则）。
 * 2. **显形用 `tr:has(:focus-visible)` 而不是 `:focus-within`**：
 *    鼠标点完复选框焦点会留在 input 上，`:focus-within` 会让复选框一直挂着，
 *    取消勾选后也不退回序号（用户实测反馈）。
 * 3. **拖动排序不在这里**：行首那个六点手柄的拖动是 `useRowDragSort`（HTML5 拖放 +
 *    落点指示线）。第八轮曾把「手柄上下拖 = 连续选中一段」写在这个 hook 里，
 *    第九轮用户明确要求手柄改成**调整行位置**，于是那段指针代码整体撤掉 ——
 *    选择一段仍可以用 `Shift` 点击，而「拖」这个手势只留一种含义，不会互相抢。
 */
export function useRowSelect({
  ids,
  selected,
  onChange,
}: {
  /** 当前已渲染的行 id，顺序与界面一致。 */
  ids: string[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  /** 范围选择的锚点：上一次单独点过的行。 */
  const anchor = useRef<string | null>(null);

  /** 点序号 / 复选框：普通点击切换单行，`Shift` 点击选中两行之间的一段。 */
  const checkboxProps = useCallback(
    (id: string) => ({
      className: "admin-check admin-rownum__box",
      type: "checkbox" as const,
      checked: selected.includes(id),
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        const checked = event.currentTarget.checked;
        // `ChangeEvent` 上没有 `shiftKey`，底层事件（点击触发的 change）是 MouseEvent。
        const shiftKey = (event.nativeEvent as MouseEvent).shiftKey === true;
        if (shiftKey && anchor.current) {
          const from = ids.indexOf(anchor.current);
          const to = ids.indexOf(id);
          if (from >= 0 && to >= 0) {
            const range = ids.slice(Math.min(from, to), Math.max(from, to) + 1);
            onChange(
              checked
                ? [...new Set([...selected, ...range])]
                : selected.filter((item) => !range.includes(item)),
            );
            return;
          }
        }
        anchor.current = id;
        onChange(checked ? [...selected, id] : selected.filter((item) => item !== id));
      },
    }),
    [ids, onChange, selected],
  );

  return { checkboxProps, anchor };
}
