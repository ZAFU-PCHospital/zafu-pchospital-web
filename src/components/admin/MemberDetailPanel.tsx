"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { MemberCategoryDistribution } from "@/components/analytics/MemberCategoryDistribution";
import { AdminModal } from "@/components/admin/AdminModal";
import { AdminToast } from "@/components/admin/AdminToast";
import type { AdminToastMessage, AdminToastTone } from "@/components/admin/AdminToast";
import { MemberIdentityFields } from "@/components/member/MemberIdentityFields";
import { MemberMetrics } from "@/components/member/MemberMetrics";
import { Button } from "@/components/ui/Button";
import { TagPicker } from "@/components/ui/TagPicker";
import { adminCopy, adminShared, memberRoleLabels, memberStatusLabels } from "@/config/admin";
import { adminFetch, firstFieldError } from "@/features/admin/admin-client";
import type {
  MemberAnalytics,
  MemberDetail,
  MemberListEntry,
  MemberMutationResult,
  MemberView,
  RoleCode,
  SkillView,
  UpdateMemberSkillsResult,
} from "@/types/contracts";

/**
 * 成员详情窗口（M6 §63「编辑成员 / 重置密码 / 设置角色 / 设置技能标签 / 查看成员统计」）。
 *
 * 这里把管理端成员操作集中在一个窗口里，因为它们共享同一份「当前成员 + 版本号」状态：
 * 编辑与技能都用乐观锁（`version` / `profileVersion`），任何一次成功写入后必须重新拉取，
 * 否则第二次提交一定撞版本冲突。
 *
 * 窗口本身由 `AdminModal` 提供：详情有两三屏高，早先内联在表格下方时用户根本看不到。
 */
