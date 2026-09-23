import { Button } from "@/components/ui/Button";
import { adminCopy } from "@/config/admin";
import { auditTargetLabel, formatAuditDateTime, shortAuditId } from "@/config/audit";
import type { AuditLogEntry } from "@/types/contracts";
import type { TableViewSpec } from "@/types/table";

/**
 * 审计记录表的视图定义（后台表格内核的第二个落地页）。
 *
 * 迁移只做一件事：把「表头 7 个 `<th>` + 7 个 `<td>`」这两份平行定义收进一份 spec。
 * **渲染逐字照抄**，三处刻意保持原样、不要顺手「优化」：
 *
 * 1. **不声明列宽**：审计表从来没接过 `useColumnResize`，列宽由浏览器按内容分配。
 *    内核因此在没有列宽时不输出 `<colgroup>` —— 迁移不该顺带改掉它的布局；
 * 2. **「时间」列不开右对齐**：与成员表的「加入时间」同一判断，是否右对齐是产品决定，
 *    不在这件事里顺手做（内核按 `datetime` 类型默认会给 `admin-table__num`）；
 * 3. **动作列是内容列**（`admin-table__grow`）：表头与单元格都要带这个类，
 *    它让这一列吸收剩余宽度、并允许换行。
 *
 * 排序说明：审计列表服务端固定按 `created_at` 倒序，`audit-log-service` 还没有 `sort`
 * 参数，所以面板**不传 `onSortChange`**（内核在不传时不渲染任何排序控件）。
 * 要开排序得先按 `docs/admin-table-kernel.md` §6 的形状贯通后端与白名单。
 */

/** 页面上会被 `render` 用到的运行时值（`<AdminTable renderContext>` 传入）。 */
export type AuditTableContext = {
  /** 打开变更摘要窗口。 */
  onDetail: (entry: AuditLogEntry) => void;
};

const copy = adminCopy.audit;

export const auditTableSpec: TableViewSpec<AuditLogEntry, AuditTableContext> = {
  id: "audit",
  title: copy.title,
  rowKey: (entry) => entry.id,
  fields: [
    {
      key: "createdAt",
      label: copy.table.createdAt,
      kind: "datetime",
      // 与迁移前一致：这一列没有 `admin-table__num`（不右对齐）。
      numeric: false,
      render: (entry) => formatAuditDateTime(entry.createdAt),
    },
    {
      key: "action",
      label: copy.table.action,
      kind: "text",
      headClassName: "admin-table__grow",
      cellClassName: "admin-table__grow",
      render: (entry) => <code>{entry.action}</code>,
    },
    {
      key: "actor",
      label: copy.table.actor,
      kind: "text",
      render: (entry) => entry.actorName ?? copy.actorSystem,
    },
    {
      key: "target",
      label: copy.table.target,
      kind: "text",
      // 完整 ID 放 `title`：格子里只显示短 ID，需要时也能复制。
      title: (entry) => entry.targetId,
      render: (entry) => (
        // 目标类型 + 短 ID 排在一行：分成两行会让每一行都高 10px，
        // 而这个 ID 平时只需要能对上号。
        <span className="admin-contacts">
          <span>{auditTargetLabel(entry.targetType)}</span>
          <code>{shortAuditId(entry.targetId)}</code>
        </span>
      ),
    },
    {
      key: "requestId",
      label: copy.table.requestId,
      kind: "text",
      render: (entry) => <code>{entry.requestId}</code>,
    },
    {
      key: "result",
      label: copy.table.result,
      kind: "select",
      render: (entry) => (
        <span
          className={
            entry.result === "SUCCESS"
              ? "repair-tag repair-tag--approved"
              : "repair-tag repair-tag--rejected"
          }
        >
          {copy.resultLabels[entry.result]}
          {entry.errorCode ? ` ${entry.errorCode}` : ""}
        </span>
      ),
    },
    {
      key: "actions",
      label: copy.table.actions,
      kind: "readonly",
      // 只读表：唯一的动作是看摘要（before / after 是 JSON，塞进列里会把行高撑成几屏）。
      render: (entry, _index, { onDetail }) => (
        <span className="admin-actions">
          <Button variant="ghost" icon="eye" onClick={() => onDetail(entry)}>
            {copy.action.detail}
          </Button>
        </span>
      ),
    },
  ],
};
