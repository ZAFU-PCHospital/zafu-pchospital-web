import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";
import { SectionHead } from "@/components/ui/SectionHead";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { docsPage } from "@/config/docs";
import { docsTeaser } from "@/config/home";
import { siteConfig } from "@/config/site";

/**
 * DocsSection —— 首页「文档」区块
 *
 * issue #330 起只保留说明与两个入口，不再展示仓库读数或目录预览；
 * 首页把展示空间留给维修记录，文档全文由独立 mdBook 站承载。
 */

export function DocsSection() {
  return (
    <Section id="docs" labelledBy="docs-title">
      <SectionHead index="03" label="Documentation" />

      <div className="sec-titlebar">
        <SectionTitle id="docs-title">{docsTeaser.title}</SectionTitle>
      </div>

      <div>
        <Reveal as="p" className="lead" index={2}>
          {docsTeaser.lead}
        </Reveal>

        <Reveal className="hero__actions" index={3}>
          <Button variant="solid" icon="book" href={docsPage.handbookAction.href}>
            {docsPage.handbookAction.label}
          </Button>
          <Button
            variant="ghost"
            icon="github"
            href={siteConfig.docRepo.url}
            external
            trailingIcon="arrowUpRight"
          >
            查看源文件仓库
          </Button>
        </Reveal>
      </div>
    </Section>
  );
}