export function MemberDetailPanel({
  memberId,
  onClose,
  onChanged,
}: {
  memberId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const copy = adminCopy.members;
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [skills, setSkills] = useState<SkillView[]>([]);
  const [stats, setStats] = useState<MemberAnalytics | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [problem, setProblem] = useState("");
  /** 一次性成功反馈：走顶部浮层（层级高于本窗口），不把窗口内容顶下去。 */
  const [toast, setToast] = useState<AdminToastMessage | null>(null);
  const [secret, setSecret] = useState("");

  const load = useCallback(async () => {
    // 只有**首次**打开才切到 `loading`：保存一次之后重新拉数据时窗口不该整块消失再长回来
    // （用户看到的「明显在加载」有一半来自这里 —— 每次写操作后窗口内容都会闪一下）。
    setState((current) => (current === "ready" ? "ready" : "loading"));
    setProblem("");
    const [detailResult, skillsResult, statsResult] = await Promise.all([
      adminFetch<MemberDetail>(`/api/v1/admin/members/${memberId}`),
      adminFetch<SkillView[]>("/api/v1/skills"),
      adminFetch<MemberAnalytics>(`/api/v1/admin/members/${memberId}/stats`),
    ]);
    if (!detailResult.ok) {
      setState("error");
      setProblem(detailResult.message);
      return;
    }
    setDetail(detailResult.data);
    setSkills(skillsResult.ok ? skillsResult.data : []);
    setStats(statsResult.ok ? statsResult.data : null);
    setState("ready");
  }, [memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 详情页里的每个写操作都以「重新加载」收尾，保证乐观锁版本号是最新的。 */
  async function mutate(
    run: () => Promise<{ ok: boolean; message?: string }>,
    successText: string,
    tone: AdminToastTone = "success",
  ) {
    setToast(null);
    setProblem("");
    const result = await run();
    if (!result.ok) {
      setProblem(result.message ?? adminShared.loadFailed);
      return;
    }
    setToast({ text: successText, tone });
    await load();
    onChanged();
  }

  return (
    <AdminModal
      title={copy.detail.title}
      subtitle={
        detail
          ? `${detail.realName}${detail.nickname ? `（${detail.nickname}）` : ""} · ${memberStatusLabels[detail.status]}`
          : undefined
      }
      onClose={onClose}
    >
      {state === "loading" ? (
        // 骨架而不是一行「正在加载…」：打开窗口时结构先立住，数据填进来时不再整块替换。
        <div className="admin-skeleton" aria-busy="true">
          <p className="sr-only" role="status">
            {adminShared.loading}
          </p>
          <span className="admin-skeleton__title" />
          <span className="admin-skeleton__line" />
          <span className="admin-skeleton__block" />
        </div>
      ) : null}

      <AdminToast toast={toast} onDismiss={() => setToast(null)} />

      {state === "error" ? (
        <>
          <p className="admin-status admin-status--error" role="alert">
            {problem || adminShared.loadFailed}
          </p>
          <div className="signup__actions">
            <Button onClick={() => void load()}>{adminShared.reload}</Button>
          </div>
        </>
      ) : null}

      {state === "ready" && detail ? (
        <>
          {problem ? (
            <p className="admin-status admin-status--error" role="alert">
              {problem}
            </p>
          ) : null}

          <div className="admin-modal__facts">
            {/* 联系方式用 `MemberIdentityFields`（`<dl>` 只读字段表）而不是 Readout：
                Readout 是首页那种等宽大写读数面板，不适合放联系方式；
                而这个组件正是 M3 用来展示「管理员维护、成员不可自助修改」字段的既有原语，
                还能带上「仅内部可见」的可见性标记。 */}
            <MemberIdentityFields
              fields={[
                { label: "QQ", value: detail.qq, visibilityTag: "仅内部可见" },
                { label: "手机号", value: detail.phone, visibilityTag: "仅内部可见" },
                { label: "学号", value: detail.studentId, muted: !detail.studentId },
                { label: "班级", value: detail.className, muted: !detail.className },
              ]}
            />
            <p className="admin-note">{copy.detail.contactsNote}</p>
          </div>

          {stats ? (
            <div className="admin-stats">
              {/* 复用 M3/M5 的指标卡与分布表：UNCONFIGURED（学期未配置）等口径由它们统一处理，
                  后台不重新解释 MetricValue，避免出现「伪造 0 次」这类口径漂移。 */}
              <MemberMetrics summary={stats.summary} />
              <MemberCategoryDistribution items={stats.categoryDistribution} />
            </div>
          ) : (
            <p className="admin-note">{copy.detail.statsUnavailable}</p>
          )}

          <EditMemberForm detail={detail} onSave={mutate} />
          <RolesForm detail={detail} onSave={mutate} />
          <SkillsForm detail={detail} skills={skills} onSave={mutate} />

          <div className="signup__actions">
            <Button
              icon="check"
              onClick={() =>
                void mutate(async () => {
                  const result = await adminFetch<MemberMutationResult>(
                    `/api/v1/admin/members/${memberId}/password-reset`,
                    { method: "POST" },
                  );
                  if (!result.ok) return { ok: false, message: result.message };
                  setSecret(result.data.initializationSecret ?? "");
                  return { ok: true };
                }, adminCopy.members.resetResult.toast)
              }
            >
              {copy.action.resetPassword}
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                void mutate(async () => {
                  const path = detail.status === "ACTIVE" ? "disable" : "enable";
                  const result = await adminFetch<MemberView>(
                    `/api/v1/admin/members/${memberId}/${path}`,
                    { method: "POST" },
                  );
                  return result.ok ? { ok: true } : { ok: false, message: result.message };
                },
                detail.status === "ACTIVE" ? copy.edit.disabled : copy.edit.enabled,
                detail.status === "ACTIVE" ? "neutral" : "success",
              )
              }
            >
              {detail.status === "ACTIVE" ? copy.action.disable : copy.action.enable}
            </Button>
          </div>

          {secret ? (
            <div role="status" aria-live="polite">
              <p className="admin-status">{copy.resetResult.title}</p>
              <p className="admin-status">
                <code>{secret}</code>
              </p>
              <p className="admin-note">{copy.resetResult.note}</p>
            </div>
          ) : null}
        </>
      ) : null}
    </AdminModal>
  );
}

type Mutate = (
  run: () => Promise<{ ok: boolean; message?: string }>,
  successText: string,
) => Promise<void>;

function EditMemberForm({ detail, onSave }: { detail: MemberDetail; onSave: Mutate }) {
  const copy = adminCopy.members.edit;
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    await onSave(async () => {
      const result = await adminFetch<MemberView>(`/api/v1/admin/members/${detail.id}`, {
        method: "PATCH",
        body: {
          realName: data.realName ?? "",
          studentId: data.studentId ?? "",
          className: data.className ?? "",
          nickname: data.nickname ?? "",
          version: detail.version,
        },
      });
      return result.ok
        ? { ok: true }
        : { ok: false, message: firstFieldError(result.fieldErrors) ?? result.message };
    }, copy.saved);
    setBusy(false);
  }

  return (
    <form method="post" className="admin-form" onSubmit={submit} aria-label={copy.title}>
      <h4 className="admin-panel__title">{copy.title}</h4>
      <div className="admin-form__grid">
        <label className="field">
          <span className="field__label">姓名</span>
          <input
            className="field__input"
            name="realName"
            required
            minLength={2}
            maxLength={64}
            defaultValue={detail.realName}
          />
        </label>
        <label className="field">
          <span className="field__label">学号</span>
          <input
            className="field__input"
            name="studentId"
            maxLength={32}
            defaultValue={detail.studentId ?? ""}
          />
        </label>
        <label className="field">
          <span className="field__label">班级</span>
          <input
            className="field__input"
            name="className"
            maxLength={80}
            defaultValue={detail.className ?? ""}
          />
        </label>
        <label className="field">
          <span className="field__label">昵称</span>
          <input
            className="field__input"
            name="nickname"
            maxLength={64}
            defaultValue={detail.nickname ?? ""}
          />
        </label>
      </div>
      <div className="signup__actions">
        <Button type="submit" disabled={busy}>
          {busy ? adminShared.submitting : copy.submit}
        </Button>
      </div>
    </form>
  );
}

function RolesForm({ detail, onSave }: { detail: MemberDetail; onSave: Mutate }) {
  const copy = adminCopy.members.roles;
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const data = new FormData(event.currentTarget);
    const roles = (["MEMBER", "ADMIN"] as const).filter((role) => data.get(role) === "on");
    await onSave(async () => {
      const result = await adminFetch<MemberListEntry>(`/api/v1/admin/members/${detail.id}/roles`, {
        method: "PUT",
        body: { roles },
      });
      return result.ok ? { ok: true } : { ok: false, message: result.message };
    }, copy.saved);
    setBusy(false);
  }

  return (
    <form method="post" className="admin-form" onSubmit={submit} aria-label={copy.title}>
      <h4 className="admin-panel__title">{copy.title}</h4>
      <div className="repair-filters__checks">
        {(["MEMBER", "ADMIN"] as RoleCode[]).map((role) => (
          <label key={role}>
            <input
              className="admin-check"
              type="checkbox"
              name={role}
              defaultChecked={detail.roles.includes(role)}
            />
            {memberRoleLabels[role]}
          </label>
        ))}
      </div>
      <p className="admin-note">{copy.hint}</p>
      <div className="signup__actions">
        <Button type="submit" disabled={busy}>
          {busy ? adminShared.submitting : copy.submit}
        </Button>
      </div>
    </form>
  );
}

