import { Button } from "@/components/ui/Button";
import { formatShanghaiDate, memberCopy } from "@/config/member";
import type { MemberPendingServe } from "@/types/contracts";

/** 工作台待办：已接待但还没有补建维修单的记录。 */
export function MemberPendingServes({ items }: { items: MemberPendingServe[] }) {
  const copy = memberCopy.dashboard;
  return (
    <section className="dash-pending" aria-labelledby="member-pending-serve-title">
      <div className="dash-pending__head">
        <div>
          <h3 className="dash-pending__title" id="member-pending-serve-title">
            {copy.pendingServeTitle}
          </h3>
          <p className="dash-pending__hint">{copy.pendingServeHint}</p>
        </div>
        <span className="dash-pending__count">
          {copy.pendingServeCount.replace("{count}", String(items.length))}
        </span>
      </div>
      <ul className="dash-pending__list">
        {items.map((item) => (
          <li className="dash-pending__item" key={item.registrationId}>
            <div className="dash-pending__text">
              <span className="dash-pending__name">{item.name}</span>
              <span className="dash-pending__activity">{item.activityTitle}</span>
              <span className="dash-pending__date">
                {copy.pendingServeActivityAt} · {formatShanghaiDate(item.activityAt)}
              </span>
            </div>
            <Button
              href={`/member/repairs/new?activityId=${encodeURIComponent(item.activityId)}&registrationId=${encodeURIComponent(item.registrationId)}`}
              className="dash-pending__action"
              trailingIcon="arrowRight"
            >
              {copy.pendingServeContinue}
              <span className="sr-only">
                ：{item.name}，{item.activityTitle}
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
