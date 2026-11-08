/**
 * 上海日历日 `YYYY-MM-DD` 的唯一格式化入口。
 *
 * 表单的 `max={shanghaiToday()}` 与服务端「维修日期不得晚于今天」必须同一天：
 * 直接用 `toISOString()` 是 UTC，上海 00:00–08:00 会算成昨天，管理员早上填当天日期
 * 就会被 HTML 拦下来。
 */
export function shanghaiToday(): string {
  return shanghaiDateOf(new Date());
}

/** 指定时刻对应的上海日历日 `YYYY-MM-DD`（`shanghaiToday` 的参数化版本）。 */
export function shanghaiDateOf(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
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
