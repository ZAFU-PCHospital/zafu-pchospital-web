import { ActivityTicketCardShell } from "@/components/repair-activities/ActivityTicketCardShell";
import { formatShanghaiTime } from "@/components/repair-activities/activity-format";
import { memberRepairActivityStatusBadgeClass } from "@/components/repair-activities/activity-status-badge";
import {
  memberRepairActivitiesCopy,
  memberRepairActivityStatusLabels,
} from "@/config/repair-activities";
import type { StaffActivityListItem } from "@/features/repair-activities/repair-activity-staff-service";

const copy = memberRepairActivitiesCopy.list;

/** 成员活动卡：复用公开票根结构，保留成员状态、出勤与工作台入口。 */
export function MemberRepairActivityTicketCard({ activity }: { activity: StaffActivityListItem }) {
  const capacity = copy.capacity
    .replace("{registered}", String(activity.registeredCount))
    .replace("{capacity}", String(activity.capacity));
  const attendance = activity.attended ? copy.attended : copy.notAttended;

  return (
    <ActivityTicketCardShell
      activity={activity}
      href={`/member/repair-activities/${activity.id}`}
      meta={
        <>
          <p>
            {copy.activityAt} · {formatShanghaiTime(activity.activityAt)}
          </p>
          <p>
            {capacity} · {attendance}
          </p>
        </>
      }
      footer={
        <>
          <span className={memberRepairActivityStatusBadgeClass(activity.status)}>
            {memberRepairActivityStatusLabels[activity.status]}
          </span>
          <span className="activity-card__cta">
            {copy.openBoard} <span aria-hidden="true">→</span>
          </span>
        </>
      }
    />
  );
}
