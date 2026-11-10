"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LoadFailure } from "@/components/ui/LoadFailure";
import { MemberAvatar } from "@/components/member/MemberAvatar";
import {
  MemberIdentityFields,
  joinedAtLabel,
  roleLabels,
  type IdentityField,
} from "@/components/member/MemberIdentityFields";
import { MemberMetrics } from "@/components/member/MemberMetrics";
import { MemberRecentRepairs } from "@/components/member/MemberRecentRepairs";
import { MemberSection } from "@/components/member/MemberSection";
import { MemberProfileSkeleton } from "@/components/member/MemberProfileSkeleton";
import { memberCopy } from "@/config/member";
import type { MemberInternalProfileView } from "@/types/contracts";

/**
 * MemberInternalProfile —— 他人内部主页
 *
 * 数据来自 `GET /api/v1/members/:memberProfileId/profile`，服务端已按
 * `ProfileVisibilityPolicy` 裁剪：不含学号、班级与账号状态细节。
 *
 * ⚠️ 本组件**不得**自己请求或推断被裁剪掉的字段。视图里没有的字段就渲染「未填写」。
 * 自我重定向在页面层（server）完成，这里只负责渲染他人视角。
 */

export type MemberInternalProfileProps = {
  memberProfileId: string;
};

export function MemberInternalProfile({ memberProfileId }: MemberInternalProfileProps) {
  const copy = memberCopy.internal;
  const [view, setView] = useState<MemberInternalProfileView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "notfound">("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch(
        `/api/v1/members/${encodeURIComponent(memberProfileId)}/profile`,
        { cache: "no-store" },
      );
      const json = await response.json();
      if (!json.success) {
        // 不存在 / 已软删除 / 无权访问统一返回该错误码（避免成员枚举），
        // 因此这里不做更细的区分，一律按「不可查看」处理。
        setState(json?.error?.code === "MEMBER_PROFILE_NOT_FOUND" ? "notfound" : "error");
        return;
      }
      setView(json.data as MemberInternalProfileView);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [memberProfileId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === "notfound") {
    return (
      <Card variant="notice">
        <p>该成员主页不存在或不可查看。</p>
        <Button href="/member">返回工作台</Button>
      </Card>
    );
  }

  if (state === "error") {
    return (
      <LoadFailure
        message={memberCopy.common.loadError}
        retryLabel={memberCopy.common.reload}
        onRetry={() => void load()}
        backHref="/member"
        backLabel={memberCopy.common.backToDashboard}
      />
    );
  }

  if (state === "loading" || !view) {
    return <MemberProfileSkeleton />;
  }

  const { profile, repairSummary, recentRepairs } = view;
  const identityFields: IdentityField[] = [
    { label: memberCopy.profile.fieldRealName, value: profile.realName, muted: !profile.realName },
    {
      label: memberCopy.profile.fieldQq,
      value: profile.qq,
      muted: !profile.qq,
      visibilityTag: memberCopy.common.internalOnly,
    },
    {
      label: memberCopy.profile.fieldJoinedAt,
      value: joinedAtLabel(profile.joinedAt),
      muted: !profile.joinedAt,
    },
    {
      label: memberCopy.profile.fieldRoles,
      value: roleLabels(profile.roles),
      muted: !profile.roles.length,
    },
  ];

  return (
    <div className="member-workspace__content">
      <header className="member-hero">
        <div className="member-hero__identity">
          <MemberAvatar displayName={profile.displayName} avatarUrl={profile.avatarUrl} size="lg" />
          <div className="member-hero__text">
            <h1 className="member-hero__name" id="member-internal-title">
              {profile.displayName}
            </h1>
            <p className="member-hero__meta">
              <span>{copy.title}</span>
              {roleLabels(profile.roles) ? <span>· {roleLabels(profile.roles)}</span> : null}
            </p>
          </div>
        </div>
        <div className="member-hero__actions">
          <Button href="/member">返回工作台</Button>
        </div>
      </header>

      <section aria-labelledby="member-internal-identity-title">
        <MemberSection
          id="member-internal-identity-title"
          title={copy.identityTitle}
          tag={copy.identityTag}
          note={copy.visibilityNote}
        >
          <MemberIdentityFields fields={identityFields} />
        </MemberSection>
      </section>

      <section aria-labelledby="member-internal-skills-title">
        <MemberSection id="member-internal-skills-title" title={copy.skillsTitle} tag={copy.skillsTag}>
          {profile.skills.length ? (
            <ul className="member-skills">
              {profile.skills.map((skill) => (
                <li className="member-tag" key={skill.id}>
                  {skill.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="member-section__note">{copy.noSkills}</p>
          )}
        </MemberSection>
      </section>

      <section aria-labelledby="member-internal-metrics-title">
        <MemberSection id="member-internal-metrics-title" title={copy.metricsTitle} tag={copy.metricsTag}>
          <MemberMetrics summary={repairSummary} />
        </MemberSection>
      </section>

      <section aria-labelledby="member-internal-recent-title">
        <MemberSection id="member-internal-recent-title" title={copy.recentTitle} tag={copy.recentTag}>
          <MemberRecentRepairs items={recentRepairs} emptyLabel={copy.recentEmpty} />
        </MemberSection>
      </section>
    </div>
  );
}
