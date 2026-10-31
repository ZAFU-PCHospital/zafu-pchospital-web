import Link from "next/link";

import {
  formatShanghaiDateParts,
  formatShanghaiTime,
} from "@/components/repair-activities/activity-format";
import { repairActivityStatusBadgeClass } from "@/components/repair-activities/activity-status-badge";
import { Card } from "@/components/ui/Card";
import {
  repairActivityStatusLabels,
  type RepairActivityStatus,
} from "@/features/repair-activities/repair-activity-validation";
import type { RepairActivityPublicView } from "@/features/repair-activities/repair-activity-service";

export type ActivityTicketCopy = {
  activityAt: string;
  /** `名额 {registered} / {capacity}` */
  capacity: string;
  /** `剩余 {count}` */
  remainingShort: string;
  endedHint: string;
  detailCta?: string;
};

type Props = {
  activity: RepairActivityPublicView;
  copy: ActivityTicketCopy;
  /** 首页入口更显性；公开列表保持整卡可点，不重复页脚入口。 */
  showDetailCta?: boolean;
};

/** 公开活动日期票根卡：公开列表与首页预览共用同一套字段与页脚。 */
export function ActivityTicketCard({ activity, copy, showDetailCta = false }: Props) {
  const ended = activity.status === "ENDED";
  const dateParts = formatShanghaiDateParts(activity.activityAt);
  const card = (
    <Card
      className={`activity-card activity-card--stub activity-card--${activity.status.toLowerCase()} repair-panel`}
    >
      <span className="activity-card__spine" aria-hidden="true" />
      <div className="activity-card__stub">
        <span className="activity-card__stub-month">{dateParts.month}</span>
        <span className="activity-card__stub-day">{dateParts.day}</span>
        <span className="activity-card__stub-weekday">{dateParts.weekday}</span>
      </div>
      <div className="activity-card__body">
        <div className="activity-card__head">
          <h2 className="activity-card__title">{activity.title}</h2>
        </div>
        <div className="activity-card__meta">
          <p>
            {copy.activityAt} · {formatShanghaiTime(activity.activityAt)}
          </p>
          <p>{formatCapacityLine(activity, ended, copy)}</p>
        </div>
        <div className="activity-card__footer">
          {ended ? (
            <p className="muted">{copy.endedHint}</p>
          ) : (
            <>
              <span className={repairActivityStatusBadgeClass(activity.status)}>
                {repairActivityStatusLabels[activity.status as RepairActivityStatus]}
              </span>
              {showDetailCta && copy.detailCta ? (
                <span className="activity-card__cta">
                  {copy.detailCta} <span aria-hidden="true">→</span>
                </span>
              ) : null}
            </>
          )}
        </div>
      </div>
    </Card>
  );

  if (ended) {
    return (
      <div aria-disabled="true" className="activity-card__ended-wrap">
        {card}
      </div>
    );
  }

  return (
    <Link href={`/repair-activities/${activity.id}`} className="activity-card__link">
      {card}
    </Link>
  );
}

/** 未结束优先「剩余 N」，可与已报/上限同行压缩；已结束仅已报/上限。 */
function formatCapacityLine(
  activity: RepairActivityPublicView,
  ended: boolean,
  copy: ActivityTicketCopy,
): string {
  const capacity = copy.capacity
    .replace("{registered}", String(activity.registeredCount))
    .replace("{capacity}", String(activity.capacity));
  if (ended) return capacity;
  const remaining = copy.remainingShort.replace("{count}", String(activity.remaining));
  return `${remaining} · ${capacity}`;
}
