import { Button } from "@/components/ui/Button";
import {
  adminCopy,
  adminShared,
  joinApplicationStatusLabels,
  provisionStatusLabels,
} from "@/config/admin";
import type { JoinApplicationSummary } from "@/types/contracts";
import type { TableViewSpec } from "@/types/table";

/**
 * 招募报名表的视图定义（后台表格内核的第五个落地页）。
 *
 * 迁移只做一件事：把「表头 8 个 `<th>` + 8 个 `<td>`」收进一份 spec，**渲染逐字照抄**。
 * 三处刻意保持原样：
 *
 * 1. **不声明列宽**：这张表从来没接过 `useColumnResize`，列宽由浏览器按内容分配
 *    （内核在没有列宽时不输出 `<colgroup>`）；
 * 2. **「报名编号」是内容列**（`admin-table__grow`）：表头与单元格都要带这个类；
 * 3. **「提交时间」不右对齐**：与成员表「加入时间」、审计表「时间」同一判断 ——
 *    内核按 `datetime` 默认会给 `admin-table__num`，因此这里显式 `numeric: false`。
 *
 * `statusClass` 与 `formatDateTime` 从面板搬到这里：前者只有这一列用，后者面板里
 * 还有两处用（详情窗口），因此由面板反过来 import 这一份 —— 抄第二份迟早会漂。
 */

/** 页面上会被 `render` 用到的运行时值（`<AdminTable renderContext>` 传入）。 */
export type JoinApplicationTableContext = {
  /** 打开报名详情窗口。 */
  onDetail: (id: string) => void;
};

const copy = adminCopy.recruitment;

export const joinApplicationTableSpec: TableViewSpec<
  JoinApplicationSummary,
  JoinApplicationTableContext
> = {
  id: "join-applications",
  title: copy.title,
  rowKey: (item) => item.id,
  fields: [
    {
      key: "ticketNo",
      label: copy.table.ticketNo,
      kind: "text",
      headClassName: "admin-table__grow",
      cellClassName: "admin-table__grow",
      render: (item) => <code>{item.ticketNo}</code>,
    },
    {
      key: "realName",
      label: copy.table.realName,
      kind: "text",
      render: (item) => item.realName,
    },
    {
      key: "cycle",
      label: copy.table.cycle,
      kind: "text",
      render: (item) => item.recruitmentCycle,
    },
    {
      key: "contacts",
      label: copy.table.contacts,
      kind: "text",
      // QQ 与手机号并排：它们都是「怎么联系这个人」，分成两列会把行撑宽一倍。
      render: (item) => (
        <>
          {item.qqMasked}
          <span className="repair-table__flags">{item.phoneMasked}</span>
        </>
      ),
    },
    {
      key: "status",
      label: copy.table.status,
      kind: "select",
      render: (item) => (
        <span className={statusClass(item.status)}>{joinApplicationStatusLabels[item.status]}</span>
      ),
    },
    {
      key: "provision",
      label: copy.table.provision,
      kind: "select",
      render: (item) => provisionStatusLabels[item.provisionStatus],
    },
    {
      key: "submittedAt",
      label: copy.table.submittedAt,
      kind: "datetime",
      numeric: false,
      render: (item) => formatDateTime(item.submittedAt),
    },
    {
      key: "actions",
      label: copy.table.actions,
      kind: "readonly",
      render: (item, _index, { onDetail }) => (
        <span className="admin-actions">
          <Button variant="ghost" onClick={() => onDetail(item.id)}>
            {copy.action.detail}
          </Button>
        </span>
      ),
    },
  ],
};

/** 空列表文案由内核统一渲染，这里把配置暴露给面板，避免面板再引一次 `adminShared`。 */
export const joinApplicationEmptyText = adminShared.empty;

/**
 * 报名状态的标签样式。
 *
 * 三档而不是两档：**已通过**用「已通过」那枚标签，**未通过 / 已撤回**是灰的中性标签
 * （它们不是「待处理」，但也不是错误），其余（待面试等）才是「待处理」。
 */
export function statusClass(status: string): string {
  if (status === "INTERVIEW_PASSED") return "repair-tag repair-tag--approved";
  if (status === "INTERVIEW_REJECTED" || status === "WITHDRAWN") {
    return "admin-tag admin-tag--muted";
  }
  return "repair-tag repair-tag--pending";
}

/**
 * 报名相关的时间：`Asia/Shanghai` 的 `YYYY-MM-DD HH:mm`。
 *
 * 比列表里其它时间多一个年份（`replace(/\//g, "-")` 是把 `zh-CN` 的 `2026/09/23`
 * 换成 `2026-09-23`）：报名是跨批次的事，同一条列表里可能横跨一年。
 */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(iso))
    .replace(/\//g, "-");
}
