"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DashGroup, DashStat, DashStats, DashTile } from "@/components/ui/dash";
import { MemberAvatar } from "@/components/member/MemberAvatar";
import { isDashboardAllClear, pendingServesState } from "@/components/member/dashboard-state";
import { MemberMetrics } from "@/components/member/MemberMetrics";
import { MemberPendingServes } from "@/components/member/MemberPendingServes";
import { MemberRankingPreviewView } from "@/components/member/MemberRankingPreview";
import { MemberRecentRepairs } from "@/components/member/MemberRecentRepairs";
import { MemberSection } from "@/components/member/MemberSection";
import { MemberSkillList } from "@/components/member/MemberSkillList";
import { MemberUpcoming } from "@/components/member/MemberUpcoming";
import { memberCopy } from "@/config/member";
import { formatShanghaiDate } from "@/lib/shanghai-date";
import { roleLabels } from "@/components/member/MemberIdentityFields";
import type { MemberDashboard as MemberDashboardData } from "@/types/contracts";

/** 欢迎区保持显示；数据区独立处理加载与失败，问候和日期在挂载后计算。 */

export type MemberDashboardProps = {
  /** 服务端已认证的展示名，用于首屏立即渲染欢迎区（避免首屏空壳） */
  initialDisplayName: string;
  roles: readonly string[];
};

