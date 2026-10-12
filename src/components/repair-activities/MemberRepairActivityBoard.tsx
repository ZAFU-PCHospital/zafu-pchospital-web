"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { AdminToast, type AdminToastMessage } from "@/components/admin/AdminToast";
import { formatShanghaiDateTime } from "@/components/repair-activities/activity-format";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { repairStatusLabels } from "@/config/repairs";
import { memberRepairActivitiesCopy, repairActivitiesPage } from "@/config/repair-activities";
import {
  canOperateActivityStaff,
  sortQueueByCheckedInAt,
  type RepairActivityIssueType,
} from "@/features/repair-activities/repair-activity-validation";
import type {
  StaffBoardView,
  StaffRegistrationView,
  StaffServeDraft,
} from "@/features/repair-activities/repair-activity-staff-service";

type Props = { activityId: string };

export function MemberRepairActivityBoard({ activityId }: Props) {
  const router = useRouter();
  const copy = memberRepairActivitiesCopy.board;
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [board, setBoard] = useState<StaffBoardView | null>(null);
  const [message, setMessage] = useState("");
  const [toast, setToast] = useState<AdminToastMessage | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<StaffRegistrationView | null>(null);
  const [checkInConfirmOpen, setCheckInConfirmOpen] = useState(false);
  const [checkInRows, setCheckInRows] = useState<StaffRegistrationView[]>([]);
  const [issueTypeDrafts, setIssueTypeDrafts] = useState<Record<string, RepairActivityIssueType>>(
    {},
  );
  const [checkInError, setCheckInError] = useState("");
  const checkInPending = useRef(false);
  const hasBoard = useRef(false);
  const boardElement = useRef<HTMLDivElement>(null);
  const scrollPosition = useRef<{ x: number; y: number } | null>(null);
  const request = useRef<{ background: boolean } | null>(null);
  /** 全局接单拦截弹层（issue #79 第 6 项）：点击「接待」命中未完成草稿时出现，不发请求。 */
  const [pendingNotice, setPendingNotice] = useState<StaffServeDraft | null>(null);
  const paused =
    busy !== null || checkInConfirmOpen || withdrawTarget !== null || pendingNotice !== null;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const load = useCallback(
    async (background = false): Promise<StaffBoardView | null> => {
      if (background && (pausedRef.current || request.current)) return null;
      // 用请求身份丢弃过期响应；清理 effect 时不主动 abort，避免开发模式报取消异常。
      const active = { background };
      request.current = active;
      if (!background) setMessage("");
      try {
        const response = await fetch(`/api/v1/member/repair-activities/${activityId}/board`, {
          cache: "no-store",
        });
        const json = (await response.json()) as {
          success: boolean;
          data?: StaffBoardView;
          error?: { message?: string };
        };
        if (request.current !== active) return null;
        if (background && (pausedRef.current || document.visibilityState !== "visible"))
          return null;
        if (!response.ok || !json.success || !json.data) {
          throw new Error(json.error?.message ?? copy.loadFailed);
        }
        if (hasBoard.current && boardElement.current) {
          scrollPosition.current = { x: window.scrollX, y: window.scrollY };
          // 列表缩短时保留原高度，避免浏览器先把滚动位置夹回页首。
          if (window.scrollY > 0) {
            boardElement.current.style.minHeight = `${boardElement.current.getBoundingClientRect().height}px`;
          }
        }
        setBoard(json.data);
        hasBoard.current = true;
        const eligibleIds = new Set(json.data.eligible.map((row) => row.id));
        setSelected((current) => new Set([...current].filter((id) => eligibleIds.has(id))));
        setState("ready");
        return json.data;
      } catch (error) {
        if (request.current !== active) return null;
        // 自动同步失败保留数据与操作反馈，下一轮继续重试。
        if (background && hasBoard.current) return null;
        if (hasBoard.current) {
          setMessage(copy.refreshFailed);
        } else {
          setState("error");
          setMessage(error instanceof Error ? error.message : copy.loadFailed);
        }
        return null;
      } finally {
        if (request.current === active) request.current = null;
      }
    },
    [activityId, copy.loadFailed, copy.refreshFailed],
  );

  useEffect(() => {
    void load();
    const onResize = () => {
      if (boardElement.current) boardElement.current.style.minHeight = "";
    };
    window.addEventListener("resize", onResize);
    return () => {
      request.current = null;
      window.removeEventListener("resize", onResize);
    };
  }, [load]);

  useEffect(() => {
    if (paused) {
      if (request.current?.background) {
        request.current = null;
      }
      return;
    }
    const refresh = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load, paused]);

  useLayoutEffect(() => {
    const position = scrollPosition.current;
    scrollPosition.current = null;
    if (position && (window.scrollX !== position.x || window.scrollY !== position.y)) {
      window.scrollTo({ left: position.x, top: position.y, behavior: "instant" });
    }
  }, [board]);

  async function postJson<T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: true; data: T } | { ok: false; message: string; code?: string }> {
    // 写请求开始时使旧的读取失效，不能让提交前的快照覆盖操作结果。
    request.current = null;
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await response.json()) as {
        success: boolean;
        data?: T;
        error?: { message?: string; code?: string };
      };
      if (!json.success || json.data === undefined) {
        return {
          ok: false,
          message: json.error?.message ?? copy.loadFailed,
          code: json.error?.code,
        };
      }
      return { ok: true, data: json.data };
    } catch {
      return { ok: false, message: copy.loadFailed };
    }
  }

  async function attend() {
    setBusy("attend");
    setToast(null);
    const result = await postJson<{ attended: boolean }>(
      `/api/v1/member/repair-activities/${activityId}/attendance`,
      {},
    );
    setBusy(null);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setToast({ text: copy.attendSuccess, tone: "success" });
    await load();
  }

  function openCheckInConfirm() {
    if (busy !== null || checkInPending.current) return;
    const rows = board?.eligible.filter((row) => selected.has(row.id)) ?? [];
    if (rows.length === 0) {
      setMessage(copy.selectNone);
      return;
    }
    setCheckInRows(rows);
    setIssueTypeDrafts(Object.fromEntries(rows.map((row) => [row.id, row.issueType])));
    setCheckInError("");
    setCheckInConfirmOpen(true);
  }

  function closeCheckInConfirm() {
    if (checkInPending.current) return;
    setCheckInConfirmOpen(false);
    setCheckInRows([]);
    setIssueTypeDrafts({});
    setCheckInError("");
  }

  async function confirmCheckIn() {
    if (checkInPending.current || busy !== null || checkInRows.length === 0) return;
    checkInPending.current = true;
    setBusy("check-in");
    setToast(null);
    setMessage("");
    setCheckInError("");
    const issueTypeUpdates = checkInRows
      .filter((row) => issueTypeDrafts[row.id] !== row.issueType)
      .map((row) => ({ registrationId: row.id, issueType: issueTypeDrafts[row.id] }));
    const result = await postJson<{ checkedIn: StaffRegistrationView[] }>(
      `/api/v1/member/repair-activities/${activityId}/check-in`,
      {
        registrationIds: checkInRows.map((row) => row.id),
        ...(issueTypeUpdates.length ? { issueTypeUpdates } : {}),
      },
    );
    if (!result.ok) {
      setCheckInError(result.message);
      checkInPending.current = false;
      setBusy(null);
      return;
    }
    setCheckInConfirmOpen(false);
    setCheckInRows([]);
    setIssueTypeDrafts({});
    setSelected(new Set());
    // 即使后续刷新失败，也展示已经提交成功的队列及其保存后的类型。
    setBoard((current) => {
      if (!current) return current;
      const savedIds = new Set(result.data.checkedIn.map((row) => row.id));
      return {
        ...current,
        eligible: current.eligible.filter((row) => !savedIds.has(row.id)),
        queue: sortQueueByCheckedInAt([
          ...current.queue.filter((row) => !savedIds.has(row.id)),
          ...result.data.checkedIn,
        ]),
      };
    });
    setToast({
      text: issueTypeUpdates.length ? copy.checkInUpdatedSuccess : copy.checkInSuccess,
      tone: "success",
    });
    const fresh = await load();
    if (!fresh) setMessage(copy.checkInRefreshFailed);
    checkInPending.current = false;
    setBusy(null);
  }

  async function confirmWithdraw() {
    if (!withdrawTarget) return;
    const registrationId = withdrawTarget.id;
    setBusy(`withdraw:${registrationId}`);
    setToast(null);
    setMessage("");
    const result = await postJson<StaffRegistrationView>(
      `/api/v1/member/repair-activities/${activityId}/withdraw`,
      { registrationId },
    );
    setBusy(null);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setWithdrawTarget(null);
    setToast({ text: copy.withdrawSuccess, tone: "neutral" });
    await load();
  }

  async function serve(registrationId: string) {
    setBusy(`serve:${registrationId}`);
    setToast(null);
    setMessage("");
    const result = await postJson<{ repairRecordId: string }>(
      `/api/v1/member/repair-activities/${activityId}/serve`,
      { registrationId },
    );
    setBusy(null);
    if (!result.ok) {
      if (result.code === "ACTIVITY_SERVE_DRAFT_PENDING") {
        // 服务端兜底（多标签 / 并发）：先刷新看板，再按最新的 pendingServeDraft 弹层；
        // 刷新后若无草稿（例如另一标签已提交），退回内联提示。
        const fresh = await load();
        if (fresh?.pendingServeDraft) setPendingNotice(fresh.pendingServeDraft);
        else setMessage(result.message);
        return;
      }
      setMessage(result.message);
      return;
    }
    setToast({ text: copy.serveSuccess, tone: "success" });
    await load();
  }

  /** 点击「接待」：先看客户端已加载的 pendingServeDraft，非空则弹层且**不发请求**。 */
  function requestServe(registrationId: string) {
    if (board?.pendingServeDraft) {
      setPendingNotice(board.pendingServeDraft);
      return;
    }
    void serve(registrationId);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (state === "loading") {
    return (
      <div className="activity-board activity-board--loading" role="status">
        <p className="muted">{copy.loading}</p>
      </div>
    );
  }
  if (state === "error" || !board) {
    return (
      <div className="activity-board">
        <p className="admin-status admin-status--error" role="alert">
          {message || copy.loadFailed}
        </p>
        <Button href="/member/repair-activities" variant="ghost">
          {copy.back}
        </Button>
      </div>
    );
  }

  const staffOpen = canOperateActivityStaff(board.activity.signupClosesAt);
  const opsDisabled = !staffOpen || !board.attended || busy !== null;
  const withdrawBusy = withdrawTarget ? busy === `withdraw:${withdrawTarget.id}` : false;
  const checkInBusy = busy === "check-in";

  return (
    <div ref={boardElement} className="activity-board content-start">
      <div className="activity-board__toolbar">
        <Button href="/member/repair-activities" variant="ghost">
          {copy.back}
        </Button>
        {board.attended ? (
          <span className="admin-tag admin-tag--accent">{copy.attendedBadge}</span>
        ) : (
          <Button
            className="activity-board__attend-cta"
            variant="solid"
            onClick={() => void attend()}
            disabled={!staffOpen || busy !== null}
          >
            {busy === "attend" ? copy.attending : copy.attendCta}
          </Button>
        )}
      </div>

      {!staffOpen || !board.attended ? (
        <Card className="activity-board__attend-banner" variant="notice">
          <p role="status">{staffOpen ? copy.attendPrompt : copy.signupNotClosed}</p>
        </Card>
      ) : null}
      <p className="admin-status activity-board__feedback" role="alert">
        {message}
      </p>
      <AdminToast toast={toast} onDismiss={() => setToast(null)} />

      <div className="activity-board__panes">
        <Card className="activity-board__pane repair-panel">
          <header className="activity-board__pane-head">
            <h2>{copy.eligibleTitle}</h2>
            <span className="member-section__tag">{copy.eligibleTag}</span>
          </header>
          {board.eligible.length === 0 ? (
            <p className="muted activity-board__empty">{copy.eligibleEmpty}</p>
          ) : (
            <ul className="activity-board__list">
              {board.eligible.map((row) => (
                <li key={row.id} className="activity-board__row">
                  <label className="activity-board__check">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      disabled={opsDisabled}
                      onChange={() => toggle(row.id)}
                    />
                    <span>
                      <strong>{row.name}</strong>
                      <span className="muted">
                        {" "}
                        · {row.phoneMasked} · {row.issueTypeLabel}
                        {/* 机型选填：没填就不占位（issue #68）。 */}
                        {row.deviceModel ? ` · ${copy.deviceModel} ${row.deviceModel}` : null}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="activity-board__actions">
            <div>
              <p className="muted m-0">{copy.selectHint}</p>
              <p className="text-ink-3 m-0 text-xs">{copy.checkInStaffReminder}</p>
            </div>
            <Button
              variant="solid"
              onClick={openCheckInConfirm}
              disabled={opsDisabled || selected.size === 0}
            >
              {busy === "check-in" ? copy.checkingIn : copy.checkIn}
            </Button>
          </div>
        </Card>

        <Card className="activity-board__pane repair-panel">
          <header className="activity-board__pane-head">
            <h2>{copy.queueTitle}</h2>
            <span className="member-section__tag">{copy.queueTag}</span>
          </header>
          {board.queue.length === 0 ? (
            <p className="muted activity-board__empty">{copy.queueEmpty}</p>
          ) : (
            <ul className="activity-board__list">
              {board.queue.map((row, index) => (
                <li key={row.id} className="activity-board__row activity-board__row--queue">
                  <div className="activity-board__queue-main">
                    {/* 队列位次：按当前渲染顺序从 1 开始（服务端已按签到时间升序）。 */}
                    <span className="activity-board__queue-rank">
                      {copy.queueRank.replace("{index}", String(index + 1))}
                    </span>
                    <div>
                      <strong>{row.name}</strong>
                      <div className="muted">
                        {copy.phone} {row.phoneMasked} · {copy.issueType} {row.issueTypeLabel}
                      </div>
                      {row.deviceModel ? (
                        <div className="muted">
                          {copy.deviceModel} {row.deviceModel}
                        </div>
                      ) : null}
                      {row.checkedInAt ? (
                        <div className="muted">
                          {copy.checkedInAt} {formatShanghaiDateTime(row.checkedInAt)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="activity-board__row-actions">
                    <Button
                      variant="solid"
                      onClick={() => requestServe(row.id)}
                      disabled={opsDisabled}
                    >
                      {busy === `serve:${row.id}` ? copy.serving : copy.serve}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setWithdrawTarget(row)}
                      disabled={!board.attended || busy !== null}
                    >
                      {busy === `withdraw:${row.id}` ? copy.withdrawing : copy.withdraw}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* 「已接待」= 常驻区块（issue #79 第 6 项）：数据为空只换内容，区块本身不出现 / 消失。 */}
      <Card className="activity-board__pane repair-panel">
        <header className="activity-board__pane-head">
          <h2>{copy.servedTitle}</h2>
          <span className="member-section__tag">{copy.servedTag}</span>
        </header>
        {board.served.length === 0 ? (
          <p className="muted activity-board__empty">{copy.servedEmpty}</p>
        ) : (
          <ul className="activity-board__list">
            {board.served.map((row) => {
              const recordId = row.repairRecordId;
              return (
                <li key={row.id} className="activity-board__row">
                  <div className="activity-board__queue-main">
                    <div>
                      <strong>{row.name}</strong>{" "}
                      {row.recordStatus ? (
                        <span className="admin-tag">{repairStatusLabels[row.recordStatus]}</span>
                      ) : null}
                      <div className="muted">
                        {copy.phone} {row.phoneMasked}
                      </div>
                    </div>
                  </div>
                  <div className="activity-board__row-actions">
                    {/* 记录缺失或已软删除：占位文案，不出链接。 */}
                    {!recordId || !row.recordStatus ? (
                      <span className="muted">{copy.recordMissing}</span>
                    ) : row.recordStatus === "DRAFT" || row.recordStatus === "REJECTED" ? (
                      <Button
                        href={`/member/repairs/${recordId}/edit?returnActivityId=${encodeURIComponent(activityId)}`}
                      >
                        {copy.fillRepair}
                      </Button>
                    ) : (
                      <Button variant="ghost" href={`/member/repairs/${recordId}`}>
                        {copy.viewRepair}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {checkInConfirmOpen ? (
        <ConfirmDialog
          title={copy.checkInConfirmTitle}
          cancelLabel={copy.checkInCancel}
          confirmLabel={checkInBusy ? copy.checkingIn : copy.checkInConfirm}
          busy={checkInBusy}
          onClose={closeCheckInConfirm}
          onConfirm={() => void confirmCheckIn()}
        >
          <p>{copy.checkInConfirmHint}</p>
          <p className="text-ink-3 text-xs">{copy.checkInStaffReminder}</p>
          <ol className="activity-board__list">
            {checkInRows.map((row, index) => (
              <li key={row.id} className="activity-board__row">
                <div>
                  <span className="text-ink-3 text-xs">{index + 1}. </span>
                  <strong>{row.name}</strong> · {row.phoneMasked}
                </div>
                {row.deviceModel ? (
                  <p className="muted m-0">
                    {copy.deviceModel} {row.deviceModel}
                  </p>
                ) : null}
                <div className="field">
                  <label className="field__label" htmlFor={`check-in-issue-${row.id}`}>
                    {row.name} · {copy.issueType}
                  </label>
                  <select
                    id={`check-in-issue-${row.id}`}
                    className="field__input"
                    value={issueTypeDrafts[row.id]}
                    disabled={checkInBusy}
                    onChange={(event) => {
                      if (checkInPending.current) return;
                      const issueType = event.target.value as RepairActivityIssueType;
                      setIssueTypeDrafts((drafts) => ({ ...drafts, [row.id]: issueType }));
                    }}
                  >
                    {repairActivitiesPage.issueTypes.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            ))}
          </ol>
          <p className="admin-status activity-board__feedback" role="alert">
            {checkInError}
          </p>
        </ConfirmDialog>
      ) : null}

      {withdrawTarget ? (
        <ConfirmDialog
          title={copy.withdrawConfirmTitle}
          cancelLabel={copy.withdrawCancel}
          confirmLabel={withdrawBusy ? copy.withdrawing : copy.withdrawConfirm}
          busy={withdrawBusy}
          onClose={() => {
            if (!withdrawBusy) setWithdrawTarget(null);
          }}
          onConfirm={() => void confirmWithdraw()}
        >
          <p>{copy.withdrawConfirmHint}</p>
          <p>
            <strong>
              {withdrawTarget.name} · {withdrawTarget.phoneMasked}
            </strong>
          </p>
        </ConfirmDialog>
      ) : null}

      {pendingNotice ? (
        <ConfirmDialog
          title={copy.pendingServeTitle}
          cancelLabel={copy.pendingServeDismiss}
          confirmLabel={copy.pendingServeFill}
          onClose={() => setPendingNotice(null)}
          onConfirm={() => {
            router.push(
              `/member/repairs/${pendingNotice.repairRecordId}/edit?returnActivityId=${encodeURIComponent(activityId)}`,
            );
          }}
        >
          <p>
            {copy.pendingServeBody
              .replace("{owner}", pendingNotice.ownerName)
              .replace("{activity}", pendingNotice.activityTitle)}
          </p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
