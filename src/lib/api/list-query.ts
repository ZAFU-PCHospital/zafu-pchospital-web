import { AppError } from "@/lib/api/errors";
import { filterParamValues, type FilterRule } from "@/lib/api/list-filter";
import { parsePagination } from "@/lib/api/pagination";
import { MAX_SORT_RULES } from "@/types/table";
import type { ListQuery, SortDirection, SortRule } from "@/types/table";

/**
 * 列表查询参数的解析与拼装（P0）。
 *
 * 为什么要有这一层：六个后台列表目前各自在 `*-http.ts` 里解析分页、关键字与筛选，
 * **没有一个列表支持排序**（`docs/飞书多维表格调研.md` §5 把「表头排序」列为
 * 「建议但要单独立项」）。排序要落地就必须同时贯通「URL 参数 → 路由 → Service →
 * Repository」，与其在六个文件里各写一遍 `sort` 解析，不如把规则收在这里：
 * 白名单校验、方向校验、去重、上限，只写一次。
 *
 * 三条约定：
 * 1. **白名单强制**：不在 `sortable` 里的字段一律 `VALIDATION_FAILED`，
 *    绝不把用户字符串透传给查询（与 `member-http.ts` 的 `oneOf` 同一原则）。
 * 2. **纯函数、不碰 IO**：入参是 `URLSearchParams`，出参是 `ListQuery`，
 *    因此可以直接被单元测试覆盖，也不依赖 React。
 * 3. **服务端与客户端共用同一份规则**：客户端用 `cycleSortRule` / `listQueryParams`
 *    生成参数，服务端用 `parseListQuery` 解析参数，两边不会漂移。
 *
 * 放在 `src/lib/api/` 是与既有 `pagination.ts` 同级：它和分页一样属于
 * 「所有列表共用的请求参数处理」，不属于任何单一领域。
 */

/** `asc` / `desc` 的合法取值，用于校验方向。 */
const DIRECTIONS: readonly SortDirection[] = ["asc", "desc"];

/**
 * 解析 `sort` 参数：`sort=joinedAt:desc,realName:asc`。
 *
 * - 省略方向时按 `asc` 处理（`sort=joinedAt`）："按这列排" 是最常见的意图；
 * - 同一字段重复出现只保留第一条，后者**不覆盖**前者（避免静默改写用户意图）；
 * - 超过 {@link MAX_SORT_RULES} 抛错，**不静默截断** —— 截断会让用户以为
 *   第三顺位也在生效（与导出「超限即拒绝而不是截断」同一口径）。
 */
export function sortRules(value: string | null, sortable: readonly string[]): SortRule[] {
  if (!value) return [];
  const rules: SortRule[] = [];
  for (const token of value.split(",")) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(":");
    const field = separator === -1 ? trimmed : trimmed.slice(0, separator);
    const rawDirection = separator === -1 ? "" : trimmed.slice(separator + 1).trim();
    if (!sortable.includes(field)) {
      throw new AppError("VALIDATION_FAILED", `sort 字段无效：${field}`);
    }
    if (rawDirection && !(DIRECTIONS as readonly string[]).includes(rawDirection)) {
      throw new AppError("VALIDATION_FAILED", `sort 方向无效：${rawDirection}`);
    }
    if (rules.some((rule) => rule.field === field)) continue;
    rules.push({ field, direction: (rawDirection || "asc") as SortDirection });
    if (rules.length > MAX_SORT_RULES) {
      throw new AppError("VALIDATION_FAILED", `排序字段最多 ${MAX_SORT_RULES} 个`);
    }
  }
  return rules;
}

/** 把排序规则拼回 `sort` 参数值；无规则返回 `null`（调用方据此决定要不要写这个参数）。 */
export function sortParam(rules: readonly SortRule[]): string | null {
  if (rules.length === 0) return null;
  return rules.map((rule) => `${rule.field}:${rule.direction}`).join(",");
}

/** 某字段当前的排序方向；未参与排序返回 `null`。 */
export function sortDirectionOf(rules: readonly SortRule[], field: string): SortDirection | null {
  return rules.find((rule) => rule.field === field)?.direction ?? null;
}

