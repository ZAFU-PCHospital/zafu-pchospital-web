"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/Button";

/**
 * 批量操作组（列表顶栏左侧的固定结构）。
 *
 * 结构永远一样：`[全选] [已选择 N 项 / 未选择记录] │ [批量动作…] [取消选择]`。
 *
 * 为什么抽成一个组件：成员管理与维修审核是后台里仅有的两处批量操作，
 * 第四轮验收要求「像 QQ 邮箱那样把批量动作放进表格顶栏」时，两处各写了一遍 ——
 * 结果一处是「勾选框 + 批量动作 + 取消选择」，另一处中间插了个退回原因输入框，
 * 同一件事两种长相。现在两处共用本组件，差异只剩传进来的动作按钮。
 *
 * 三条不许改的约定（都是踩过的坑）：
 * 1. **常驻**：未选中时动作按钮置灰，绝不「选中才出现」——出现/消失会让表格位移。
 * 2. **占位文案固定**：未选中时也要占着「未选择记录」这一格，否则工具栏宽度会跳。
 * 3. **需要额外输入的批量动作走弹层**：批量退回要填原因，原因输入框放弹层里，
 *    不塞进顶栏（塞进去会把顶栏撑高、也把其它页面的顶栏比下去）。
 */
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
  /** 批量动作按钮，按业务顺序传入。 */
  actions: ReactNode;
}) {
  return (
    <>
      <input
        className="admin-check"
        type="checkbox"
        aria-label={selectAllLabel}
        checked={allSelected}
        onChange={(event) => onSelectAll(event.currentTarget.checked)}
      />
      <span className="admin-status">
        {count > 0 ? selectedLabel.replace("{count}", String(count)) : noneLabel}
      </span>
      <span className="admin-toolbar__sep" aria-hidden="true" />
      {actions}
      <Button variant="ghost" disabled={clearDisabled ?? count === 0} onClick={onClear}>
        {clearLabel}
      </Button>
    </>
  );
}
