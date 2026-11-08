import Link from "next/link";

import { memberCopy, formatDurationMinutes } from "@/config/member";
import { formatShanghaiDate } from "@/lib/shanghai-date";
import { repairResultLabels } from "@/config/repairs";
import type { MemberRecentRepair } from "@/types/contracts";

/**
 * MemberRecentRepairs —— 最近已通过维修
 *
 * ⚠️ `MemberRecentRepair` **没有 status 字段**：该列表本身就只包含已通过记录
 * （数据源是 M2 的 `listApprovedRepairsForAnalytics()`）。
 * 因此这里不渲染状态标签 —— 凭空补一个「已通过」标签等于前端伪造字段，
 * 「已通过」这一事实由区块标题（`recentTitle`）表达。
 *
 * 每项链接到维修记录详情，沿用现有 `/member/repairs/[id]` 入口（不新造路由）。
 */

export type MemberRecentRepairsProps = {
  items: readonly MemberRecentRepair[];
  emptyLabel?: string;
  /** 是否显示「查看全部记录」脚注链接 */
  moreHref?: string;
  moreLabel?: string;
};

export function MemberRecentRepairs({
  items,
  emptyLabel = memberCopy.dashboard.recentEmpty,
  moreHref,
  moreLabel = memberCopy.dashboard.recentMore,
}: MemberRecentRepairsProps) {
  if (!items.length) {
    return <p className="member-section__note">{emptyLabel}</p>;
  }

  return (
    <>
      <ul className="member-records">
        {items.map((item) => (
          <li className="member-record" key={item.id}>
            <div className="member-record__top">
              <span className="member-record__date">{formatShanghaiDate(item.repairDate)}</span>
              {item.categoryName ? (
                <span className="member-record__category">{item.categoryName}</span>
              ) : null}
              {item.result ? (
                <span className="member-tag member-tag--muted">
                  {repairResultLabels[item.result as keyof typeof repairResultLabels] ?? item.result}
                </span>
              ) : null}
              {typeof item.durationMinutes === "number" ? (
                <span className="member-record__duration">
                  {formatDurationMinutes(item.durationMinutes)}
                </span>
              ) : null}
            </div>
            <p className="member-record__excerpt">
              <Link href={`/member/repairs/${item.id}`}>{item.contentExcerpt}</Link>
            </p>
          </li>
        ))}
      </ul>
      {moreHref ? (
        <p className="member-section__foot">
          <Link href={moreHref}>{moreLabel}</Link>
        </p>
      ) : null}
    </>
  );
}
