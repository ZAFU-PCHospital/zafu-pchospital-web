import { cn, revealIndex } from "@/lib/utils";

/**
 * Readout —— 读数面板
 *
 * 对应设计基准中的 `.readout`：等宽字体、大写标签、右侧数值的仪表式面板。
 * 数值必须是真实数据（例如站点内置的文档仓库清单），不要用它做纯装饰。
 * 小屏下会自动压成一行，只有 rows 会被保留。
 */

export type ReadoutRow = {
  label: string;
  value: string;
  /** 数值单位：按小一号字渲染，不占 label 的宽度。 */
  unit?: string;
  /** 是否使用信号黄强调（用于最关键的单个数值） */
  accent?: boolean;
  /** 数值的字号是否强制缩小（用于时间戳这类长文本） */
  compact?: boolean;
};

export type ReadoutProps = {
  /** 面板标题左侧文案 */
  title: string;
  /** 面板标题右侧的等宽英文标签 */
  tag: string;
  rows: readonly ReadoutRow[];
  /** 面板底部的补充说明，小屏隐藏 */
  footnote?: string;
  index?: number;
  className?: string;
};

export function Readout({ title, tag, rows, footnote, index = 0, className }: ReadoutProps) {
  return (
    <div className={cn("readout reveal", className)} style={revealIndex(index)}>
      <p className="readout__title">
        <span>{title}</span>
        <span>{tag}</span>
      </p>
      {rows.map((row) => (
        <div className="readout__row" key={row.label}>
          <span>{row.label}</span>
          <b
            className={cn(row.accent && "is-accent")}
            style={row.compact ? { fontSize: "0.8125rem" } : undefined}
          >
            {row.value}
            {row.unit ? <small> {row.unit}</small> : null}
          </b>
        </div>
      ))}
      {footnote ? <p className="readout__foot">{footnote}</p> : null}
    </div>
  );
}
