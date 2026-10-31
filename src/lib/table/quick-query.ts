import type { TableQueryState } from "./query-state";

export type QuickField = {
  key: string;
  label: string;
  options?: readonly { value: string; label: string }[];
  placeholder?: string;
  maxLength?: number;
};

export type StatusTabs = {
  key: string;
  label: string;
  options: readonly { value: string; label: string }[];
};

/** 关键字单独收起，状态页签不再重复出现在「更多筛选」。 */
export function splitQuickFields(quick: readonly QuickField[], statusKey = "") {
  const search = quick.find((field) => field.key === "query");
  return {
    search,
    fields: quick.filter((field) => field.key !== search?.key && field.key !== statusKey),
  };
}

export function withFixedValue<F extends Record<string, string>>(
  value: TableQueryState<F>,
  key: string,
  raw: string,
  trim = false,
): TableQueryState<F> {
  const fixed: Record<string, string> = { ...value.fixed, [key]: trim ? raw.trim() : raw };
  return { ...value, fixed: fixed as F };
}

export function applyQuickFields<F extends Record<string, string>>(
  value: TableQueryState<F>,
  fields: readonly QuickField[],
  values: Readonly<Record<string, string>>,
): TableQueryState<F> {
  const fixed: Record<string, string> = { ...value.fixed };
  for (const field of fields) fixed[field.key] = (values[field.key] ?? "").trim();
  return { ...value, fixed: fixed as F };
}

/** 清除筛选只清条件，保留排序与分组；重置查询由页面传入的完整 reset 处理。 */
export function clearFilterConditions<F extends Record<string, string>>(
  value: TableQueryState<F>,
): TableQueryState<F> {
  const fixed: Record<string, string> = {};
  for (const key of Object.keys(value.fixed)) fixed[key] = "";
  return { ...value, fixed: fixed as F, filters: [] };
}

export function removeAdvancedFilter<F extends Record<string, string>>(
  value: TableQueryState<F>,
  index: number,
): TableQueryState<F> {
  return { ...value, filters: value.filters.filter((_, current) => current !== index) };
}
