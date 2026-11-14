import {
  formatShanghaiDateTime,
  formatShanghaiTimeRange,
} from "@/components/repair-activities/activity-format";
import { Icon } from "@/components/ui/Icon";
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
 * 报名成功凭条（issue #363）：成功提示区 + 票根卡片。
 *
 * 卡片分两段：活动信息（抬头 / 名称 / 时间 / 地点）─ 打孔撕票线 ─ 核验信息
 * （姓名·手机号两列；报名时间·故障类型两列，机型独占一行）。`endsAt` / `location` /
 * `deviceModel` 为空时对应行不渲染，不编造。到场准备由卡片下方的说明区承载，
 * 凭条内不重复。
 *
 * 动效：图标描边 + 四块错峰淡入（40–70ms 间隔），只动 transform / opacity；
 * 减弱动效时只保留淡入。
 */
export function RepairActivityReceipt({ activity, registration }: Props) {
  const timeRange = formatShanghaiTimeRange(activity.activityAt, activity.endsAt);
  const issueTypeLabel =
    repairActivityIssueTypeLabels[registration.issueType as RepairActivityIssueType] ??
    registration.issueType;

  return (
    <div className={styles.receiptSuccess}>
      <div className={styles.successHero}>
        <span className={styles.successIcon} aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path className={styles.successCheck} pathLength={1} d="M5 13l4 4L19 7" />
          </svg>
        </span>
        <p className={styles.successTitle}>{page.detail.signupSuccessTitle}</p>
        <p className={styles.successLead}>{copy.successLead}</p>
      </div>

      <article className={styles.receipt}>
        <div className={styles.receiptActivity}>
          <p className={styles.receiptKicker}>{copy.kicker}</p>
          <h3 className={styles.receiptTitle}>{activity.title}</h3>
          <dl className={styles.receiptMeta}>
            <div>
              <dt>
                <Icon name="calendar" />
                {page.activityAt}
              </dt>
              <dd>{timeRange ?? formatShanghaiDateTime(activity.activityAt)}</dd>
            </div>
            {activity.location ? (
              <div>
                <dt>{page.location}</dt>
                <dd>{activity.location}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        {/* 打孔撕票线：横向虚线贯穿卡宽，两端半圆缺口纯 CSS。 */}
        <span className={styles.receiptDivider} aria-hidden="true" />

        <div className={styles.receiptHolder}>
          <dl className={styles.receiptFields}>
            <div className={styles.receiptIdentity}>
              <div>
                <dt>{page.detail.name}</dt>
                <dd>{registration.name}</dd>
              </div>
              <div>
                <dt>{page.detail.phone}</dt>
                <dd>{registration.phoneMasked}</dd>
              </div>
            </div>
            <div className={styles.receiptBooking}>
              <div>
                <dt>{copy.registeredAt}</dt>
                <dd>{formatShanghaiDateTime(registration.createdAt)}</dd>
              </div>
              <div>
                <dt>{page.detail.issueType}</dt>
                <dd>{issueTypeLabel}</dd>
              </div>
              {registration.deviceModel ? (
                <div className={styles.receiptBookingWide}>
                  <dt>{copy.deviceModel}</dt>
                  <dd>{registration.deviceModel}</dd>
                </div>
              ) : null}
            </div>
          </dl>
          <p className={styles.receiptHint}>{copy.screenshotHint}</p>
        </div>
      </article>
    </div>
  );
}
