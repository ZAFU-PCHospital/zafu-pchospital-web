"use client";

import { useTableQuery } from "@/components/admin/useTableQuery";
import { tableQueryOptions } from "@/config/table-queries";
import { tableCopy } from "@/config/admin-tables";

import { useCallback, useEffect, useState } from "react";
import { AdminTableExport } from "@/components/admin/AdminTableExport";
import { AdminTableQuery } from "@/components/admin/AdminTableQuery";

import { AdminTable } from "@/components/admin/AdminTable";
import { repairTableSpec, type RepairTableContext } from "@/components/admin/repair-table-spec";
import { useColumnResize, type ColumnSpec } from "@/components/admin/useColumnResize";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { adminCopy, adminShared } from "@/config/admin";
import { repairStatusLabels } from "@/config/repairs";
import { adminFetch } from "@/features/admin/admin-client";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import { AdminBatchTools } from "@/components/admin/AdminBatchTools";
import { AdminListToolbar } from "@/components/admin/AdminListToolbar";
import { AdminListEnd, useAdminList } from "@/components/admin/useAdminList";
import { AdminToast } from "@/components/admin/AdminToast";
import type { AdminToastMessage } from "@/components/admin/AdminToast";
import { AdminModal } from "@/components/admin/AdminModal";
import { RepairAdminActions } from "@/components/admin/RepairAdminActions";
import type { RepairBatchReviewResult, RepairCategoryView, RepairView } from "@/types/contracts";

type Filters = {
  query: string;
  status: string;
  result: string;
  categoryId: string;
  repairDateFrom: string;
  repairDateTo: string;
};

const QUERY_OPTIONS = tableQueryOptions("repairs");

const EMPTY_FILTERS: Filters = {
  query: "",
  status: "",
  result: "",
  categoryId: "",
  repairDateFrom: "",
  repairDateTo: "",
};

const COLUMNS: ColumnSpec[] = repairTableSpec.fields.map((field) => ({
  id: field.key,
  width: field.width ?? 0,
  label: field.label || field.headLabel || "",
}));
const COLUMN_STORAGE_KEY = "zafu-pchospital:admin-columns:repairs:v1";

/**
 * 维修审核（M6 §64）。
 *
 * 批量操作走 `POST /api/v1/admin/repairs/batch-reviews`，服务端逐条复用单条审核路径，
 * 因此允许部分成功 —— 这里必须把逐条结果展示出来，不能只报一句「批量失败」。
 */
