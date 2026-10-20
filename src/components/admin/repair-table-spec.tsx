import { Button } from "@/components/ui/Button";
import { adminCopy, adminShared } from "@/config/admin";
import { formatDurationMinutes, formatShanghaiDate } from "@/config/member";
import {
  formatRepairParticipants,
  repairCopy,
  repairResultLabels,
  repairStatusLabels,
} from "@/config/repairs";
import { UNCATEGORIZED_LABEL } from "@/types/contracts";
import type { RepairView } from "@/types/contracts";
import type { TableViewSpec } from "@/types/table";

/**
 * 维修审核表：默认列宽由此声明，面板复用 `useColumnResize` 调整并保存偏好。
 * 保留独立选择列、原有排序字段与左对齐；长值的完整内容留在 title 与详情中。
 */

/** 页面上会被 `render` 用到的运行时值（`<AdminTable renderContext>` 传入）。 */
export type RepairTableContext = {
  /** 已勾选的记录 id。 */
  selected: string[];
  /** 勾选 / 取消勾选一行（值由调用方在事件里先取出，避免 `currentTarget` 失效）。 */
  onToggleSelected: (recordId: string, checked: boolean) => void;
  /** 打开这一行的详情窗口。 */
  onDetail: (recordId: string) => void;
};

const copy = adminCopy.repairs;

export const repairTableSpec: TableViewSpec<RepairView, RepairTableContext> = {
  id: "repairs",
  title: copy.title,
  rowKey: (record) => record.id,
  fields: [
    {
      key: "select",
      // 选择列没有字段名：表头为空，内核因此不写 `data-label`。
      label: "",
      headLabel: copy.table.selectOne,
      kind: "readonly",
      width: 48,
      sortable: false,
      render: (record, _index, { selected, onToggleSelected }) => (
        <input
          className="admin-check"
          type="checkbox"
          aria-label={copy.table.selectOne}
          checked={selected.includes(record.id)}
          // `event.currentTarget` 只在事件派发期间有效：把它读进 state updater 里会在
          // updater 真正执行时变成 null 并抛 `Cannot read properties of null (reading
          // 'checked')`（浏览器实测踩到）。所以先取值再交给回调。
          onChange={(event) => onToggleSelected(record.id, event.currentTarget.checked)}
        />
      ),
    },
    {
      key: "repairDate",
      label: copy.table.repairDate,
      kind: "date",
      width: 100,
      numeric: false,
      render: (record) => formatShanghaiDate(record.repairDate),
    },
    {
      key: "member",
      // 列 id 描述「这一格显示谁」，排序字段是 API 的 `memberName`。
      sortKey: "memberName",
      label: copy.table.member,
      kind: "text",
      width: 150,
      title: (record) => formatRepairParticipants(record),
      render: (record) => formatRepairParticipants(record),
    },
    {
      key: "category",
      sortKey: "categoryName",
      label: copy.table.category,
      kind: "select",
      width: 110,
      title: (record) => record.category?.name ?? UNCATEGORIZED_LABEL,
      render: (record) => record.category?.name ?? UNCATEGORIZED_LABEL,
    },
    {
      key: "deviceModel",
      label: copy.table.deviceModel,
      kind: "text",
      width: 180,
      sortable: false,
      cellClassName: "repair-table__model",
      title: (record) => record.deviceModel || adminShared.none,
      render: (record) => <span>{record.deviceModel || adminShared.none}</span>,
    },
    {
      key: "result",
      label: copy.table.result,
      kind: "select",
      width: 84,
      title: (record) => (record.result ? repairResultLabels[record.result] : adminShared.none),
      render: (record) => (record.result ? repairResultLabels[record.result] : adminShared.none),
    },
    {
      key: "duration",
      sortKey: "durationMinutes",
      label: copy.table.duration,
      kind: "number",
      width: 100,
      numeric: false,
      render: (record) =>
        record.durationMinutes === null
          ? adminShared.none
          : formatDurationMinutes(record.durationMinutes),
    },
    {
      key: "status",
      label: copy.table.status,
      kind: "select",
      width: 156,
      title: (record) =>
        [
          repairStatusLabels[record.status],
          record.isDifficult ? repairCopy.list.difficult : "",
          record.isTypical ? repairCopy.list.typical : "",
        ]
          .filter(Boolean)
          .join("、"),
      render: (record) => (
        <span className="admin-tags">
          <span className={`repair-tag repair-tag--${record.status.toLowerCase()}`}>
            {repairStatusLabels[record.status]}
          </span>
          {record.isDifficult ? (
            <span className="admin-tag">{repairCopy.list.difficult}</span>
          ) : null}
          {record.isTypical ? (
            <span className="admin-tag admin-tag--accent">{repairCopy.list.typical}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: "actions",
      label: copy.table.actions,
      kind: "readonly",
      width: 150,
      sortable: false,
      render: (record, _index, { onDetail }) => (
        <span className="admin-actions">
          <Button variant="ghost" onClick={() => onDetail(record.id)}>
            {copy.action.detail}
          </Button>
        </span>
      ),
    },
  ],
};
