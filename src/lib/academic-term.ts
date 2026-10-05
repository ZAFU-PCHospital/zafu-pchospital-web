/**
 * 学期区间配置解析与统一日期边界（M3 任务书 §6.2）。
 *
 * 规则：
 * - 两项均未配置 → 合法，学期统计返回 `UNCONFIGURED`；
 * - 只配置一项、格式非法、开始日晚于结束日 → 配置非法（启动校验失败）；
 * - 日期按 `Asia/Shanghai`（UTC+8，无夏令时）自然日解释，再转换为 UTC 查询边界；
 * - 结束日**包含全天**，统一表达为 `[startInclusive, endExclusive)`；
 * - 当前月同样按 `Asia/Shanghai` 自然月计算；
 * - 不依赖数据库服务器本地时区或浏览器时区；
 * - 区间是**时刻**，只可直接用于 `DATETIME` 列；`DATE` 列（`repairDate`）
 *   必须先经 {@link toDateOnlyBounds} 转成日期边界（见该函数说明）。
 */

import { AppError } from "@/lib/api/errors";

/** 中国标准时间相对 UTC 的固定偏移（小时）。中国大陆不分夏令时，恒为 UTC+8。 */
export const CHINA_UTC_OFFSET_HOURS = 8;

const SHANGHAI_OFFSET_MS = CHINA_UTC_OFFSET_HOURS * 60 * 60 * 1000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 半开区间 `[startInclusive, endExclusive)`，两端均为 UTC 时刻。 */
export type UtcRange = {
  startInclusive: Date;
  endExclusive: Date;
};

export type AcademicTermConfig =
  | { configured: false; reason: "MISSING" }
  | { configured: true; start: string; end: string; range: UtcRange };

export type AcademicTermParseResult =
  | { ok: true; config: AcademicTermConfig }
  | { ok: false; message: string };

/** 把「Asia/Shanghai 自然日 + 当天 00:00:00.000」转成 UTC 时刻。 */
function shanghaiDayStartToUtc(year: number, month: number, day: number): Date {
  // 先按 UTC 构造同一天的 00:00，再减去 8 小时偏移。
  // 这样避免依赖运行环境的本地时区（Date.UTC 恒定按 UTC 解释）。
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0) - SHANGHAI_OFFSET_MS);
}

/** 解析严格的 `YYYY-MM-DD`，并拒绝 2026-02-30 这类看似合法但日历上不存在的日期。 */
function parseShanghaiDate(
  raw: string,
): { ok: true; year: number; month: number; day: number } | { ok: false } {
  const match = DATE_PATTERN.exec(raw);
  if (!match) return { ok: false };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return { ok: false };
  // 校验真实存在：用 UTC 构造后回读，若不相等说明该日期不存在（如 2 月 30 日）。
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return { ok: false };
  }
  return { ok: true, year, month, day };
}

function readEnvValue(name: string): string {
  return (process.env[name] ?? "").trim();
}

/**
 * 解析学期配置。纯函数，不写缓存，便于单元测试覆盖五种情形。
 * 合法的「未配置」与「配置非法」是两种结果：前者 `ok: true`，后者 `ok: false`。
 */
export function parseAcademicTermConfig(
  rawStart: string | undefined,
  rawEnd: string | undefined,
): AcademicTermParseResult {
  const start = (rawStart ?? "").trim();
  const end = (rawEnd ?? "").trim();

  if (!start && !end) {
    return { ok: true, config: { configured: false, reason: "MISSING" } };
  }
  if (!start || !end) {
    const missing = !start ? "ACADEMIC_TERM_START" : "ACADEMIC_TERM_END";
    return { ok: false, message: `学期配置必须同时提供开始与结束日期，缺少 ${missing}` };
  }

  const parsedStart = parseShanghaiDate(start);
  if (!parsedStart.ok) {
    return { ok: false, message: `ACADEMIC_TERM_START 不是合法的 YYYY-MM-DD 日期：${start}` };
  }
  const parsedEnd = parseShanghaiDate(end);
  if (!parsedEnd.ok) {
    return { ok: false, message: `ACADEMIC_TERM_END 不是合法的 YYYY-MM-DD 日期：${end}` };
  }

  const startInclusive = shanghaiDayStartToUtc(parsedStart.year, parsedStart.month, parsedStart.day);
  // 结束日包含全天 → 排他上界 = 结束日次日 00:00（Asia/Shanghai）。
  const endExclusive = shanghaiDayStartToUtc(parsedEnd.year, parsedEnd.month, parsedEnd.day + 1);

  if (endExclusive.getTime() <= startInclusive.getTime()) {
    return { ok: false, message: `学期开始日期不得晚于结束日期：${start} → ${end}` };
  }

  return {
    ok: true,
    config: { configured: true, start, end, range: { startInclusive, endExclusive } },
  };
}

let cachedAcademicTerm: AcademicTermConfig | undefined;

/**
 * 读取并缓存学期配置。配置非法时抛 `ACADEMIC_TERM_CONFIG_INVALID`（500），
 * 使服务在启动/首次访问校验期即失败，而不是静默产出错误的统计。
 */
export function getAcademicTermConfig(): AcademicTermConfig {
  if (cachedAcademicTerm) return cachedAcademicTerm;
  const result = parseAcademicTermConfig(
    process.env.ACADEMIC_TERM_START,
    process.env.ACADEMIC_TERM_END,
  );
  if (!result.ok) {
    throw new AppError("ACADEMIC_TERM_CONFIG_INVALID", `学期配置无效：${result.message}`);
  }
  cachedAcademicTerm = result.config;
  return cachedAcademicTerm;
}

