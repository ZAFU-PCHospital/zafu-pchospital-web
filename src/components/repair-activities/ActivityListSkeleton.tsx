import { repairActivitiesPage } from "@/config/repair-activities";

/** 公开活动票根骨架：沿用票根结构，保持列表初始高度稳定。 */
export function ActivityListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div
      className="activity-list activity-list--paged activity-list--ticket activity-skeleton-list"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">{repairActivitiesPage.loading}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="activity-card activity-card--stub activity-skeleton"
          aria-hidden="true"
        >
          <span className="activity-card__spine" />
          <div className="activity-card__stub">
            <span className="activity-skeleton__bar activity-skeleton__bar--stub" />
          </div>
          <div className="activity-card__body">
            <span className="activity-skeleton__bar activity-skeleton__bar--title" />
            <span className="activity-skeleton__bar" />
            <span className="activity-skeleton__bar activity-skeleton__bar--short" />
          </div>
        </div>
      ))}
    </div>
  );
}
