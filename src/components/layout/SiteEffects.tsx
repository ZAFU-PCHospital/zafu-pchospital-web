"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * SiteEffects —— 站点级视觉行为
 *
 * 集中实现设计基准中三处与滚动/指针相关的效果，全站只挂载一次：
 *
 * 1. 进场揭示：观察 `.reveal`，进入视口后加 `.is-in`，只播一次。
 * 2. 顶部进度线：优先由 CSS 滚动时间轴驱动（见 globals.css 的 @supports 分支），
 *    浏览器不支持 `animation-timeline` 时才用 JS 兜底。
 * 3. 指针准星：仅在「支持悬停的精确指针 + 未开启减少动效」时启用。
 *
 * 原则：只动 transform / opacity，不读布局属性，不用滚动监听做动画。
 *
 * 注意：`html.js` 这个类由 app/layout.tsx 中的内联脚本在 hydration 之前加上
 * （用于避免进场元素闪烁），本组件不重复添加，保持单一来源。
 *
 * ---------------------------------------------------------------------------
 * 为什么进场揭示必须依赖 pathname（重要，不要改回 []）
 *
 * `.reveal` 的初始隐藏态来自 CSS `html.js .reveal { opacity: 0 }`，
 * 只有 IntersectionObserver 补上 `.is-in` 才会显示。本组件挂在**根布局**上，
 * 客户端路由切换时它不会重新挂载 —— 若只在挂载时扫描一次，
 * 新页面的 `.reveal` 永远拿不到 `.is-in`，表现为切页后主内容区整片空白、
 * 手动刷新才恢复。因此下面这段 effect 以 pathname 为依赖，每次换页重新扫描。
 *
 * 同理，**将来在这里加任何「与页面内容有关」的逻辑，都要放进这一段，
 * 而不是第一段**：第一段只在整站生命周期内跑一次。
 * ---------------------------------------------------------------------------
 */

/** 进场揭示的判定阈值，必须与 IntersectionObserver 的配置保持一致 */
const REVEAL_OPTIONS = { rootMargin: "0px 0px -12% 0px", threshold: 0.15 } as const;

/**
 * 兜底判定：元素是否已经达到「该揭示」的可见程度。
 * 口径与 REVEAL_OPTIONS 完全对齐（视口底边上移 12%，元素 15% 以上可见）。
 */
function hasEnteredViewport(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.height === 0) return false;
  const viewportBottom = window.innerHeight * 0.88;
  const visibleHeight = Math.min(rect.bottom, viewportBottom) - Math.max(rect.top, 0);
  return visibleHeight > 0 && visibleHeight / rect.height >= 0.15;
}

