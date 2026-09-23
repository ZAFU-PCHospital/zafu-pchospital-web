"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { Icon } from "@/components/ui/Icon";
import { adminShared } from "@/config/admin";

/** 反馈条的停留时长（毫秒）。够读完一行「分类已停用。」，又不至于一直挂在屏幕上。 */
export const ADMIN_TOAST_DURATION_MS = 4000;

/**
 * 反馈语气决定图标：
 * - `success`：**做完了一件事**（保存、更新、启用、审核通过）→ 对勾；
 * - `neutral`：**成功地把状态改成了「关掉」**（停用、禁用、退回、软删除）→ 叉。
 *
 * 两者都表示操作成功，区别只在语义 —— 所以不用颜色区分（本站只有一个强调色，
 * 也没有危险色令牌），只用图标，文字本身已经说清了结果。
 */
export type AdminToastTone = "success" | "neutral";

export type AdminToastMessage = { text: string; tone: AdminToastTone };

/**
 * AdminToast —— 后台操作反馈浮层（M6）。
 *
 * 为什么要有它：早先后台把「分类已停用。」这类反馈直接**内联**渲染在内容顶部，
 * 于是每次操作都会在表单上方插入/移除一行文字 —— 视觉上像「文本在加载卸载」，
 * 而且那行文字挂在页面上不会自己消失，得等下一次操作把它覆盖掉。
 * 反馈是「刚刚发生了什么」的一次性信息，不该参与页面布局。
 *
 * 三条实现约束：
 * 1. **中性面板 + 强调色图标**，不用 `.notice`（`docs/design-system.md` §4.5 明确规定
 *    `.notice` 只用于须知/风险，不做成功反馈）；这里复用 `.card` 的描边 + `--surface-1`；
 * 2. **Portal 到 `document.body`**：页面内容在 `<main>` 的层叠上下文里，不挂 body 的话
 *    移动端顶栏（`.topbar`，z-index 85）会盖住它；`z-index: 100` 同时高于详情窗口（96），
 *    这样窗口内的操作反馈也能看见；
 * 3. `role="status"` + `aria-live="polite"`：读屏会在空闲时朗读，不打断当前操作。
 *
 * 只承载**一行的成功反馈**。错误、以及「必须带走的信息」（初始密码、批量逐条失败明细、
 * 导出空结果诊断）仍然内联展示 —— 那些不能自动消失。
 */
export function AdminToast({
  toast,
  onDismiss,
}: {
  /** `null` 表示不显示；每次新操作都换一个新对象，计时器随之重来。 */
  toast: AdminToastMessage | null;
  onDismiss: () => void;
}) {
  /** 用 ref 持有回调：否则父组件每次重渲染都会重置下面的计时器，反馈条赖着不走。 */
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => dismissRef.current(), ADMIN_TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!toast || typeof document === "undefined") return null;

  return createPortal(
    <div className="admin-toast">
      <div
        className={`card admin-toast__body admin-toast__body--${toast.tone}`}
        role="status"
        aria-live="polite"
      >
        <Icon name={toast.tone === "success" ? "check" : "close"} />
        <p className="admin-toast__text">{toast.text}</p>
        <button
          className="admin-toast__close"
          type="button"
          aria-label={adminShared.toastClose}
          onClick={onDismiss}
        >
          <Icon name="close" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
