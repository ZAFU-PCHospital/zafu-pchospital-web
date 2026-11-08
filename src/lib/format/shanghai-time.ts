/**
 * Asia/Shanghai 时间展示与自然日键（服务层提示文案与前端共用）。
 *
 * 放在 `lib/format` 而不是 `config/` 或某个组件目录：这些是纯格式化逻辑，
 * 服务层（错误文案里的开放时刻）与展示层（活动时间、出勤名单）都要用，
 * 只保留一份实现，避免多处逐字重复。
 */

/** 完整日期时间（`2026/10/01 13:30`），按 Asia/Shanghai 取。 */
export function formatShanghaiDateTime(value: Date | string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

/** 仅时刻（`13:30`），用于出勤成员名单等已知日期的场景。 */
export function formatShanghaiTime(value: Date | string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

/** 自然日键（`YYYY-MM-DD`），只用于比较两个时刻是否同一天。 */
export function shanghaiDayKey(value: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
