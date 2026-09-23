import { adminCopy } from "@/config/admin";

/**
 * 审计日志的展示格式（从 `AuditLogPanel` 里原样搬出来）。
 *
 * 为什么单独成文件：这三个函数是**渲染层的公共依赖** —— 表格 spec 与变更摘要窗口都要用，
 * 留在页面组件里会让 spec 反过来 import 组件。与 `src/config/member.ts` 的
 * `formatShanghaiDate` 同一处理。
 *
 * 顺带记一笔：`formatDateTime` 目前在七个后台面板里各有一份逐字相同的拷贝
 * （评论 / 报名 / 邀请码 / 公开设置 / 成员 / 审计…）。统一它们属于「其余面板迁移」
 * 的一部分，本轮不动 —— 一次只改一件事，免得 diff 里全是无关改动。
 */

/** 表格里只显示短 ID（8 位）；完整值在单元格的 `title` 里，需要时也能复制。 */
export function shortAuditId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/** 已知目标类型给中文名；未知的一律原样显示，不猜也不隐藏。 */
export function auditTargetLabel(targetType: string): string {
  const labels: Record<string, string> = adminCopy.audit.targetLabels;
  return labels[targetType] ?? targetType;
}

/** 审计时间是排查依据，精确到秒。 */
export function formatAuditDateTime(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(new Date(iso))
    .replace(/\//g, "-");
}
