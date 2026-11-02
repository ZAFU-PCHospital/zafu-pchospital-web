"use client";

import { useTableQuery } from "@/components/admin/useTableQuery";
import { tableQueryOptions } from "@/config/table-queries";

import { useCallback, useEffect, useState } from "react";
import { AdminTableQuery } from "@/components/admin/AdminTableQuery";

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
import { type AuditActionOption, type AuditLogEntry } from "@/types/contracts";

const QUERY_OPTIONS = tableQueryOptions("audit");

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
  const query = useTableQuery(QUERY_OPTIONS, EMPTY_FILTERS);
  const requestParams = query.params;
  const sortRules = query.value.sort;
  const setSortRules = query.setSort;
  const [detail, setDetail] = useState<AuditLogEntry | null>(null);

  // 取数状态收在 `useAdminList`：审计这里行数最多，往下滚动自动接下一页尤其必要。
  const list = useAdminList<AuditLogEntry>(
    useCallback(
      (targetPage: number, signal?: AbortSignal) =>
        adminFetch<AuditLogEntry[]>(`/api/v1/admin/audit-logs?${requestParams(targetPage)}`, {
          signal,
        }),
      [requestParams],
    ),
    { queryKey: query.ready ? query.signature : null },
  );
  const { items, pagination, state, problem, loadingMore } = list;
  /** 单元格渲染要用的运行时值（打开变更摘要窗口）。 */
  const auditContext: AuditTableContext = { onDetail: setDetail };

  const load = useCallback(async () => {
    await list.reload();
  }, [list]);

  useEffect(() => {
    // 动作清单只在进页面时取一次：它是「有哪些动作出现过」，不随筛选变化。
    void (async () => {
      const result = await adminFetch<AuditActionOption[]>("/api/v1/admin/audit-logs/actions");
      if (result.ok) setActions(result.data);
    })();
  }, []);

  return (
    <div className="admin-workspace__content">
      <div className="admin-workspace__header">
        <div>
          <h1 className="admin-workspace__title" id="admin-audit-title">
            {copy.title}
          </h1>
        </div>
      </div>

      {problem ? (
        <p className="admin-status admin-status--error" role="alert">
          {problem}
        </p>
      ) : null}

      <AdminTableQuery
        ready={query.ready}
        value={query.value}
        options={QUERY_OPTIONS}
        quick={[
          {
            key: "action",
            label: copy.filter.action,
            options: actions.map((item) => ({ value: item.action, label: item.action })),
          },
          {
            key: "result",
            label: copy.filter.result,
            options: Object.entries(copy.resultLabels).map(([value, label]) => ({ value, label })),
          },
        ]}
        onChange={query.setValue}
        onClear={query.reset}
        summary={list.summary}
        refreshing={list.refreshing}
        problem={list.problem}
      />

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
          <AdminListToolbar
            count={pagination?.total ?? items.length}
            refreshing={list.refreshing}
            previous={Boolean(list.problem)}
          />
          {/* 列定义由 spec 提供，跨列编辑行由 renderRow 接管。 */}
          <AdminTable
            spec={auditTableSpec}
            sort={sortRules}
            onSortChange={setSortRules}
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
    <div className="admin-section">
      <h3 className="admin-panel__title">{title}</h3>
      <pre className="admin-json">{value === null ? "—" : JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}