export function MemberDashboard({ initialDisplayName, roles }: MemberDashboardProps) {
  const copy = memberCopy.dashboard;
  const [data, setData] = useState<MemberDashboardData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [now, setNow] = useState<{ greeting: string; date: string; weekday: string } | null>(null);

  useEffect(() => {
    const date = new Date();
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        hour12: false,
        timeZone: "Asia/Shanghai",
      }).format(date),
    );
    const greeting =
      hour < 6
        ? copy.greetings.dawn
        : hour < 11
          ? copy.greetings.morning
          : hour < 14
            ? copy.greetings.noon
            : hour < 18
              ? copy.greetings.afternoon
              : copy.greetings.evening;
    const parts = new Intl.DateTimeFormat("zh-CN", {
      month: "long",
      day: "numeric",
      weekday: "long",
      timeZone: "Asia/Shanghai",
    }).formatToParts(date);
    setNow({
      greeting,
      date: formatShanghaiDate(date.toISOString()),
      weekday: parts.find((part) => part.type === "weekday")?.value ?? "",
    });
    // copy 是构建期常量，不需要进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch("/api/v1/member/dashboard", { cache: "no-store" });
      const json = await response.json();
      if (!json.success) throw new Error(json?.error?.code ?? "DASHBOARD_FAILED");
      setData(json.data as MemberDashboardData);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const profile = data?.profile ?? null;
  const displayName = profile?.displayName ?? initialDisplayName;
  const joinedAt = profile ? formatShanghaiDate(profile.joinedAt) : null;
  const roleText = roleLabels(profile?.roles ?? roles);

  const queueFailed = data?.degraded.includes("workQueue") ?? false;
  const queue = queueFailed ? null : (data?.workQueue ?? null);
  const { items: pendingServes, failed: pendingServesFailed } = pendingServesState(data);
  const unread = data
    ? data.notifications.available
      ? data.notifications.unreadCount
      : null
    : null;
  const allClear = isDashboardAllClear({
    queue,
    pendingServeCount: pendingServes.length,
    pendingServesFailed,
    unread,
  });

  return (
    <>
      <header className="dash-hero">
        <div className="dash-hero__identity">
          <MemberAvatar displayName={displayName} avatarUrl={profile?.avatarUrl} />
          <div className="dash-hero__text">
            <h1 className="dash-hero__name" id="member-title">
              {now ? `${now.greeting}，${displayName}` : `${copy.welcome}，${displayName}`}
            </h1>
            <p className="dash-hero__meta">
              {now ? (
                <span>
                  {now.date} {now.weekday}
                </span>
              ) : null}
              {roleText ? <span>{roleText}</span> : null}
              {joinedAt ? (
                <span>
                  {copy.joinedAtLabel} {joinedAt}
                </span>
              ) : null}
            </p>
          </div>
        </div>
        <div className="dash-hero__actions">
          <Button href="/member/repairs/new" variant="solid">
            {copy.quickNew}
          </Button>
        </div>
      </header>

      {state === "error" ? (
        <Card variant="notice">
          <p>{memberCopy.common.loadError}</p>
          <Button onClick={() => void load()}>{memberCopy.common.reload}</Button>
        </Card>
      ) : null}

      {state === "loading" ? <DashboardSkeleton /> : null}

      {state === "ready" && data ? (
        <>
          <section className="dash-block" aria-labelledby="member-action-title">
            <div className="dash-block__head">
              <h2 className="dash-block__title" id="member-action-title">
                {copy.actionTitle}
              </h2>
              <span className="dash-block__tag">{copy.actionTag}</span>
            </div>
            {pendingServes.length > 0 ? <MemberPendingServes items={pendingServes} /> : null}
            {pendingServesFailed ? (
              <p className="dash-note">
                {copy.pendingServeLoadFailed}{" "}
                <button className="dash-note__retry" type="button" onClick={() => void load()}>
                  {memberCopy.common.reload}
                </button>
              </p>
            ) : null}
            <DashStats>
              <DashStat
                label={copy.actionDraft}
                value={queue?.draftCount ?? null}
                unit={copy.unitCount}
                href="/member/repairs?status=DRAFT"
                active
              />
              <DashStat
                label={copy.actionPending}
                value={queue?.pendingCount ?? null}
                unit={copy.unitCount}
                href="/member/repairs?status=PENDING"
              />
              <DashStat
                label={copy.actionRejected}
                value={queue?.rejectedCount ?? null}
                unit={copy.unitCount}
                href="/member/repairs?status=REJECTED"
                active
              />
              <DashStat
                label={copy.actionUnread}
                value={unread}
                unit="条"
                href="/member/notifications"
                active
              />
            </DashStats>
            {queueFailed ? (
              <p className="dash-note">
                {memberCopy.common.sectionLoadError}{" "}
                <button className="dash-note__retry" type="button" onClick={() => void load()}>
                  {memberCopy.common.reload}
                </button>
              </p>
            ) : null}
            {allClear ? <p className="dash-allclear">{copy.actionAllClear}</p> : null}
          </section>

          <DashGroup title={copy.quickTitle} id="member-quick-title" className="dash-block">
            <DashTile icon="plus" label={copy.quickNew} desc={copy.quickNewDesc} href="/member/repairs/new" />
            <DashTile icon="fileText" label={copy.quickAll} desc={copy.quickAllDesc} href="/member/repairs" />
            <DashTile
              icon="calendar"
              label={copy.quickActivities}
              desc={copy.quickActivitiesDesc}
              href="/member/repair-activities"
            />
            <DashTile
              icon="bell"
              label={copy.quickNotifications}
              desc={copy.quickNotificationsDesc}
              href="/member/notifications"
            />
            <DashTile icon="heart" label={copy.quickFavorites} desc={copy.quickFavoritesDesc} href="/member/favorites" />
            <DashTile icon="trophy" label={copy.quickRankings} desc={copy.quickRankingsDesc} href="/member/rankings" />
            <DashTile icon="book" label={copy.quickCases} desc={copy.quickCasesDesc} href="/member/cases" />
            <DashTile icon="edit" label={copy.quickProfile} desc={copy.quickProfileDesc} href="/member/profile" />
          </DashGroup>

          <div className="dash-cols">
            <div className="dash-cols__main">
              <section aria-labelledby="member-metrics-title">
                <MemberSection
                  id="member-metrics-title"
                  title={copy.metricsTitle}
                  tag={copy.metricsTag}
                  foot={copy.metricsFootnote}
                >
                  {data.degraded.includes("repairSummary") ? (
                    <SectionError onRetry={() => void load()} />
                  ) : (
                    <MemberMetrics summary={data.repairSummary} />
                  )}
                </MemberSection>
              </section>

              <section aria-labelledby="member-recent-title">
                <MemberSection id="member-recent-title" title={copy.recentTitle} tag={copy.recentTag}>
                  {data.degraded.includes("recentRepairs") ? (
                    <SectionError onRetry={() => void load()} />
                  ) : (
                    <MemberRecentRepairs
                      items={data.recentRepairs}
                      moreHref="/member/repairs"
                      moreLabel={copy.recentMore}
                    />
                  )}
                </MemberSection>
              </section>
            </div>

            <aside className="dash-cols__aside">
              <section aria-labelledby="member-ranking-title">
                <MemberSection id="member-ranking-title" title={copy.rankingTitle} tag={copy.rankingTag}>
                  {data.degraded.includes("ranking") ? (
                    <SectionError onRetry={() => void load()} />
                  ) : (
                    <MemberRankingPreviewView preview={data.ranking} />
                  )}
                </MemberSection>
              </section>

              <section aria-labelledby="member-skills-title">
                <details className="member-skills-fold">
                  <summary className="member-skills-fold__summary">
                    <span className="member-skills-fold__title" id="member-skills-title">
                      {copy.skillsLabel}
                    </span>
                    <span className="member-section__tag">{copy.skillsTag}</span>
                  </summary>
                  <div className="member-skills-fold__body">
                    <MemberSkillList skills={data.profile.skills} />
                    <Button href="/member/profile" variant="ghost">
                      {copy.skillsEditLink}
                    </Button>
                  </div>
                </details>
              </section>

              <section aria-labelledby="member-upcoming-title">
                <MemberSection
                  id="member-upcoming-title"
                  title={copy.upcomingTitle}
                  tag={copy.upcomingTag}
                >
                  <MemberUpcoming
                    notifications={data.notifications}
                    favorites={data.favorites}
                    onRetry={() => void load()}
                  />
                </MemberSection>
              </section>
            </aside>
          </div>
        </>
      ) : null}
    </>
  );
}

/** 局部错误占位：仅在**单个区块**加载失败时替换该区块内容。 */
function SectionError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="member-section__error" role="status">
      <p>{memberCopy.common.sectionLoadError}</p>
      <Button onClick={onRetry}>{memberCopy.common.reload}</Button>
    </div>
  );
}

/** 加载骨架：只勾出待办带与双列的轮廓，hero 始终渲染真实内容。 */
function DashboardSkeleton() {
  return (
    <div className="dash-skeleton" role="status" aria-live="polite">
      <span className="sr-only">{memberCopy.common.loading}</span>
      <div className="dash-skeleton__stats" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <span className="dash-skeleton__bar dash-skeleton__bar--stat" key={index} />
        ))}
      </div>
      <div className="dash-skeleton__tiles" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5, 6].map((index) => (
          <span className="dash-skeleton__bar dash-skeleton__bar--tile" key={index} />
        ))}
      </div>
      <div className="dash-skeleton__cols" aria-hidden="true">
        <span className="dash-skeleton__bar dash-skeleton__bar--block" />
        <span className="dash-skeleton__bar dash-skeleton__bar--block" />
      </div>
    </div>
  );
}
