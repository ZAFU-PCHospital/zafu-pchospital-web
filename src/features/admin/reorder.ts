import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/api/errors";
import { movedManyIds } from "@/lib/list-order";
import type { ReorderDirection } from "@/types/contracts";

/**
 * 列表排序的两个共用动作（M6 第三轮验收）。
 *
 * 技能标签与故障分类都需要「顺序」，但**不该让人填序号**：填 `10 / 20 / 30` 来管理顺序，
 * 是把系统的活儿推给使用者，插一个中间项时还得回头改其他人的数字。
 * 界面改成一行两个按钮（上移 / 下移），服务端只负责把这一格挪动一位。
 *
 * 两条实现约定：
 * 1. **写成稠密序号**（`0..n-1`）。历史数据里的序号可能是全 0（早期 create 用默认值）
 *    或 `10/20/30` 的间隙；只交换两行的 `sortOrder` 在重复序号下会「看起来没反应」。
 * 2. 已经在首/末位时**幂等成功**（返回 `null`），不报错、不写审计 ——
 *    用户点了一个不会改变任何东西的按钮，不该收到一条错误。
 */

/** 两张支持排序的表的判别键。 */
export type SortableTable = "skills" | "repair_categories";

/** 取下一个可用序号（追加到末尾）。 */
export async function nextSortOrder(
  tx: Prisma.TransactionClient,
  table: SortableTable,
): Promise<number> {
  const max =
    table === "skills"
      ? (await tx.skill.aggregate({ where: { deletedAt: null }, _max: { sortOrder: true } }))._max
          .sortOrder
      : (
          await tx.repairCategory.aggregate({
            where: { deletedAt: null },
            _max: { sortOrder: true },
          })
        )._max.sortOrder;
  return (max ?? -1) + 1;
}

/**
 * 算出移动后的完整 id 顺序。
 *
 * 返回 `null` 表示「不需要移动」（目标已在边界），调用方应当幂等返回。
 * 目标 id 不在列表里则抛 `notFoundCode`。
 */
export function reorderedIds(
  ids: readonly string[],
  targetId: string,
  direction: ReorderDirection,
  notFoundCode: "SKILL_NOT_FOUND" | "RESOURCE_NOT_FOUND",
  notFoundMessage: string,
): string[] | null {
  const index = ids.indexOf(targetId);
  if (index < 0) throw new AppError(notFoundCode, notFoundMessage);
  const swapWith = direction === "UP" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= ids.length) return null;
  const next = [...ids];
  [next[index], next[swapWith]] = [next[swapWith], next[index]];
  return next;
}

/**
 * 算出「把 A 拖到 B 之前」之后的完整顺序（M6 第五轮验收）。
 *
 * 界面从「一行两个上移 / 下移按钮」改成**拖动排序**：拖动一次可能跨越好几格，
 * 一格一格调用上移会让服务端写 N 次、审计也写 N 条。这里一次算出最终顺序，
 * 调用方只写一次。
 *
 * `beforeId` 为 `null` 表示拖到末尾。返回 `null` 表示顺序没变（幂等成功，不写库）。
 */
export function movedIds(
  ids: readonly string[],
  targetId: string,
  beforeId: string | null,
  notFoundCode: "SKILL_NOT_FOUND" | "RESOURCE_NOT_FOUND",
  notFoundMessage: string,
): string[] | null {
  return movedRowIds(ids, [targetId], beforeId, notFoundCode, notFoundMessage);
}

/**
 * 同一件事的**多行版本**（M6 第九轮：成员表勾选多行后一起拖动）。
 *
 * 排序规则在 `lib/list-order.ts` 里只写了一份 —— 界面松手时要先用同一套规则做乐观更新，
 * 两边不一致就会出现「松手后跳一下再弹回去」。这里只负责把「未知 id」翻译成错误码。
 */
export function movedRowIds(
  ids: readonly string[],
  movingIds: readonly string[],
  beforeId: string | null,
  notFoundCode: "SKILL_NOT_FOUND" | "RESOURCE_NOT_FOUND",
  notFoundMessage: string,
): string[] | null {
  const { order, unknown } = movedManyIds(ids, movingIds, beforeId);
  if (unknown.length > 0) throw new AppError(notFoundCode, notFoundMessage);
  return order;
}
