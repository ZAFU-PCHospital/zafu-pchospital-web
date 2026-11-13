"use client";

import { useEffect } from "react";

import { Container } from "@/components/layout/Container";
import { Button } from "@/components/ui/Button";
import { routeErrorPage } from "@/config/errors";
import { reportClientError } from "@/lib/telemetry/client";

/**
 * 路由级错误边界
 *
 * 覆盖根布局以下的全部页面段：出错时 Header / Footer 与公开导航仍然可用，
 * 所以这里只替换正文，版式沿用 `not-found.tsx`（`page-head` + `sec-head`）。
 * 文案在 `config/errors.ts`，组件只负责版式与两个出路。
 *
 * 错误照旧打进控制台（含 Next 给的 digest），便于从使用者那里回收信息；
 * 不在这里展示堆栈 —— 对访客没有意义，还可能带出实现细节。
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    reportClientError(error, "route");
  }, [error]);

  return (
    <section className="page-head">
      <Container>
        <header className="sec-head">
          <span className="sec-head__num">{routeErrorPage.code}</span>
          <span className="sec-head__rule" aria-hidden="true" />
          <span className="sec-head__en">{routeErrorPage.labelEn}</span>
        </header>

        <h1 className="sec-title">{routeErrorPage.title}</h1>

        <p className="lead">{routeErrorPage.lead}</p>

        <div className="hero__actions">
          <Button variant="solid" onClick={reset}>
            {routeErrorPage.retryAction}
          </Button>
          <Button variant="ghost" href="/" trailingIcon="chevronRight">
            {routeErrorPage.homeAction}
          </Button>
        </div>
      </Container>
    </section>
  );
}
