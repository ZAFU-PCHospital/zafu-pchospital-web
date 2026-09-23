"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { memberCopy } from "@/config/member";
import { TagPicker } from "@/components/ui/TagPicker";
import { mergeSkillOptions } from "@/features/skills/skill-options";
import {
  MEMBER_NICKNAME_MAX_LENGTH,
  MEMBER_SKILL_LIMIT,
  type MemberSelfProfile,
  type SkillView,
} from "@/types/contracts";

/**
 * MemberProfileEditor —— 昵称 + 技能标签编辑
 *
 * 两个字段走两个接口，乐观锁版本号各不相同：
 * - `PATCH /member/profile` 用 `profile.version` 更新昵称；
 * - `PUT /member/profile/skills` 用 `profileVersion` 更新技能关联。
 *
 * 关键点：
 * 1. 每次成功保存都必须用响应里的新 `version` 覆盖本地值，否则第二次保存必然 409。
 * 2. 409（版本冲突）与普通失败要给**不同**提示：冲突时引导刷新，而不是让用户重试。
 * 3. 昵称前端只做「长度 + 空白」这样的廉价校验，真实规则以服务端为准；
 *    服务端的 `fieldErrors` 一律原样展示。
 */

export type MemberProfileEditorProps = {
  profile: MemberSelfProfile;
  /** 服务端已确认的启用技能列表 */
  availableSkills: SkillView[];
  /** 保存成功后把最新资料回传给父级，保持只读视图同步 */
  onProfileChange: (profile: MemberSelfProfile) => void;
};

type Status = { kind: "idle" | "saving" | "saved" | "error" | "conflict"; message?: string };

