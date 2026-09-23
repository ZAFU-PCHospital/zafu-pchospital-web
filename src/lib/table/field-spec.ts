import type { FilterOp } from "@/lib/api/list-filter";
import type { FieldFilterSpec, FieldKind, FieldSpec, TableViewSpec } from "@/types/table";

/**
 * 字段类型的默认行为（P0）。
 *
 * 这些默认值存在的意义是**不要每张表都重复声明同一件事**：成员表的「加入时间」、
 * 维修表的「维修日期」都该右对齐 + 等宽数字，这是字段类型的性质，不是某张表的选择。
 * 但默认值**一律可以被 spec 显式覆盖** —— 内核不替产品做决定。
 *
 * 只放纯函数：没有 React、没有 IO，因此可以直接被单元测试覆盖。
 */

/**
 * 右对齐 + 等宽数字的字段类型。
 *
 * 只有能纵向比大小的类型才右对齐：数字、日期、日期时间。**文本类一律左对齐**，
 * 包括看起来像数字的学号 —— 学号是对比用的标识符，不是量。
 * （与 `docs/飞书多维表格调研.md` §4 的第 12 条同一判断：飞书本身也不居中。）
 */
const NUMERIC_KINDS: readonly FieldKind[] = ["number", "date", "datetime"];

/** 该字段是否默认右对齐（`admin-table__num`）。 */
export function defaultNumeric(kind: FieldKind): boolean {
  return NUMERIC_KINDS.includes(kind);
}

/**
 * 该字段是否默认可排序。
 *
 * `readonly` 之外的字段都可排序 —— 包括文本（按拼音/字典序）与标签列。
 * 只读字段（公式、查找引用、创建时间这类由系统产出的值）能否排序取决于后端：
 * 默认关闭，需要时在 spec 里显式写 `sortable: true`，避免界面给出一个必然报错的入口。
 */
export function isFieldSortable<T, C>(field: FieldSpec<T, C>): boolean {
  return field.sortable ?? field.kind !== "readonly";
}

/** 该字段的排序字段名：默认与列 id 相同，复合列可用 `sortKey` 指定（见 `FieldSpec.sortKey`）。 */
export function sortKeyOf<T, C>(field: FieldSpec<T, C>): string {
  return field.sortKey ?? field.key;
}

/**
 * 该表的可排序字段白名单。
 *
 * 客户端用它决定表头能不能点，服务端用它校验 `sort` 参数 —— **同一份白名单**，
 * 因此不会出现「界面能点、后端报 400」这种两边口径不一致的情况。
 *
 * 返回的是**排序字段名**（`sortKeyOf`）而不是列 id：白名单对齐的是 API 契约。
 */
export function sortableFields<T, C>(spec: TableViewSpec<T, C>): string[] {
  return spec.fields.filter((field) => isFieldSortable(field)).map((field) => sortKeyOf(field));
}

/**
 * 列显隐的初始状态：`hidden: true` 的字段默认不显示。
 *
 * 返回的是「整个字段清单」而不是「只列隐藏项」：列设置面板需要按完整顺序渲染开关，
 * 而 TanStack 的 `VisibilityState` 语义是「缺省即可见」，显式给全量能避免
 * 「新增一列之后，旧用户的偏好记录里没有它，于是它到底该不该显示」这种歧义。
 */
export function initialColumnVisibility<T, C>(spec: TableViewSpec<T, C>): Record<string, boolean> {
  return Object.fromEntries(spec.fields.map((field) => [field.key, field.hidden !== true]));
}

/**
 * 从 spec 派生出「能加条件的列」清单（顺序即列顺序）。
 *
 * 面板把它交给筛选弹层：弹层不需要认识 spec，只需要这份选项 + 文案。
 */
export function filterFieldsOf<T, C>(spec: TableViewSpec<T, C>): FilterFieldOption[] {
  return spec.fields
    .filter(
      (field): field is FieldSpec<T, C> & { filter: FieldFilterSpec } =>
        // 声明了 `filter` 却一个运算符都没给的列在这里被跳过：一个展开后选不出运算符的
        // 条目是坏入口，不是「暂时没有」。
        field.filter !== undefined && field.filter.ops.length > 0,
    )
    .map((field) => ({
      key: filterKeyOf(field),
      columnKey: field.key,
      label: field.label,
      ops: field.filter.ops,
      input: field.filter.input,
    }));
}

/**
 * 该字段的筛选字段名：默认与列 id 相同，复合列用 `FieldFilterSpec.key` 指定。
 *
 * 面板用它与后端白名单对齐（`sortableFields` ↔ `*_SORTABLE` 的同一模式）。
 */
export function filterKeyOf<T, C>(field: FieldSpec<T, C>): string {
  return field.filter?.key ?? field.key;
}

/**
 * 可筛选列在界面上的描述（`filterFieldsOf` 的产物）。
 *
 * 与行数据类型无关，因此**不带泛型参数** —— 弹层拿到它之后不需要认识 spec。
 */
export type FilterFieldOption = {
  /** 后端筛选字段名：写进 `filter=<field>:<op>:<value>` 的那一段。 */
  key: string;
  /** 列 id（`FieldSpec.key`）：选项唯一性与文案定位用它。 */
  columnKey: string;
  label: string;
  ops: readonly FilterOp[];
  input: FieldFilterSpec["input"];
};

/** 按 key 取字段定义；找不到返回 `undefined`（调用方必须处理，不要用 `!` 掩盖契约漂移）。 */
export function findField<T, C>(
  spec: TableViewSpec<T, C>,
  key: string,
): FieldSpec<T, C> | undefined {
  return spec.fields.find((field) => field.key === key);
}
