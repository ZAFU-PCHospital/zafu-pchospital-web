"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { AdminTable } from "@/components/admin/AdminTable";
import { repairTableSpec, type RepairTableContext } from "@/components/admin/repair-table-spec";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { adminCopy, adminShared } from "@/config/admin";
import { repairResultLabels, repairStatusLabels } from "@/config/repairs";
import { adminFetch, prefetchAdmin } from "@/features/admin/admin-client";
import { sortParam } from "@/lib/api/list-query";
import { AdminBatchTools } from "@/components/admin/AdminBatchTools";
import { AdminListToolbar } from "@/components/admin/AdminListToolbar";
import { AdminListEnd, useAdminList } from "@/components/admin/useAdminList";
import { AdminToast } from "@/components/admin/AdminToast";
import type { AdminToastMessage } from "@/components/admin/AdminToast";
import { AdminModal } from "@/components/admin/AdminModal";
import { RepairAdminActions } from "@/components/admin/RepairAdminActions";
import { RepairStatus, RepairResult } from "@/types/contracts";
import type { RepairBatchReviewResult, RepairCategoryView, RepairView } from "@/types/contracts";
import type { SortRule } from "@/types/table";

type Filters = {
  query: string;
  status: string;
  result: string;
  categoryId: string;
  repairDateFrom: string;
  repairDateTo: string;
};

