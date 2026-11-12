import { memberCopy } from "@/config/member";

/** 个人资料页骨架：与 hero + 身份 + 编辑 + 指标 + 最近记录的 ready 结构一致。 */
export function MemberProfileSkeleton() {
  return (
    <div className="member-workspace__content member-skeleton" role="status" aria-live="polite">
      <span className="sr-only">{memberCopy.common.loading}</span>
      <header className="member-hero" aria-hidden="true">
        <div className="member-hero__identity">
          <span className="member-skeleton__avatar" />
          <div className="member-hero__text">
            <span className="member-skeleton__bar member-skeleton__bar--lg" />
            <span className="member-skeleton__bar member-skeleton__bar--sm" />
          </div>
        </div>
        <div className="member-hero__actions">
          <span className="member-skeleton__button" />
        </div>
      </header>
      <div className="member-section" aria-hidden="true">
        <span className="member-skeleton__bar member-skeleton__bar--sm" />
        <div className="member-skeleton__stack">
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} className="member-skeleton__bar" />
          ))}
        </div>
      </div>
      <div className="member-section" aria-hidden="true">
        <span className="member-skeleton__bar member-skeleton__bar--sm" />
        <span className="member-skeleton__bar member-skeleton__bar--block" />
      </div>
      <div className="member-section" aria-hidden="true">
        <span className="member-skeleton__bar member-skeleton__bar--sm" />
        <div className="member-metrics">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="member-metric" key={index}>
              <span className="member-skeleton__bar member-skeleton__bar--sm" />
              <span className="member-skeleton__bar member-skeleton__bar--lg" />
            </div>
          ))}
        </div>
      </div>
      <div className="member-section" aria-hidden="true">
        <span className="member-skeleton__bar member-skeleton__bar--sm" />
        <div className="member-skeleton__stack">
          {Array.from({ length: 3 }, (_, index) => (
            <span key={index} className="member-skeleton__bar member-skeleton__bar--block" />
          ))}
        </div>
      </div>
    </div>
  );
}
