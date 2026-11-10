"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { LoadFailure } from "@/components/ui/LoadFailure";
import { MemberAvatar } from "@/components/member/MemberAvatar";
import {
  MemberIdentityFields,
  joinedAtLabel,
  roleLabels,
  type IdentityField,
} from "@/components/member/MemberIdentityFields";
import { MemberMetrics } from "@/components/member/MemberMetrics";
import { MemberProfileEditor } from "@/components/member/MemberProfileEditor";
import { MemberRecentRepairs } from "@/components/member/MemberRecentRepairs";
import { MemberSection } from "@/components/member/MemberSection";
import { MemberProfileSkeleton } from "@/components/member/MemberProfileSkeleton";
import { memberCopy } from "@/config/member";
import type {
  MemberSelfProfile,
  MemberSelfProfileView,
  SkillView,
} from "@/types/contracts";

/**
 * MemberProfileView —— 个人资料页（自己）
 *
 * 数据来源：
 * - `GET /api/v1/member/profile` —— 完整的自我可见资料（含 QQ / 学号 / 班级）
 * - `GET /api/v1/skills` —— 供技能选择器使用的启用技能
 *
 * 「查看」与「编辑」分离：只读字段（实名/学号/班级/QQ/加入时间/角色）用 `<dl>` 呈现，
 * 只有昵称与技能可编辑。QQ 旁标注「内部可见」，如实告知可见性边界。
 */

export type MemberProfileViewProps = {
  initialDisplayName: string;
};

export function MemberProfileView({ initialDisplayName }: MemberProfileViewProps) {
  const copy = memberCopy.profile;
  const [view, setView] = useState<MemberSelfProfileView | null>(null);
  const [availableSkills, setAvailableSkills] = useState<SkillView[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      // 技能列表是辅助数据：它失败不该让整页失败，因此单独 catch。
      const [profileResponse, skillsResponse] = await Promise.all([
        fetch("/api/v1/member/profile", { cache: "no-store" }),
        fetch("/api/v1/skills", { cache: "no-store" }).catch(() => null),
      ]);

      const profileJson = await profileResponse.json();
      if (!profileJson.success) throw new Error(profileJson?.error?.code ?? "PROFILE_FAILED");
      setView(profileJson.data as MemberSelfProfileView);

      if (skillsResponse) {
        const skillsJson = await skillsResponse.json();
        setAvailableSkills(skillsJson.success ? (skillsJson.data as SkillView[]) : []);
      } else {
        setAvailableSkills([]);
      }
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function applyProfile(next: MemberSelfProfile) {
    setView((current) => (current ? { ...current, profile: next } : current));
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
    { label: copy.fieldRealName, value: profile.realName, muted: !profile.realName },
    { label: copy.fieldStudentId, value: profile.studentId, muted: !profile.studentId },
    { label: copy.fieldClassName, value: profile.className, muted: !profile.className },
    {
      label: copy.fieldQq,
      value: profile.qq,
      muted: !profile.qq,
      // QQ 只在这里与内部主页出现；明确标注可见范围，避免用户误以为完全私密。
      visibilityTag: memberCopy.common.internalOnly,
    },
    { label: copy.fieldJoinedAt, value: joinedAtLabel(profile.joinedAt), muted: !profile.joinedAt },
    { label: copy.fieldRoles, value: roleLabels(profile.roles), muted: !profile.roles.length },
    { label: copy.fieldStatus, value: profile.status },
  ];

  return (
    <div className="member-workspace__content">
      <header className="member-hero">
        <div className="member-hero__identity">
          <MemberAvatar displayName={profile.displayName || initialDisplayName} avatarUrl={profile.avatarUrl} size="lg" />
          <div className="member-hero__text">
            <h1 className="member-hero__name" id="member-profile-title">
              {profile.displayName || initialDisplayName}
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

      <section aria-labelledby="member-identity-title">
        <MemberSection
          id="member-identity-title"
          title={copy.identityTitle}
          tag={copy.identityTag}
          note={copy.readonlyNote}
        >
          <MemberIdentityFields fields={identityFields} />
        </MemberSection>
      </section>

      <section aria-labelledby="member-profile-edit-title">
        <h2 className="sr-only" id="member-profile-edit-title">
          {copy.title}
        </h2>
        <MemberProfileEditor
          profile={profile}
          availableSkills={availableSkills}
          onProfileChange={applyProfile}
        />
      </section>

      <section aria-labelledby="member-profile-metrics-title">
        <MemberSection id="member-profile-metrics-title" title={copy.metricsTitle} tag={copy.metricsTag}>
          <MemberMetrics summary={repairSummary} />
        </MemberSection>
      </section>

      <section aria-labelledby="member-profile-recent-title">
        <MemberSection id="member-profile-recent-title" title={copy.recentTitle} tag={copy.recentTag}>
          <MemberRecentRepairs items={recentRepairs} moreHref="/member/repairs" />
        </MemberSection>
      </section>
    </div>
  );
}