export function resetAcademicTermConfigForTests(): void {
  cachedAcademicTerm = undefined;
}

/** 读取原始值用于启动校验（不缓存，避免把非法配置缓存住）。 */
export function readAcademicTermEnv(): { start: string; end: string } {
  return {
    start: readEnvValue("ACADEMIC_TERM_START"),
    end: readEnvValue("ACADEMIC_TERM_END"),
  };
}

/**
 * 给定一个 UTC 时刻，返回它所在的 `Asia/Shanghai` 自然月区间。
 * 例：2026-09-01T00:00:00Z（上海时间 08:00）→ 2026-09 月
 *     2026-08-31T16:00:00Z（上海时间 09-01 00:00）→ 2026-09 月
 */
export function shanghaiMonthRange(instant: Date): UtcRange & { year: number; month: number } {
  // 平移到上海本地时间，再取其年月。
  const shanghai = new Date(instant.getTime() + SHANGHAI_OFFSET_MS);
  const year = shanghai.getUTCFullYear();
  const month = shanghai.getUTCMonth() + 1;
  const startInclusive = shanghaiDayStartToUtc(year, month, 1);
  // 下月 1 日 00:00（Asia/Shanghai）。Date.UTC 会自动进位 13 月 → 次年 1 月。
  const endExclusive = shanghaiDayStartToUtc(year, month + 1, 1);
  return { startInclusive, endExclusive, year, month };
}

/** 把 `YYYY-MM-DD` 的上海自然日转成 UTC 起始时刻；供页面格式化与测试使用。 */
export function shanghaiDateToUtc(date: string): Date | null {
  const parsed = parseShanghaiDate(date.trim());
  if (!parsed.ok) return null;
  return shanghaiDayStartToUtc(parsed.year, parsed.month, parsed.day);
}

/** 取某时刻所处的上海自然日，表达为该日的 UTC 零点。 */
function utcMidnightOfShanghaiDay(instant: Date): Date {
  const shanghai = new Date(instant.getTime() + SHANGHAI_OFFSET_MS);
  return new Date(
    Date.UTC(shanghai.getUTCFullYear(), shanghai.getUTCMonth(), shanghai.getUTCDate()),
  );
}

/**
 * 把上海自然日区间转成 **`DATE` 列可直接比较的日期边界**（issue #75）。
 *
 * 为什么必须有这一步：`repair_records.repair_date` 是 `@db.Date`（纯日历日），
 * 而 Prisma 的查询构造器（`count` / `findMany` / `groupBy` 的 `where`）会把过滤用的
 * `Date` **按 UTC 日历日截断**。区间两端是「上海某日 00:00」的 UTC 时刻（比日期早 8 小时），
 * 截断后就变成**前一个日期**，于是整个区间被向前挪一天：
 *
 * ```
 * 上海 2026-09 月：[2026-08-31T16:00Z, 2026-09-30T16:00Z)
 *   截断成日期后：[2026-08-31,      2026-09-30)      ← 少算了 9-30，多算了 8-31
 *   经本函数转换：[2026-09-01,      2026-10-01)      ← 正确
 * ```
 *
 * 表现为「上月末的记录被算进本月、本月末的记录不计入本月」（学期同理，
 * 学期前一天被算进来、学期末日被漏掉）。原生 SQL（`$queryRaw`，M5 的榜单与趋势走这条路）
 * 把参数按完整时刻比较，本就没有这个问题 —— 不转换的话，同一份数据在「摘要」与「榜单」
 * 里会得出两个不同的答案。
 *
 * 返回的两端都是 UTC 零点，因此在**两种语义下都恰好等于**上海自然日区间：
 * 被截断成日期时得到 `[2026-09-01, 2026-10-01)`，不被截断时得到等价的 `00:00:00` 时刻。
 *
 * **只可用于 `DATE` 列**（当前即 `repairDate`）；`createdAt` / `closedAt` 这类 `DATETIME`
 * 列仍应直接传区间时刻，否则会把当天 00:00 之后的记录漏掉。
 */
export function toDateOnlyBounds(range: UtcRange): { gte: Date; lt: Date } {
  return {
    gte: utcMidnightOfShanghaiDay(range.startInclusive),
    lt: utcMidnightOfShanghaiDay(range.endExclusive),
  };
}

/**
 * 单个上海自然日 `YYYY-MM-DD` → **`DATE` 列可直接比较的 UTC 零点**；非法日期返回 `null`。
 *
 * 与 {@link toDateOnlyBounds} 同一用途（见其说明）：需要「结束日包含全天」时，
 * 调用方自行 `+24h` 取次日零点作为排他上界。
 */
export function shanghaiDayToDateOnly(date: string): Date | null {
  const parsed = parseShanghaiDate(date.trim());
  if (!parsed.ok) return null;
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
}

/**
 * 以 `anchor` 所在上海自然月为**最后一个月**，向前取连续 `count` 个月的 `YYYY-MM`。
 *
 * 复用 `shanghaiMonthRange` 的年月推导，保证与本月/学期口径完全一致；
 * 数据库只聚出有数据的月份，缺失月份由调用方按真实 `0` 补齐（M5 任务书 §7）。
 */
export function recentShanghaiMonths(anchor: Date, count: number): string[] {
  if (count <= 0) return [];
  const { year, month } = shanghaiMonthRange(anchor);
  const months: string[] = [];
  // 用「绝对月序号」做加减，避免手工处理跨年进位。
  const anchorIndex = year * 12 + (month - 1);
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const index = anchorIndex - offset;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    months.push(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`);
  }
  return months;
}
