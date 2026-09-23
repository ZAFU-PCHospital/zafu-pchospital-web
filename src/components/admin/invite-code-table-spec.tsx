import { Button } from "@/components/ui/Button";
import { adminCopy, adminShared, inviteCodeStatusLabels } from "@/config/admin";
import type { InviteCodeAdminView } from "@/types/contracts";
import type { TableViewSpec } from "@/types/table";

/**
 * 邀请码表的视图定义（后台表格内核的第四个落地页）。
 *
 * 迁移只做一件事：把「表头 7 个 `<th>` + 7 个 `<td>`」收进一份 spec，**渲染逐字照抄**。
 * 三处刻意保持原样：
 *
 * 1. **不声明列宽**：这张表从来没接过 `useColumnResize`，列宽由浏览器按内容分配
 *    （内核在没有列宽时不输出 `<colgroup>`）；
 * 2. **「生效区间」是内容列**（`admin-table__grow`）：表头与单元格都要带这个类；
 * 3. **「创建时间」不右对齐**：与成员表「加入时间」、审计表「时间」同一判断 ——
 *    是否右对齐是产品决定，不在这件事里顺手做（内核按 `datetime` 默认会给
 *    `admin-table__num`，因此这里显式 `numeric: false`）。
 *
 * 「调整策略」那一行不在这里：它把中间四列合成一个表单（`colSpan`），由面板通过
 * `<AdminTable renderRow>` 整行接管 —— spec 描述的是**常规行**长什么样。
 */

/** 页面上会被 `render` 用到的运行时值（`<AdminTable renderContext>` 传入）。 */
export type InviteCodeTableContext = {
  /** 有请求在飞（创建 / 调整 / 撤销）：按钮禁用，避免连点。 */
  busy: boolean;
  /** 进入行内「调整策略」。 */
  onEditPolicy: (id: string) => void;
  /**
   * 撤销。已撤销的邀请码按钮是**禁用**的：服务端也会拒（`notRevocable`），
   * 但界面不该先给出一个必然失败的入口。
   */
  onRevoke: (item: InviteCodeAdminView) => void;
};

const copy = adminCopy.inviteCodes;

export const inviteCodeTableSpec: TableViewSpec<InviteCodeAdminView, InviteCodeTableContext> = {
  id: "invite-codes",
  title: copy.title,
  rowKey: (item) => item.id,
  fields: [
    {
      key: "prefix",
      label: copy.table.prefix,
      kind: "text",
      // 库里只有摘要，列表能拿到的就是明文前 8 位（`displayPrefix`）。
      render: (item) => <code>{item.displayPrefix}</code>,
    },
    {
      key: "status",
      label: copy.table.status,
      kind: "select",
      render: (item) => (
        <span
          className={
            item.status === "ACTIVE"
              ? "repair-tag repair-tag--approved"
              : "repair-tag repair-tag--pending"
          }
        >
          {inviteCodeStatusLabels[item.status]}
        </span>
      ),
    },
    {
      key: "window",
      label: copy.table.window,
      kind: "text",
      headClassName: "admin-table__grow",
      cellClassName: "admin-table__grow",
      render: (item) => windowText(item),
    },
    {
      key: "usage",
      label: copy.table.usage,
      kind: "text",
      // 已用 / 上限：两个数字挨着写，读者不必再把两列对起来。
      render: (item) =>
        copy.usage
          .replace("{used}", String(item.usedCount))
          .replace("{max}", String(item.maxUses)),
    },
    {
      key: "binding",
      label: copy.table.binding,
      kind: "text",
      // 绑定信息按 PII 规则脱敏后才到界面，因此这里显示的是 `138****1234` 这种值。
      render: (item) => bindingText(item) || adminShared.none,
    },
    {
      key: "createdAt",
      label: copy.table.createdAt,
      kind: "datetime",
      numeric: false,
      render: (item) => formatDateTime(item.createdAt),
    },
    {
      key: "actions",
      label: copy.table.actions,
      kind: "readonly",
      render: (item, _index, { busy, onEditPolicy, onRevoke }) => (
        <span className="admin-actions">
          <Button variant="ghost" icon="edit" onClick={() => onEditPolicy(item.id)}>
            {copy.action.policy}
          </Button>
          <Button
            variant="ghost"
            disabled={busy || item.status === "REVOKED"}
            onClick={() => onRevoke(item)}
          >
            {copy.action.revoke}
          </Button>
        </span>
      ),
    },
  ],
};

/** 空列表文案由内核统一渲染，这里把配置暴露给面板，避免面板再引一次 `adminShared`。 */
export const inviteCodeEmptyText = adminShared.empty;

/** 生效区间：两端都没有就是「长期有效」，只有一端时只写那一端。 */
export function windowText(item: InviteCodeAdminView): string {
  if (!item.activeFrom && !item.expiresAt) return copy.window.forever;
  const parts: string[] = [];
  if (item.activeFrom) {
    parts.push(copy.window.from.replace("{from}", formatDateTime(item.activeFrom)));
  }
  if (item.expiresAt) {
    parts.push(copy.window.until.replace("{to}", formatDateTime(item.expiresAt)));
  }
  return parts.join(" · ");
}

/** 绑定：QQ 与手机号可能各绑一个，中间用 ` · ` 分开。 */
export function bindingText(item: InviteCodeAdminView): string {
  const parts: string[] = [];
  if (item.boundQqMasked) parts.push(`QQ ${item.boundQqMasked}`);
  if (item.boundPhoneMasked) parts.push(item.boundPhoneMasked);
  return parts.join(" · ");
}

/**
 * 列表里的时间：`Asia/Shanghai` 的 `MM-DD HH:mm`。表格列窄，不重复显示年份。
 *
 * 从面板搬到 spec 是因为两处都要用它（常规行的「创建时间」与整行接管时的同一格），
 * 抄第二份迟早会漂。
 */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
