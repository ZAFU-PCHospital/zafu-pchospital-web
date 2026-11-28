import { Readout, type ReadoutRow } from "@/components/ui/Readout";
import { docMeta, formatGeneratedAt } from "@/lib/docs";
import { pad2 } from "@/lib/utils";

/**
 * DocReadout —— 文档仓库读数面板
 *
 * 数值直接读取 src/data/doc-manifest.json，是真实数据而非装饰。
 * 首页 Hero、首页文档区块、/tools 入口页共用。
 */

export type DocReadoutProps = {
  title: string;
  tag: string;
  /** 是否显示「生成时间」一行（首页 Hero 的精简版不显示） */
  showGeneratedAt?: boolean;
  footnote?: string;
  index?: number;
  className?: string;
};

export function DocReadout({
  title,
  tag,
  showGeneratedAt = false,
  footnote,
  index = 0,
  className,
}: DocReadoutProps) {
  const rows: ReadoutRow[] = [
    { label: "目录条目", value: pad2(docMeta.counts.total) },
    { label: "已就绪", value: pad2(docMeta.counts.ready), accent: true },
    { label: "待撰写", value: pad2(docMeta.counts.pending) },
  ];

  if (showGeneratedAt) {
    rows.push({
      label: "生成时间",
      value: formatGeneratedAt(docMeta.generatedAt),
      compact: true,
    });
  }

  return (
    <Readout
      title={title}
      tag={tag}
      rows={rows}
      footnote={footnote}
      index={index}
      className={className}
    />
  );
}
