"use client";

import type { ReactNode } from "react";

/**
 * 列表工具栏（M6 第四轮验收：参考 QQ 邮箱的列表顶栏）。
 *
 * 结构：`[全选] 已选择 N 项 | 批量动作…  ······  共 M 条`
 * —— 左对齐是「选中态 + 动作」，右对齐是数量。批量条**常驻**，未选中时动作按钮禁用。
 *
 * 为什么不再用「选中才出现」的条（无论是插在表格上方还是固定底部）：
 * 插进文档流会把表格顶下去；固定底部虽然不占布局，但它是**另一块浮起来的界面**，
 * 与列表本身割裂。邮箱客户端的做法更直接 —— 工具栏一直在，只是按钮会灰掉：
 * 没有出现/消失，也就没有任何位移，同时「选中后能做什么」在操作前就看得见。
 *
 * 与 `.admin-list` 配合使用：工具栏是列表面板的表头，表格在下面，共用一层描边。
 */
export function AdminListToolbar({
  children,
  count,
}: {
  /** 左侧：选择状态与批量动作按钮。 */
  children: ReactNode;
  /** 右侧：总数文案。 */
  count: string;
}) {
  return (
    <div className="admin-toolbar">
      <div className="admin-toolbar__actions">{children}</div>
      <p className="admin-toolbar__count">{count}</p>
    </div>
  );
}
