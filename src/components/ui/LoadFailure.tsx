"use client";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

/** 列表 / 详情加载失败：保留错误信息，并提供重试与可选返回。 */
export function LoadFailure({
  message,
  retryLabel,
  onRetry,
  backHref,
  backLabel,
  className,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
  backHref?: string;
  backLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("load-failure", className)} role="alert">
      <p className="load-failure__message">{message}</p>
      <div className="load-failure__actions">
        {backHref && backLabel ? (
          <Button variant="ghost" href={backHref}>
            {backLabel}
          </Button>
        ) : null}
        <Button onClick={onRetry}>{retryLabel}</Button>
      </div>
    </div>
  );
}
