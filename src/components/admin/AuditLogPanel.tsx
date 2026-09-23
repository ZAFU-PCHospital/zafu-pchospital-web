"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AdminModal } from "@/components/admin/AdminModal";
import { AdminListToolbar } from "@/components/admin/AdminListToolbar";
import { AdminTable } from "@/components/admin/AdminTable";
import { auditTableSpec, type AuditTableContext } from "@/components/admin/audit-table-spec";
import { AdminListEnd, useAdminList } from "@/components/admin/useAdminList";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { adminCopy, adminShared } from "@/config/admin";
import { formatAuditDateTime } from "@/config/audit";
import { adminFetch } from "@/features/admin/admin-client";
import { AuditResult, type AuditActionOption, type AuditLogEntry } from "@/types/contracts";

const EMPTY_FILTERS = {
  action: "",
  actorUserId: "",
  targetType: "",
  targetId: "",
  requestId: "",
  result: "",
  createdFrom: "",
  createdTo: "",
};

/**
 * 审计记录（M6 批次 2，需求 §45）。
 *
 * `audit:read` 从 M0 起就在权限表里，却一直没有界面 —— 「重要操作留痕」只能靠直接查库，
 * 等于没兑现需求里「出现数据争议时可以追踪」这个用途。
 *
 * 三处刻意设计：
 * 1. **只读**：没有编辑、没有删除，连入口都不提供（能改的审计等于没有审计）。
 * 2. 动作筛选是**下拉而不是输入框**：动作名有 `repair.exported` 这样的点分小写，
 *    也有 `MEMBER_PROFILE_UPDATED` 这样的历史遗留写法，不该要求使用者记住命名规则。
 * 3. 摘要放在窗口里看：`before` / `after` 是 JSON，塞进表格列会把行高撑成几屏。
 *    摘要在**写入时**就已脱敏（凭据类字段整条丢弃、QQ 与手机号打码），读取不再写审计。
 */
