import { Icon } from "@/components/ui/Icon";
import { docsPage } from "@/config/docs";
import { docMeta } from "@/lib/docs";
import { pad2 } from "@/lib/utils";

/**
 * DocBanner —— 工具页顶部的「技术文档知识库」横幅卡
 *
 * 左栏是标题、说明与两个入口，右栏是文档清单读数（目录条目 / 已就绪 / 待撰写）。
 * 读数来自 src/data/doc-manifest.json，是真实统计而非装饰。
 *
 * 样式见 ../app/tools/tools.css 的 .tp-banner*：主题表面、左侧 3px 强调条、
 * 横向由强调底色渐变到表面，按设计稿复刻。
 */
export function DocBanner() {
  return (
    <div className="tp-banner">
      <div>
        <h2 className="tp-banner__title">{docsPage.bannerTitle}</h2>
        <p className="tp-banner__desc">{docsPage.bannerDescription}</p>

        <div className="tp-banner__actions">
          <a className="tp-btn tp-btn--solid" href={docsPage.handbookAction.href}>
            {docsPage.handbookAction.label}
            <Icon name="arrowRight" />
          </a>
          <a
            className="tp-btn tp-btn--ghost"
            href={docsPage.repositoryAction.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {docsPage.repositoryAction.label}
            <Icon name="arrowUpRight" />
          </a>
        </div>
      </div>

      <dl className="tp-stats">
        <div>
          <dt>目录条目</dt>
          <dd>{pad2(docMeta.counts.total)}</dd>
        </div>
        <div className="is-accent">
          <dt>已就绪</dt>
          <dd>{pad2(docMeta.counts.ready)}</dd>
        </div>
        <div>
          <dt>待撰写</dt>
          <dd>{pad2(docMeta.counts.pending)}</dd>
        </div>
      </dl>
    </div>
  );
}
