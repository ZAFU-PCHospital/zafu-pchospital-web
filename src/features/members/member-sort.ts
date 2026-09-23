import type { Prisma } from "@/generated/prisma/client";

import { AppError } from "@/lib/api/errors";
import type { SortRule } from "@/types/table";

/**
 * 成员列表的排序白名单与 `orderBy` 映射（后台表格内核的参考链路）。
 *
 * 这里是「一份白名单，两处使用」：`member-http.ts` 用它校验 URL 上的 `sort` 参数，
 * 前端表头用它决定哪一列的列名可以点。放在同一个模块里，就不会出现
 * 「界面能点、后端报 400」这种两边口径不一致的情况。
 *
 * **只列真实存在的列**。成员表界面上还有两列看起来能排序、实际不能：
 *
 * - `approvedRepairCount` / `approvedRepairMinutes`（「维修记录」列）是跨表聚合出来的
 *   （见 `member-repository.ts` 的 `approvedRepairStats`），按它排序要把聚合做成
 *   JOIN 或子查询，属独立变更；
 * - `skills` / `roles` / `contacts` 是关联或脱敏后的展示值，没有可比较的标量。
 *
 * 这三类在前端 spec 里显式写 `sortable: false`，**不给出一个必然报错的入口**。
 */
export const MEMBER_SORTABLE = [
  "realName",
  "nickname",
  "studentId",
  "className",
  "status",
  "joinedAt",
] as const;

export type MemberSortField = (typeof MEMBER_SORTABLE)[number];

/**
 * API 字段名 → 数据库列名。
 *
 * 目前一一对应，但**不直接拿字段名当列名**：接口字段是契约（对外稳定），
 * 列名是存储实现（可能重命名）。两者之间留一层映射，改存储时不必改契约。
 */
const MEMBER_SORT_COLUMN: Record<
  MemberSortField,
  keyof Prisma.MemberProfileOrderByWithRelationInput
> = {
  realName: "realName",
  nickname: "nickname",
  studentId: "studentId",
  className: "className",
  status: "status",
  joinedAt: "joinedAt",
};

/**
 * 没有排序参数时的服务端默认顺序：**管理员拖出来的 `sortOrder` 顺序**（第九轮验收），
 * 新建成员 `sortOrder = 0`，与当前位置为 0 的那位并列后靠 `createdAt desc` 排在最前 ——
 * 「新成员出现在最前面」这条老行为没有丢；`id` 再兜一层保证分页稳定。
 *
 * 它属于**服务端**而不是前端：前端若把这个默认值拼进 URL，第一次 GET 与后续 GET
 * 的口径就未必一致，无限下翻时会出现重复行或漏行。
 *
 * 与 `memberRepository.orderedIds`（拖动重排时读取整份顺序）必须**逐字一致** ——
 * 落点前后关系一旦与列表不一致，就会出现「拖到 A 前面，刷新后 A 还在我后面」。
 */
export const MEMBER_DEFAULT_ORDER_BY: readonly Prisma.MemberProfileOrderByWithRelationInput[] = [
  { sortOrder: "asc" },
  { createdAt: "desc" },
  { id: "desc" },
];

/**
 * 排序规则 → Prisma `orderBy`。
 *
 * 两条硬约束：
 * 1. **白名单**：不在 {@link MEMBER_SORTABLE} 里的字段抛 `VALIDATION_FAILED`。
 *    正常情况下 `member-http.ts` 已经拦掉，这里是纵深防御 —— 未来若有别的调用方
 *    直接构造 `MemberListInput`，也不会把字段名透传进 SQL。
 * 2. **永远保留 tiebreaker**：主排序键可以重复（同名的两个人、同一秒创建的两条记录），
 *    没有确定名次就没有稳定分页；`skip` / `take` 的分页会因此重复或漏行。
 */
export function memberOrderBy(
  sort?: readonly SortRule[],
): Prisma.MemberProfileOrderByWithRelationInput[] {
  if (!sort || sort.length === 0) return [...MEMBER_DEFAULT_ORDER_BY];
  const orderBy = sort.map((rule) => {
    const column = MEMBER_SORT_COLUMN[rule.field as MemberSortField];
    if (!column) throw new AppError("VALIDATION_FAILED", `sort 字段无效：${rule.field}`);
    return { [column]: rule.direction } as Prisma.MemberProfileOrderByWithRelationInput;
  });
  orderBy.push({ id: "desc" });
  return orderBy;
}
