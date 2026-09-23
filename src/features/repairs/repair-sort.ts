import type { Prisma } from "@/generated/prisma/client";

import { AppError } from "@/lib/api/errors";
import type { SortRule } from "@/types/table";

/**
 * 维修记录列表的排序白名单与 `orderBy` 映射（与成员表同一形状，见 `member-sort.ts`）。
 *
 * **只列能排的字段**，两类刻意不开放：
 *
 * - `content` / `remark`（长文本）：按正文排序没有意义，而且 `ORDER BY` 大字段很贵；
 * - `photos` / `reviews`（一对多）：没有可比较的标量。
 *
 * 三个与成员表不同的地方，都写在这里免得踩：
 *
 * 1. **关联列按「名字」排**，不按外键：`memberName` → `memberProfile.realName`、
 *    `categoryName` → `category.name`。按 UUID 排对使用者没有意义；
 * 2. **可空列**（`repairDate` / `durationMinutes` / `result` / `category`）在 MySQL 里
 *    `ASC` 会把 `NULL` 排在**最前**、`DESC` 排最后。草稿没有维修日期，所以升序时草稿在最上面
 *    —— 这是 MySQL 的既定语义，不额外改写（改成 `NULLS LAST` 需要 `ORDER BY IS NULL`，
 *    会让索引失效）；
 * 3. **导出不复用这里的排序**：`RepairExportInput` 虽然继承了 `RepairListInput`，
 *    但导出服务的 `orderBy` 是固定的（按维修日期倒序），导出顺序不该由界面上的临时排序决定。
 */
export const REPAIR_SORTABLE = [
  "repairDate",
  "durationMinutes",
  "status",
  "result",
  "memberName",
  "categoryName",
  "createdAt",
] as const;

export type RepairSortField = (typeof REPAIR_SORTABLE)[number];

/** API 字段名 → Prisma `orderBy` 片段（关联列走关系，不是外键 id）。 */
const REPAIR_SORT_ORDER: Record<
  RepairSortField,
  (direction: SortRule["direction"]) => Prisma.RepairRecordOrderByWithRelationInput
> = {
  repairDate: (direction) => ({ repairDate: direction }),
  durationMinutes: (direction) => ({ durationMinutes: direction }),
  status: (direction) => ({ status: direction }),
  result: (direction) => ({ result: direction }),
  memberName: (direction) => ({ memberProfile: { realName: direction } }),
  categoryName: (direction) => ({ category: { name: direction } }),
  createdAt: (direction) => ({ createdAt: direction }),
};

/** 没有排序参数时的服务端默认顺序：最近的维修在前，`id` 兜底保证分页稳定。 */
export const REPAIR_DEFAULT_ORDER_BY: readonly Prisma.RepairRecordOrderByWithRelationInput[] = [
  { repairDate: "desc" },
  { createdAt: "desc" },
  { id: "desc" },
];

/**
 * 排序规则 → Prisma `orderBy`。两条约束与成员表完全一致：
 * 白名单校验（纵深防御，路由层已经拦过一次）+ **永远补 `id` tiebreaker**
 * （主排序键重复时名次不确定，无限下翻的分页会读重或漏行）。
 */
export function repairOrderBy(
  sort?: readonly SortRule[],
): Prisma.RepairRecordOrderByWithRelationInput[] {
  if (!sort || sort.length === 0) return [...REPAIR_DEFAULT_ORDER_BY];
  const orderBy = sort.map((rule) => {
    const build = REPAIR_SORT_ORDER[rule.field as RepairSortField];
    if (!build) throw new AppError("VALIDATION_FAILED", `sort 字段无效：${rule.field}`);
    return build(rule.direction);
  });
  orderBy.push({ id: "desc" });
  return orderBy;
}
