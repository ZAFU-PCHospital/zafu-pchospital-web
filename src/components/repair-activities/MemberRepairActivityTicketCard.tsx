import { ActivityTicketCardShell } from "@/components/repair-activities/ActivityTicketCardShell";
import {
  formatShanghaiDateTime,
  formatShanghaiTime,
  formatShanghaiTimeRange,
} from "@/components/repair-activities/activity-format";
import { memberRepairActivityStatusBadgeClass } from "@/components/repair-activities/activity-status-badge";
import {
  memberRepairActivitiesCopy,
  memberRepairActivityStatusLabels,
} from "@/config/repair-activities";
import { checkInOpensAt } from "@/features/repair-activities/repair-activity-validation";
import type { StaffActivityListItem } from "@/features/repair-activities/repair-activity-staff-service";

const copy = memberRepairActivitiesCopy.list;

/** 成员活动卡：复用公开票根结构，保留成员状态、出勤与工作台入口。 */
export function MemberRepairActivityTicketCard({ activity }: { activity: StaffActivityListItem }) {
  const capacity = copy.capacity
    .replace("{registered}", String(activity.registeredCount))
    .replace("{capacity}", String(activity.capacity));
  const attendance = activity.attended ? copy.attended : copy.notAttended;
  const timeRange = formatShanghaiTimeRange(activity.activityAt, activity.endsAt);
  // 签到窗口（issue #367）：活动开始前 30 分钟开放；卡片只在取到数据后由客户端渲染，
  // 因此这里按当前时刻判断不会产生水合不一致。
  const opensAt = checkInOpensAt(activity.activityAt);
  const checkInOpen = activity.status !== "ENDED" && Date.now() >= opensAt.getTime();
  const checkInLine = checkInOpen
    ? copy.checkInOpen
    : copy.checkInOpensAt.replace("{time}", formatShanghaiDateTime(opensAt));

  return (
    <ActivityTicketCardShell
      activity={activity}
      href={`/member/repair-activities/${activity.id}`}
      // 强调色脊线跟随签到窗口（issue #367），不再跟随报名状态。
      modifier={checkInOpen ? "activity-card--checkin-open" : undefined}
      meta={
        <>
          <p>
            {copy.activityAt} · {timeRange ?? formatShanghaiTime(activity.activityAt)}
          </p>
          {activity.location ? (
            <p>
              {copy.location} · {activity.location}
            </p>
          ) : null}
          <p>
            {capacity} · {attendance}
          </p>
          {activity.status === "ENDED" ? null : <p>{checkInLine}</p>}
        </>
      }
      footer={
        <>
          <span className={memberRepairActivityStatusBadgeClass(activity.status, checkInOpen)}>
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