export function SiteEffects() {
  const pathname = usePathname();

  /* ============ 一次性：脚本标记 / 顶部进度线 / 指针准星 ============ */
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("js");

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");

    /* --------------------------------------------------- 顶部进度线 */
    const supportsScrollTimeline =
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      CSS.supports("animation-timeline: scroll()");

    let onScroll: (() => void) | null = null;

    if (!supportsScrollTimeline) {
      const bar = document.getElementById("scrollBar");
      let ticking = false;

      const paint = () => {
        ticking = false;
        const distance = document.documentElement.scrollHeight - window.innerHeight;
        const progress = distance > 0 ? Math.min(1, Math.max(0, window.scrollY / distance)) : 0;
        if (bar) bar.style.transform = `scaleX(${progress.toFixed(4)})`;
      };

      onScroll = () => {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(paint);
      };

      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll, { passive: true });
      paint();
    }

    /* ----------------------------------------------------- 指针准星 */
    const reticle = document.getElementById("reticle");
    let cursorAnimation: number | null = null;
    let onPointerMove: ((event: PointerEvent) => void) | null = null;
    let onPointerLeave: (() => void) | null = null;
    let onReduceChange: (() => void) | null = null;

    if (reticle && !reduce.matches && fine.matches) {
      let targetX = window.innerWidth / 2;
      let targetY = window.innerHeight / 2;
      let currentX = targetX;
      let currentY = targetY;
      let shown = false;

      const loop = () => {
        currentX += (targetX - currentX) * 0.22;
        currentY += (targetY - currentY) * 0.22;
        reticle.style.transform = `translate3d(${currentX.toFixed(2)}px,${currentY.toFixed(2)}px,0) translate(-50%,-50%)`;

        if (Math.abs(targetX - currentX) > 0.2 || Math.abs(targetY - currentY) > 0.2) {
          cursorAnimation = window.requestAnimationFrame(loop);
        } else {
          cursorAnimation = null;
        }
      };

      onPointerMove = (event) => {
        targetX = event.clientX;
        targetY = event.clientY;

        if (!shown) {
          shown = true;
          currentX = targetX;
          currentY = targetY;
          reticle.setAttribute("data-active", "true");
        }
        if (cursorAnimation === null) cursorAnimation = window.requestAnimationFrame(loop);
      };

      onPointerLeave = () => {
        shown = false;
        reticle.setAttribute("data-active", "false");
      };

      onReduceChange = () => reticle.setAttribute("data-active", "false");

      document.addEventListener("pointermove", onPointerMove, { passive: true });
      document.addEventListener("pointerleave", onPointerLeave);
      reduce.addEventListener("change", onReduceChange);
    }

    return () => {
      if (onScroll) {
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
      }

      if (onPointerMove) document.removeEventListener("pointermove", onPointerMove);
      if (onPointerLeave) document.removeEventListener("pointerleave", onPointerLeave);
      if (onReduceChange) reduce.removeEventListener("change", onReduceChange);
      if (cursorAnimation !== null) window.cancelAnimationFrame(cursorAnimation);
    };
  }, []);

  /* ============ 每次换页：进场揭示（含兜底） ============ */
  useEffect(() => {
    /* 只接管尚未揭示过的元素；已经带 .is-in 的保持原状，不重播动画。
       **跳过后台**（`.admin-shell` 内）：管理台是密集数据界面，进后台还要等内容淡入属于
       装饰性动画，CSS 里已经把这块的 `.reveal` 中性化。更重要的是：直接改 class 会让
       DOM 与 React 的 vdom 分叉，之后只要路由器重渲染到这一棵子树，React 就报
       hydration 不匹配（实测 `/admin` 首页必现，公开页不会）。后台不参与揭示，
       这个分叉也就不存在了。 */
    const pending = Array.from(document.querySelectorAll<HTMLElement>(".reveal")).filter(
      (el) => !el.classList.contains("is-in") && !el.closest(".admin-shell"),
    );

    if (!("IntersectionObserver" in window)) {
      pending.forEach((el) => el.classList.add("is-in"));
      return;
    }

    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        obs.unobserve(entry.target); // 只播一次，播完即注销
      });
    }, REVEAL_OPTIONS);

    pending.forEach((el) => observer.observe(el));

    /* 兜底：内容绝不允许永久不可见。
       宽限期后复查一次，凡「已经进入视口却仍是隐藏态」的直接补 .is-in ——
       覆盖观察器因任何原因没生效的情况。判定口径与观察器一致，
       所以正常路径下这段不会改变动效节奏，只是最后一道保险。 */
    const safetyNet = window.setTimeout(() => {
      document.querySelectorAll<HTMLElement>(".reveal:not(.is-in)").forEach((el) => {
        if (hasEnteredViewport(el)) el.classList.add("is-in");
      });
    }, 1200);

    return () => {
      observer.disconnect();
      window.clearTimeout(safetyNet);
    };
  }, [pathname]);

  return (
    <>
      {/* 阅读进度线：条本身由 CSS 滚动时间轴或上面的兜底逻辑驱动 */}
      <div className="progress-line" aria-hidden="true">
        <i className="progress-line__bar" id="scrollBar" />
      </div>

      {/* 指针准星：桌面精确指针下跟随鼠标，其余环境保持隐藏 */}
      <div className="reticle" id="reticle" data-active="false" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.4}
          strokeLinecap="round"
        >
          <line x1="12" y1="2" x2="12" y2="7" />
          <line x1="12" y1="17" x2="12" y2="22" />
          <line x1="2" y1="12" x2="7" y2="12" />
          <line x1="17" y1="12" x2="22" y2="12" />
        </svg>
        <span className="reticle__dot" />
      </div>
    </>
  );
}