/** `<th aria-sort>` 的取值。未排序返回 `undefined`（省略属性比 `"none"` 更干净）。 */
export function ariaSortOf(
  rules: readonly SortRule[],
  field: string,
): "ascending" | "descending" | undefined {
  const direction = sortDirectionOf(rules, field);
  if (direction === null) return undefined;
  return direction === "asc" ? "ascending" : "descending";
}

/**
 * 表头点击的三态循环：**未排序 → 升序 → 降序 → 未排序**。
 *
 * 为什么是三态而不是「升 / 降」两态：两态下用户没有办法回到「不排序」，只能刷新页面，
 * 而「按服务端默认顺序」本身是列表的一个正常状态（成员表默认按加入时间倒序），
 * 必须有入口退回去。
 *
 * 已达 {@link MAX_SORT_RULES} 时**不新增**字段：靠点击表头凑满三个排序字段这件事
 * 本身就很难向使用者解释清楚，宁可不动，也不要把已经设好的排序挤掉。
 */
export function cycleSortRule(rules: readonly SortRule[], field: string): SortRule[] {
  const index = rules.findIndex((rule) => rule.field === field);
  if (index === -1) {
    if (rules.length >= MAX_SORT_RULES) return [...rules];
    return [...rules, { field, direction: "asc" }];
  }
  if (rules[index].direction === "asc") {
    const next = [...rules];
    next[index] = { field, direction: "desc" };
    return next;
  }
  return rules.filter((rule) => rule.field !== field);
}

/**
 * 拼出交给 `adminFetch` 的查询串。
 *
 * 只写有值的参数：`page` / `pageSize` 恒有；`query` 去空白后为空则不写
 * （写一个空的 `query=` 会让服务端把「没填关键字」与「关键字是空串」当成两件事）。
 *
 * 另外两类参数属于「一张表自己的东西」，由调用方给：
 *
 * - `fixed`：快捷筛选条上的参数（成员表的 `status` / `role`、评论表的 `deleted`…）。
 *   它们不是通用契约的一部分，各表各不相同；值为空串或 `undefined` 时一律不写，
 *   理由与 `query` 相同；
 * - `filters`：列级筛选，**一条条件一个 `filter` 参数**（不是逗号分隔）。条件是用户输入
 *   （学号、班级名），可能自带逗号或冒号 —— 重复参数交给 `URLSearchParams` 编码，
 *   不自己发明转义规则。
 */
export function listQueryParams(
  query: ListQuery,
  extra: {
    fixed?: Readonly<Record<string, string | undefined>>;
    filters?: readonly FilterRule[];
  } = {},
): URLSearchParams {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  const keyword = query.query?.trim();
  if (keyword) params.set("query", keyword);
  const sort = sortParam(query.sort);
  if (sort) params.set("sort", sort);
  for (const [key, value] of Object.entries(extra.fixed ?? {})) {
    if (value) params.set(key, value);
  }
  for (const value of filterParamValues(extra.filters ?? [])) {
    params.append("filter", value);
  }
  return params;
}

/**
 * 服务端入口：URL 参数 → `ListQuery`。
 *
 * 分页复用 `parsePagination`（`page=1&pageSize=20`，`pageSize` 范围 1–100），
 * 因此排序支持**不需要**各路由重复实现分页校验。
 *
 * `defaultSort` 是「用户没点过表头时按什么排」，属于**服务端**语义：
 * 不能由前端拼进 URL —— 否则第一个 GET 与后续 GET 的排序口径不一致，
 * 无限下翻时会出现重复行或漏行。
 */
export function parseListQuery(
  params: URLSearchParams,
  options: { sortable: readonly string[]; defaultSort?: readonly SortRule[] },
): ListQuery {
  const { page, pageSize } = parsePagination(params);
  const parsed = sortRules(params.get("sort"), options.sortable);
  return {
    page,
    pageSize,
    query: params.get("query")?.trim() || undefined,
    sort: parsed.length > 0 ? parsed : [...(options.defaultSort ?? [])],
  };
}
