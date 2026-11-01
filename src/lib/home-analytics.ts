import type { PublicHomeAnalytics } from "@/types/contracts";

/** 学年标签由服务端在同一次统计里给出，标题与注脚必须使用同一段区间。 */
export function homeYearLabel(template: string, data: PublicHomeAnalytics): string {
  return template.replace("{academicYear}", data.academicYear.label);
}

/** 首页统计与 Hero 读数共用的小时换算，避免两处四舍五入口径不一致。 */
export function formatRepairDurationHours(minutes: number): string {
  return (minutes / 60).toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}
