import { Readout, type ReadoutRow } from "@/components/ui/Readout";
import { homePublicAnalytics as copy } from "@/config/home";
import { formatRepairDurationHours, homeYearLabel } from "@/lib/home-analytics";
import type { PublicHomeAnalytics } from "@/types/contracts";

/** 首屏读数：文档统计退场，改为公开维修数据；详细统计关闭时只显示累计设备数。 */
export function RepairReadout({ data, index = 0 }: { data: PublicHomeAnalytics; index?: number }) {
  const stats = data.repairStats;
  if (!stats) return null;

  const rows: ReadoutRow[] = [
    {
      label: copy.total,
      value: stats.totalApprovedCount.toLocaleString("zh-CN"),
      unit: copy.countUnit,
      accent: true,
    },
  ];
  if (stats.details) {
    rows.push(
      {
        label: homeYearLabel(copy.year, data),
        value: stats.details.yearApprovedCount.toLocaleString("zh-CN"),
        unit: copy.countUnit,
      },
      {
        label: copy.duration,
        value: formatRepairDurationHours(stats.details.totalApprovedDurationMinutes),
        unit: copy.durationUnit,
      },
    );
  }

  return (
    <Readout
      title={copy.readoutTitle}
      tag={copy.readoutTag}
      rows={rows}
      footnote={homeYearLabel(copy.note, data)}
      index={index}
    />
  );
}
