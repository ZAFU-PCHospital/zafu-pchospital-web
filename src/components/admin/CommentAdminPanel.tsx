"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AdminListToolbar } from "@/components/admin/AdminListToolbar";
import { AdminModal } from "@/components/admin/AdminModal";
import { AdminTable } from "@/components/admin/AdminTable";
import { AdminToast } from "@/components/admin/AdminToast";
import type { AdminToastMessage } from "@/components/admin/AdminToast";
import { commentTableSpec, type CommentTableContext } from "@/components/admin/comment-table-spec";
import { AdminListEnd, useAdminList } from "@/components/admin/useAdminList";
import { RepairAdminActions } from "@/components/admin/RepairAdminActions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { adminCopy, adminShared, commentDeletedLabels } from "@/config/admin";
import { adminFetch } from "@/features/admin/admin-client";
import {
  CommentModerationFilter,
  type AdminCommentEntry,
  type RepairCategoryView,
  type RepairDetailView,
} from "@/types/contracts";

type Filters = {
  query: string;
  deleted: CommentModerationFilter;
  createdFrom: string;
  createdTo: string;
};

const EMPTY_FILTERS: Filters = { query: "", deleted: "ACTIVE", createdFrom: "", createdTo: "" };

/**
 * 评论管理（M6 批次 2，需求 §37）。
 *
 * 需求只有两件事：「删除违规评论」与「查看评论所属维修记录」，界面就只做这两件：
 *
 * - 列表把**所属记录**（成员 / 维修日期 / 审核状态）直接摆在评论旁边，
 *   不用点开就能判断这条评论挂在谁身上；
 * - 「所属记录」按钮复用批 1 的记录窗口（`RepairAdminActions`）—— 那里已经能看照片、
 *   看时间线、审核、改数据，另做一个只读记录详情等于同样的信息两处维护；
 * - 删除是**软删除**：列表默认只看未删除的，但可以切到「已删除」复核 —— 软删除后评论
 *   仍在库里，界面若完全看不见，管理员无法确认删除结果。
 */
export function CommentAdminPanel() {
  const copy = adminCopy.comments;
  /** 页面自己产生的错误（删除失败、记录读取失败）；取数错误走 `list.problem`。 */
  const [actionProblem, setProblem] = useState("");
  const [toast, setToast] = useState<AdminToastMessage | null>(null);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<AdminCommentEntry | null>(null);
  const [record, setRecord] = useState<{
    detail: RepairDetailView;
    categories: RepairCategoryView[];
  } | null>(null);
  const [recordProblem, setRecordProblem] = useState("");

  // 取数状态收在 `useAdminList` 里：往下滚动自动接下一页（邮箱式的连续列表，
  // 不再有「上一页 / 下一页」）。筛选变化时由下面的 effect 重置回第一页。
  const list = useAdminList<AdminCommentEntry>(
    useCallback(
      (targetPage: number) => {
        const params = new URLSearchParams({ page: String(targetPage), pageSize: "20" });
        if (applied.query) params.set("query", applied.query);
        if (applied.deleted) params.set("deleted", applied.deleted);
        if (applied.createdFrom) params.set("createdFrom", applied.createdFrom);
        if (applied.createdTo) params.set("createdTo", applied.createdTo);
        return adminFetch<AdminCommentEntry[]>(`/api/v1/admin/comments?${params.toString()}`);
      },
      [applied],
    ),
  );
  const { items, pagination, state, problem, loadingMore } = list;
  const shownProblem = actionProblem || problem;
  /** 单元格渲染要用的运行时值：删除按钮的禁用态、打开所属记录、弹出删除确认框。 */
  const commentContext: CommentTableContext = {
    busy,
    onOpenRecord: (recordId) => void openRecord(recordId),
    onRemove: setRemoving,
  };

  const load = useCallback(async () => {
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
      query: data.query ?? "",
      deleted: (data.deleted || "ACTIVE") as CommentModerationFilter,
      createdFrom: data.createdFrom ?? "",
      createdTo: data.createdTo ?? "",
    });
  }

  async function openRecord(recordId: string) {
    setRecordProblem("");
    const [detail, categories] = await Promise.all([
      adminFetch<RepairDetailView>(`/api/v1/repairs/${recordId}`),
      adminFetch<RepairCategoryView[]>("/api/v1/repair-categories"),
    ]);
    if (!detail.ok) {
      setRecordProblem(`${copy.recordWindow.failed}（${detail.message}）`);
      return;
    }
    setRecord({ detail: detail.data, categories: categories.ok ? categories.data : [] });
  }

  async function confirmRemove() {
    if (!removing) return;
    setBusy(true);
    setProblem("");
    setToast(null);
    const result = await adminFetch<{ deleted: boolean }>(`/api/v1/admin/comments/${removing.id}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setRemoving(null);
    setToast({ text: copy.removePanel.done, tone: "neutral" });
    await load();
  }

  return (
    <div className="admin-workspace__content">
      <div className="admin-workspace__header">
        <div>
          <h1 className="admin-workspace__title" id="admin-comments-title">
            {copy.title}
          </h1>
          <p className="admin-workspace__lead">{copy.lead}</p>
        </div>
      </div>

      <AdminToast toast={toast} onDismiss={() => setToast(null)} />

      {recordProblem ? (
        <p className="admin-status admin-status--error" role="alert">
          {recordProblem}
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
            <span className="field__label">{copy.filter.deleted}</span>
            <select className="field__input" name="deleted" defaultValue={applied.deleted}>
              {CommentModerationFilter.map((value) => (
                <option key={value} value={value}>
                  {commentDeletedLabels[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{copy.filter.dateFrom}</span>
            <input
              className="field__input"
              type="date"
              name="createdFrom"
              defaultValue={applied.createdFrom}
            />
          </label>
          <label className="field">
            <span className="field__label">{copy.filter.dateTo}</span>
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
          {/* 顶栏常驻（邮箱式）：说明当前删除态，右侧是总数。 */}
          <AdminListToolbar
            count={copy.count.replace("{count}", String(pagination?.total ?? items.length))}
          >
            <span className="admin-status">
              {copy.toolbar.status
                .replace("{label}", copy.filter.deleted)
                .replace("{state}", commentDeletedLabels[applied.deleted])}
            </span>
          </AdminListToolbar>
          {/* 表格本体由内核渲染（`AdminTable`）：表头与单元格内容都来自 `commentTableSpec`。
              评论表**不声明列宽**，因此内核不会输出 `<colgroup>`，列宽仍由浏览器按内容分配
              —— 与迁移前一致。面板不传 `onSortChange`：评论接口还没有 `sort` 参数，
              内核在不传时不渲染任何排序控件。 */}
          <AdminTable
            spec={commentTableSpec}
            items={items}
            renderContext={commentContext}
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

      {removing ? (
        <AdminModal title={copy.removePanel.title} onClose={() => setRemoving(null)}>
          <p className="admin-note">{copy.removePanel.hint}</p>
          <p className="admin-status">{removing.body}</p>
          <div className="signup__actions">
            <Button variant="solid" disabled={busy} onClick={() => void confirmRemove()}>
              {busy ? adminShared.submitting : copy.removePanel.submit}
            </Button>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              {copy.removePanel.cancel}
            </Button>
          </div>
        </AdminModal>
      ) : null}

      {record ? (
        <RepairAdminActions
          record={record.detail}
          categories={record.categories}
          onClose={() => setRecord(null)}
          onChanged={() => void load()}
        />
      ) : null}
    </div>
  );
}
