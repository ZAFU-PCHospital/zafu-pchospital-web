import { MAX_FILTER_RULES, isCompleteFilterRule, type FilterOp, type FilterRule } from "@/lib/api/list-filter";
import type { FilterFieldOption } from "@/lib/table/field-spec";

/**
 * 列级筛选弹层的**草稿状态**（P2 第二半）。
 *
 * 为什么把这块单独拿出来：弹层里「选列 / 选运算符 / 填值 / 删一条」全是**状态迁移**，
 * 与 React 和 DOM 无关。放在组件里就只能靠点击测试去覆盖，而这里放的是纯函数 ——
 * 换列之后旧值该留该清、运算符什么时候重置，这些判断可以直接被单元测试钉住
 * （项目没有 jsdom，测试用 `react-dom/server` 渲染，跑不了交互）。
 *
 * 一条铁律：**草稿只在「应用」时变成生效条件**。中途随意输入不触发请求 ——
 * 每敲一个字符取一次数，既是无谓的往返，也会让列表在打字过程中反复闪。
 *
 * 与 `isCompleteFilterRule` 的分工：这里只管「界面上的草稿」，合法性（白名单、
 * 运算符是否支持）由服务端的 `parseFilters` 说了算，界面不重复实现一遍白名单。
 */
export type FilterDraftRow = { field: string; op: FilterOp; value: string };

/** 从已生效的条件造出草稿（打开弹层时用）。**深拷贝**：草稿上的改动不该碰到生效条件。 */
export function draftFromRules(rules: readonly FilterRule[]): FilterDraftRow[] {
  return rules.map((rule) => ({ field: rule.field, op: rule.op, value: rule.value }));
}

/**
 * 空草稿。
 *
 * 刻意**不预置一行**：预置的那一行是空的，「应用」因此永远灰着，看起来像功能坏了；
 * 空状态配一句「还没有条件」+「添加条件」更直白。
 */
export function emptyDraft(): FilterDraftRow[] {
  return [];
}

/** 新加一行的默认值：第一列 + 它的第一个运算符（值必须由人填，不给默认）。 */
function defaultRow(fields: readonly FilterFieldOption[]): FilterDraftRow | null {
  const first = fields[0];
  if (!first) return null;
  // `filterFieldsOf` 已经滤掉没有运算符的列，`?? "eq"` 只是把类型收窄。
  return { field: first.key, op: first.ops[0] ?? "eq", value: "" };
}

/** 追加一条条件；已达上限或没有任何可筛列时返回原草稿（界面据此禁用「添加」）。 */
export function addDraftRow(
  draft: readonly FilterDraftRow[],
  fields: readonly FilterFieldOption[],
): FilterDraftRow[] {
  if (draft.length >= MAX_FILTER_RULES) return [...draft];
  const row = defaultRow(fields);
  if (!row) return [...draft];
  return [...draft, row];
}

/** 改第 `index` 行的若干字段。越界或行不存在时原样返回。 */
export function updateDraftRow(
  draft: readonly FilterDraftRow[],
  index: number,
  patch: Partial<FilterDraftRow>,
): FilterDraftRow[] {
  if (index < 0 || index >= draft.length) return [...draft];
  return draft.map((row, position) => (position === index ? { ...row, ...patch } : row));
}

/** 删掉第 `index` 行。 */
export function removeDraftRow(draft: readonly FilterDraftRow[], index: number): FilterDraftRow[] {
  return draft.filter((_row, position) => position !== index);
}

/**
 * 换列。
 *
 * 两件事同时可能发生，都收在这里而不是散在组件的 `onChange` 里：
 *
 * 1. **运算符**：新列不支持当前运算符就换成它的第一个（例如「包含」换成「状态」列之后
 *    只能用等于 / 不等于）；
 * 2. **值**：只在**控件形态相同且不是枚举**时保留。同样是文本框，换个列继续用旧值很顺手；
 *    而枚举换列（选项完全不同）与文本↔日期（格式不同）留着旧值就是一条看着填了、
 *    提交必然被拒的条件。
 */
export function changeDraftField(
  draft: readonly FilterDraftRow[],
  index: number,
  fieldKey: string,
  fields: readonly FilterFieldOption[],
): FilterDraftRow[] {
  const row = draft[index];
  const target = fields.find((field) => field.key === fieldKey);
  if (!row || !target) return [...draft];
  const previousKind = fields.find((field) => field.key === row.field)?.input.kind;
  const op = target.ops.includes(row.op) ? row.op : (target.ops[0] ?? "eq");
  const keepValue = target.input.kind !== "enum" && previousKind === target.input.kind;
  return updateDraftRow(draft, index, { field: fieldKey, op, value: keepValue ? row.value : "" });
}

/** 改运算符。同一列的运算符共享一种值形态（见 `FieldFilterSpec.ops`），因此值不动。 */
export function changeDraftOp(
  draft: readonly FilterDraftRow[],
  index: number,
  op: FilterOp,
): FilterDraftRow[] {
  return updateDraftRow(draft, index, { op });
}

/** 改值。 */
export function changeDraftValue(
  draft: readonly FilterDraftRow[],
  index: number,
  value: string,
): FilterDraftRow[] {
  return updateDraftRow(draft, index, { value });
}

/**
 * 每条都填完了没 —— 「应用」能不能点的唯一依据。
 *
 * 有一条没填完就**不给应用**，而不是只提交填好的那几条：后者会让界面上出现过一条
 * 看着生效、其实没提交的条件，而使用者只会以为筛选坏了。
 */
export function isDraftComplete(draft: readonly FilterDraftRow[]): boolean {
  return draft.every(isCompleteFilterRule);
}

/**
 * 草稿 → 生效条件。**调用前必须先过 `isDraftComplete`**（这里不重复判断，
 * 也不静默丢掉不完整的行）。
 *
 * 值两边去空白：粘贴进来的尾部空格在 `contains` 里是看不见的差异，却会让「明明匹配
 * 得上却搜不到」。
 */
export function draftToRules(draft: readonly FilterDraftRow[]): FilterRule[] {
  return draft.map((row) => ({ field: row.field, op: row.op, value: row.value.trim() }));
}
