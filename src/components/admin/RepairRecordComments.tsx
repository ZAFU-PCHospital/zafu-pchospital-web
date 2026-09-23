"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { adminCopy, adminShared } from "@/config/admin";
import { adminFetch } from "@/features/admin/admin-client";
import type { RepairCommentView } from "@/types/contracts";

/**
 * 记录详情窗口里的评论列表（M6 第三轮验收）。
 *
 * 为什么要加这个：管理端的「评论管理」是**跨记录**的列表，管理员在那里看到一条评论、
 * 点「所属记录」打开了记录窗口，却看不到这条评论 —— 记录窗口里原本完全没有评论。
 * 于是「这条评论挂在哪、上下文是什么」始终无从确认，反馈里就是「找不到评论的入口」。
 *
 * 复用成员端的 `GET /api/v1/repairs/:id/comments`（`comment:read` + `assertCanReadRepair`，
 * 管理员两条都有），**不改任何契约**；删除走管理端的 `DELETE /api/v1/admin/comments/:id`
 * （`comment:moderate`）—— 那是跨记录、按评论 ID 操作的入口。
 *
 * 这里只读 + 删除，不做发表/回复：管理员在记录窗口里的目的是**审核与处置**，
 * 发表评论属于成员端的讨论功能，混进来会让这个窗口多出两套输入状态。
 */
export function RepairRecordComments({
  recordId,
  onChanged,
}: {
  recordId: string;
  onChanged: () => void;
}) {
  const copy = adminCopy.comments;
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [items, setItems] = useState<RepairCommentView[]>([]);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState((current) => (current === "ready" ? "ready" : "loading"));
    setProblem("");
    const result = await adminFetch<RepairCommentView[]>(
      `/api/v1/repairs/${recordId}/comments?page=1&pageSize=50`,
    );
    if (!result.ok) {
      setState("error");
      setProblem(result.message);
      return;
    }
    setItems(result.data);
    setState("ready");
  }, [recordId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(commentId: string) {
    setBusy(true);
    setProblem("");
    const result = await adminFetch<{ deleted: boolean }>(
      `/api/v1/admin/comments/${commentId}`,
      { method: "DELETE" },
    );
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    await load();
    onChanged();
  }

  const total = items.reduce((sum, item) => sum + 1 + item.replies.length, 0);

  return (
    <div>
      <h3 className="admin-panel__title">
        {copy.recordWindow.comments.replace("{count}", String(total))}
      </h3>

      {state === "loading" ? (
        <p className="admin-status" role="status">
          {adminShared.loading}
        </p>
      ) : null}

      {state === "error" ? (
        <>
          <p className="admin-status admin-status--error" role="alert">
            {problem}
          </p>
          <div className="signup__actions">
            <Button onClick={() => void load()}>{adminShared.reload}</Button>
          </div>
        </>
      ) : null}

      {state === "ready" && problem ? (
        <p className="admin-status admin-status--error" role="alert">
          {problem}
        </p>
      ) : null}

      {state === "ready" ? (
        items.length === 0 ? (
          <p className="admin-note">{copy.recordWindow.empty}</p>
        ) : (
          <ul className="admin-comments">
            {items.map((root) => (
              <li key={root.id}>
                <CommentRow comment={root} busy={busy} onRemove={remove} />
                {root.replies.length > 0 ? (
                  <ul className="admin-comments admin-comments--replies">
                    {root.replies.map((reply) => (
                      <li key={reply.id}>
                        <CommentRow comment={reply} busy={busy} onRemove={remove} isReply />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

function CommentRow({
  comment,
  busy,
  isReply = false,
  onRemove,
}: {
  comment: RepairCommentView;
  busy: boolean;
  isReply?: boolean;
  onRemove: (commentId: string) => void;
}) {
  const copy = adminCopy.comments;
  return (
    <div className="admin-comments__row">
      <p className="admin-comments__meta">
        <span className="admin-comments__author">{comment.author.name}</span>
        {isReply ? <span className="admin-tag admin-tag--muted">{copy.recordWindow.reply}</span> : null}
        <span>{formatDateTime(comment.createdAt)}</span>
      </p>
      <p className="admin-comments__body">{comment.body}</p>
      <Button
        variant="ghost"
        icon="trash"
        disabled={busy}
        onClick={() => onRemove(comment.id)}
      >
        <span className="sr-only">{copy.action.remove}</span>
      </Button>
    </div>
  );
}

/** `Asia/Shanghai` 的 `MM-DD HH:mm`：窗口里空间有限，不重复显示年份。 */
function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
