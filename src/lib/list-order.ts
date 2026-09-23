/**
 * 列表拖动排序的**排序规则**（唯一实现，客户端与服务端共用）。
 *
 * 为什么要单独一个纯函数模块：拖动排序现在是**乐观更新** —— 松手的一瞬间界面先按
 * 本地规则把顺序改掉，再把落点发给服务端。两边如果各写一套规则，用户就会看到
 * 「松手后跳了一下又弹回去」；这类不一致极难复现，干脆让两边调同一个函数。
 *
 * 本文件**不得**引入 Prisma / AppError / React：它同时被客户端组件与服务端 Service 引用。
 * 带错误码的那层包装在 `features/admin/reorder.ts`（服务端专用）。
 */

export type MoveOrder = {
  /** 移动后的完整顺序；`null` 表示顺序没有变化（幂等成功，不必写库）。 */
  order: string[] | null;
  /** 出现在 `movingIds` 或 `beforeId` 里、但不在 `ids` 里的 id（调用方据此报 404）。 */
  unknown: string[];
};

/**
 * 把 `movingIds` 整体挪到 `beforeId` 之前（`beforeId` 为 `null` = 挪到末尾）。
 *
 * 三条规则：
 * 1. **保持移动块内部的相对顺序**（按它们在 `ids` 里的原有先后）。
 * 2. `beforeId` 必须**不在** `movingIds` 里。这条由调用方保证：界面算落点时会跳过
 *    被移动的那几行（否则「插到自己前面」是个没有意义的落点）。万一传进来了，
 *    按「位置不变」处理，不报错也不乱动。
 * 3. 未知 id 只收集不抛错 —— 抛错要用到服务端的 `AppError`，这个模块要能在浏览器里跑。
 */
export function movedManyIds(
  ids: readonly string[],
  movingIds: readonly string[],
  beforeId: string | null,
): MoveOrder {
  const known = new Set(ids);
  const moving = ids.filter((id) => movingIds.includes(id));
  const unknown = [...movingIds.filter((id) => !known.has(id))];
  if (beforeId !== null && !known.has(beforeId)) unknown.push(beforeId);
  if (unknown.length > 0) return { order: null, unknown };
  if (moving.length === 0) return { order: null, unknown: [] };
  // 落点落在移动块自己身上：位置不变（幂等）。
  if (beforeId !== null && movingIds.includes(beforeId)) return { order: null, unknown: [] };

  const rest = ids.filter((id) => !movingIds.includes(id));
  const insertAt = beforeId === null ? rest.length : rest.indexOf(beforeId);
  const next = [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
  const unchanged = next.every((id, position) => id === ids[position]);
  return { order: unchanged ? null : next, unknown: [] };
}

/**
 * 一次拖动要移动哪些行。
 *
 * 界面规则：**拖的那一行在选中集合里、且选中不止一行时，整个选中集合一起移动**
 * （飞书那一套：勾几行再拖其中一行，几行一起走）；否则只移动拖的那一行。
 * 抽成函数是为了让「算落点的钩子」与「发请求的面板」用同一条判断，不会各算各的。
 */
export function movingRowIds(draggingId: string, selection: readonly string[]): string[] {
  if (selection.length > 1 && selection.includes(draggingId)) return [...selection];
  return [draggingId];
}

/**
 * 按给定的 id 顺序重排数组（乐观更新落地用）。
 *
 * `order` 里没有的项保持原有先后接在末尾：并发追加的新页不能被乐观更新弄丢。
 * `sort` 自 ES2019 起是稳定排序，所以这个「接在末尾」的顺序是确定的。
 */
export function applyOrder<T extends { id: string }>(
  items: readonly T[],
  order: readonly string[],
): T[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...items].sort(
    (left, right) =>
      (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );
}