function SkillsForm({
  detail,
  skills,
  onSave,
}: {
  detail: MemberDetail;
  skills: SkillView[];
  onSave: Mutate;
}) {
  const copy = adminCopy.members.skills;
  const [busy, setBusy] = useState(false);
  /**
   * 受控选择：原先是 `defaultChecked` + `FormData`，改一个标签要先把整张表读一遍
   * 才看得出选了什么。现在选择状态就在组件里，`TagPicker` 上下两处都能即时反映。
   */
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    detail.skills.map((skill) => skill.id),
  );

  // 详情重新加载（保存后）会带回新的 `version` 与技能集合，选择状态必须跟着走，
  // 否则第二次提交会拿旧集合去撞乐观锁。
  useEffect(() => {
    setSelectedIds(detail.skills.map((skill) => skill.id));
  }, [detail]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    await onSave(async () => {
      const result = await adminFetch<UpdateMemberSkillsResult>(
        `/api/v1/admin/members/${detail.id}/skills`,
        { method: "PUT", body: { skillIds: selectedIds, profileVersion: detail.version } },
      );
      return result.ok
        ? { ok: true }
        : { ok: false, message: firstFieldError(result.fieldErrors) ?? result.message };
    }, copy.saved);
    setBusy(false);
  }

  return (
    <form method="post" className="admin-form" onSubmit={submit} aria-label={copy.title}>
      <h4 className="admin-panel__title">{copy.title}</h4>
      <TagPicker
        options={skills}
        selectedIds={selectedIds}
        onChange={setSelectedIds}
        disabled={busy}
        labels={{
          empty: copy.empty,
          remaining: copy.remaining,
          remove: copy.remove,
          inactive: copy.inactive,
          limitReached: copy.limitReached,
        }}
      />
      <div className="signup__actions">
        <Button type="submit" variant="solid" disabled={busy}>
          {busy ? adminShared.submitting : copy.submit}
        </Button>
      </div>
    </form>
  );
}
