import type { FilterOp } from "@/lib/api/list-filter";
import type { FilterRule } from "@/lib/api/list-filter";
import type { ReactNode } from "react";

/** 表格列、查询与编辑的公共契约。 */

/** 排序方向。与查询参数 `sort=<field>:<asc|desc>` 一一对应。 */
export type SortDirection = "asc" | "desc";

/** 一条排序规则。`field` 必须落在该表的可排序白名单里（服务端同样要校验）。 */
export type SortRule = { field: string; direction: SortDirection };

export type TableListOptions = { sort?: SortRule[]; filters?: FilterRule[]; groupBy?: string };
export type TableGroupSummary = {
  field: string;
  counts: { value: string | null; count: number }[];
};
export type TableListExtras = { summary?: TableGroupSummary };

/**
 * 列表查询契约：分页 + 关键字 + 排序。
 *
 * 与既有 `PaginationInput` 的关系：分页沿用 `page` / `pageSize`（由 `parsePagination`
 * 解析，1–100）；关键字沿用既有的 `query` 参数名，**不新造 `keyword`** ——
 * 改名会让已经接线的六个列表与 `docs/contracts/api-v1.md` 一起返工。
 *
 * 各表自己的筛选值（`status` / `role` / `categoryId` …）**不进这个类型**：
 * 它们由各自的 `*-http.ts` 按白名单解析，内核不重复实现筛选项。
 */
export type ListQuery = {
  page: number;
  pageSize: number;
  query?: string;
  sort: SortRule[];
};

/**
 * 单次查询允许携带的排序字段数上限。
 *
 * 上限的理由不是性能，而是**界面可解释性**：多字段排序里排在第二、第三位的字段
 * 只有打开排序面板才看得见，多了就没人说得清「现在到底按什么排」。
 */
export const MAX_SORT_RULES = 3;

/**
 * 字段类型。命名对齐飞书多维表格的字段类型，供内核推导默认行为
 * （是否可排序、数值与日期用等宽数字、将来用哪种就地编辑器）。
 *
 * `readonly` 覆盖飞书的公式 / 查找引用 / 创建时间 / 创建人一类**不可编辑**字段 ——
 * 它们能显示、能被排序，但永远不参与就地编辑。
 */
export type FieldKind =
  | "text"
  | "longText"
  | "number"
  | "date"
  | "datetime"
  | "select"
  | "multiSelect"
  | "user"
  | "boolean"
  | "phone"
  | "attachment"
  | "readonly";

/**
 * 一列的完整定义。
 *
 * 这里**不设 `formatter` 之类的间接层**：渲染直接给一个 `render`。
 * 因为每个列表的空值、截断、徽标、图标规则本来就不同（成员表的「技能标签」要截成
 * 两枚 + `+N`，维修表的「内容」要单行省略）。内核只负责把结果放进正确的 `<td>`，
 * 并补上 `data-label`（≤1100px 的卡片式降级依赖它）。
 */
export type FieldSpec<T, C = unknown> = {
  /** 列 id。同时是排序 / 筛选参数里的字段名，必须与 API 契约一致。 */
  key: string;
  /** 表头文案；同时作为 `data-label`（移动端卡片式降级时每个值前面显示的字段名）。 */
  label: string;
  /**
   * 表头里**额外**给读屏的一句文案，渲染成 `<span class="sr-only">`。
   *
   * 用在「表头没有可见文案、但这一列需要一个列名」的列上 —— 典型是行首的拖动/选择列：
   * 表头是空的（`label: ""`，写了字就会把这一列撑宽、像素就动了），
   * 可读屏用户仍然需要知道这一列是干什么的。
   *
   * `sr-only` 是绝对定位 + 裁剪，不参与布局，因此加它与不加**像素完全一致**。
   * 它只影响表头；`data-label` 仍然取 `label`（空的 `label` 不会写出空属性）。
   */
  headLabel?: string;
  kind: FieldKind;
  /**
   * 默认列宽（px）。**可选**，因为它决定的是两种不同的布局模式：
   *
   * - 声明了列宽 → 内核输出 `<colgroup>`，配合 `useColumnResize` 可以拖拽（成员表）；
   * - 不声明 → **不输出 `<colgroup>`**，列宽交给浏览器按内容分配。审计日志这类只读表
   *   今天就是这个行为，迁移不该顺手把它的布局改掉。
   *
   * 用户拖过列宽之后由 `useColumnResize` 的持久化值覆盖声明值。
   */
  width?: number;
  /**
   * 单元格内容。第二个参数是**列表内的连续行号**（无限下翻时接着往下编）；
   * 第三个参数是页面通过 `<AdminTable renderContext={…}>` 传进来的运行时上下文
   * （行首选择控件的 props、跳详情的回调这类**每次渲染都会变**的东西）。
   *
   * 为什么不让 spec 直接闭包捕获这些值：spec 一旦依赖它们，它的引用就会随「选中了哪几行」
   * 变化，而以 spec 派生的列清单为依赖的 `useColumnResize` 就会重跑列宽对齐 ——
   * 每勾一行重跑一次，既浪费又容易在拖动中打架。spec 因此保持**模块级常量**。
   */
  render: (row: T, index: number, context: C) => ReactNode;
  /** 显式指定表头与单元格类名。 */
  headClassName?: string;
  /** 数据单元格 `<td>` 的附加 class（例如成员表首列的 `admin-table__member`）。 */
  cellClassName?: string;
  /**
   * 排序字段名（API 契约里的字段名）。默认等于 {@link FieldSpec.key}。
   *
   * 需要它是因为**列 id 与 API 字段并不总是一一对应**：成员表首列是复合单元格
   * （行首手柄 + 序号 + 复选框 + 姓名 + 昵称 + 「查看」），列 id 叫 `member`
   * 描述的是「这一格长什么样」，而它能排序的字段是 API 的 `realName`。
   *
   * 列 id 另有用途（列宽偏好按 id 存储、拖动竖线按 id 定位），因此**不能为了对齐
   * API 字段而改列 id** —— 改了会让使用者已保存的列宽全部失效。两者分开表达。
   */
  sortKey?: string;
  /** 复合列的排序口径说明，作为列头排序按钮的提示与无障碍名称。 */
  sortDescription?: string;
  /** 等宽数字（`admin-table__num`），单元格仍左对齐。默认由 `kind` 推导，可显式覆盖。 */
  numeric?: boolean;
  /** 是否可作为排序字段。默认由 `kind` 推导；`false` 表示这列不参与排序。 */
  sortable?: boolean;
  /** `<td title>`：被截断列的完整值（班级、长文本）。 */
  title?: (row: T) => string | undefined;
  /** 默认隐藏（列设置里可以打开）。 */
  hidden?: boolean;
  /** 冻结列。P2 接 `position: sticky`，P0 只记录意图、不产生视觉变化。 */
  frozen?: boolean;
  /** 仅标量单元格支持就地编辑；返回 null 表示当前不可编辑，复合字段在详情中编辑。 */
  editable?: (row: T, context: C) => CellEdit | null;
  /**
   * 列级筛选：这一列能不能加条件、能用哪些运算符、值用什么控件。
   *
   * 不声明 = 这一列不参与列级筛选（关联列、聚合列、只读列都属于这类）。
   * 后端白名单必须同时有它，否则条件会被 400 拒掉。
   */
  filter?: FieldFilterSpec;
};

