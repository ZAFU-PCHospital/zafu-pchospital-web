import {
  formatShanghaiDateTime,
  formatShanghaiTimeRange,
} from "@/components/repair-activities/activity-format";
import { repairActivitiesPage } from "@/config/repair-activities";
import {
  repairActivityIssueTypeLabels,
  type RepairActivityIssueType,
} from "@/features/repair-activities/repair-activity-validation";
import type {
  RegistrationPublicView,
  RepairActivityPublicView,
} from "@/features/repair-activities/repair-activity-service";

import styles from "./RepairActivityDetail.module.css";

const page = repairActivitiesPage;
const copy = repairActivitiesPage.detail.receipt;

type Props = {
  activity: RepairActivityPublicView;
  registration: RegistrationPublicView;
};

/**
 * 报名成功凭条（issue #363）：票根式两段——上半是活动与时间地点，下半是报名信息。
 *
 * 只负责凭条主体；到场准备由调用方按 `RepairActivityPreparation layout="inline"` 接在下方，
 * 保持一屏内可截图。`endsAt` / `location` / `deviceModel` 为空时对应行不渲染，不编造。
 */
export function RepairActivityReceipt({ activity, registration }: Props) {
  const timeRange = formatShanghaiTimeRange(activity.activityAt, activity.endsAt);
  const issueTypeLabel =
    repairActivityIssueTypeLabels[registration.issueType as RepairActivityIssueType] ??
    registration.issueType;

  return (
    // 不加 aria-label：凭条抬头由可见的 kicker 文本提供，再加同名标签会让读屏连念两遍。
    <article className={styles.receipt}>
      <header className={styles.receiptHead}>
        <p className={styles.receiptKicker}>{copy.kicker}</p>
        <h3 className={styles.receiptTitle}>{activity.title}</h3>
      </header>

      <dl className={styles.receiptMeta}>
        <div>
          <dt>{page.activityAt}</dt>
          <dd>{timeRange ?? formatShanghaiDateTime(activity.activityAt)}</dd>
        </div>
        {activity.location ? (
          <div>
            <dt>{page.location}</dt>
            <dd>{activity.location}</dd>
          </div>
        ) : null}
      </dl>

      <span className={styles.receiptDivider} aria-hidden="true" />

      <dl className={styles.receiptFields}>
        <div>
          <dt>{page.detail.name}</dt>
          <dd>{registration.name}</dd>
        </div>
        <div>
          <dt>{page.detail.phone}</dt>
          <dd>{registration.phoneMasked}</dd>
        </div>
        <div>
          <dt>{copy.registeredAt}</dt>
          <dd>{formatShanghaiDateTime(registration.createdAt)}</dd>
        </div>
        <div>
          <dt>{page.detail.issueType}</dt>
          <dd>{issueTypeLabel}</dd>
        </div>
        {registration.deviceModel ? (
          <div>
            <dt>{copy.deviceModel}</dt>
            <dd>{registration.deviceModel}</dd>
          </div>
        ) : null}
      </dl>

      <p className={styles.receiptHint}>{copy.screenshotHint}</p>
    </article>
  );
}
