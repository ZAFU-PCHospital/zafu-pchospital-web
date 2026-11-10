import { filterParamValues, parseFilters, type FilterRule } from "@/lib/api/list-filter";
import { listQueryParams, sortParam, sortRules } from "@/lib/api/list-query";
import { tableField, type TableQueryOptions } from "@/config/table-queries";
import type { SortRule } from "@/types/table";

export type TableQueryState<F extends Record<string, string> = Record<string, string>> = {
  fixed: F;
  sort: SortRule[];
  filters: FilterRule[];
  groupBy: string;
};
export const emptyTableQuery = <F extends Record<string, string>>(
  fixed: F,
): TableQueryState<F> => ({ fixed: { ...fixed }, sort: [], filters: [], groupBy: "" });

/** 是否应用了会收窄结果的查询条件；排序 / 分组不算筛选。 */
export function hasActiveTableFilters(value: TableQueryState): boolean {
  return value.filters.length > 0 || Object.values(value.fixed).some((entry) => Boolean(entry));
}

/** 可分享 URL 严格只允许日期/枚举，不按“看起来不像个人信息”猜测文本值。 */
export function shareableTableParams(value: TableQueryState, options: TableQueryOptions) {
  const params = new URLSearchParams();
  const sort = sortParam(value.sort);
  if (sort) params.set("sort", sort);
  if (value.groupBy) params.set("groupBy", value.groupBy);
  for (const [key, entry] of Object.entries(value.fixed)) {
    const labels = tableField(options.id, key).labels;
    if (entry && labels && Object.hasOwn(labels, entry)) params.set(key, entry);
  }
  const safe = value.filters.filter((rule) => {
    const field = options.filters.find((field) => field.key === rule.field);
    return field?.input.kind === "enum"
      ? field.input.options.some((option) => option.value === rule.value)
      : field?.input.kind === "date" && /^\d{4}-\d{2}-\d{2}$/.test(rule.value);
  });
  for (const entry of filterParamValues(safe)) params.append("filter", entry);
  return params;
}

export function readTableParams<F extends Record<string, string>>(
  params: URLSearchParams,
  defaults: F,
  options: TableQueryOptions,
): TableQueryState<F> {
  const value = emptyTableQuery(defaults);
  for (const key of Object.keys(defaults)) {
    const raw = params.get(key);
    const labels = tableField(options.id, key).labels;
    if (raw && labels && Object.hasOwn(labels, raw))
      value.fixed[key as keyof F] = raw as F[keyof F];
  }
  try {
    value.sort = sortRules(params.get("sort"), options.sortable);
  } catch {
    /* 不恢复非法深链。 */
  }
  try {
    const parsed = parseFilters(params.getAll("filter"), options.filterable);
    value.filters = parseFilters(
      shareableTableParams({ ...value, filters: parsed }, options).getAll("filter"),
      options.filterable,
    );
  } catch {
    /* 非法 URL 条件不参与请求。 */
  }
  const group = params.get("groupBy");
  if (group && options.groups.includes(group)) value.groupBy = group;
  return value;
}

export function tableRequestParams(value: TableQueryState, page: number) {
  const params = listQueryParams(
    { page, pageSize: 20, query: value.fixed.query, sort: value.sort },
    { fixed: value.fixed, filters: value.filters },
  );
  if (value.groupBy) params.set("groupBy", value.groupBy);
  return params;
}
