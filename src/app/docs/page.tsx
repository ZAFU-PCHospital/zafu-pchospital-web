import type { Metadata } from "next";

import { DocBanner } from "@/components/docs/DocBanner";
import { ToolDirectory } from "@/components/docs/ToolDirectory";
import { docsPage } from "@/config/docs";
import { docMeta, formatGeneratedAt } from "@/lib/docs";

import "./tools.css";

export const metadata: Metadata = {
  title: docsPage.title,
  description: docsPage.metadataDescription,
};

/**
 * /docs 工具索引页
 *
 * 结构：面包屑 → 标题导语 → 技术文档知识库横幅卡 → 工具网址目录 → 页脚说明行。
 * 技术文档正文由独立仓库生成到同域 /handbook/，本页只保留入口；
 * 工具数据来自 src/config/tools.ts，交互在 ToolDirectory 组件内。
 *
 * 版式按设计稿逐像素复刻（色值取自设计稿采样，见 tools.css 顶部注释），
 * 因此不使用 Section / SectionHead 等沿用主题令牌的版式组件。
 */
export default function DocsPage() {
  return (
    <div className="tp">
      <p className="tp-crumb">
        <b>{docsPage.index} / {docsPage.label}</b> · {docsPage.crumbLabel}
      </p>

      <h1 className="tp-title">{docsPage.title}</h1>
      <p className="tp-lead">{docsPage.lead}</p>

      <DocBanner />
      <ToolDirectory />

      <div className="tp-foot">
        <span>外链均为官方网站，新窗口打开。</span>
        <span>
          文档读数来自 doc-manifest.json · 生成于 {formatGeneratedAt(docMeta.generatedAt)}
        </span>
      </div>
    </div>
  );
}
