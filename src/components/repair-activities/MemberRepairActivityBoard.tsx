"use client";

import { useRouter } from "next/navigation";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AdminModal } from "@/components/admin/AdminModal";
import { AdminToast, type AdminToastMessage } from "@/components/admin/AdminToast";
import { memberRepairActivityStatusBadgeClass } from "@/components/repair-activities/activity-status-badge";
import {
  ATTENDED_TAG_CLASS,
  recordStatusTagClass,
  recordStatusTagIcon,
} from "@/components/repair-activities/activity-record-tag";
import {
  formatShanghaiDateTime,
  formatShanghaiTime,
} from "@/components/repair-activities/activity-format";
import { BoardSyncStatus } from "./BoardSyncStatus";
import { useBoardResource } from "./useBoardResource";
import { RegistrationPhone } from "@/components/repair-activities/RegistrationPhone";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { PageAlert } from "@/components/ui/PageAlert";
import { cn } from "@/lib/utils";
import { createBoardSearch } from "./board-search";
import { repairStatusLabels } from "@/config/repairs";
import {
  memberRepairActivitiesCopy,
  memberRepairActivityStatusLabels,
  repairActivitiesPage,
} from "@/config/repair-activities";
import {
  activityEndExclusive,
  canOperateActivityStaff,
  sortQueueByCheckedInAt,
  type RepairActivityIssueType,
  type RepairActivityStatus,
} from "@/features/repair-activities/repair-activity-validation";
import type {
  StaffLiveBoardView,
  StaffServedBoardView,
  StaffAttendanceBoardView,
  StaffRegistrationView,
  StaffServedRow,
  StaffPendingServe,
  ServeResultView,
  RevertServeResultView,
} from "@/features/repair-activities/repair-activity-staff-service";

type Props = { activityId: string };

/** 手机端一次只展示一个分区（<1100px；宽屏由 CSS 显示全部并排栏）。 */
type MobilePane = "eligible" | "queue" | "served";

