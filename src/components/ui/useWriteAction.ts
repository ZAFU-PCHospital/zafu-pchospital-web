"use client";

import { useCallback, useRef, useState } from "react";

export type WriteActionResult = { ok: true } | { ok: false; message?: string };

/**
 * 列表写操作的 busy / 防重 / 失败提示包装。
 *
 * 只负责一次写请求；成功后由调用方传入的 `onSuccess` 刷新列表。
 * 失败信息保持到下一次操作或手动关闭，不使用会自动消失的成功浮层。
 */
export function useWriteAction({
  onSuccess,
}: {
  onSuccess?: () => void | Promise<void>;
} = {}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const successRef = useRef(onSuccess);
  successRef.current = onSuccess;

  const run = useCallback(
    async (
      key: string,
      action: () => Promise<WriteActionResult>,
      fallbackMessage: string,
    ): Promise<boolean> => {
      // ref 先于 state 生效，连续点击在同一帧内也会被挡住。
      if (inFlight.current) return false;
      inFlight.current = true;
      setBusyKey(key);
      setError("");
      try {
        const result = await action();
        if (!result.ok) {
          setError(result.message?.trim() || fallbackMessage);
          return false;
        }
        await successRef.current?.();
        return true;
      } catch {
        setError(fallbackMessage);
        return false;
      } finally {
        inFlight.current = false;
        setBusyKey(null);
      }
    },
    [],
  );

  const clearError = useCallback(() => setError(""), []);

  return { busyKey, busy: busyKey !== null, error, clearError, run };
}
