"use client";

import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { useMemo, useState, type ComponentPropsWithoutRef, type ReactNode, type Ref } from "react";

import { ariaSortOf, cycleSortRule } from "@/lib/api/list-query";
import { defaultNumeric, isFieldSortable, sortKeyOf } from "@/lib/table/field-spec";
import type { CellEdit, FieldSpec, SortRule, TableViewSpec } from "@/types/table";

/** 根据 TableViewSpec 渲染表格；数据与排序状态由调用方管理。 */

/** 行属性：`data-row-id` 显式列出 —— 六个列表都用它做「写操作后按 id 重新定位」。 */
type AdminRowProps = ComponentPropsWithoutRef<"tr"> & { "data-row-id"?: string };

export type AdminTableProps<T, C = unknown> = {
  spec: TableViewSpec<T, C>;
  /** 已经取回的行（含无限下翻追加的部分）。 */
  items: T[];
  /**
   * 单元格渲染要用的运行时上下文（行首选择控件的 props、跳详情的回调…）。
   *
   * 它是 **`render` 的第三个参数**，而不是由 spec 闭包捕获：选中状态一变，spec 的引用
   * 就会变，而以 spec 派生的列清单为依赖的 `useColumnResize` 就会重跑列宽对齐 ——
   * 拖动列宽时尤其危险。spec 保持模块级常量，会变的值每次渲染从这里进。
   */
  renderContext: C;
  /** 空列表内容（由页面提供文案与下一步动作）。 */
  empty: ReactNode;
  /** 当前排序规则。 */
  sort?: readonly SortRule[];
  /** 表头点击后的新排序（三态循环）；不传则不渲染排序控件。 */
  onSortChange?: (rules: SortRule[]) => void;
  /** 列宽（px，与**可见列**一一对应）。不传则用 spec 的默认宽。 */
  widths?: readonly number[];
  /** `<col>` 的 ref：`useColumnResize` 拖动时直接改它，绕开 React 重渲染。 */
  colRefs?: readonly (Ref<HTMLTableColElement> | undefined)[];
  /** `<table>` 的 ref：`useColumnResize` 用它量列边界。 */
  tableRef?: Ref<HTMLTableElement>;
  /** 行属性，例如 `data-row-id` 与悬停预取。 */
  rowProps?: (row: T, index: number) => AdminRowProps;
  /** 外层容器 class，默认 `admin-table-wrap`。 */
  wrapClassName?: string;
  /** `<table>` 的 class，默认 `admin-table`。 */
  className?: string;
  /**
   * 就地编辑失败时的回调（文案由页面决定：内核不写文案，也不假设用哪种提示）。
   * 不传也可以 —— 页面自己的提交函数里已经报了错，这里只是兜底。
   */
  onEditError?: (message: string) => void;
  /**
   * 覆盖层：渲染在 `<table>` 之后、外层容器之内。
   *
   * 成员表的 Excel 式全局竖线（`.admin-colgrid`）必须放在表格**外面**才能贯穿表头与所有行，
   * 因此它不能作为表格的子节点，也不能由调用方自己再包一层 —— 那会多出一层 DOM。
   */
  overlay?: ReactNode;
  /**
   * **整行接管**：返回节点时这一行完全由调用方渲染（自己写 `<td>`，含 `colSpan`）；
   * 返回 `null` 走常规的逐列渲染。
   *
   * `<tr>` 本身仍由内核渲染：`key`、`rowProps`（`data-row-id` / 类名 / 悬停预取）照旧生效，
   * `<colgroup>` 与列宽也仍然成立 —— 接管的只是「这一行里有哪些格子」。
   *
   * 为什么需要它：邀请码列表的「调整策略」是在**行内**改三个字段（使用次数 / 生效时间 /
   * 失效时间），服务端一次 PATCH 提交它们。逐列渲染表达不了「一行里几个格子合成一个表单」，
   * 拆成三个各自编辑的单元格又会把一次提交拆成三次、还会多出两次审计。
   */
  renderRow?: (item: T, index: number, context: C) => ReactNode;
};