/**
 * 一列的**列级筛选**声明（`FieldSpec.filter`）。
 *
 * 运算符与后端白名单是同一份来源（各领域下的 filter-fields 模块，
 * 例如 src/features/members/member-filter-fields.ts），因此不会出现
 * 「界面能选、后端 400」。
 */
export type FieldFilterSpec = {
  /**
   * 后端的筛选字段名：默认与列 id 相同。
   *
   * 与 `sortKey` 同一个道理 —— 列 id 说的是「这一格长什么样」，API 字段名是契约。
   * 成员首列的 id 是 `member`（格子里有手柄、姓名、昵称、查看按钮），
   * 后端认的却是 `realName`。
   */
  key?: string;
  /**
   * 这一列支持的运算符。**必须**与后端白名单逐项一致（界面给多了就是必然 400 的入口，
   * 给少了则是「明明支持却选不出来」）。同一列的运算符要求**同一种值形态**：
   * 枚举列给 `eq` / `neq`，日期列给 `gte` / `lte` —— 换运算符不该让已填的值失效。
   */
  ops: readonly FilterOp[];
  /**
   * 值的输入形态 —— 决定界面上给什么控件：
   * - `text`：文本框（配 `contains`）；
   * - `enum`：下拉（配 `eq` / `neq`），选项由 spec 给（值 + 文案）；
   * - `date`：日期框（配 `gte` / `lte`），值一律 `YYYY-MM-DD`。
   */
  input:
    | { kind: "text"; placeholder?: string }
    | { kind: "enum"; options: readonly { value: string; label: string }[] }
    | { kind: "date" }
    | { kind: "number" };
};

/**
 * 就地编辑的一次会话（由 {@link FieldSpec.editable} 产出）。
 *
 * 内核负责交互（点击进入、Enter 提交、Esc 取消、失焦提交）与「零位移」的编辑框，
 * spec 只负责回答两件事：**当前值是什么**、**怎么提交**。
 */
export type CellEdit = {
  /** 进入编辑态时的当前值（输入框的初始值）。 */
  initial: string;
  /** 读屏用的行标识（如「张三」），拼进「编辑班级：张三」这样的无障碍名称。 */
  rowLabel: string;
  /**
   * 提交新值。**抛错表示没成功**：内核会退出编辑态并回调 `onEditError`
   * （错误文案由页面决定，内核不写文案）。
   */
  commit: (next: string) => Promise<void>;
};

/** 一张表的视图定义。新增一张后台表 = 新增一份这个对象。 */
export type TableViewSpec<T, C = unknown> = {
  /** 稳定 id（`members` / `repairs`…），用于列宽与列设置的存储键。 */
  id: string;
  /** 表格标题，同时作为 `<caption class="sr-only">` 供读屏用户。 */
  title: string;
  /** 行唯一键。用于 React key，以及写操作后「按 id 重新定位」（不缓存行号）。 */
  rowKey: (row: T) => string;
  fields: readonly FieldSpec<T, C>[];
};