export function AuditLogPanel() {
  const copy = adminCopy.audit;
  const [actions, setActions] = useState<AuditActionOption[]>([]);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [detail, setDetail] = useState<AuditLogEntry | null>(null);

  // 取数状态收在 `useAdminList`：审计这里行数最多，往下滚动自动接下一页尤其必要。
  const list = useAdminList<AuditLogEntry>(
    useCallback(
      (targetPage: number) => {
        const params = new URLSearchParams({ page: String(targetPage), pageSize: "20" });
        for (const [key, value] of Object.entries(applied)) {
          if (value) params.set(key, value);
        }
        return adminFetch<AuditLogEntry[]>(`/api/v1/admin/audit-logs?${params.toString()}`);
      },
      [applied],
    ),
  );
  const { items, pagination, state, problem, loadingMore } = list;
  /** 单元格渲染要用的运行时值（打开变更摘要窗口）。 */
  const auditContext: AuditTableContext = { onDetail: setDetail };

  const load = useCallback(async () => {
    await list.reload();
  }, [list]);

  useEffect(() => {
    void load();
    // `applied` 变化才重新取第一页；`list` 是稳定引用（内部用 ref 取最新筛选）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied]);

  useEffect(() => {
    // 动作清单只在进页面时取一次：它是「有哪些动作出现过」，不随筛选变化。
    void (async () => {
      const result = await adminFetch<AuditActionOption[]>("/api/v1/admin/audit-logs/actions");
      if (result.ok) setActions(result.data);
    })();
  }, []);

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    setApplied({
      action: data.action ?? "",
      actorUserId: data.actorUserId ?? "",
      targetType: data.targetType ?? "",
      targetId: data.targetId ?? "",
      requestId: data.requestId ?? "",
      result: data.result ?? "",
      createdFrom: data.createdFrom ?? "",
      createdTo: data.createdTo ?? "",
    });
  }

  const totalActions = actions.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="admin-workspace__content">
      <div className="admin-workspace__header">
        <div>
          <h1 className="admin-workspace__title" id="admin-audit-title">
            {copy.title}
          </h1>
          <p className="admin-workspace__lead">{copy.lead}</p>
        </div>
      </div>

      {problem ? (
        <p className="admin-status admin-status--error" role="alert">
          {problem}
        </p>
      ) : null}

      <form
        method="post"
        className="admin-filters"
        onSubmit={submitFilters}
        aria-label={copy.filter.submit}
      >
        <div className="admin-filters__row">
          <label className="field">
            <span className="field__label">{copy.filter.action}</span>
            <select className="field__input" name="action" defaultValue={applied.action}>
              <option value="">{copy.actionAll.replace("{count}", String(totalActions))}</option>
              {actions.map((option) => (
                <option key={option.action} value={option.action}>
                  {copy.actionOption
                    .replace("{action}", option.action)
                    .replace("{count}", String(option.count))}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{copy.filter.result}</span>
            <select className="field__input" name="result" defaultValue={applied.result}>
              <option value="">全部</option>
              {AuditResult.map((value) => (
                <option key={value} value={value}>
                  {copy.resultLabels[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{copy.filter.targetType}</span>
            <input
              className="field__input"
              name="targetType"
              defaultValue={applied.targetType}
              maxLength={80}
            />
          </label>
          <label className="field">
            <span className="field__label">{copy.filter.actorUserId}</span>
            <input
              className="field__input"
              name="actorUserId"
              defaultValue={applied.actorUserId}
              maxLength={36}
            />
          </label>
          <label className="field">
            <span className="field__label">{copy.filter.targetId}</span>
            <input
              className="field__input"
              name="targetId"
              defaultValue={applied.targetId}
              maxLength={36}
            />
          </label>
          <label className="field">
            <span className="field__label">{copy.filter.requestId}</span>
            <input
              className="field__input"
              name="requestId"
              defaultValue={applied.requestId}
              maxLength={64}
            />
          </label>
          <label className="field">
            <span className="field__label">{copy.filter.createdFrom}</span>
            <input
              className="field__input"
              type="date"
              name="createdFrom"
              defaultValue={applied.createdFrom}
            />
          </label>
          <label className="field">
            <span className="field__label">{copy.filter.createdTo}</span>
            <input
              className="field__input"
              type="date"
              name="createdTo"
              defaultValue={applied.createdTo}
            />
          </label>
          <Button type="submit" icon="check">
            {copy.filter.submit}
          </Button>
          <Button variant="ghost" onClick={() => setApplied(EMPTY_FILTERS)}>
            {copy.filter.reset}
          </Button>
        </div>
      </form>

      {state === "loading" ? (
        <p className="admin-status" role="status">
          {adminShared.loading}
        </p>
      ) : null}

      {state === "error" ? (
        <Card variant="notice">
          <p>{problem || adminShared.loadFailed}</p>
          <Button onClick={() => void load()}>{adminShared.reload}</Button>
        </Card>
      ) : null}

      {state === "ready" ? (
        <div className="admin-list">
          {/* 只读列表没有批量动作，顶栏只放一句状态说明与总数。 */}
          <AdminListToolbar
            count={copy.count.replace("{count}", String(pagination?.total ?? items.length))}
          >
            <span className="admin-status">{copy.readonlyNote}</span>
          </AdminListToolbar>
          {/* 表格本体由内核渲染（`AdminTable`）：表头与单元格内容都来自 `auditTableSpec`。
              审计表**不声明列宽**，因此内核不会输出 `<colgroup>`，列宽仍由浏览器按内容分配
              —— 与迁移前一致。面板不传 `onSortChange`：后端还没有 `sort` 参数，
              内核在不传时不渲染任何排序控件。 */}
          <AdminTable
            spec={auditTableSpec}
            items={items}
            renderContext={auditContext}
            emptyText={adminShared.empty}
          />
          <AdminListEnd
            pagination={pagination}
            loaded={items.length}
            busy={loadingMore}
            onLoadMore={list.loadMore}
            labels={adminShared.listEnd}
          />
        </div>
      ) : null}

      {detail ? (
        <AdminModal
          title={copy.detail.title}
          subtitle={`${detail.action} · ${formatAuditDateTime(detail.createdAt)}`}
          onClose={() => setDetail(null)}
        >
          <p className="admin-note">{copy.detail.redactedNote}</p>
          {detail.beforeSummary === null && detail.afterSummary === null ? (
            <p className="admin-note">{copy.detail.empty}</p>
          ) : (
            <>
              <SummaryBlock title={copy.detail.before} value={detail.beforeSummary} />
              <SummaryBlock title={copy.detail.after} value={detail.afterSummary} />
            </>
          )}
          <div className="signup__actions">
            <Button variant="ghost" onClick={() => setDetail(null)}>
              {adminShared.close}
            </Button>
          </div>
        </AdminModal>
      ) : null}
    </div>
  );
}

function SummaryBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div>
      <h3 className="admin-panel__title">{title}</h3>
      <pre className="admin-json">{value === null ? "—" : JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}
