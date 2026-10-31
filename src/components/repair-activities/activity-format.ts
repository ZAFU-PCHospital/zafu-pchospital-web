/** Asia/Shanghai 日期时间展示（公开/成员端共用）。 */
export function formatShanghaiDateTime(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** Asia/Shanghai 时间（时:分）展示，用于出勤成员名单。 */
export function formatShanghaiTime(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** 公开列表日期票根：月份、两位日、星期，统一按 Asia/Shanghai 取。 */
export function formatShanghaiDateParts(iso: string): {
  month: string;
  day: string;
  weekday: string;
} {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(iso));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    month: `${value("month")}月`,
    day: value("day"),
    weekday: value("weekday"),
  };
}

/**
 * 报名开始倒计时：拆成天/时/分/秒，供抢票式数字块渲染。
 *
 * 向上取整到秒：还剩不到 1 秒时不会先显示 00:00:00；负数按 0 处理。
 */
export function signupCountdownParts(remainingMs: number): {
  days: number;
  hours: string;
  minutes: string;
  seconds: string;
} {
  // 防御：解析失败 / 非有限值一律归零，绝不把 Infinity / NaN 渲染进数字块。
  if (!Number.isFinite(remainingMs)) {
    return { days: 0, hours: "00", minutes: "00", seconds: "00" };
  }
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return { days, hours: pad(hours), minutes: pad(minutes), seconds: pad(seconds) };
}
