import Link from "next/link";
import type { ReactNode } from "react";

import { formatShanghaiDateParts } from "@/components/repair-activities/activity-format";
import { Card } from "@/components/ui/Card";
import type { RepairActivityStatus } from "@/features/repair-activities/repair-activity-validation";

type ActivityTicketActivity = {
  title: string;
  activityAt: string;
  status: RepairActivityStatus;
};

type Props = {
  activity: ActivityTicketActivity;
  href?: string;
  meta: ReactNode;
  footer: ReactNode;
};

/** 活动日期票根壳：公开列表、首页预览与成员活动列表共用同一套票根结构。 */
export function ActivityTicketCardShell({ activity, href, meta, footer }: Props) {
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
        <div className="activity-card__meta">{meta}</div>
        <div className="activity-card__footer">{footer}</div>
      </div>
    </Card>
  );

  if (!href) {
    return (
      <div aria-disabled="true" className="activity-card__ended-wrap">
        {card}
      </div>
    );
  }

  return (
    <Link href={href} className="activity-card__link">
      {card}
    </Link>
  );
}
