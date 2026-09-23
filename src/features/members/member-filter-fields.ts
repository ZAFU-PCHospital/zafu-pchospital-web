import type { FilterableFields } from "@/lib/api/list-filter";

/**
 * 成员列表能筛的列与各自支持的运算符。
 *
 * **单独成文件**是为了让前端表单与后端校验共用同一份定义，同时不让客户端 bundle
 * 牵连服务端的取值映射（`member-filter.ts` 里有 Prisma `where` 与日期解析）。
 * 与 `MEMBER_SORTABLE` 同一模式。
 *
 * 与既有固定筛选（`query` / `status` / `role`）的关系：
 *
 * - `query` 是**跨列关键字搜索**（姓名 / 昵称 / 学号 / 班级 / 脱敏联系方式 OR 起来），
 *   列级筛选是**逐列的精确条件**，两者语义不同，可以同时用；
 * - `role` 是关联（一个成员可有多个角色），不是列，因此不在列级白名单里，
 *   留在固定筛选条里 —— 这也是「列级筛选替代不了固定筛选」的那部分；
 * - `status` 两边都能表达：固定条里保留它（单值枚举一个下拉最快），
 *   列级也开放（需要「不等于某状态」这类条件时用）。
 */
export const MEMBER_FILTERABLE: FilterableFields = {
  status: ["eq", "neq"],
  realName: ["contains"],
  nickname: ["contains"],
  studentId: ["contains"],
  className: ["contains"],
  joinedAt: ["gte", "lte"],
};
