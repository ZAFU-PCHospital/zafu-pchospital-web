"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "next/navigation";
import { RepairActivityRegistrationsPanel } from "./RepairActivityRegistrationsPanel";
import { RepairActivityCustomerBlacklistPanel } from "./RepairActivityCustomerBlacklistPanel";
import { MemberRepairActivityBoard } from "@/components/repair-activities/MemberRepairActivityBoard";
import { BoardSyncStatus } from "@/components/repair-activities/BoardSyncStatus";
import { useBoardResource } from "@/components/repair-activities/useBoardResource";
import { formatShanghaiDateTime } from "@/components/repair-activities/activity-format";
import { repairActivityStatusBadgeClass } from "@/components/repair-activities/activity-status-badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { adminCopy } from "@/config/admin";
import { adminFetch } from "@/features/admin/admin-client";
import { repairActivityStatusShortLabels } from "@/features/repair-activities/repair-activity-validation";
import type { RepairActivityPublicView } from "@/features/repair-activities/repair-activity-service";
import type { StaffAttendanceBoardView } from "@/features/repair-activities/repair-activity-staff-service";

const copy = adminCopy.activityWorkspace;
type Tab = keyof typeof copy.tabs;
const tabs = Object.keys(copy.tabs) as Tab[];

/** 已访问页签保留组件与表单；隐藏看板暂停轮询，重新显示时按既有读取器对账。 */
export function RepairActivityWorkspace({
  activity: initialActivity,
  canAdmin,
}: {
  activity: RepairActivityPublicView;
  canAdmin: boolean;
}) {
  const query = useSearchParams();
  const [activity, setActivity] = useState(initialActivity);
  const allowed = tabs.filter((tab) => canAdmin || tab === "overview" || tab === "board");
  const candidate = query.get("tab") as Tab;
  const tab = allowed.includes(candidate) ? candidate : "overview";
  const [visited, setVisited] = useState<Tab[]>([tab]);
  const scrolls = useRef<Partial<Record<Tab, number>>>({});
  useEffect(() => {
    setVisited((current) => (current.includes(tab) ? current : [...current, tab]));
  }, [tab]);
  useLayoutEffect(() => {
    const positions = scrolls.current;
    window.scrollTo({ top: positions[tab] ?? 0, behavior: "instant" });
    const remember = () => {
      positions[tab] = window.scrollY;
    };
    window.addEventListener("scroll", remember, { passive: true });
    return () => {
      window.removeEventListener("scroll", remember);
    };
  }, [tab]);
  function select(next: Tab) {
    scrolls.current[tab] = window.scrollY;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.pushState(null, "", url);
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, current: Tab) {
    const index = allowed.indexOf(current);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? allowed.length - 1
          : event.key === "ArrowRight"
            ? (index + 1) % allowed.length
            : event.key === "ArrowLeft"
              ? (index + allowed.length - 1) % allowed.length
              : null;
    if (next === null) return;
    event.preventDefault();
    const target = allowed[next];
    document.getElementById(`activity-tab-${target}`)?.focus({ preventScroll: true });
    select(target);
  }
  const fields = adminCopy.repairActivities.create;
  return (
    <div className="admin-workspace__content">
      <header className="admin-workspace__header">
        <div>
          <h1 className="admin-workspace__title" id="activity-object-title">
            {activity.title}
          </h1>
          <p className="admin-note">
            {formatShanghaiDateTime(activity.activityAt)} · {activity.location ?? "—"}
          </p>
        </div>
        <Button
          variant="ghost"
          href={canAdmin ? "/admin/repair-activities" : "/member/repair-activities"}
        >
          {canAdmin ? copy.back : copy.backMember}
        </Button>
      </header>
      <div className="admin-activity-tabs" role="tablist" aria-label={copy.title}>
        {allowed.map((key) => (
          <button
            type="button"
            role="tab"
            key={key}
            id={`activity-tab-${key}`}
            aria-controls={`activity-panel-${key}`}
            aria-selected={key === tab}
            tabIndex={key === tab ? 0 : -1}
            onClick={() => select(key)}
            onKeyDown={(event) => keyboard(event, key)}
          >
            {copy.tabs[key]}
          </button>
        ))}
      </div>
      {allowed
        .filter((key) => key === tab || visited.includes(key))
        .map((key) => (
          <div
            className="admin-activity-panel"
            role="tabpanel"
            tabIndex={0}
            id={`activity-panel-${key}`}
            aria-labelledby={`activity-tab-${key}`}
            hidden={key !== tab}
            key={key}
          >
            {key === "overview" ? (
              <Card>
                <span className={repairActivityStatusBadgeClass(activity.status)}>
                  {repairActivityStatusShortLabels[activity.status]}
                </span>
                <dl className="admin-modal__facts">
                  <div>
                    <dt>{fields.location}</dt>
                    <dd>{activity.location ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>{fields.activityAt}</dt>
                    <dd>{formatShanghaiDateTime(activity.activityAt)}</dd>
                  </div>
                  <div>
                    <dt>{fields.endsAt}</dt>
                    <dd>{activity.endsAt ? formatShanghaiDateTime(activity.endsAt) : "—"}</dd>
                  </div>
                  <div>
                    <dt>{adminCopy.repairActivities.table.window}</dt>
                    <dd>
                      {formatShanghaiDateTime(activity.signupOpensAt)} →{" "}
                      {formatShanghaiDateTime(activity.signupClosesAt)}
                    </dd>
                  </div>
                  <div>
                    <dt>{adminCopy.repairActivities.table.capacity}</dt>
                    <dd>
                      {adminCopy.repairActivities.capacityLine
                        .replace("{registered}", String(activity.registeredCount))
                        .replace("{capacity}", String(activity.capacity))}
                    </dd>
                  </div>
                </dl>
                <Button variant="solid" onClick={() => select("board")}>
                  {copy.enterBoard}
                </Button>
              </Card>
            ) : null}
            {key === "registrations" ? (
              <RepairActivityRegistrationsPanel
                activityId={activity.id}
                active={key === tab}
                onChanged={() => {
                  void adminFetch<RepairActivityPublicView>(
                    `/api/v1/admin/repair-activities/${activity.id}`,
                  ).then((result) => {
                    if (result.ok) setActivity(result.data);
                  });
                }}
              />
            ) : null}
            {key === "board" ? (
              <MemberRepairActivityBoard activityId={activity.id} active={key === tab} embedded />
            ) : null}
            {key === "attendance" ? (
              <ActivityAttendance activityId={activity.id} active={key === tab} />
            ) : null}
            {key === "blacklist" ? (
              <>
                <p className="admin-note">{copy.blacklistScope}</p>
                <RepairActivityCustomerBlacklistPanel />
              </>
            ) : null}
          </div>
        ))}
    </div>
  );
}

function ActivityAttendance({ activityId, active }: { activityId: string; active: boolean }) {
  const attendance = useBoardResource<StaffAttendanceBoardView>(activityId, "attendance", {
    automatic: active,
    paused: !active,
    interval: 60_000,
  });
  const state = attendance.state;
  return (
    <Card>
      <div className="admin-panel__head">
        <h2 className="admin-panel__title">{copy.tabs.attendance}</h2>
        <Button
          variant="ghost"
          onClick={() => void attendance.read({ manual: true })}
          disabled={state.pending}
        >
          {copy.refresh}
        </Button>
      </div>
      <BoardSyncStatus label={adminCopy.repairActivities.table.attendance} state={state} />
      {!state.data ? (
        <p role={state.error ? "alert" : "status"}>{state.error || copy.attendanceLoading}</p>
      ) : state.data.attendanceMembers.length === 0 ? (
        <p className="muted">{copy.attendanceEmpty}</p>
      ) : (
        <ul className="activity-board__attendance-list">
          {state.data.attendanceMembers.map((member) => (
            <li className="activity-board__attendance-row" key={member.memberProfileId}>
              <span>{member.name}</span>
              <span>{formatShanghaiDateTime(member.checkedInAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
