"use client";

import { useEffect } from "react";

import { Container } from "@/components/layout/Container";
import { globalErrorPage } from "@/config/errors";
import { siteConfig } from "@/config/site";
import { reportClientError } from "@/lib/telemetry/client";

import "./globals.css";

/**
 * 全局错误页（最后一道兜底）
 *
 * 只在**根布局自身**抛错时出现：Header / Footer 这些骨架都不在了，
 * 因此这里自己渲染 `<html>` / `<body>`，并自行引入全局样式 ——
 * 根布局那份样式依赖已经不存在，不引的话这一页会退化成浏览器默认样式
 * （实测两份样式在生产构建里是同一个 chunk，不会让其他页面多下载一遍）。
 *
 * 与 `error.tsx` 的两点不同：
 * - 出路用原生 `<a>` 而不是 `Button`（它渲染 `next/link`）：骨架都坏掉时客户端路由
 *   往往也一起坏了（例如某个 chunk 没加载下来），只有整页重新加载才靠得住。
 * - 不插手显示模式：服务端出错时 Next 用自己的错误文档替换整份 head，根布局的主题脚本
 *   不在场，这一页就落在默认主题上（见 `config/errors.ts`）；客户端出错时文档早已带着
 *   用户的主题，更不需要在这里做第二遍。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    reportClientError(error, "global");
  }, [error]);

  return (
    <html lang="zh-Hans-CN">
      <head>
        <title>{`${globalErrorPage.title} · ${siteConfig.name}`}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>

      <body>
        <main id="main">
          <section className="page-head">
            <Container>
              <header className="sec-head">
                <span className="sec-head__num">{globalErrorPage.code}</span>
                <span className="sec-head__rule" aria-hidden="true" />
                <span className="sec-head__en">{globalErrorPage.labelEn}</span>
              </header>

              <h1 className="sec-title">{globalErrorPage.title}</h1>

              <p className="lead">{globalErrorPage.lead}</p>

              <div className="hero__actions">
                <button className="btn btn--solid" type="button" onClick={reset}>
                  {globalErrorPage.retryAction}
                </button>
                {/* 这一处刻意用原生 <a> 而不是 next/link，理由见文件头。 */}
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a className="btn btn--ghost" href="/">
                  {globalErrorPage.homeAction}
                </a>
              </div>
            </Container>
          </section>
        </main>
      </body>
    </html>
  );
}
