import { memberCopy, formatDurationMinutes } from "@/config/member";
import type { MemberRepairSummary, MetricValue } from "@/types/contracts";

/**
 * MemberMetrics —— 维修指标卡（累计 / 本学期 / 本月 / 累计时长）
 *
 * 数据全部来自 `MemberRepairSummary`，即 M2 的「已通过维修」正式统计口径
 * （`source: "M2_APPROVED_REPAIRS"`）。本组件**不做任何再统计**，
 * 只是把服务端给出的 `MetricValue` 呈现出来。
 *
 * 关键约束：`status === "UNCONFIGURED"`（如学期区间未配置）时显示「待配置」，
 * **绝不**回退为伪造的「0 次」—— `value` 此时必为 `null`，
 * 出现 `AVAILABLE` + `null` 的组合只能说明上游违约，这里按未配置渲染兜底。
 *
 * 计数类的渲染是「大号数字 + 小号单位 span」，不要改用 `config/member.ts` 的
 * `formatCount()`：那个helper返回的字符串自带「次」，叠上单位 span 就是「1 次次」。
 */

export type MemberMetricsProps = {
  summary: MemberRepairSummary;
  /** 指标标题覆盖：个人资料页与工作台共用同一组件 */
  labels?: Partial<Record<"total" | "term" | "month" | "duration", string>>;
};

type MetricEntry = {
  key: "total" | "term" | "month" | "duration";
  label: string;
  metric: MetricValue;
  unit?: string;
  /** 时长类指标用「x 小时 y 分钟」而不是「x 次」 */
  duration?: boolean;
};

export function MemberMetrics({ summary, labels }: MemberMetricsProps) {
  const copy = memberCopy.dashboard;
  const entries: MetricEntry[] = [
    {
      key: "total",
      label: labels?.total ?? copy.metricTotal,
      metric: summary.totalApprovedCount,
      unit: copy.unitCount,
    },
    {
      key: "term",
      label: labels?.term ?? copy.metricTerm,
      metric: summary.termApprovedCount,
      unit: copy.unitCount,
    },
    {
      key: "month",
      label: labels?.month ?? copy.metricMonth,
      metric: summary.monthApprovedCount,
      unit: copy.unitCount,
    },
    {
      key: "duration",
      label: labels?.duration ?? copy.metricDuration,
      metric: summary.totalApprovedDurationMinutes,
      duration: true,
    },
  ];

  return (
    <dl className="member-metrics">
      {entries.map((entry) => (
        <div className="member-metric" key={entry.key}>
          <dt className="member-metric__label">{entry.label}</dt>
          <dd className={`member-metric__value${isUnavailable(entry) ? " member-metric__value--unconfigured" : ""}`}>
            {renderValue(entry)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function isUnavailable(entry: MetricEntry): boolean {
  return entry.metric.status !== "AVAILABLE" || entry.metric.value === null;
}

function renderValue(entry: MetricEntry) {
  if (isUnavailable(entry)) return memberCopy.common.unconfigured;

  const value = entry.metric.value as number;
  if (entry.duration) return formatDurationMinutes(value);
  /* 这里**不能**再用 `formatCount`：它返回的字符串本身已经带「次」，
     配合下面那个单位 span 会渲染成「1 次次」（M3 起的既有缺陷）。
     指标卡的小号单位是 `.member-metric__unit`，与「待处理维修」队列同一套写法：
     数字走大号，单位走 13px 的次级文字。 */
  return (
    <>
      {value}
      {entry.unit ? <span className="member-metric__unit">{entry.unit}</span> : null}
    </>
  );
}
