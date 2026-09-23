"use client";

import { useCallback, useEffect, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

/**
 * GalleryCarousel —— 现场图集走马灯
 *
 * 与 Ticker 的区别：Ticker 是 aria-hidden 的纯装饰文字跑马灯，
 * 这里的每一屏都是给人看的内容（图片 + 图注），因此必须可读、可操作、可暂停。
 *
 * 行为约定：
 * - 自动播放间隔由 autoPlayMs 控制；> 5000ms 时按 WCAG 2.2.2 必须能暂停。
 * - 悬停暂停、聚焦暂停、切到后台暂停；点击暂停按钮可手动锁定。
 * - slides 为空时整块不渲染（调用方通常也不会渲染），避免出现空框。
 * - prefers-reduced-motion 或 autoPlayMs <= 0 时不自动播放。
 *
 * 两个呈现变体（variant）：
 * - "panel"（默认）：带外框的独立面板，图注压在照片下缘，底部有完整控制条。
 *   适合图片作为页面主体之一的场景。
 * - "editorial"：无外框、整幅大图，图注移到照片下方成为一行编辑式信息栏
 *   （「纪年 · 活动名 · 序号」），左右箭头收成极简的文字态。
 *   控件刻意弱化，避免出现「企业官网轮播组件」的观感。
 *
 * 两个变体的 DOM 结构、无障碍语义与交互行为完全一致，
 * 差异只体现在 class 与渲染方式上，调用方可安全按需切换。
 */

export type GallerySlide = {
  src: string;
  alt: string;
  title: string;
  description: string;
  /** 图注左端的纪年 / 场次标签，缺省时该位不渲染 */
  year?: string;
};

export type GalleryCarouselProps = {
  slides: readonly GallerySlide[];
  /** 自动播放间隔（ms）。<= 0 表示不自动播放。 */
  autoPlayMs?: number;
  /** 呈现变体，默认 "panel" */
  variant?: "panel" | "editorial";
  className?: string;
};

export function GalleryCarousel({
  slides,
  autoPlayMs = 0,
  variant = "panel",
  className,
}: GalleryCarouselProps) {
  const [index, setIndex] = useState(0);
  /** 用户显式锁定的暂停态（点了暂停按钮） */
  const [locked, setLocked] = useState(false);
  /** 临时暂停态（悬停 / 聚焦 / 页面不可见） */
  const [held, setHeld] = useState(false);
  /** 是否允许自动播放：客户端挂载后再判断减少动效偏好，避免 SSR 结果不一致 */
  const [autoAllowed, setAutoAllowed] = useState(false);

  const count = slides.length;
  const editorial = variant === "editorial";

  /** 减少动效偏好 + 间隔有效性，都在挂载后判定 */
  useEffect(() => {
    if (autoPlayMs <= 0) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setAutoAllowed(!mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [autoPlayMs]);

  const playing = autoAllowed && !locked && !held && count > 1;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % count);
    }, autoPlayMs);
    return () => window.clearInterval(timer);
  }, [playing, autoPlayMs, count]);

  /** 页面切到后台时暂停，避免用户回来时连翻好几张 */
  useEffect(() => {
    const onVisibility = () => setHeld(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const go = useCallback(
    (next: number) => {
      if (count === 0) return;
      setIndex(((next % count) + count) % count);
    },
    [count],
  );

  /** 左右方向键切换，仅在轮播获得焦点时生效 */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      go(index + 1);
    }
  };

  if (count === 0) return null;

  const multiple = count > 1;
  const current = slides[index];

  return (
    <div
      className={cn("gallery", editorial && "gallery--editorial", className)}
      role="group"
      aria-roledescription="轮播"
      aria-label="社团现场图集"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(false);
      }}
      onKeyDown={onKeyDown}
    >
      <div className="gallery__stage">
        {slides.map((slide, i) => (
          <figure
            key={slide.src}
            className={cn("gallery__slide", i === index && "is-current")}
            aria-hidden={i !== index}
            // 非当前帧不参与 tab 与朗读顺序
            inert={i !== index}
          >
            {/* 优先 WebP、回退原 JPEG：WebP 在同样尺寸下比 JPEG 小约三分之一
                （实测五张合计 851 KB → 545 KB，720px 档合计只要 228 KB），
                而 `tools/` 里的 `compress-gallery.mjs` 已经把 JPEG 压到 q74，
                再压 JPEG 就只能掉画质了。
                不用 `next/image`：它会引入 sharp 这个运行时依赖，而这批图是
                构建前就定稿的静态资源（同下面那条 eslint 注释的判断）。
                `sizes` 按 `.gallery__stage` 的实际宽度给：宽屏下是内容列宽度，
                窄屏整幅铺满 —— 让 720px 档在手机上生效，省下大半流量。 */}
            <picture>
              <source
                type="image/webp"
                srcSet={`${webpOf(slide.src, 720)} 720w, ${webpOf(slide.src, 1440)} 1440w`}
                sizes="(min-width: 1200px) 1160px, 100vw"
              />
              {/* `next/no-img-element` 不报这条：有 `<picture>` + WebP 源的 img 属于
                  「已经有更优格式」的情形，规则自己认。 */}
              <img
                className="gallery__img"
                src={slide.src}
                alt={slide.alt}
                loading={i === 0 ? "eager" : "lazy"}
                decoding="async"
              />
            </picture>
            {/* panel 变体的图注压在照片下缘；editorial 变体改用下方独立信息栏 */}
            {!editorial && (
              <figcaption className="gallery__cap">
                <strong className="gallery__cap-title">{slide.title}</strong>
                <span className="gallery__cap-desc">{slide.description}</span>
              </figcaption>
            )}
          </figure>
        ))}
      </div>

      {/* ---------------------------------------------------- editorial 信息栏 */}
      {editorial && (
        <div className="gallery__lede">
          <p className="gallery__lede-line">
            {current.year ? <span className="gallery__lede-year">{current.year}</span> : null}
            <span className="gallery__lede-title">{current.title}</span>
          </p>
          <p className="gallery__lede-desc">{current.description}</p>
        </div>
      )}

      {multiple && (
        <div className="gallery__bar">
          <div className="gallery__nav">
            <button
              type="button"
              className="gallery__btn"
              onClick={() => go(index - 1)}
              aria-label="上一张图片"
            >
              <Icon name="chevronLeft" />
            </button>
            <button
              type="button"
              className="gallery__btn"
              onClick={() => go(index + 1)}
              aria-label="下一张图片"
            >
              <Icon name="chevronRight" />
            </button>
          </div>

          <ol className="gallery__dots">
            {slides.map((slide, i) => (
              <li key={slide.src}>
                <button
                  type="button"
                  className={cn("gallery__dot", i === index && "is-current")}
                  onClick={() => go(i)}
                  aria-label={`第 ${i + 1} 张：${slide.title}`}
                  aria-current={i === index ? "true" : undefined}
                />
              </li>
            ))}
          </ol>

          <div className="gallery__meta">
            <span className="gallery__idx" aria-hidden="true">
              {String(index + 1).padStart(2, "0")} / {String(count).padStart(2, "0")}
            </span>
            {autoAllowed && (
              <button
                type="button"
                className="gallery__toggle"
                onClick={() => setLocked((v) => !v)}
                aria-label={locked ? "继续自动切换" : "暂停自动切换"}
              >
                {locked ? "播放" : "暂停"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 原图路径 → 同目录的 WebP 变体路径（`04-repair-session.jpg` → `04-repair-session-1440.webp`）。
 *
 * 变体是**一次性生成后入库的静态资源**（生成方式与 `tools/compress-gallery.mjs` 同一条路子：
 * 用 pnpm store 里的 sharp 按时长边缩放再编码），带宽度后缀是因为同一张图有两档尺寸
 * 给 `srcset` 挑。找不到变体时 `<picture>` 会自动回退到 `<img>` 的原 JPEG ——
 * 这正是用 `<picture>` 而不是把 `src` 直接换成 WebP 的原因：老浏览器还有退路。
 */
function webpOf(src: string, width: number): string {
  return src.replace(/\.jpe?g$/i, `-${width}.webp`);
}