export function AdminTable<T, C = unknown>({
  spec,
  items,
  renderContext,
  empty,
  sort,
  onSortChange,
  widths,
  colRefs,
  tableRef,
  rowProps,
  wrapClassName = "admin-table-wrap",
  className = "admin-table",
  onEditError,
  overlay,
  renderRow,
}: AdminTableProps<T, C>) {
  const fields = spec.fields;
  const fieldByKey = useMemo(() => new Map(fields.map((field) => [field.key, field])), [fields]);

  // 列模型只登记「有哪些列、叫什么、默认多宽」。排序/筛选由服务端负责，
  // 因此这里不需要 accessor —— 单元格内容一律走 spec 的 `render`。
  const columns = useMemo<ColumnDef<T>[]>(
    () =>
      fields.map((field) => ({
        id: field.key,
        header: field.label,
        size: field.width,
      })),
    [fields],
  );

  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
  });

  const rules = sort ?? [];

  /**
   * 就地编辑的会话只可能有**一个**（同一时刻只改一格），因此状态就是一个坐标 + 草稿值。
   * 提交期间禁用输入框：既防止连点，也让「正在保存」这件事在控件上看得见。
   */
  const [editing, setEditing] = useState<{ rowId: string; fieldKey: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [committing, setCommitting] = useState(false);

  async function commitEdit(edit: CellEdit, next: string) {
    if (committing) return;
    setCommitting(true);
    try {
      await edit.commit(next);
      setEditing(null);
    } catch (error) {
      // 失败就退出编辑态：留一个改不动的输入框更糟（用户会以为还能再试一次成功）。
      // 文案由页面给（`onEditError` 或它自己的提示），内核只负责收场。
      setEditing(null);
      onEditError?.(error instanceof Error ? error.message : "保存失败，请重试");
    } finally {
      setCommitting(false);
    }
  }

  // 只有「声明了列宽」或「调用方给了 widths」时才输出 `<colgroup>`：
  // 其余情况保持浏览器自动分配列宽（按内容分配）。
  const hasColumnWidths = widths !== undefined || fields.some((field) => field.width !== undefined);

  const visibleColumns = table.getVisibleLeafColumns();
  const rows = table.getRowModel().rows;

  return (
    <div className={wrapClassName}>
      <table className={className} ref={tableRef}>
        <caption className="sr-only">{spec.title}</caption>
        {hasColumnWidths ? (
          <colgroup>
            {/* 宽度由 React 渲染（首屏、键盘调整、容器变化都靠它），拖动过程中由
                `useColumnResize` 直接改这两个属性绕开重渲染。 */}
            {visibleColumns.map((column, index) => (
              <col
                key={column.id}
                ref={colRefs?.[index]}
                style={{
                  width: `${widths?.[index] ?? fieldByKey.get(column.id)?.width ?? column.getSize()}px`,
                }}
              />
            ))}
          </colgroup>
        ) : null}
        <thead>
          <tr>
            {visibleColumns.map((column) => {
              const field = fieldByKey.get(column.id);
              if (!field) return null;
              return (
                <th
                  key={column.id}
                  scope="col"
                  className={field.headClassName}
                  aria-sort={ariaSortOf(rules, sortKeyOf(field))}
                >
                  {onSortChange && isFieldSortable(field) ? (
                    <button
                      type="button"
                      // `p-0 text-left` 抵消浏览器给 `<button>` 的默认内边距与居中对齐：
                      // 排序控件必须在表头里占与纯文本完全相同的位置（零位移）。
                      className="admin-th__sort p-0 text-left"
                      title={field.sortDescription}
                      aria-label={
                        field.sortDescription
                          ? `${field.label}：${field.sortDescription}`
                          : undefined
                      }
                      onClick={() => onSortChange(cycleSortRule(rules, sortKeyOf(field)))}
                    >
                      {field.label}
                    </button>
                  ) : (
                    field.label
                  )}
                  {/* 只给读屏的列名（`sr-only` 不参与布局）：行首的拖动 / 选择列可见表头是空的，
                      但读屏用户需要知道这一列是干什么的。 */}
                  {field.headLabel ? <span className="sr-only">{field.headLabel}</span> : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td className="admin-table__empty" colSpan={Math.max(visibleColumns.length, 1)}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => {
              const item = row.original;
              // 整行接管只在调用方真的要接管这一行时才生效（返回 `null` = 照常逐列渲染）。
              const takeover = renderRow?.(item, index, renderContext) ?? null;
              return (
                <tr key={spec.rowKey(item)} {...rowProps?.(item, index)}>
                  {takeover ??
                    row.getVisibleCells().map((cell) => {
                      const field = fieldByKey.get(cell.column.id);
                      if (!field) return null;
                      const rowId = spec.rowKey(item);
                      const edit = field.editable?.(item, renderContext) ?? null;
                      const isEditing =
                        edit !== null && editing?.rowId === rowId && editing.fieldKey === field.key;
                      return (
                        <td
                          key={cell.id}

                          data-label={field.label || undefined}
                          className={cellClassName(field)}
                          title={field.title?.(item)}
                        >
                          {isEditing ? (
                            <input
                              // 编辑框与单元格里的文本**同尺寸**（尺寸相关的一切都清零/继承），
                              // 否则进入编辑会让行高变化、整张表往下跳。
                              className="admin-celledit__input"
                              value={draft}
                              autoFocus
                              disabled={committing}
                              aria-label={`编辑${field.label}：${edit.rowLabel}`}
                              onChange={(event) => setDraft(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void commitEdit(edit, draft);
                                }
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  setEditing(null);
                                }
                              }}
                              onBlur={() => {
                                // 没改过就只是离开，不发请求（避免一次点击产生一次写与一条审计）。
                                if (draft === edit.initial) setEditing(null);
                                else void commitEdit(edit, draft);
                              }}
                            />
                          ) : edit ? (
                            <button
                              type="button"
                              // `p-0 text-start` 抵掉 `<button>` 的默认内边距与居中对齐：
                              // 可编辑单元格与纯文本单元格占**同一个盒子**。
                              className="admin-celledit p-0 text-start"
                              aria-label={`编辑${field.label}：${edit.rowLabel}`}
                              onClick={() => {
                                setDraft(edit.initial);
                                setEditing({ rowId, fieldKey: field.key });
                              }}
                            >
                              {field.render(item, index, renderContext)}
                            </button>
                          ) : (
                            field.render(item, index, renderContext)
                          )}
                        </td>
                      );
                    })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      {overlay}
    </div>
  );
}

/** 单元格 class：显式声明的优先，`numeric` 可覆盖由字段类型推导的默认值。 */
function cellClassName<T, C>(field: FieldSpec<T, C>): string | undefined {
  const numeric = field.numeric ?? defaultNumeric(field.kind);
  const classes = [field.cellClassName, numeric ? "admin-table__num" : undefined].filter(
    (value): value is string => Boolean(value),
  );
  return classes.length > 0 ? classes.join(" ") : undefined;
}
