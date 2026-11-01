import { DocList } from "@/components/docs/DocList";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";
import { SectionHead } from "@/components/ui/SectionHead";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { docsPage } from "@/config/docs";
import { docsTeaser } from "@/config/home";
import { siteConfig } from "@/config/site";
import { docPageUrl, docTree, flattenDocTree } from "@/lib/docs";

/**
 * DocsSection —— 首页「文档」区块
 *
 * 对应设计基准的 `.docs`：说明与入口按钮，下方是带标题栏的目录预览面板；
 * issue #330 起不再展示仓库读数，首页把数据位置留给维修记录。
 *
 * 主入口直接进入 mdBook 的 Intro 页面，这里同时保留目录预览。
 */

export function DocsSection() {
  const items = flattenDocTree(docTree);

  return (
    <Section id="docs" labelledBy="docs-title">
      <SectionHead index="03" label="Documentation" />

      <div className="sec-titlebar">
        <SectionTitle id="docs-title">{docsTeaser.title}</SectionTitle>
      </div>

      <div className="docs__grid docs__grid--single">
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
      </div>

      <Reveal className="docpreview" index={1}>
        <div className="docpreview__bar">
          <span className="docpreview__dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>src/ · {siteConfig.docRepo.name}</span>
          <span>{siteConfig.docRepo.author}</span>
        </div>
        <DocList items={items} resolveHref={docPageUrl} />
      </Reveal>
    </Section>
  );
}
