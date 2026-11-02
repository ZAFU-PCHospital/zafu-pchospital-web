"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { Button } from "@/components/ui/Button";
import { tableCopy } from "@/config/admin-tables";

/** 维修审核与成员管理共用的批量操作工具栏。 */
export function AdminBatchTools({
  allSelected,
  selectAllLabel,
  onSelectAll,
  count,
  selectedLabel,
  noneLabel,
  clearLabel,
  onClear,
  clearDisabled,
  disabled = false,
  empty = false,
  actions,
}: {
  /** 表头全选框当前是否已全选（列表为空时传 `false`）。 */
  allSelected: boolean;
  selectAllLabel: string;
  onSelectAll: (checked: boolean) => void;
  /** 当前选中的条数。 */
  count: number;
  /** 选中时的文案，含 `{count}` 占位。 */
  selectedLabel: string;
  /** 未选中时的文案。 */
  noneLabel: string;
  clearLabel: string;
  onClear: () => void;
  clearDisabled?: boolean;
  disabled?: boolean;
  empty?: boolean;
  /** 批量动作按钮，按业务顺序传入。 */
  actions: ReactNode;
}) {
  const checkbox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (checkbox.current) checkbox.current.indeterminate = count > 0 && !allSelected;
  }, [allSelected, count]);
  return (
    <div className="admin-batch-tools">
      <label className="admin-batch-tools__all">
        <input
          ref={checkbox}
          className="admin-check"
          type="checkbox"
          aria-label={selectAllLabel}
          checked={allSelected}
          disabled={disabled || empty}
          onChange={(event) => onSelectAll(event.currentTarget.checked)}
        />
        <span className="admin-toolbar__mobile-only">{tableCopy.selectLoaded}</span>
      </label>
      <span className="admin-status admin-batch-tools__count">
        <span className="admin-toolbar__desktop-only">
          {count > 0 ? selectedLabel.replace("{count}", String(count)) : noneLabel}
        </span>
        <span className="admin-toolbar__mobile-only" aria-live="polite">
          {tableCopy.selectedShort.replace("{count}", String(count))}
        </span>
      </span>
      <span className="admin-toolbar__sep" aria-hidden="true" />
      <div className="admin-batch-tools__actions">{actions}</div>
      <Button
        className="admin-toolbar__desktop-only"
        variant="ghost"
        disabled={disabled || (clearDisabled ?? count === 0)}
        onClick={onClear}
      >
        {clearLabel}
      </Button>
      <Button
        className="admin-toolbar__mobile-only admin-batch-tools__cancel-mobile"
        variant="ghost"
        disabled={disabled}
        onClick={onClear}
      >
        {tableCopy.cancelSelection}
      </Button>
    </div>
  );
}
