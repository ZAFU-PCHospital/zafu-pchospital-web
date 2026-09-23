import type { Prisma } from "@/generated/prisma/client";

import { parseUtcDateFilter } from "@/lib/api/date-filter";
import { AppError } from "@/lib/api/errors";
import type { FilterRule } from "@/lib/api/list-filter";
import { MemberStatus } from "@/types/contracts";

/**
 * 成员列表的**列级筛选**白名单与 `where` 映射（后台表格内核的参考实现）。
 *
 * 白名单本身在 `member-filter-fields.ts`（前端表单也要用，不能牵连这里的 Prisma 映射）；
 * 本文件只负责「条件 → `where`」以及**取值校验**（枚举取值、日期格式）。
 *
 * 与既有固定筛选（`query` / `status` / `role`）的关系：
 *
 * - `query` 是**跨列的关键字搜索**（姓名 / 昵称 / 学号 / 班级 / 脱敏联系方式 OR 起来），
 *   列级筛选是**逐列的精确条件**，两者语义不同，可以同时用；
 * - `role` 是关联（一个成员可有多个角色），不是列，因此不在列级白名单里，
 *   留在固定筛选条里 —— 这也是「列级筛选替代不了固定筛选」的那部分；
 * - `status` 两边都能表达：固定条里保留它（单值枚举用一个下拉最快），
 *   列级也开放（需要「不等于某状态」这类条件时用）。
 */
/**
 * 筛选条件 → Prisma `where` 片段（调用方放进 `AND`）。
 *
 * 值在这里解释：枚举要校验取值、日期要按 `Asia/Shanghai` 自然日解释
 * （**结束日包含全天**，用「次日 00:00 排他上界」表达 —— 见 `parseUtcDateFilter` 的注释，
 * 直接写 `lte: new Date(value)` 会把当天 08:00 之后的记录全排除，界面上表现为
 * 「筛同一天得到 0 条」）。
 */
export function memberFilterWhere(rules: readonly FilterRule[]): Prisma.MemberProfileWhereInput[] {
  return rules.map((rule) => {
    switch (rule.field) {
      case "status": {
        const value = memberStatus(rule.value);
        return rule.op === "eq" ? { status: value } : { status: { not: value } };
      }
      case "realName":
        return { realName: { contains: rule.value } };
      case "nickname":
        return { nickname: { contains: rule.value } };
      case "studentId":
        return { studentId: { contains: rule.value } };
      case "className":
        return { className: { contains: rule.value } };
      case "joinedAt": {
        // 两个运算符各用半边区间：`gte` 取当天 00:00（含），`lte` 取次日 00:00（不含）。
        const range =
          rule.op === "gte"
            ? parseUtcDateFilter(rule.value, undefined, "加入时间")
            : parseUtcDateFilter(undefined, rule.value, "加入时间");
        return { joinedAt: { gte: range.gte, lt: range.lt } };
      }
      default:
        // 路由层已经拦过一次；这里是纵深防御（未来若有别的调用方直接构造输入）。
        throw new AppError("VALIDATION_FAILED", `filter 字段无效：${rule.field}`);
    }
  });
}

function memberStatus(value: string): string {
  if (!(MemberStatus as readonly string[]).includes(value)) {
    throw new AppError("VALIDATION_FAILED", `成员状态无效：${value}`);
  }
  return value;
}
