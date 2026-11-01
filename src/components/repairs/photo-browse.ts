/** 缩略图网格与灯箱共用的纯逻辑：文案占位、循环切图与手势判定。 */

export const PHOTO_SWIPE_MIN_DISTANCE = 48;
export const PHOTO_SWIPE_CLOSE_DISTANCE = 80;

export type PhotoSwipeAction = "previous" | "next" | "close" | null;

/** 把 `{index}` / `{count}` 这类占位符换成实际值；未知占位符保持原样。 */
export function fillPhotoCopy(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/** 灯箱内循环切图；只有一张时返回原下标。 */
export function stepPhotoIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (((current + delta) % count) + count) % count;
}

/**
 * 触屏手势判定。
 *
 * 放大状态下交给原生滚动平移，不抢横滑；未放大时横滑切图，向下滑关闭。
 * 纵向阈值高于横向，避免「想关掉却翻到下一张」。
 */
export function photoSwipeAction(dx: number, dy: number, zoomed: boolean): PhotoSwipeAction {
  if (zoomed) return null;
  const horizontal = Math.abs(dx);
  const vertical = Math.abs(dy);
  if (vertical >= PHOTO_SWIPE_CLOSE_DISTANCE && vertical > horizontal) {
    return dy > 0 ? "close" : null;
  }
  if (horizontal >= PHOTO_SWIPE_MIN_DISTANCE && horizontal > vertical) {
    return dx > 0 ? "previous" : "next";
  }
  return null;
}
