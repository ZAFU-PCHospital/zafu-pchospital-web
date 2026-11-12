import { tableCopy } from "@/config/admin-tables";
import { Button } from "@/components/ui/Button";
import {
  adminCopy,
  adminShared,
  joinApplicationStatusLabels,
  provisionStatusLabels,
} from "@/config/admin";
import type { JoinApplicationSummary, ProvisionStatus } from "@/types/contracts";
import type { TableViewSpec } from "@/types/table";

/** 招募报名表列定义。 */

/** 页面上会被 `render` 用到的运行时值（`<AdminTable renderContext>` 传入）。 */
export type JoinApplicationTableContext = {
  /** 打开报名详情窗口。 */
  onDetail: (id: string) => void;
  /** 行内「通过」：面板弹二次确认，确认后才提交。 */
  onApprove: (item: JoinApplicationSummary) => void;
  /** 有请求在途：行内按钮一并置灰，防连点。 */
  busy: boolean;
};

/**
 * 只有「已提交 / 待面试」可以一键通过（与服务端 `review` 接受的状态一致）；
 * 其余状态按钮**常驻但置灰** —— 按钮忽隐忽现会让整行宽度跳动。
 */
export function canQuickApprove(status: JoinApplicationSummary["status"]): boolean {
  return status === "SUBMITTED" || status === "INTERVIEW_PENDING";
}

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
      sortKey: "recruitmentCycle",
      label: copy.table.cycle,
      kind: "text",
      render: (item) => item.recruitmentCycle,
    },
    {
      key: "contacts",
      sortable: false,
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
        <span className="admin-tags">
          <span className={statusClass(item.status)}>
            {joinApplicationStatusLabels[item.status]}
          </span>
        </span>
      ),
    },
    {
      key: "provision",
      sortKey: "provisionStatus",
      label: copy.table.provision,
      kind: "select",
      render: (item) => (
        <span className="admin-tags">
          <span className={provisionStatusClass(item.provisionStatus)}>
            {provisionStatusLabels[item.provisionStatus]}
          </span>
        </span>
      ),
    },
    {
      key: "submittedAt",
      label: copy.table.submittedAt,
      kind: "datetime",
      numeric: false,
      render: (item) => formatDateTime(item.submittedAt),
    },
    {
      key: "lastReviewedAt",
      label: tableCopy.interviewedAt,
      kind: "datetime",
      numeric: false,
      render: (item) =>
        item.lastReviewedAt ? formatDateTime(item.lastReviewedAt) : adminShared.none,
    },
    {
      key: "approvedAt",
      label: tableCopy.approvedAt,
      kind: "datetime",
      numeric: false,
      render: (item) => (item.approvedAt ? formatDateTime(item.approvedAt) : adminShared.none),
    },
    {
      key: "actions",
      sortable: false,
      label: copy.table.actions,
      kind: "readonly",
      render: (item, _index, { busy, onDetail, onApprove }) => (
        <span className="admin-actions">
          <Button variant="ghost" onClick={() => onDetail(item.id)}>
            {copy.action.detail}
          </Button>
          <Button
            variant="ghost"
            disabled={busy || !canQuickApprove(item.status)}
            onClick={() => onApprove(item)}
          >
            {copy.action.approve}
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

/** 发放失败需要优先看见；已发放用强调色，无需发放弱化。 */
export function provisionStatusClass(status: ProvisionStatus): string {
  if (status === "FAILED") return "admin-tag admin-tag--danger";
  if (status === "SUCCEEDED") return "admin-tag admin-tag--accent";
  if (status === "NOT_REQUIRED") return "admin-tag admin-tag--muted";
  return "admin-tag";
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
