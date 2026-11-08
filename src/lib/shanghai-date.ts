/**
 * Asia/Shanghai 的日历日与时刻格式化（服务端提示文案与前端展示共用）。
 *
 * 全仓只保留这一份 `Intl.DateTimeFormat` 的上海时间实现：
 * - 日历日（`YYYY-MM-DD`）一律走 `shanghaiDateOf`；
 * - 展示用「日期时间 / 时刻」用下面的 `formatShanghaiDateTime` / `formatShanghaiTime`。
 *
 * 日历日不要用 `format()` 拼：地区数据会随浏览器 / ICU 版本变化，`format()` 不保证
 * `YYYY-MM-DD` 的形态，所以 `shanghaiDateOf` 用 `formatToParts` 逐段取。
 */

/**
 * 上海日历日 `YYYY-MM-DD`。
 *
 * 表单的 `max={shanghaiToday()}` 与服务端「维修日期不得晚于今天」必须同一天：
 * 直接用 `toISOString()` 是 UTC，上海 00:00–08:00 会算成昨天，管理员早上填当天日期
 * 就会被 HTML 拦下来。
 */
export function shanghaiToday(): string {
  return shanghaiDateOf(new Date());
}

/** 指定时刻对应的上海日历日 `YYYY-MM-DD`（`shanghaiToday` 的参数化版本）。 */
export function shanghaiDateOf(instant: Date | string): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  // 地区数据会随浏览器 / ICU 版本变化，format() 不保证 YYYY-MM-DD。
  const value = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** 把 ISO 时间戳 / Date 格式化为 `YYYY-MM-DD`（Asia/Shanghai），空值或非法输入返回占位。 */
export function formatShanghaiDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  return shanghaiDateOf(date);
}

/** 完整日期时间展示（`2026/10/01 13:30`），按 Asia/Shanghai 取。 */
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

/** 仅时刻展示（`13:30`），用于出勤成员名单等已知日期的场景。 */
export function formatShanghaiTime(value: Date | string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