export function MemberRepairActivityBoard({ activityId }: Props) {
  const router = useRouter();
  const activityTarget = useMemo(() => ({ id: activityId }), [activityId]);
  const currentActivity = useRef<typeof activityTarget | null>(null);
  useLayoutEffect(() => {
    currentActivity.current = activityTarget;
    return () => {
      currentActivity.current = null;
    };
  }, [activityTarget]);
  const copy = memberRepairActivitiesCopy.board;
  const [clock, setClock] = useState(() => Date.now());
  const [serverEnded, setServerEnded] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const composingSearch = useRef(false);
  const [servedCollapsed, setServedCollapsed] = useState(false);
  const [toast, setToast] = useState<AdminToastMessage | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<StaffRegistrationView | null>(null);
  /** 撤销接待：确认弹层目标与在途标记。 */
  const [revertTarget, setRevertTarget] = useState<StaffServedRow | null>(null);
  const [revertBusy, setRevertBusy] = useState(false);
  const [checkInConfirmOpen, setCheckInConfirmOpen] = useState(false);
  const [checkInRows, setCheckInRows] = useState<StaffRegistrationView[]>([]);
  const [issueTypeDrafts, setIssueTypeDrafts] = useState<Record<string, RepairActivityIssueType>>(
    {},
  );
  const [checkInError, setCheckInError] = useState("");
  const checkInPending = useRef(false);
  const boardElement = useRef<HTMLDivElement>(null);
  /** 全局接单拦截弹层：点击「接待」命中未完成草稿时出现，不发请求。 */
  const [pendingNotice, setPendingNotice] = useState<StaffPendingServe | null>(null);
  /** 出勤成员弹层：仅活动管理员，只读名单。 */
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  /**
   * 手机端分区切换：<1100px 一次只展示一个分区。
   * 首次加载后落定默认分区（管理员优先「待签到」，成员固定「排队中」），
   * 之后保留用户点选，不因 5 秒刷新里数据变化自动跳转。
   */
  const [mobilePane, setMobilePane] = useState<MobilePane | null>(null);
  const paused =
    busy !== null ||
    checkInConfirmOpen ||
    withdrawTarget !== null ||
    revertTarget !== null ||
    pendingNotice !== null ||
    attendanceOpen;
  const [desktop, setDesktop] = useState(false);
  function preserveMobileHeight() {
    const element = boardElement.current;
    if (!element || desktop) return;
    // 刷新缩短名单时，仍留出容纳当前视口的高度，避免浏览器夹断滚动位置。
    element.style.minHeight =
      window.scrollY > 0
        ? `${Math.max(0, window.innerHeight - element.getBoundingClientRect().top)}px`
        : "";
  }
  useEffect(() => {
    if (desktop) return;
    const clearHeightProtectionAtTop = () => {
      const element = boardElement.current;
      if (element?.style.minHeight && window.scrollY === 0) element.style.minHeight = "";
    };
    window.addEventListener("scroll", clearHeightProtectionAtTop, { passive: true });
    return () => window.removeEventListener("scroll", clearHeightProtectionAtTop);
  }, [desktop]);
  const live = useBoardResource<StaffLiveBoardView>(activityId, "live", {
    automatic: true,
    paused,
    interval: serverEnded ? 60_000 : 5_000,
    succeeded(next) {
      preserveMobileHeight();
      setClock(Date.now());
      setMessage((current) =>
        current === copy.checkInRefreshFailed || current === copy.refreshFailed ? "" : current,
      );
      setServerEnded((ended) => ended || next.activity.status === "ENDED");
      setMobilePane(
        (current) => current ?? (next.canAdmin && next.eligible.length > 0 ? "eligible" : "queue"),
      );
      const ids = new Set(next.eligible.map((row) => row.id));
      setSelected((current) => new Set([...current].filter((id) => ids.has(id))));
    },
  });
  const served = useBoardResource<StaffServedBoardView>(activityId, "served", {
    automatic: Boolean(live.state.data) && (desktop || mobilePane === "served"),
    paused,
    interval: 60_000,
    succeeded: preserveMobileHeight,
  });
  const attendance = useBoardResource<StaffAttendanceBoardView>(activityId, "attendance", {
    automatic: false,
    paused,
    interval: 60_000,
  });
  const board = live.state.data
    ? {
        ...live.state.data,
        served: served.state.data?.served ?? [],
        attendanceMembers: attendance.state.data?.attendanceMembers ?? [],
      }
    : null;
  const state = board ? "ready" : live.state.failures > 0 ? "error" : "loading";
  const load = useCallback(async () => live.read({ manual: true }), [live]);
  async function refreshVisible() {
    await Promise.all([
      load(),
      desktop || mobilePane === "served" ? served.read({ manual: true }) : null,
    ]);
  }
  async function refreshAfterWrite() {
    await Promise.all([load(), served.read({ manual: true })]);
  }
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1100px)");
    const resize = () => setDesktop(media.matches);
    resize();
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);
  useLayoutEffect(() => {
    // 只有换目标才清空操控状态；同场刷新不碰弹窗草稿与有效选择。
    setMobilePane(null);
    setSearch("");
    setSearchDraft("");
    composingSearch.current = false;
    setServedCollapsed(false);
    setServerEnded(false);
    setSelected(new Set());
    setMessage("");
    setToast(null);
    setBusy(null);
    setWithdrawTarget(null);
    setRevertTarget(null);
    setRevertBusy(false);
    setPendingNotice(null);
    setAttendanceOpen(false);
    setCheckInConfirmOpen(false);
    setCheckInRows([]);
    setIssueTypeDrafts({});
    setCheckInError("");
    checkInPending.current = false;
  }, [activityId]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setClock(Date.now());
      const activity = live.state.data?.activity;
      if (activity && Date.now() >= activityEndExclusive(new Date(activity.activityAt)).getTime())
        setServerEnded(true);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [live]);

  useLayoutEffect(() => {
    boardElement.current?.querySelectorAll(".activity-board__pane-body").forEach((pane) => {
      pane.scrollTop = 0;
    });
  }, [activityId, search]);

  useLayoutEffect(() => {
    if (boardElement.current) boardElement.current.style.minHeight = "";
  }, [activityId, search, mobilePane, desktop]);

  function applySearch(value: string) {
    if (value === search) return;
    setSearch(value);
    if (!desktop) window.scrollTo({ top: 0, behavior: "instant" });
  }

  function switchMobilePane(next: MobilePane) {
    if (next === mobilePane) return;
    setMobilePane(next);
    if (!desktop) window.scrollTo({ top: 0, behavior: "instant" });
  }

  async function postJson<T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: true; data: T } | { ok: false; message: string; code?: string }> {
    // 写请求开始时使旧的读取失效，不能让提交前的快照覆盖操作结果。
    live.invalidate();
    served.invalidate();
    attendance.invalidate();
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
      if (currentActivity.current !== activityTarget)
        return { ok: false, message: "", code: "STALE_ACTIVITY" };
      if (!json.success || json.data === undefined) {
        if (json.error?.code === "ACTIVITY_ENDED") {
          setServerEnded(true);
          setClock(Date.now());
        }
        return {
          ok: false,
          message:
            json.error?.code === "ACTIVITY_ENDED"
              ? copy.activityEnded
              : (json.error?.message ?? copy.loadFailed),
          code: json.error?.code,
        };
      }
      return { ok: true, data: json.data };
    } catch {
      return { ok: false, message: copy.loadFailed };
    }
  }

  /**
   * 操作窗口的即时判定：渲染态用 5 秒节拍的 `clock`，这里必须用实时时间 ——
   * 确认窗可能在两次节拍之间跨过结束点，写操作必须按当前时刻复核（不要改成 `clock`）。
   */
  function blockedStaffMessage(): string | null {
    if (!board) return copy.loadFailed;
    const now = new Date();
    if (
      serverEnded ||
      board.activity.status === "ENDED" ||
      now.getTime() >= activityEndExclusive(new Date(board.activity.activityAt)).getTime()
    ) {
      return copy.activityEnded;
    }
    return canOperateActivityStaff(board.activity, now) ? null : copy.signupNotClosed;
  }

  function allowStaffAction(): boolean {
    const blocked = blockedStaffMessage();
    if (!blocked) return true;
    setClock(Date.now());
    setMessage(blocked);
    return false;
  }

  async function attend() {
    if (busy !== null || !allowStaffAction()) return;
    setBusy("attend");
    setToast(null);
    const result = await postJson<{ attended: boolean }>(
      `/api/v1/member/repair-activities/${activityId}/attendance`,
      {},
    );
    if (currentActivity.current !== activityTarget) return;
    setBusy(null);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setToast({ text: copy.attendSuccess, tone: "success" });
    await refreshAfterWrite();
  }

  function openCheckInConfirm() {
    if (busy !== null || checkInPending.current || !allowStaffAction()) return;
    const rows = board?.eligible.filter((row) => selected.has(row.id)) ?? [];
    if (rows.length === 0) {
      setMessage(copy.selectNone);
      return;
    }
    // 勾选达标、继续走确认弹窗：把「请先勾选…」浮条清掉，避免错误提示滞留。
    setMessage("");
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
    const blocked = blockedStaffMessage();
    if (blocked) {
      setClock(Date.now());
      setCheckInError(blocked);
      return;
    }
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
    if (currentActivity.current !== activityTarget) return;
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
    live.update((current) => {
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
    if (currentActivity.current !== activityTarget) return;
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
    if (currentActivity.current !== activityTarget) return;
    setBusy(null);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setWithdrawTarget(null);
    setToast({ text: copy.withdrawSuccess, tone: "neutral" });
    await refreshAfterWrite();
  }

  async function serve(registrationId: string) {
    if (busy !== null || !allowStaffAction()) return;
    setBusy(`serve:${registrationId}`);
    setToast(null);
    setMessage("");
    const result = await postJson<ServeResultView>(
      `/api/v1/member/repair-activities/${activityId}/serve`,
      { registrationId },
    );
    if (currentActivity.current !== activityTarget) return;
    setBusy(null);
    if (!result.ok) {
      if (result.code === "ACTIVITY_SERVE_PENDING") {
        // 服务端兜底（多标签 / 并发）：先刷新看板，再按最新的未建单接待弹层；
        // 刷新后若已无待补建（例如另一标签刚提交），退回内联提示。
        const fresh = await load();
        if (currentActivity.current !== activityTarget) return;
        if (fresh?.pendingServeRegistration) setPendingNotice(fresh.pendingServeRegistration);
        else setMessage(result.message);
        return;
      }
      setMessage(result.message);
      return;
    }
    setToast({ text: copy.serveSuccess, tone: "success" });
    await refreshAfterWrite();
  }

  /** 撤销接待：仅接待者本人 / 活动管理员可见按钮，服务端再校一遍。 */
  async function confirmRevertServe() {
    if (!revertTarget || revertBusy) return;
    setRevertBusy(true);
    setToast(null);
    const result = await postJson<RevertServeResultView>(
      `/api/v1/member/repair-activities/${activityId}/revert-serve`,
      { registrationId: revertTarget.id },
    );
    if (currentActivity.current !== activityTarget) return;
    setRevertBusy(false);
    setRevertTarget(null);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setToast({ text: copy.revertServeSuccess, tone: "neutral" });
    await refreshAfterWrite();
  }

  /** 点击「接待」：先看客户端已加载的待补建接待，非空则弹层且**不发请求**。 */
  function requestServe(registrationId: string) {
    if (!allowStaffAction()) return;
    if (board?.pendingServeRegistration) {
      setPendingNotice(board.pendingServeRegistration);
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

  /**
   * 页头：小标签 + 活动名主标题 + 日期行。
   * 活动名来自看板数据，加载中就绪前先用「活动工作台」占位。
   * 状态徽章仅在已加载看板后出现（issue #239），与成员活动列表使用同一套文案。
   */
  function renderHead(title: string, meta?: string, status?: RepairActivityStatus) {
    return (
      <header className="member-page-head activity-board__head">
        <p className="member-section__tag">{copy.label}</p>
        <div className="activity-card__head activity-board__title-row">
          <h1 className="sec-title" id="member-activity-board-title">
            {title}
          </h1>
          {status ? (
            <span className={memberRepairActivityStatusBadgeClass(status)}>
              {memberRepairActivityStatusLabels[status]}
            </span>
          ) : null}
        </div>
        {meta ? <p className="activity-board__meta">{meta}</p> : null}
      </header>
    );
  }

  if (state === "loading") {
    return (
      <div className="activity-board activity-board--loading">
        {renderHead(copy.title)}
        <p className="muted" role="status">
          {copy.loading}
        </p>
      </div>
    );
  }
  if (state === "error" || !board) {
    return (
      <div className="activity-board">
        {renderHead(copy.title)}
        <p className="admin-status admin-status--error" role="alert">
          {message || live.state.error || copy.loadFailed}
        </p>
        <Button onClick={() => void load()} disabled={live.state.pending}>
          {copy.retry}
        </Button>
        <Button href="/member/repair-activities" variant="ghost">
          {copy.back}
        </Button>
      </div>
    );
  }

  const ended =
    serverEnded ||
    board.activity.status === "ENDED" ||
    clock >= activityEndExclusive(new Date(board.activity.activityAt)).getTime();
  const staffOpen = !ended && canOperateActivityStaff(board.activity, new Date(clock));
  // 结束时只更新原提示；已出勤且无提示卡的看板用浮层，不能把整板向下挤。
  const showAttendBanner =
    clock < new Date(board.activity.signupClosesAt).getTime() || !board.attended;
  const floatingMessage = message || (ended && !showAttendBanner ? copy.activityEnded : "");
  const opsDisabled = !staffOpen || !board.attended || busy !== null;
  const withdrawBusy = withdrawTarget ? busy === `withdraw:${withdrawTarget.id}` : false;
  const checkInBusy = busy === "check-in";
  const matches = createBoardSearch(search);
  const eligibleRows = matches ? board.eligible.filter(matches) : board.eligible;
  const queueRows = board.queue
    .map((row, index) => ({ row, rank: index + 1 }))
    .filter(({ row }) => !matches || matches(row));
  const servedRows = matches ? board.served.filter(matches) : board.served;
  const countLabel = (shown: number, total: number) => (matches ? `${shown}/${total}` : total);
  const servedCountLabel = matches
    ? served.state.data
      ? countLabel(servedRows.length, board.served.length)
      : served.state.failures
        ? copy.searchCountFailed
        : copy.searchCountUnknown
    : board.servedCount;
  const hiddenSelected = matches
    ? board.eligible.filter((row) => selected.has(row.id) && !matches(row)).length
    : 0;
  // 手机端切换项（与 panes 的可见性一致：成员没有「待签到」）。
  const mobilePanes: Array<[MobilePane, string, number | string]> = [];
  if (board.canAdmin)
    mobilePanes.push([
      "eligible",
      copy.eligibleTitle,
      countLabel(eligibleRows.length, board.eligible.length),
    ]);
  mobilePanes.push(
    ["queue", copy.queueTitle, countLabel(queueRows.length, board.queue.length)],
    ["served", copy.servedTitle, servedCountLabel],
  );
  // 滑块位置：与 mobilePanes 顺序一致；理论上必有匹配，找不到时回落到第一段。
  const activeIndex = Math.max(
    0,
    mobilePanes.findIndex(([key]) => key === mobilePane),
  );

  return (
    <div ref={boardElement} className="activity-board activity-board--ready">
      {renderHead(
        board.activity.title,
        formatShanghaiDateTime(board.activity.activityAt),
        ended ? "ENDED" : board.activity.status,
      )}
      <div className="activity-board__toolbar">
        <Button href="/member/repair-activities" variant="ghost">
          {copy.back}
        </Button>
        {board.attended ? (
          <span className={ATTENDED_TAG_CLASS}>{copy.attendedBadge}</span>
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
        {/* 出勤成员入口：仅活动管理员可见，人数实时取自看板数据。
            放在工具栏尾部靠右（CSS 的 auto 外边距），不与返回 / 出勤按钮抢行。 */}
        {board.canAdmin ? (
          <Button
            className="activity-board__attendance-entry"
            variant="ghost"
            trailingIcon="chevronRight"
            onClick={() => {
              setAttendanceOpen(true);
              void attendance.read({ manual: true });
            }}
          >
            {copy.attendanceEntry.replace("{count}", String(board.attendanceCount ?? 0))}
          </Button>
        ) : null}
        <div className="activity-board__sync-row activity-board__live-sync">
          <BoardSyncStatus label={copy.queueSyncedAt} state={live.state} />
          <Button
            variant="ghost"
            onClick={() => void refreshVisible()}
            disabled={paused || live.state.pending || served.state.pending}
          >
            {copy.refresh}
          </Button>
        </div>
      </div>

      {showAttendBanner ? (
        <Card className="activity-board__attend-banner" variant="notice">
          <p role="status">
            {ended
              ? copy.activityEnded
              : staffOpen
                ? board.canAdmin
                  ? copy.attendPrompt
                  : copy.attendPromptMember
                : copy.signupNotClosed}
          </p>
        </Card>
      ) : null}
      <AdminToast toast={toast} onDismiss={() => setToast(null)} />
      {/* 页面级错误 = 浮动提示（方案 A）：不占布局，工具行与卡片之间只剩网格间距。 */}
      {floatingMessage ? (
        <PageAlert
          message={floatingMessage}
          closeLabel={message ? memberRepairActivitiesCopy.board.dismissAlert : undefined}
          onClose={message ? () => setMessage("") : undefined}
        />
      ) : null}
      <div className="activity-board__controls">
        <div className="activity-board__search">
          <input
            className="field__input"
            type="search"
            aria-label={copy.search}
            placeholder={copy.searchPlaceholder}
            value={searchDraft}
            onChange={(event) => {
              const value = event.target.value;
              setSearchDraft(value);
              if (
                !composingSearch.current &&
                !(event.nativeEvent as InputEvent | undefined)?.isComposing
              )
                applySearch(value);
            }}
            onCompositionStart={() => {
              composingSearch.current = true;
            }}
            onCompositionEnd={(event) => {
              composingSearch.current = false;
              const value = event.currentTarget.value;
              setSearchDraft(value);
              applySearch(value);
            }}
          />
        </div>

        {/* 手机端分区切换（·分段滑块）：窄屏一次只显示一个分区、切换行吸顶；
          宽屏由 CSS 隐藏，恢复并排栏。计数实时来自看板数据、放在段内（等宽段不因数字变化位移）。 */}
        <div className="activity-board__switcher" role="group" aria-label={copy.paneSwitcherLabel}>
          <div
            className="activity-board__seg"
            style={
              { "--seg-count": mobilePanes.length, "--seg-index": activeIndex } as CSSProperties
            }
          >
            <span className="activity-board__seg-thumb" aria-hidden="true" />
            {mobilePanes.map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                className="activity-board__seg-btn"
                aria-pressed={mobilePane === key}
                onClick={() => switchMobilePane(key)}
              >
                {label}
                <span className="activity-board__seg-count">{count}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        className={cn(
          "activity-board__panes",
          board.canAdmin && "activity-board__panes--admin",
          servedCollapsed && "activity-board__panes--history-collapsed",
        )}
      >
        {/* 待签到：仅活动管理员可见；成员的看板在服务端就不下发这批数据。 */}
        {board.canAdmin ? (
          <Card
            className={`activity-board__pane repair-panel ${
              mobilePane === "eligible" ? "is-active" : ""
            }`}
          >
            <header className="activity-board__pane-head">
              <h2 id="activity-board-eligible">
                {copy.eligibleTitle}
                <span className="activity-board__pane-count">
                  {countLabel(eligibleRows.length, board.eligible.length)}
                </span>
              </h2>
              <span className="member-section__tag">{copy.eligibleTag}</span>
            </header>
            <div
              className="activity-board__pane-body"
              role="region"
              aria-labelledby="activity-board-eligible"
              tabIndex={0}
            >
              {eligibleRows.length === 0 ? (
                <p className="muted activity-board__empty">
                  {matches && board.eligible.length ? copy.searchEmpty : copy.eligibleEmpty}
                </p>
              ) : (
                <ul className="activity-board__list">
                  {eligibleRows.map((row) => (
                    <li key={row.id} className="activity-board__row">
                      <div className="activity-board__check">
                        <input
                          type="checkbox"
                          id={`registration-${row.id}`}
                          checked={selected.has(row.id)}
                          disabled={opsDisabled}
                          aria-label={`${copy.name} ${row.name}`}
                          onChange={() => toggle(row.id)}
                        />
                        <div>
                          <div className="activity-board__check-heading">
                            <label htmlFor={`registration-${row.id}`}>
                              <strong>{row.name}</strong>
                            </label>
                            <RegistrationPhone
                              key={`${activityId}:${row.id}:${row.phoneMasked}`}
                              activityId={activityId}
                              registrationId={row.id}
                              phoneMasked={row.phoneMasked}
                              onError={setMessage}
                            />
                          </div>
                          <p className="activity-board__check-meta">
                            {row.issueTypeLabel}
                            {row.deviceModel ? ` · ${row.deviceModel}` : null}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="activity-board__actions">
              <p className="muted m-0">
                {selected.size
                  ? copy.selectedCount.replace("{count}", String(selected.size))
                  : copy.selectHint}
                {hiddenSelected
                  ? copy.selectedHidden.replace("{count}", String(hiddenSelected))
                  : null}
              </p>
              <Button
                variant="solid"
                onClick={openCheckInConfirm}
                disabled={opsDisabled || selected.size === 0}
              >
                {busy === "check-in" ? copy.checkingIn : copy.checkIn}
              </Button>
            </div>
          </Card>
        ) : null}

        <Card
          className={`activity-board__pane repair-panel ${
            mobilePane === "queue" ? "is-active" : ""
          }`}
        >
          <header className="activity-board__pane-head">
            <h2 id="activity-board-queue">
              {copy.queueTitle}
              <span className="activity-board__pane-count activity-board__pane-count--queue">
                {countLabel(queueRows.length, board.queue.length)}
              </span>
            </h2>
            <span className="member-section__tag">{copy.queueTag}</span>
          </header>
          <div
            className="activity-board__pane-body"
            role="region"
            aria-labelledby="activity-board-queue"
            tabIndex={0}
          >
            {queueRows.length === 0 ? (
              <p className="muted activity-board__empty">
                {matches && board.queue.length
                  ? copy.searchEmpty
                  : board.canAdmin
                    ? copy.queueEmpty
                    : copy.queueEmptyMember}
              </p>
            ) : (
              <ul className="activity-board__list">
                {queueRows.map(({ row, rank }) => (
                  <li key={row.id} className="activity-board__row activity-board__row--queue">
                    <div className="activity-board__queue-main">
                      <span className="activity-board__queue-rank">
                        {copy.queueRank.replace("{index}", String(rank))}
                      </span>
                      <div>
                        <strong>{row.name}</strong>
                        <div className="activity-board__queue-line">
                          <span className="activity-board__queue-label">{copy.phone}</span>
                          <span className="activity-board__queue-value">{row.phoneMasked}</span>
                        </div>
                        <div className="activity-board__queue-line">
                          <span className="activity-board__queue-label">{copy.issueType}</span>
                          <span className="activity-board__queue-value">{row.issueTypeLabel}</span>
                        </div>
                        {row.checkedInAt ? (
                          <div className="activity-board__queue-line">
                            <span className="activity-board__queue-label">{copy.checkedInAt}</span>
                            <span className="activity-board__queue-value">
                              {formatShanghaiDateTime(row.checkedInAt)}
                            </span>
                          </div>
                        ) : null}
                        {row.deviceModel ? (
                          <div className="activity-board__queue-line">
                            <span className="activity-board__queue-label">{copy.deviceModel}</span>
                            <span className="activity-board__queue-value">{row.deviceModel}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="activity-board__row-actions activity-board__row-actions--foot">
                      <Button
                        className="activity-board__serve-btn"
                        trailingIcon="arrowRight"
                        onClick={() => requestServe(row.id)}
                        disabled={opsDisabled}
                      >
                        {busy === `serve:${row.id}` ? copy.serving : copy.serve}
                      </Button>
                      {/* 「撤回」仅活动管理员：成员视角不出现；
                        服务端 withdraw 同样要求 activity:admin 兜底。
                        幽灵 + Undo 图标，悬停转危险色。 */}
                      {board.canAdmin ? (
                        <Button
                          variant="ghost"
                          className="activity-board__withdraw-btn"
                          icon="undo"
                          onClick={() => setWithdrawTarget(row)}
                          disabled={!board.attended || busy !== null}
                        >
                          {busy === `withdraw:${row.id}` ? copy.withdrawing : copy.withdraw}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        {/* 「已接待」= 常驻区块（作为成员两栏 / 管理员三栏的
            最后一栏，按 servedAt 降序）：数据为空只换内容，区块本身不出现 / 消失。 */}
        <Card
          className={`activity-board__pane activity-board__pane--served repair-panel ${
            mobilePane === "served" ? "is-active" : ""
          }`}
        >
          <header className="activity-board__pane-head">
            <h2 id="activity-board-served">
              {copy.servedTitle}
              <span className="activity-board__pane-count">{servedCountLabel}</span>
            </h2>
            <Button
              variant="ghost"
              className="activity-board__history-toggle"
              trailingIcon={servedCollapsed ? "chevronRight" : "chevronDown"}
              aria-expanded={!servedCollapsed}
              aria-controls="activity-board-served-list"
              onClick={() => setServedCollapsed((current) => !current)}
            >
              {servedCollapsed ? copy.expandServed : copy.collapseServed}
            </Button>
          </header>
          <div
            className="activity-board__pane-body"
            id="activity-board-served-list"
            role="region"
            aria-labelledby="activity-board-served"
            tabIndex={0}
          >
            {!served.state.data ? (
              <p className="muted activity-board__empty" role="status">
                {served.state.failures ? copy.servedLoadFailed : copy.servedLoading}
              </p>
            ) : servedRows.length === 0 ? (
              <p className="muted activity-board__empty">
                {matches && board.served.length
                  ? copy.searchEmpty
                  : board.canAdmin
                    ? copy.servedEmpty
                    : copy.servedEmptySelf}
              </p>
            ) : (
              <ul className="activity-board__list">
                {servedRows.map((row) => {
                  const recordId = row.repairRecordId;
                  // 待补建：接待已占位、维修单还没创建。
                  const pendingRecord = recordId === null;
                  // 已通过打勾、待审核用「眼睛」：暗色下品牌黄与警示橙色相接近，靠图标再区分一层。
                  const recordIcon = row.recordStatus ? recordStatusTagIcon(row.recordStatus) : null;
                  return (
                    <li key={row.id} className="activity-board__row">
                      <div className="activity-board__served-main">
                        <div>
                          <strong>{row.name}</strong>{" "}
                          {pendingRecord ? (
                            <span className="repair-tag repair-tag--pending">
                              {copy.servedPendingTag}
                            </span>
                          ) : row.recordStatus ? (
                            <span className={recordStatusTagClass(row.recordStatus)}>
                              {recordIcon ? <Icon name={recordIcon} /> : null}
                              {repairStatusLabels[row.recordStatus]}
                            </span>
                          ) : null}
                          {pendingRecord ? (
                            <p className="muted m-0">{copy.servedPendingHint}</p>
                          ) : null}
                          <p className="activity-board__check-meta">
                            {row.issueTypeLabel}
                            {row.deviceModel ? ` · ${row.deviceModel}` : null}
                          </p>
                          <div className="activity-board__queue-line">
                            <span className="activity-board__queue-label">{copy.phone}</span>
                            <RegistrationPhone
                              key={`${activityId}:${row.id}:${row.phoneMasked}`}
                              activityId={activityId}
                              registrationId={row.id}
                              phoneMasked={row.phoneMasked}
                              onError={setMessage}
                            />
                          </div>
                          {board.canAdmin ? (
                            <div className="activity-board__queue-line">
                              <span className="activity-board__queue-label">{copy.servedBy}</span>
                              <span className="activity-board__queue-value">
                                {row.servedByName || copy.servedByUnknown}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="activity-board__row-actions items-center">
                        {row.canRevert ? (
                          <Button variant="ghost" onClick={() => setRevertTarget(row)}>
                            {copy.revertServe}
                          </Button>
                        ) : null}
                        {pendingRecord ? (
                          row.canFill ? (
                            <Button
                              href={`/member/repairs/new?activityId=${encodeURIComponent(activityId)}&registrationId=${encodeURIComponent(row.id)}`}
                            >
                              {copy.continueFill}
                            </Button>
                          ) : (
                            <span className="muted">{copy.servedPendingByOwner}</span>
                          )
                        ) : !recordId || !row.recordStatus ? (
                          // 记录缺失或已软删除：占位文案，不出链接。
                          <span className="muted">{copy.recordMissing}</span>
                        ) : row.recordStatus === "DRAFT" || row.recordStatus === "REJECTED" ? (
                          <Button
                            href={`/member/repairs/${recordId}/edit?returnActivityId=${encodeURIComponent(activityId)}`}
                          >
                            {copy.fillRepair}
                          </Button>
                        ) : (
                          <Button
                            className="activity-board__view-btn"
                            href={`/member/repairs/${recordId}`}
                          >
                            {copy.viewRepair}
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="activity-board__sync-row activity-board__history-sync">
            <BoardSyncStatus label={copy.servedSyncedAt} state={served.state} />
            <Button
              variant="ghost"
              onClick={() => void served.read({ manual: true })}
              disabled={paused || served.state.pending}
            >
              {copy.refresh}
            </Button>
          </div>
        </Card>
      </div>

      {checkInConfirmOpen ? (
        <ConfirmDialog
          title={copy.checkInConfirmTitle}
          cancelLabel={copy.checkInCancel}
          confirmLabel={checkInBusy ? copy.checkingIn : copy.checkInConfirm}
          busy={checkInBusy}
          confirmDisabled={!staffOpen}
          onClose={closeCheckInConfirm}
          onConfirm={() => void confirmCheckIn()}
        >
          <p>{copy.checkInConfirmHint}</p>
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
                    disabled={checkInBusy || !staffOpen}
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

      {revertTarget ? (
        <ConfirmDialog
          title={copy.revertServeConfirmTitle}
          cancelLabel={copy.revertServeCancel}
          confirmLabel={revertBusy ? copy.revertingServe : copy.revertServeConfirm}
          busy={revertBusy}
          onClose={() => {
            if (!revertBusy) setRevertTarget(null);
          }}
          onConfirm={() => void confirmRevertServe()}
        >
          <p>
            {revertTarget.repairRecordId
              ? copy.revertServeConfirmHintLegacy
              : copy.revertServeConfirmHint}
          </p>
          <p>
            <strong>
              {revertTarget.name} · {revertTarget.phoneMasked}
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
              `/member/repairs/new?activityId=${encodeURIComponent(pendingNotice.activityId)}&registrationId=${encodeURIComponent(pendingNotice.registrationId)}`,
            );
          }}
        >
          <p>
            {copy.pendingServeBody
              .replace("{owner}", pendingNotice.name)
              .replace("{activity}", pendingNotice.activityTitle)}
          </p>
          <p className="admin-note">{copy.pendingServeUndoHint}</p>
        </ConfirmDialog>
      ) : null}

      {/* 出勤成员名单：只读弹层，沿用后台详情窗口；桌面两列、
          人多时由弹窗正文内部滚动，页面高度不随之变化。 */}
      {attendanceOpen ? (
        <AdminModal
          title={copy.attendanceTitle}
          subtitle={`${board.activity.title} · ${formatShanghaiDateTime(board.activity.activityAt)}`}
          onClose={() => setAttendanceOpen(false)}
        >
          <div className="activity-board__sync-row">
            <BoardSyncStatus label={copy.attendanceSyncedAt} state={attendance.state} />
            <Button
              variant="ghost"
              onClick={() => void attendance.read({ manual: true })}
              disabled={attendance.state.pending}
            >
              {copy.refresh}
            </Button>
          </div>
          {!attendance.state.data ? (
            <p className="muted m-0" role="status">
              {attendance.state.failures ? copy.attendanceLoadFailed : copy.attendanceLoading}
            </p>
          ) : board.attendanceMembers.length === 0 ? (
            <p className="muted m-0">{copy.attendanceEmpty}</p>
          ) : (
            <ul className="activity-board__attendance-list">
              {board.attendanceMembers.map((row) => (
                <li key={row.memberProfileId} className="activity-board__attendance-row">
                  <span className="activity-board__attendance-name">{row.name}</span>
                  <span className="activity-board__attendance-time">
                    {copy.attendanceCheckedInAt.replace(
                      "{time}",
                      formatShanghaiTime(row.checkedInAt),
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="admin-note">{copy.attendanceNote}</p>
        </AdminModal>
      ) : null}
    </div>
  );
}
