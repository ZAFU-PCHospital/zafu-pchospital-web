import { Icon } from "@/components/ui/Icon";
import { type DocListItem } from "@/lib/docs";

/**
 * DocList —— 文档目录列表
 *
 * 对应设计基准中 docs 区块的 `.docpreview__list`。
 * 首页的文档预览与 /tools 入口页共用同一实现。
 *
 * 已就绪条目跳转到同域 mdBook 页面；待撰写条目为不可点击的状态展示。
 */

export type DocListProps = {
  items: readonly DocListItem[];
  /** 由 mdBook outputPath 生成站内阅读地址 */
  resolveHref?: (outputPath: string) => string;
};

export function DocList({ items, resolveHref }: DocListProps) {
  return (
    <ul className="docpreview__list">
      {items.map((item, index) => {
        const key = `${item.type}-${item.title}-${index}`;

        if (item.type === "group") {
          return (
            <li className="docpreview__group" key={key}>
              {item.title}
            </li>
          );
        }

        const clickable = !item.pending && Boolean(item.outputPath) && Boolean(resolveHref);

        return (
          <li key={key}>
            {clickable ? (
              <a className="docpreview__item" href={resolveHref?.(item.outputPath as string)}>
                <Icon name="fileText" />
                <span>{item.title}</span>
              </a>
            ) : (
              <span className="docpreview__item is-pending" title="该文档尚未撰写">
                <Icon name="fileText" />
                <span>{item.title}</span>
                <em>待撰写</em>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
