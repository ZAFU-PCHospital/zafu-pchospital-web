import { AppError } from "@/lib/api/errors";

/**
 * 列表的**列级筛选**参数（后台表格内核）。
 *
 * 与既有的「固定筛选」（`status` / `role` 这类各自命名、各写一份解析的参数）不同，
 * 这里是一套**通用契约**：`filter=<field>:<op>:<value>`，可重复出现。
 *
 * 为什么用重复参数而不是像 `sort` 那样逗号分隔：筛选值是**用户输入**（学号、班级、
 * 姓名），可能带逗号、冒号、空格。重复参数由 `URLSearchParams` 负责百分号编码，
 * 不需要自己发明转义规则 —— 发明转义规则的下一步一定是转义 bug。
 *
 * 三条约定：
 * 1. **白名单强制**：字段与运算符都必须在该表的 `FilterableFields` 里，
 *    否则 `VALIDATION_FAILED`（与 `sort` 同一原则，绝不把用户字符串透传给查询）；
 * 2. **值不许为空**：空值的「筛选」等于没筛，却会让界面上多出一条看着生效的条件；
 * 3. **条数上限**：超过 {@link MAX_FILTER_RULES} 拒绝而不是截断 —— 截断会让使用者
 *    以为第三条也在生效。
 */

/**
 * 支持的运算符。刻意保持很小：
 *
 * - `eq` / `neq`：枚举、布尔这类离散值；
 * - `contains`：文本（学号、班级、姓名、备注）；
 * - `gte` / `lte`：日期与数字区间。
 *
 * **不做**「正则」「模糊匹配多字段」「跨表条件」：前两个能把一次误输入变成全表扫描，
 * 第三个会让筛选的语义取决于表的关联图，都不是「加个条件」该有的复杂度。
 */
export const FilterOp = ["eq", "neq", "contains", "gte", "lte"] as const;
export type FilterOp = (typeof FilterOp)[number];

/** 一条筛选条件。`value` 保持字符串：类型解释归各表的映射层（日期 / 枚举 / 数字）。 */
export type FilterRule = { field: string; op: FilterOp; value: string };

/** 一张表声明「哪些字段能筛、各自支持哪些运算符」。前端表单与后端校验共用这一份。 */
export type FilterableFields = Readonly<Record<string, readonly FilterOp[]>>;

/** 单次查询最多几个条件（与排序同一考虑：多了没人说得清现在筛的是什么）。 */
export const MAX_FILTER_RULES = 5;

/**
 * 解析重复的 `filter` 参数。
 *
 * 值里允许出现冒号（例如时间戳、`a:b` 这样的正文），所以**只切前两个冒号**，
 * 其后整段都是值。
 */
export function parseFilters(
  values: readonly string[],
  filterable: FilterableFields,
): FilterRule[] {
  const rules: FilterRule[] = [];
  for (const raw of values) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const first = trimmed.indexOf(":");
    const second = first === -1 ? -1 : trimmed.indexOf(":", first + 1);
    if (first === -1 || second === -1) {
      throw new AppError("VALIDATION_FAILED", `filter 格式无效：${trimmed}`);
    }
    const field = trimmed.slice(0, first);
    const op = trimmed.slice(first + 1, second) as FilterOp;
    const value = trimmed.slice(second + 1);
    const allowed = filterable[field];
    if (!allowed) throw new AppError("VALIDATION_FAILED", `filter 字段无效：${field}`);
    if (!allowed.includes(op)) {
      throw new AppError("VALIDATION_FAILED", `filter 运算符无效：${field} 不支持 ${op}`);
    }
    if (!value.trim()) throw new AppError("VALIDATION_FAILED", `filter 值不能为空：${field}`);
    // 完全相同的条件出现两次没有意义（同一字段的**不同**运算符是合法的：
    // 日期区间就是 `gte` + `lte` 两条）。
    if (rules.some((rule) => rule.field === field && rule.op === op && rule.value === value)) {
      continue;
    }
    rules.push({ field, op, value });
    if (rules.length > MAX_FILTER_RULES) {
      throw new AppError("VALIDATION_FAILED", `筛选条件最多 ${MAX_FILTER_RULES} 条`);
    }
  }
  return rules;
}

/** 拼回 `filter` 参数值（每条一个），交给 `URLSearchParams.append` 编码。 */
export function filterParamValues(rules: readonly FilterRule[]): string[] {
  return rules.map((rule) => `${rule.field}:${rule.op}:${rule.value}`);
}

/** 等价判断用的签名（顺序敏感：条件顺序不同就是不同的查询）。 */
export function filterSignature(rules: readonly FilterRule[]): string {
  return rules.map((rule) => `${rule.field}:${rule.op}:${rule.value}`).join("|");
}

/** 追加一条条件；已达上限时返回原数组（界面据此禁用「添加」按钮，不静默丢弃）。 */
export function addFilterRule(
  rules: readonly FilterRule[],
  rule: FilterRule = { field: "", op: "eq", value: "" },
): FilterRule[] {
  if (rules.length >= MAX_FILTER_RULES) return [...rules];
  return [...rules, rule];
}

/** 改第 `index` 条条件（字段 / 运算符 / 值都可能被改）。 */
export function updateFilterRule(
  rules: readonly FilterRule[],
  index: number,
  patch: Partial<FilterRule>,
): FilterRule[] {
  return rules.map((rule, position) => (position === index ? { ...rule, ...patch } : rule));
}

/** 删掉第 `index` 条条件。 */
export function removeFilterRule(rules: readonly FilterRule[], index: number): FilterRule[] {
  return rules.filter((_rule, position) => position !== index);
}

/**
 * 一条条件是否可以提交：字段、运算符在界面上都选好、值也填了。
 *
 * 界面用它决定「应用」按钮能不能点 —— 与后端 `parseFilters` 的校验是两件事：
 * 这里只判断「填完了没」，合法性由服务端说了算（界面不重复实现白名单）。
 */
export function isCompleteFilterRule(rule: FilterRule): boolean {
  return Boolean(rule.field) && Boolean(rule.op) && Boolean(rule.value.trim());
}
