"use client";

import { useState } from "react";

import { AdminModal } from "@/components/admin/AdminModal";
import { Button } from "@/components/ui/Button";
import { adminShared } from "@/config/admin";
import { MAX_FILTER_RULES, type FilterOp, type FilterRule } from "@/lib/api/list-filter";
import type { FilterFieldOption } from "@/lib/table/field-spec";
import {
  addDraftRow,
  changeDraftField,
  changeDraftOp,
  changeDraftValue,
  draftFromRules,
  draftToRules,
  emptyDraft,
  isDraftComplete,
  removeDraftRow,
  type FilterDraftRow,
} from "@/lib/table/filter-draft";

/**
 * 列级筛选的入口与弹层（P2 第二半）。
 *
 * 与快捷筛选条（`.admin-filters` 那一排姓名 / 状态 / 角色）的分工：
 *
 * - 快捷条回答「最常用的那几件事」，条件各写各的参数（`query` / `status` / `role`），
 *   一个成员的角色是关联、不是列，只能在那里筛；
 * - 这里回答「任意一列加条件」：列与运算符都来自 spec 的声明，因此**加条件不需要写代码**，
 *   在 `FieldSpec.filter` 里声明一下这一列能筛、支持哪些运算符即可。
 *
 * 三者（快捷筛选、关键字、列级条件）是**同时生效**的：后端的 where 是 AND 起来的，
 * 界面不假装它们互斥。
 *
 * 为什么条件编辑走弹层而不是内联展开：表格本身一两千像素高，往上插一块面板会把整个
 * 列表顶下去（`AGENTS.md` 的零位移约束）；弹层挂在 `body` 上，开关都不动布局。
 * 触发按钮**常驻**工具栏：它不会因为「有没有条件」而出现或消失。
 */

/**
 * 工具栏里的常驻入口。
 *
 * 里面有**固定宽度**的计数槽位：中间的数字从 0 变成 3 时按钮宽度不变，
 * 因此右边的「新增成员」不会横移。槽位最多一位数（条件上限是 5 条）。
 */
export function AdminFilterTrigger({
  fields,
  count,
  onClick,
}: {
  fields: readonly FilterFieldOption[];
  count: number;
  onClick: () => void;
}) {
  const labels = adminShared.filters;
  // 这张表没有声明任何可筛列时不给入口：点开一个空弹层比没有入口更糟。
  if (fields.length === 0) return null;
  return (
    <Button
      // 描边按钮（与同排的批量动作、新增成员同一档）：`ghost` 没有边框，
      // 「有条件在生效」就没地方用信号色标出来。
      variant="outline"
      icon="filter"
      className={count > 0 ? "admin-filterbtn is-active" : "admin-filterbtn"}
      aria-label={
        count > 0 ? labels.openActive.replace("{count}", String(count)) : labels.open
      }
      onClick={onClick}
    >
      {labels.open}
      {/* 计数是给人扫一眼的，语义已经写在按钮的 `aria-label` 上，因此对读屏隐藏。 */}
      <span className="admin-filterbtn__count" aria-hidden="true">
        {count > 0 ? String(count) : ""}
      </span>
    </Button>
  );
}