export function MemberProfileEditor({
  profile,
  availableSkills,
  onProfileChange,
}: MemberProfileEditorProps) {
  const copy = memberCopy.profile;
  const [nickname, setNickname] = useState(profile.nickname ?? "");
  const [version, setVersion] = useState(profile.version);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>(() =>
    profile.skills.map((skill) => skill.id),
  );
  const [skillVersion, setSkillVersion] = useState(profile.version);
  const skillOptions = useMemo(
    () => mergeSkillOptions(availableSkills, profile.skills),
    [availableSkills, profile.skills],
  );

  // 父级刷新资料后同步本地草稿（例如用户点了「取消」重新载入）
  useEffect(() => {
    setNickname(profile.nickname ?? "");
    setVersion(profile.version);
    setSelectedSkillIds(profile.skills.map((skill) => skill.id));
    setSkillVersion(profile.version);
  }, [profile]);

  const [nicknameStatus, setNicknameStatus] = useState<Status>({ kind: "idle" });
  const [skillsStatus, setSkillsStatus] = useState<Status>({ kind: "idle" });

  const nicknameDirty = nickname !== (profile.nickname ?? "");
  const skillsDirty = useMemo(() => {
    const current = [...profile.skills.map((skill) => skill.id)].sort();
    const next = [...selectedSkillIds].sort();
    return current.length !== next.length || current.some((id, index) => id !== next[index]);
  }, [profile.skills, selectedSkillIds]);

  const saveNickname = useCallback(async () => {
    const trimmed = nickname.trim();
    if (trimmed.length > MEMBER_NICKNAME_MAX_LENGTH) {
      setNicknameStatus({ kind: "error", message: copy.invalidNickname });
      return;
    }

    setNicknameStatus({ kind: "saving" });
    try {
      const response = await fetch("/api/v1/member/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ nickname: trimmed === "" ? null : trimmed, version }),
      });
      const json = await response.json();

      if (!json.success) {
        setNicknameStatus(describeFailure(json, copy.conflict, copy.saveFailed));
        return;
      }

      const next = json.data.profile as MemberSelfProfile;
      setVersion(json.data.version);
      setSkillVersion(json.data.version);
      onProfileChange(next);
      setNicknameStatus({ kind: "saved", message: copy.saved });
    } catch {
      setNicknameStatus({ kind: "error", message: copy.saveFailed });
    }
  }, [
    copy.conflict,
    copy.invalidNickname,
    copy.saveFailed,
    copy.saved,
    nickname,
    onProfileChange,
    version,
  ]);

  const saveSkills = useCallback(async () => {
    if (selectedSkillIds.length > MEMBER_SKILL_LIMIT) {
      setSkillsStatus({
        kind: "error",
        message: copy.skillsLimitReached.replace("{limit}", String(MEMBER_SKILL_LIMIT)),
      });
      return;
    }

    setSkillsStatus({ kind: "saving" });
    try {
      const response = await fetch("/api/v1/member/profile/skills", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ skillIds: selectedSkillIds, profileVersion: skillVersion }),
      });
      const json = await response.json();

      if (!json.success) {
        setSkillsStatus(describeFailure(json, copy.conflict, copy.saveFailed));
        return;
      }

      setSkillVersion(json.data.version);
      setVersion(json.data.version);
      // 保存接口返回的是技能视图，不是完整资料；这里把它并入资料后回传父级。
      onProfileChange({
        ...profile,
        skills: json.data.skills as SkillView[],
        version: json.data.version,
      });
      setSkillsStatus({ kind: "saved", message: copy.skillsSaved });
    } catch {
      setSkillsStatus({ kind: "error", message: copy.saveFailed });
    }
  }, [
    copy.conflict,
    copy.saveFailed,
    copy.skillsLimitReached,
    copy.skillsSaved,
    onProfileChange,
    profile,
    selectedSkillIds,
    skillVersion,
  ]);

  const nicknameHint = copy.nicknameHint.replace("{max}", String(MEMBER_NICKNAME_MAX_LENGTH));
  const skillsLead = copy.skillsLead.replace("{limit}", String(MEMBER_SKILL_LIMIT));

  return (
    <>
      <div className="member-section">
        <header className="member-section__head">
          <h2 className="member-section__title" id="member-nickname-title">
            {copy.nicknameLabel}
          </h2>
          <span className="member-section__tag">Nickname</span>
        </header>
        <form
          className="member-form"
          aria-labelledby="member-nickname-title"
          onSubmit={(event) => {
            event.preventDefault();
            void saveNickname();
          }}
        >
          <label className="field">
            <span className="field__label">{copy.nicknameLabel}</span>
            <input
              className="field__input"
              value={nickname}
              maxLength={MEMBER_NICKNAME_MAX_LENGTH}
              placeholder={copy.nicknamePlaceholder}
              onChange={(event) => {
                setNickname(event.target.value);
                setNicknameStatus({ kind: "idle" });
              }}
            />
            <span className="member-section__note">{nicknameHint}</span>
          </label>
          <div className="member-form__actions">
            <Button
              type="submit"
              variant="solid"
              disabled={nicknameStatus.kind === "saving" || !nicknameDirty}
            >
              {nicknameStatus.kind === "saving" ? memberCopy.common.saving : memberCopy.common.save}
            </Button>
            {nicknameDirty ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setNickname(profile.nickname ?? "");
                  setNicknameStatus({ kind: "idle" });
                }}
              >
                {memberCopy.common.cancel}
              </Button>
            ) : null}
          </div>
          <StatusLine status={nicknameStatus} />
        </form>
      </div>

      <div className="member-section">
        <header className="member-section__head">
          <h2 className="member-section__title" id="member-skills-editor-title">
            {copy.skillsTitle}
          </h2>
          <span className="member-section__tag">{copy.skillsTag}</span>
        </header>
        <p className="member-section__note">{skillsLead}</p>
        <TagPicker
          options={skillOptions}
          selectedIds={selectedSkillIds}
          limit={MEMBER_SKILL_LIMIT}
          disabled={skillsStatus.kind === "saving"}
          labels={{
            empty: copy.skillsEmpty,
            remaining: copy.skillsRemaining,
            remove: copy.skillsRemove,
            inactive: copy.skillInactiveSelected,
            limitReached: copy.skillsLimitReached,
          }}
          onChange={(next) => {
            setSelectedSkillIds(next);
            setSkillsStatus({ kind: "idle" });
          }}
        />
        <div className="member-form__actions">
          <Button
            variant="solid"
            disabled={skillsStatus.kind === "saving" || !skillsDirty}
            onClick={() => void saveSkills()}
          >
            {skillsStatus.kind === "saving" ? memberCopy.common.saving : memberCopy.common.save}
          </Button>
          {skillsDirty ? (
            <Button
              variant="ghost"
              onClick={() => {
                setSelectedSkillIds(profile.skills.map((skill) => skill.id));
                setSkillsStatus({ kind: "idle" });
              }}
            >
              {memberCopy.common.cancel}
            </Button>
          ) : null}
        </div>
        <StatusLine status={skillsStatus} />
      </div>
    </>
  );
}

/** 把失败响应翻译成展示状态：版本冲突单列，其余按普通失败处理。 */
function describeFailure(
  json: { error?: { code?: string; message?: string; fieldErrors?: unknown } },
  conflictLabel: string,
  fallbackLabel: string,
): Status {
  // 服务端乐观锁冲突的唯一错误码，见 `src/lib/api/errors.ts`。
  if (json.error?.code === "MEMBER_PROFILE_VERSION_CONFLICT") {
    return { kind: "conflict", message: conflictLabel };
  }
  // 服务端逐字段错误优先（例如昵称含控制字符），否则用服务端 message，最后才兜底。
  const fieldErrors = json.error?.fieldErrors as Record<string, string[]> | undefined;
  const firstField = fieldErrors ? Object.values(fieldErrors)[0]?.[0] : undefined;
  return { kind: "error", message: firstField ?? json.error?.message ?? fallbackLabel };
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === "idle" || !status.message) return null;
  return (
    <p
      className={`member-form__status${status.kind === "error" || status.kind === "conflict" ? "member-form__status--error" : ""}`}
      role={status.kind === "error" || status.kind === "conflict" ? "alert" : "status"}
      aria-live="polite"
    >
      {status.message}
    </p>
  );
}
