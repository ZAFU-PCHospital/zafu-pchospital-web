"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/Button";
import { adminShared } from "@/config/admin";

/**
 * AdminModal —— 后台详情窗口（M6）。
 *
 * 为什么需要它：成员详情的字段与表单加起来有两三屏高，早先直接**内联**渲染在
 * 表格下方（`.admin-workspace__content` 的最后一个子节点），点「详情」后用户
 * 看到的页面毫无变化 —— 内容其实在脚底下，必须自己往下翻才找得到。
 * 后台的详情/编辑是「临时聚焦在某一条记录上」，用窗口呈现才符合这个语义。
 *
 * 复用既有实现而不是新造一套视觉：
 * - 遮罩按 `docs/design-system.md` §4.5「需要浮层时用底色加深 + 全屏遮罩」，
 *   取 `--bg-deep` 加深，**不加投影**（设计基准禁止 box-shadow）；
 * - 窗口本体沿用 `.card` 的描边 + `--surface-1` 底 + `--r-mid` 圆角；
 * - 滚动锁定 / `Esc` 关闭 / 焦点归还与 `layout/Header.tsx` 的移动端浮层完全同构。
 *
 * **必须走 Portal 挂到 `document.body`**：页面内容位于 `<main>` 的层叠上下文里
 * （`main` 自带 `z-index`），直接在这里写 `z-index: 96` 只能盖住 `<main>` 内部的东西
 * ——桌面索引栏（`.rail`，z-index 80）与移动端顶栏（`.topbar`，85）都挂在根层，
 * 会穿透遮罩浮在窗口上面（实测：窗口左侧那一竖条仍是亮的）。
 * 挂到 `body` 之后 `.admin-modal` 的 z-index 才在根层参与比较，能盖住两者。
 *
 * 焦点处理刻意选择「焦点落在窗口上」（`tabIndex={-1}`）而不是第一个控件：
 * 详情窗口里的第一个可聚焦元素是关闭按钮，直接聚焦它会让读屏用户先听到「关闭」，
 * 而把焦点交给 `role="dialog"` 容器会先朗读标题。
 */
export function AdminModal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const windowRef = useRef<HTMLDivElement>(null);
  /** 打开前的焦点位置：关闭后要还回去，否则键盘用户的焦点会掉到 `<body>` 上。 */
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    windowRef.current?.focus();

    return () => {
      document.body.style.overflow = "";
      // 只有真正可聚焦的元素才还焦点：触发按钮之外的场景（例如程序化 click）
      // 焦点原本就在 `<body>` 上，`body.focus()` 是空操作，不需要特殊分支。
      returnFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="admin-modal">
      {/* 遮罩：只承担「点空白处关闭」这一鼠标便利，键盘用户走 Esc 与关闭按钮，
          因此标记 aria-hidden，不进入可访问性树。 */}
      <div className="admin-modal__veil" aria-hidden="true" onClick={onClose} />

      <div
        ref={windowRef}
        className="admin-modal__window"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="admin-modal__head">
          <div>
            <h2 className="admin-modal__title" id={titleId}>
              {title}
            </h2>
            {subtitle ? <p className="admin-modal__lead">{subtitle}</p> : null}
          </div>
          <Button variant="ghost" icon="close" onClick={onClose}>
            {adminShared.close}
          </Button>
        </header>

        <div className="admin-modal__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
