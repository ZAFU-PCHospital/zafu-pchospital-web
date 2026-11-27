import type { Metadata } from "next";

import { Container } from "@/components/layout/Container";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "页面不存在",
};

/**
 * 404
 *
 * 沿用设计系统的排版与按钮，不引入新的视觉语言。
 */

export default function NotFound() {
  return (
    <section className="page-head">
      <Container>
        <header className="sec-head">
          <span className="sec-head__num">404</span>
          <span className="sec-head__rule" aria-hidden="true" />
          <span className="sec-head__en">Not Found</span>
        </header>

        <h1 className="sec-title">你访问的页面不存在</h1>

        <p className="lead">
          页面可能已被移动或删除，或者链接已经失效。可以从首页重新开始，或者直接去实用工具页找文档和常用官网。
        </p>

        <div className="hero__actions">
          <Button variant="solid" href="/" icon="chevronRight">
            回到首页
          </Button>
          <Button variant="ghost" href="/docs" trailingIcon="chevronRight">
            浏览实用工具
          </Button>
        </div>
      </Container>
    </section>
  );
}