/** 条件编辑区（纯展示：状态与回调全部由 `AdminFilterDialog` 提供，因此可以直接 SSR 断言）。 */
export function AdminFilterDialogBody({
  fields,
  draft,
  atLimit,
  onAdd,
  onRemove,
  onChangeField,
  onChangeOp,
  onChangeValue,
}: {
  fields: readonly FilterFieldOption[];
  draft: readonly FilterDraftRow[];
  atLimit: boolean;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onChangeField: (index: number, fieldKey: string) => void;
  onChangeOp: (index: number, op: FilterOp) => void;
  onChangeValue: (index: number, value: string) => void;
}) {
  const labels = adminShared.filters;

  return (
    <div className="admin-conditions">
      {draft.length === 0 ? <p className="admin-conditions__empty">{labels.empty}</p> : null}

      {draft.map((row, index) => {
        const option = fields.find((field) => field.key === row.field);
        return (
          <div className="admin-conditions__row" key={index}>
            <label className="field">
              <span className="field__label">{labels.field}</span>
              <select
                className="field__input"
                value={row.field}
                onChange={(event) => onChangeField(index, event.target.value)}
              >
                {/* 状态里没有匹配的列（理论上不该出现）时补一个占位项：
                    否则受控 select 会显示第一项，而界面状态其实什么也没选。 */}
                {option ? null : <option value="">{labels.pick}</option>}
                {fields.map((field) => (
                  <option key={field.key} value={field.key}>
                    {field.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">{labels.op}</span>
              <select
                className="field__input"
                value={row.op}
                onChange={(event) => onChangeOp(index, event.target.value as FilterOp)}
              >
                {(option?.ops ?? []).map((op) => (
                  <option key={op} value={op}>
                    {labels.ops[op]}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">{labels.value}</span>
              <FilterValueInput
                input={option?.input}
                value={row.value}
                onChange={(value) => onChangeValue(index, value)}
              />
            </label>

            <Button
              variant="ghost"
              icon="trash"
              aria-label={`${labels.remove}${option ? `：${option.label}` : ""}`}
              onClick={() => onRemove(index)}
            >
              {labels.remove}
            </Button>
          </div>
        );
      })}

      <div className="admin-conditions__tools">
        <Button icon="plus" disabled={atLimit} onClick={onAdd}>
          {labels.add}
        </Button>
        {atLimit ? (
          // 到上限时明说，而不是让「添加条件」静静地不响应。
          <p className="admin-conditions__hint">
            {labels.limit.replace("{count}", String(MAX_FILTER_RULES))}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 值控件按 `FieldFilterSpec.input` 三选一。
 *
 * 为什么由 spec 决定而不是按运算符猜：`contains` 与 `eq` 都可能落在文本列上，
 * 而日期列的值必须是日历选择器（手打 `2026/1/1` 这种格式服务端不认）。
 */
function FilterValueInput({
  input,
  value,
  onChange,
}: {
  input: FilterFieldOption["input"] | undefined;
  value: string;
  onChange: (value: string) => void;
}) {
  const labels = adminShared.filters;
  if (!input) return <input className="field__input" value={value} disabled readOnly />;

  if (input.kind === "enum") {
    return (
      <select
        className="field__input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {/* 空选项是「还没选」的可见状态，不是可提交的值（后端拒绝空值）。 */}
        <option value="">{labels.pick}</option>
        {input.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (input.kind === "date") {
    return (
      <input
        className="field__input"
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <input
      className="field__input"
      value={value}
      placeholder={input.placeholder}
      maxLength={64}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** 条件弹层：草稿状态在这里，只有「应用」才把草稿交出去。 */
export function AdminFilterDialog({
  fields,
  rules,
  onApply,
  onClose,
}: {
  fields: readonly FilterFieldOption[];
  rules: readonly FilterRule[];
  onApply: (rules: FilterRule[]) => void;
  onClose: () => void;
}) {
  const labels = adminShared.filters;
  // 打开时的生效条件就是草稿的初值；关闭即丢弃，重开又是一份干净的草稿。
  const [draft, setDraft] = useState<FilterDraftRow[]>(() => draftFromRules(rules));
  const complete = isDraftComplete(draft);

  return (
    <AdminModal title={labels.title} subtitle={labels.lead} onClose={onClose}>
      <AdminFilterDialogBody
        fields={fields}
        draft={draft}
        atLimit={draft.length >= MAX_FILTER_RULES}
        onAdd={() => setDraft((current) => addDraftRow(current, fields))}
        onRemove={(index) => setDraft((current) => removeDraftRow(current, index))}
        onChangeField={(index, fieldKey) =>
          setDraft((current) => changeDraftField(current, index, fieldKey, fields))
        }
        onChangeOp={(index, op) => setDraft((current) => changeDraftOp(current, index, op))}
        onChangeValue={(index, value) =>
          setDraft((current) => changeDraftValue(current, index, value))
        }
      />

      <div className="admin-actions admin-conditions__actions">
        <Button
          variant="solid"
          icon="check"
          disabled={!complete}
          onClick={() => {
            onApply(draftToRules(draft));
            onClose();
          }}
        >
          {labels.apply}
        </Button>
        <Button variant="ghost" disabled={draft.length === 0} onClick={() => setDraft(emptyDraft())}>
          {labels.reset}
        </Button>
        {complete ? null : (
          <p className="admin-conditions__hint" role="status">
            {labels.incomplete}
          </p>
        )}
      </div>
    </AdminModal>
  );
}
