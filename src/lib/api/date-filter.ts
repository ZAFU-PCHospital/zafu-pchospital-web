import { shanghaiDateToUtc } from "@/lib/academic-term";
import { AppError } from "@/lib/api/errors";

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC 半开区间 `[gte, lt)`；两端都可缺失，缺失即该侧不设限。 */
export type UtcDateFilter = { gte?: Date; lt?: Date };

/**
 * 把页面上两个 `YYYY-MM-DD` 输入框解析成 UTC 查询区间（M6 批次 2）。
 *
 * 三条约定：
 * 1. 日期按 `Asia/Shanghai` 自然日解释（中国大陆无夏令时，偏移恒为 +8），
 *    与 `lib/academic-term.ts` 的统计口径完全一致，不依赖服务器或浏览器时区；
 * 2. **结束日包含全天**，表达为排他上界「结束日次日 00:00」——
 *    这正是 `lte: new Date("2026-09-22")` 那种写法的问题所在：
 *    它把 9-22 当天 08:00 以后的记录全部排除，界面上表现为「筛同一天得到 0 条」；
 * 3. 起止都没填时返回空对象，调用方不要把它当成 `{}` 之外的条件拼进 `where`。
 */
export function parseUtcDateFilter(
  from: string | undefined,
  to: string | undefined,
  label = "日期",
): UtcDateFilter {
  const gte = from ? parseShanghaiDay(from, label) : undefined;
  const toDay = to ? parseShanghaiDay(to, label) : undefined;
  // +24h 即次日 00:00：上海无夏令时，不存在「某天有 23 或 25 小时」的情况。
  const lt = toDay ? new Date(toDay.getTime() + DAY_MS) : undefined;
  if (gte && lt && lt.getTime() <= gte.getTime()) {
    throw new AppError("VALIDATION_FAILED", `${label}结束不能早于开始`);
  }
  return { gte, lt };
}

function parseShanghaiDay(value: string, label: string): Date {
  const parsed = shanghaiDateToUtc(value);
  if (!parsed) throw new AppError("VALIDATION_FAILED", `${label}格式无效，应为 YYYY-MM-DD`);
  return parsed;
}

/** 供 `where` 直接使用：区间为空时返回 `undefined`，避免生成无意义的 `{}` 条件。 */
export function dateRangeWhere(filter: UtcDateFilter): { gte?: Date; lt?: Date } | undefined {
  return filter.gte || filter.lt ? filter : undefined;
}
