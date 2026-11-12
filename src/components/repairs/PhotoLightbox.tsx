"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type TouchEvent,
} from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useFocusTrap } from "@/components/ui/useFocusTrap";
import { repairPhotoCopy } from "@/config/repairs";
import { cn } from "@/lib/utils";
import type { RepairPhotoView } from "@/types/contracts";

import { fillPhotoCopy, photoSwipeAction, stepPhotoIndex } from "./photo-browse";

type Props = {
  photos: RepairPhotoView[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
};

/**
 * PhotoLightboxView —— 照片灯箱的可见实现。
 *
 * 与 `AdminModal` 同一套窗口规则（Portal、Esc、锁定滚动、焦点归还），
 * 额外负责照片自己的键盘 / 触屏操作：
 * - 左右键或横滑切图，Esc 或下滑关闭；
 * - `+/-` 或底部按钮在「适应窗口 / 原始尺寸」之间切换，放大后交给滚动容器平移；
 * - 关闭后焦点回到打开灯箱的那张缩略图。
 *
 * 焦点与 Esc / Tab 由共享弹层栈管理，照片按键只在当前窗口内处理。
 */
export function PhotoLightboxView({ photos, index, onIndexChange, onClose }: Props) {
  const titleId = useId();
  const windowRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const [zoomed, setZoomed] = useState(false);
  /** 用「照片 id + 重试代次」而不是布尔值，切图时不会短暂沿用上一张的加载结果。 */
  const [loadedToken, setLoadedToken] = useState<string | null>(null);
  const [failedToken, setFailedToken] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const photo = photos[index];
  const count = photos.length;
  const loadToken = photo ? `${photo.id}:${reloadKey}` : "";
  const loaded = loadedToken === loadToken;
  const failed = failedToken === loadToken;
  const alt = fillPhotoCopy(repairPhotoCopy.alt, { index: index + 1, count });

  useFocusTrap(windowRef, onClose, !!photo);

  const go = useCallback(
    (delta: number) => {
      if (count <= 1) return;
      onIndexChange(stepPhotoIndex(index, delta, count));
    },
    [count, index, onIndexChange],
  );

  useEffect(() => {
    setZoomed(false);
  }, [index]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (zoomed) {
      stage.scrollTo({
        left: (stage.scrollWidth - stage.clientWidth) / 2,
        top: (stage.scrollHeight - stage.clientHeight) / 2,
      });
    } else {
      // 从原始尺寸缩回适应窗口时清掉平移偏移，否则图片会停在舞台角落。
      stage.scrollTo({ left: 0, top: 0 });
    }
  }, [zoomed, loaded]);

  function onPhotoKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      go(event.key === "ArrowLeft" ? -1 : 1);
    } else if (["+", "=", "-", "_"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      setZoomed(event.key === "+" || event.key === "=");
    }
  }

  if (!photo) return null;

  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0];
    if (!touch) return;
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const action = photoSwipeAction(touch.clientX - start.x, touch.clientY - start.y, zoomed);
    if (action === "close") {
      onClose();
    } else if (action === "previous") {
      go(-1);
    } else if (action === "next") {
      go(1);
    }
  }

  function retry() {
    setLoadedToken(null);
    setFailedToken(null);
    setReloadKey((value) => value + 1);
  }

  return (
    <div className="photo-lightbox">
      <div className="photo-lightbox__veil" aria-hidden="true" onClick={onClose} />
      <div
        ref={windowRef}
        className="photo-lightbox__window"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onPhotoKeyDown}
      >
        <header className="photo-lightbox__head">
          <h2 className="photo-lightbox__title" id={titleId}>
            {repairPhotoCopy.title}
          </h2>
          <button
            type="button"
            className="photo-lightbox__close"
            onClick={onClose}
            aria-label={repairPhotoCopy.close}
          >
            <Icon name="close" />
          </button>
        </header>

        <div
          ref={stageRef}
          className={cn("photo-lightbox__stage", zoomed && "is-zoomed")}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {count > 1 ? (
            <button
              type="button"
              className="photo-lightbox__nav photo-lightbox__nav--prev"
              onClick={() => go(-1)}
              aria-label={repairPhotoCopy.previous}
            >
              <Icon name="chevronLeft" />
            </button>
          ) : null}

          <div className="photo-lightbox__canvas">
            <Image
              key={`${photo.id}-${reloadKey}`}
              className={cn("photo-lightbox__img", !loaded && "is-loading")}
              src={photo.contentUrl}
              alt={alt}
              width={photo.width ?? 1280}
              height={photo.height ?? 960}
              unoptimized
              onLoad={() => {
                setLoadedToken(loadToken);
                setFailedToken(null);
              }}
              onError={() => {
                setFailedToken(loadToken);
                setLoadedToken(null);
              }}
              onDoubleClick={() => setZoomed((value) => !value)}
            />
            {!loaded && !failed ? (
              <p className="photo-lightbox__status" role="status">
                {repairPhotoCopy.loading}
              </p>
            ) : null}
            {failed ? (
              <div className="photo-lightbox__status photo-lightbox__status--error" role="alert">
                <p>{repairPhotoCopy.loadFailed}</p>
                <Button onClick={retry}>{repairPhotoCopy.retry}</Button>
              </div>
            ) : null}
          </div>

          {count > 1 ? (
            <button
              type="button"
              className="photo-lightbox__nav photo-lightbox__nav--next"
              onClick={() => go(1)}
              aria-label={repairPhotoCopy.next}
            >
              <Icon name="chevronRight" />
            </button>
          ) : null}
        </div>

        <footer className="photo-lightbox__bar">
          <span className="photo-lightbox__counter">
            {fillPhotoCopy(repairPhotoCopy.counter, { index: index + 1, count })}
          </span>
          <button
            type="button"
            className="photo-lightbox__zoom"
            onClick={() => setZoomed((value) => !value)}
            aria-pressed={zoomed}
          >
            <Icon name={zoomed ? "zoomOut" : "zoomIn"} />
            <span>{zoomed ? repairPhotoCopy.zoomOut : repairPhotoCopy.zoomIn}</span>
          </button>
        </footer>
      </div>
    </div>
  );
}

export function PhotoLightbox(props: Props) {
  if (typeof document === "undefined") return null;
  return createPortal(<PhotoLightboxView {...props} />, document.body);
}