const EMPTY_FILTERS: Filters = {
  query: "",
  status: "",
  result: "",
  categoryId: "",
  repairDateFrom: "",
  repairDateTo: "",
};

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
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  /** 表头排序（三态循环由内核算好；空数组 = 服务端默认顺序：维修日期倒序）。 */
  const [sortRules, setSortRules] = useState<SortRule[]>([]);
  const [rejectNote, setRejectNote] = useState("");
  /** 批量退回的原因填在弹层里（顶栏只放动作按钮）。 */
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 页面自己的错误（批量失败等）；取数错误来自 `list.problem`。 */
  const [actionProblem, setProblem] = useState("");

  // 取数状态收在 `useAdminList`：往下滚动自动接下一页（邮箱式的连续列表）。
  const list = useAdminList<RepairView>(
    useCallback(
      (targetPage: number) => {
        const params = new URLSearchParams({ page: String(targetPage), pageSize: "20" });
        for (const [key, value] of Object.entries(applied)) if (value) params.set(key, value);
        // 排序字段必须在服务端白名单里（`REPAIR_SORTABLE`），否则后端 400 ——
        // 表头只给白名单内的列渲染控件，两边同一份来源。
        const sort = sortParam(sortRules);
        if (sort) params.set("sort", sort);
        return adminFetch<RepairView[]>(`/api/v1/admin/repairs?${params}`);
      },
      [applied, sortRules],
    ),
  );
  const { items, pagination, state, problem, loadingMore } = list;
  const shownProblem = actionProblem || problem;

  /**
   * 排序变化后回到第一页：`useAdminList` 不猜调用方意图，重置一律由页面负责
   * （与筛选同一条约定）。用「上一次生效的排序」做闸门，挂载时不会多取一次；
   * 排序不改记录集合，所以**不清空已选**。
   */
  const sortSignature = sortParam(sortRules) ?? "";
  const appliedSort = useRef(sortSignature);
  useEffect(() => {
    if (appliedSort.current === sortSignature) return;
    appliedSort.current = sortSignature;
    void list.reload();
  }, [sortSignature, list]);

  /** 单元格渲染要用的运行时值：勾选状态、勾选回调、打开详情。 */
  const repairContext: RepairTableContext = {
    selected,
    onToggleSelected: (recordId, checked) =>
      setSelected((current) =>
        checked ? [...current, recordId] : current.filter((id) => id !== recordId),
      ),
    onDetail: setActiveId,
  };

  const load = useCallback(async () => {
    // 换筛选后清空选择，避免「已选 N 条」与当前列表无关。
    setSelected([]);
    // 分类下拉只在进页面时取一次；筛选变化时顺带刷新（幂等，代价很小）。
    const categoryResult = await adminFetch<RepairCategoryView[]>("/api/v1/repair-categories");
    if (categoryResult.ok) setCategories(categoryResult.data);
    await list.reload();
  }, [list]);

  useEffect(() => {
    void load();
    // `applied` 变化才重新取第一页；`list` 是稳定引用（内部用 ref 取最新筛选）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied]);

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    setApplied({
      query: (data.query ?? "").trim(),
      status: data.status ?? "",
      result: data.result ?? "",
      categoryId: data.categoryId ?? "",
      repairDateFrom: data.repairDateFrom ?? "",
      repairDateTo: data.repairDateTo ?? "",
    });
  }

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
          idempotencyKey: crypto.randomUUID(),
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
          <p className="admin-workspace__lead">{copy.lead}</p>
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

      <form
        method="post"
        className="admin-filters"
        onSubmit={submitFilters}
        aria-label={copy.filter.submit}
      >
        <div className="admin-filters__row">
          <label className="field">
            <span className="field__label">{copy.filter.query}</span>
            <input
              className="field__input"
              name="query"
              defaultValue={applied.query}
              maxLength={64}
            />
          </label>
          <label className="field">
            <span className="field__label">{copy.filter.status}</span>
            <select className="field__input" name="status" defaultValue={applied.status}>
              <option value="">{copy.filter.all}</option>
              {RepairStatus.map((status) => (
                <option key={status} value={status}>
                  {repairStatusLabels[status]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{copy.filter.result}</span>
            <select className="field__input" name="result" defaultValue={applied.result}>
              <option value="">{copy.filter.all}</option>
              {RepairResult.map((result) => (
                <option key={result} value={result}>
                  {repairResultLabels[result]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{copy.filter.category}</span>
            <select className="field__input" name="categoryId" defaultValue={applied.categoryId}>
              <option value="">{copy.filter.all}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{copy.filter.dateFrom}</span>
            <input
              className="field__input"
              type="date"
              name="repairDateFrom"
              defaultValue={applied.repairDateFrom}
            />
          </label>
          <label className="field">
            <span className="field__label">{copy.filter.dateTo}</span>
            <input
              className="field__input"
              type="date"
              name="repairDateTo"
              defaultValue={applied.repairDateTo}
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
          <p>{shownProblem || adminShared.loadFailed}</p>
          <Button onClick={() => void load()}>{adminShared.reload}</Button>
        </Card>
      ) : null}

      {state === "ready" ? (
        <div className="admin-list">
          {/* 顶栏常驻（邮箱式）：与成员管理共用 `AdminBatchTools`，结构完全一致。
              批量退回要填原因，原因输入框在弹层里（不塞进顶栏，顶栏就不会被撑高）。 */}
          <AdminListToolbar
            count={copy.count.replace("{count}", String(pagination?.total ?? items.length))}
          >
            <AdminBatchTools
              allSelected={allSelected}
              selectAllLabel={copy.table.selectAll}
              onSelectAll={(checked) => setSelected(checked ? items.map((item) => item.id) : [])}
              count={selected.length}
              selectedLabel={copy.batch.selected}
              noneLabel={copy.batch.none}
              clearLabel={copy.batch.clear}
              onClear={() => setSelected([])}
              actions={
                <>
                  <Button
                    disabled={busy || selected.length === 0}
                    icon="check"
                    onClick={() => void runBatch("APPROVED")}
                  >
                    {copy.batch.approve}
                  </Button>
                  <Button
                    disabled={busy || selected.length === 0}
                    onClick={() => setRejecting(true)}
                  >
                    {copy.batch.reject}
                  </Button>
                </>
              }
            />
          </AdminListToolbar>
          {/* 表格本体由内核渲染（`AdminTable`）：表头与单元格内容都来自 `repairTableSpec`。
              这张表**不声明列宽**，所以内核不输出 `<colgroup>`，列宽仍由浏览器按内容分配。
              排序：`sortKey` 与后端 `REPAIR_SORTABLE` 一一对应（成员 / 分类按**名字**排）。 */}
          <AdminTable
            spec={repairTableSpec}
            items={items}
            renderContext={repairContext}
            sort={sortRules}
            onSortChange={setSortRules}
            emptyText={adminShared.empty}
            rowProps={(record) => ({
              // 悬停即预取记录详情（窗口里的照片与评论都要靠它）。
              onMouseEnter: () => prefetchAdmin(`/api/v1/repairs/${record.id}`),
            })}
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