export function RepairAdminPanel() {
  const copy = adminCopy.repairs;
  /** 批量逐条失败明细要留在页面上，不能自动消失。 */
  const [message, setMessage] = useState("");
  /** 一次性成功反馈：走顶部浮层，不占布局。 */
  const [toast, setToast] = useState<AdminToastMessage | null>(null);
  const [categories, setCategories] = useState<RepairCategoryView[]>([]);
  const query = useTableQuery(QUERY_OPTIONS, EMPTY_FILTERS);
  const requestParams = query.params;
  const sortRules = query.value.sort;
  const setSortRules = query.setSort;
  const [selected, setSelected] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  /** 表头排序（三态循环由内核算好；空数组 = 服务端默认顺序：维修日期倒序）。 */
  const resize = useColumnResize({ storageKey: COLUMN_STORAGE_KEY, columns: COLUMNS });
  const [rejectNote, setRejectNote] = useState("");
  /** 批量退回的原因填在弹层里（顶栏只放动作按钮）。 */
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 页面自己的错误（批量失败等）；取数错误来自 `list.problem`。 */
  const [actionProblem, setProblem] = useState("");

  // 取数状态收在 `useAdminList`：往下滚动自动接下一页（邮箱式的连续列表）。
  const list = useAdminList<RepairView>(
    useCallback(
      (targetPage: number, signal?: AbortSignal) =>
        adminFetch<RepairView[]>(`/api/v1/admin/repairs?${requestParams(targetPage)}`, { signal }),
      [requestParams],
    ),
    { queryKey: query.ready ? query.signature : null },
  );
  const { items, pagination, state, problem, loadingMore } = list;
  const selectionFilter = JSON.stringify([query.value.fixed, query.value.filters]);
  useEffect(() => {
    setSelected([]);
  }, [selectionFilter]);
  useEffect(() => {
    let alive = true;
    void adminFetch<RepairCategoryView[]>("/api/v1/repair-categories").then((result) => {
      if (alive && result.ok) setCategories(result.data);
    });
    return () => {
      alive = false;
    };
  }, []);
  const shownProblem = actionProblem || problem;

  /** 单元格渲染要用的运行时值：勾选状态、勾选回调、打开详情。 */
  const repairContext: RepairTableContext = {
    selected,
    onToggleSelected: (recordId, checked) => {
      if (list.refreshing) return;
      setSelected((current) =>
        checked ? [...current, recordId] : current.filter((id) => id !== recordId),
      );
    },
    onDetail: setActiveId,
  };

  const load = useCallback(async () => {
    // 换筛选后清空选择，避免「已选 N 条」与当前列表无关。
    setSelected([]);
    await list.reload();
  }, [list]);

  async function runBatch(decision: "APPROVED" | "REJECTED") {
    if (decision === "REJECTED" && !rejectNote.trim()) {
      setProblem(copy.review.rejectHint);
      return;
    }
    setBusy(true);
    setMessage("");
    setToast(null);
    setProblem("");
    const result = await adminFetch<RepairBatchReviewResult>(
      "/api/v1/admin/repairs/batch-reviews",
      {
        method: "POST",
        body: {
          recordIds: selected,
          decision,
          note: rejectNote.trim() || undefined,
          // 每次提交一个新批次键；服务端按 `${key}:${recordId}` 派生成各记录的幂等键。
          idempotencyKey: createIdempotencyKey(),
        },
      },
    );
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    if (result.data.failed.length === 0) {
      setToast({
        text: `已处理 ${result.data.succeeded.length} 条记录。`,
        // 批量退回是对记录说「不」，用叉。
        tone: decision === "APPROVED" ? "success" : "neutral",
      });
    } else {
      setMessage(
        `${adminShared.batchPartial}成功 ${result.data.succeeded.length} 条，失败 ${result.data.failed.length} 条：${result.data.failed
          .map((item) => `${item.recordId.slice(0, 8)}… ${item.message}`)
          .join("；")}`,
      );
    }
    setRejectNote("");
    setRejecting(false);
    await load();
  }

  const allSelected = items.length > 0 && items.every((item) => selected.includes(item.id));

  return (
    <div className="admin-workspace__content">
      <div className="admin-workspace__header">
        <div>
          <h1 className="admin-workspace__title" id="admin-repairs-title">
            {copy.title}
          </h1>
        </div>
      </div>

      <AdminToast toast={toast} onDismiss={() => setToast(null)} />

      {message ? (
        <p className="admin-status" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
      {shownProblem ? (
        <p className="admin-status admin-status--error" role="alert">
          {shownProblem}
        </p>
      ) : null}

      <AdminTableQuery
        ready={query.ready}
        value={query.value}
        options={QUERY_OPTIONS}
        quick={[
          { key: "query", label: copy.filter.query },
          {
            key: "status",
            label: copy.filter.status,
            options: Object.entries(repairStatusLabels).map(([value, label]) => ({ value, label })),
          },
          {
            key: "categoryId",
            label: copy.filter.category,
            options: categories.map((item) => ({ value: item.id, label: item.name })),
          },
        ]}
        statusTabs={{
          key: "status",
          label: copy.filter.status,
          // 页签按审核流程排序，草稿放在最后；「全部」由工具栏统一补在最前。
          options: (["PENDING", "APPROVED", "REJECTED", "DRAFT"] as const).map((value) => ({
            value,
            label: repairStatusLabels[value],
          })),
        }}
        onChange={query.setValue}
        onClear={query.reset}
        summary={list.summary}
        refreshing={list.refreshing}
        problem={list.problem}
        onResetColumns={resize.reset}
      />

      {state === "loading" ? (
        <p className="admin-status" role="status">
          {adminShared.loading}
        </p>
      ) : null}

      {state === "error" ? (
        <Card variant="notice">
          <p>{shownProblem || adminShared.loadFailed}</p>
          <Button onClick={() => void load()}>{adminShared.reload}</Button>
        </Card>
      ) : null}

      {state === "ready" ? (
        <div className="admin-list">
          <AdminListToolbar
            count={(list.refreshing
              ? tableCopy.updating
              : list.problem
                ? tableCopy.previousCount
                : tableCopy.count
            ).replace("{count}", String(pagination?.total ?? items.length))}
          >
            <AdminBatchTools
              allSelected={allSelected}
              selectAllLabel={copy.table.selectAll}
              onSelectAll={(checked) => {
                if (!list.refreshing) setSelected(checked ? items.map((item) => item.id) : []);
              }}
              count={selected.length}
              selectedLabel={copy.batch.selected}
              noneLabel={copy.batch.none}
              clearLabel={copy.batch.clear}
              onClear={() => setSelected([])}
              actions={
                <>
                  <Button
                    disabled={busy || list.refreshing || selected.length === 0}
                    icon="check"
                    onClick={() => void runBatch("APPROVED")}
                  >
                    {copy.batch.approve}
                  </Button>
                  <Button
                    disabled={busy || list.refreshing || selected.length === 0}
                    onClick={() => setRejecting(true)}
                  >
                    {copy.batch.reject}
                  </Button>
                </>
              }
            />
            <AdminTableExport
              path="/api/v1/admin/repairs/export"
              params={() => query.params(1)}
              disabled={busy || list.refreshing}
              onError={setProblem}
              onDone={(text) => setToast({ text, tone: "success" })}
            />
          </AdminListToolbar>
          {/* 列宽与渲染来自同一份 spec；复用成员表的竖线拖动、键盘调整与本地偏好。 */}
          <AdminTable
            spec={repairTableSpec}
            items={items}
            renderContext={repairContext}
            sort={sortRules}
            onSortChange={setSortRules}
            emptyText={adminShared.empty}
            widths={resize.widths}
            colRefs={resize.colRefs}
            tableRef={resize.tableRef}
            wrapClassName="admin-table-wrap admin-table-wrap--resizable"
            className="admin-table admin-table--resizable admin-table--repairs"
            overlay={
              <div className="admin-colgrid">
                {resize.boundaries.map((boundary) => (
                  <span
                    key={boundary.id}
                    style={{ insetInlineStart: `${boundary.x}px` }}
                    {...resize.lineProps(boundary.id, boundary.label)}
                  />
                ))}
              </div>
            }
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

      {activeId
        ? (() => {
            const record = items.find((item) => item.id === activeId);
            if (!record) return null;
            return (
              <RepairAdminActions
                record={record}
                categories={categories}
                onClose={() => setActiveId(null)}
                onChanged={() => void load()}
              />
            );
          })()
        : null}

      {/* 批量退回：原因必填，所以先用弹层收原因再提交（与单条退回同一句话术）。 */}
      {rejecting ? (
        <AdminModal
          title={copy.review.rejectTitle}
          subtitle={copy.batch.selected.replace("{count}", String(selected.length))}
          onClose={() => setRejecting(false)}
        >
          <p className="admin-note">{copy.review.rejectHint}</p>
          <label className="field">
            <span className="field__label">{copy.review.rejectTitle}</span>
            <input
              className="field__input"
              value={rejectNote}
              maxLength={2000}
              autoFocus
              placeholder={copy.review.notePlaceholder}
              onChange={(event) => setRejectNote(event.currentTarget.value)}
            />
          </label>
          <div className="signup__actions">
            <Button
              variant="solid"
              disabled={busy || !rejectNote.trim()}
              onClick={() => void runBatch("REJECTED")}
            >
              {busy ? adminShared.submitting : copy.batch.rejectSubmit}
            </Button>
            <Button variant="ghost" onClick={() => setRejecting(false)}>
              {copy.review.cancel}
            </Button>
          </div>
        </AdminModal>
      ) : null}
    </div>
  );
}
