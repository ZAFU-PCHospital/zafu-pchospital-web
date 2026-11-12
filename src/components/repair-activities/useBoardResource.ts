"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createBoardReader } from "./board-reader";

export function useBoardResource<T>(
  activityId: string,
  view: "live" | "served" | "attendance",
  options: { automatic: boolean; paused: boolean; interval: number; succeeded?: (data: T) => void },
) {
  const [, render] = useState(0);
  const settings = useRef(options);
  const previousInterval = useRef(options.interval);
  useLayoutEffect(() => {
    settings.current = options;
  });
  // 创建本身无副作用；被 React 放弃的 render 不得终止仍在屏幕上的读取器。
  const reader = useMemo(
    () =>
      createBoardReader<T>({
        url: `/api/v1/member/repair-activities/${activityId}/board?view=${view}`,
        interval: () => settings.current.interval,
        paused: () => settings.current.paused,
        changed: () => render((value) => value + 1),
        succeeded: (data) => settings.current.succeeded?.(data),
      }),
    [activityId, view],
  );
  useLayoutEffect(() => {
    // Strict Mode 的 setup/cleanup 会复用实例；清理只失效请求，不把实例永久关闭。
    return () => reader.invalidate();
  }, [reader]);
  useEffect(() => {
    if (!options.automatic || options.paused) {
      reader.invalidate(true);
      return;
    }
    const refresh = () => {
      if (document.visibilityState !== "visible") reader.invalidate(true);
      else void reader.read({ resume: true });
    };
    // 写后手动对账已经读取新快照时，恢复轮询沿用它的到期时间。
    const intervalChanged = previousInterval.current !== options.interval;
    previousInterval.current = options.interval;
    void reader.read({ resume: intervalChanged });
    const timer = window.setInterval(() => void reader.read(), 1_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      reader.invalidate(true);
    };
  }, [reader, options.automatic, options.paused, options.interval]);
  return reader;
}
