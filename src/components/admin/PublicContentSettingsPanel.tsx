"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AdminToast } from "@/components/admin/AdminToast";
import type { AdminToastMessage } from "@/components/admin/AdminToast";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { adminCopy, adminShared } from "@/config/admin";
import { adminFetch } from "@/features/admin/admin-client";
import { RankingDisplayNameMode } from "@/types/contracts";
import type {
  PublicContentSettings,
  RankingDisplayNameMode as RankingMode,
} from "@/types/contracts";

/** 表单草稿：四项一起提交（契约是整体替换语义，不是字段补丁）。 */
type SettingsDraft = {
  publicRepairStatsEnabled: boolean;
  publicRepairStatsDetailEnabled: boolean;
  publicRankingsEnabled: boolean;
  rankingDisplayName: RankingMode;
};

/**
 * 公开统计设置（M6 批次 2，需求 §31 / §32 / §74）。
 *
 * 这是**唯一**决定官网对外展示什么的开关集合。三条刻意的设计：
 *
 * 1. 表单是受控的，而不是 `defaultValue` + `FormData`：辅助数据那一项要随主开关实时
 *    禁用/取消勾选，非受控写法做不到「一眼看出它现在不会生效」。
 * 2. 底部有一块「当前对外效果」的直白描述 —— 一排开关看不出最终长什么样，
 *    而这份配置的后果是**对外可见**的，不该让人靠推测。
 * 3. 展示名单独一段并写明需求 §74 的边界（QQ 等私人信息禁止公开），
 *    因为「打开排行榜」和「公开真实姓名」是两件严重程度完全不同的事。
 */
export function PublicContentSettingsPanel() {
  const copy = adminCopy.settings;
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [problem, setProblem] = useState("");
  const [toast, setToast] = useState<AdminToastMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<PublicContentSettings | null>(null);
  const [draft, setDraft] = useState<SettingsDraft>({
    publicRepairStatsEnabled: false,
    publicRepairStatsDetailEnabled: false,
    publicRankingsEnabled: false,
    // 默认取「仅昵称」而不是数组第一项「真实姓名」：没有配置时不该预设公开实名。
    rankingDisplayName: "NICKNAME",
  });

  const load = useCallback(async () => {
    setState((current) => (current === "ready" ? "ready" : "loading"));
    setProblem("");
    const result = await adminFetch<PublicContentSettings>("/api/v1/admin/settings/public-content");
    if (!result.ok) {
      setState("error");
      setProblem(result.message);
      return;
    }
    setSettings(result.data);
    setDraft({
      publicRepairStatsEnabled: result.data.publicRepairStatsEnabled,
      publicRepairStatsDetailEnabled: result.data.publicRepairStatsDetailEnabled,
      publicRankingsEnabled: result.data.publicRankingsEnabled,
      rankingDisplayName: result.data.rankingDisplayName,
    });
    setState("ready");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 排行榜预览里第 index 位的展示名。
   *
   * 三种策略的差异正是这个设置项要表达的东西，所以预览必须**真的换名字**，
   * 而不是只改一句说明文字。`HIDDEN` 用中性文案代替姓名。
   */
  function rankingName(index: number): string {
    if (draft.rankingDisplayName === "HIDDEN") return copy.preview.rankingsHidden;
    return copy.preview.rankingNames[draft.rankingDisplayName][index] ?? "";
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    setToast(null);
    const result = await adminFetch<PublicContentSettings>(
      "/api/v1/admin/settings/public-content",
      { method: "PUT", body: draft },
    );
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setSettings(result.data);
    setDraft({
      publicRepairStatsEnabled: result.data.publicRepairStatsEnabled,
      publicRepairStatsDetailEnabled: result.data.publicRepairStatsDetailEnabled,
      publicRankingsEnabled: result.data.publicRankingsEnabled,
      rankingDisplayName: result.data.rankingDisplayName,
    });
    setToast({ text: copy.saved, tone: "success" });
  }

  return (
    <div className="admin-workspace__content">
      <div className="admin-workspace__header">
        <div>
          <h1 className="admin-workspace__title" id="admin-settings-title">
            {copy.title}
          </h1>
          <p className="admin-workspace__lead">{copy.lead}</p>
        </div>
      </div>

      <AdminToast toast={toast} onDismiss={() => setToast(null)} />

      {problem ? (
        <p className="admin-status admin-status--error" role="alert">
          {problem}
        </p>
      ) : null}

      <p className="admin-note">
        {settings?.updatedAt && settings.updatedBy
          ? copy.updatedAt
              .replace("{time}", formatDateTime(settings.updatedAt))
              .replace("{name}", settings.updatedBy.name)
          : copy.never}
      </p>

      {state === "loading" ? (
        <p className="admin-status" role="status">
          {adminShared.loading}
        </p>
      ) : null}

      {state === "error" ? (
        <Card variant="notice">
          <p>{problem || adminShared.loadFailed}</p>
          <Button onClick={() => void load()}>{adminShared.reload}</Button>
        </Card>
      ) : null}

      {state === "ready" ? (
        <>
          <Card className="admin-panel">
            <form method="post" className="admin-form" onSubmit={submit} aria-label={copy.title}>
              <h2 className="admin-panel__title">{copy.stats.title}</h2>
              <div className="admin-checkrow">
                <label>
                  <input
                    className="admin-check"
                    type="checkbox"
                    checked={draft.publicRepairStatsEnabled}
                    onChange={(event) => {
                      // `event.currentTarget` 只在事件派发期间有效，必须**先取值**再交给
                      // state updater：在 updater 里读它会在 updater 真正执行时变成 null
                      // （浏览器实测抛 `Cannot read properties of null (reading 'checked')`）。
                      const { checked } = event.currentTarget;
                      setDraft((current) => ({
                        ...current,
                        publicRepairStatsEnabled: checked,
                        // 主开关关掉时辅助数据不可能生效，就地跟随，避免留下一个「开着但没用」的项。
                        publicRepairStatsDetailEnabled:
                          current.publicRepairStatsDetailEnabled && checked,
                      }));
                    }}
                  />
                  {copy.stats.enabled}
                </label>
              </div>
              <p className="admin-note">{copy.stats.enabledHint}</p>
              <div className="admin-checkrow">
                <label>
                  <input
                    className="admin-check"
                    type="checkbox"
                    disabled={!draft.publicRepairStatsEnabled}
                    checked={draft.publicRepairStatsDetailEnabled}
                    onChange={(event) => {
                      const { checked } = event.currentTarget;
                      setDraft((current) => ({
                        ...current,
                        publicRepairStatsDetailEnabled: checked,
                      }));
                    }}
                  />
                  {copy.stats.detail}
                </label>
              </div>
              <p className="admin-note">{copy.stats.detailHint}</p>

              <h2 className="admin-panel__title">{copy.rankings.title}</h2>
              <div className="admin-checkrow">
                <label>
                  <input
                    className="admin-check"
                    type="checkbox"
                    checked={draft.publicRankingsEnabled}
                    onChange={(event) => {
                      const { checked } = event.currentTarget;
                      setDraft((current) => ({ ...current, publicRankingsEnabled: checked }));
                    }}
                  />
                  {copy.rankings.enabled}
                </label>
              </div>
              <p className="admin-note">{copy.rankings.enabledHint}</p>

              <h2 className="admin-panel__title">{copy.display.title}</h2>
              <div className="admin-form__grid">
                <label className="field">
                  <span className="field__label">{copy.display.title}</span>
                  <select
                    className="field__input"
                    value={draft.rankingDisplayName}
                    disabled={!draft.publicRankingsEnabled}
                    onChange={(event) => {
                      const { value } = event.currentTarget;
                      setDraft((current) => ({
                        ...current,
                        rankingDisplayName: value as RankingMode,
                      }));
                    }}
                  >
                    {RankingDisplayNameMode.map((mode) => (
                      <option key={mode} value={mode}>
                        {copy.display.modeLabels[mode]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="admin-note">{copy.display.hint}</p>

              <div className="signup__actions">
                <Button type="submit" variant="solid" icon="check" disabled={busy}>
                  {busy ? adminShared.submitting : copy.submit}
                </Button>
              </div>
            </form>
          </Card>

          <Card className="admin-panel">
            <h2 className="admin-panel__title">{copy.preview.title}</h2>
            <p className="admin-note">{copy.preview.note}</p>

            {/* 首页维修数据：直接复用成员工作台的指标卡（大号数字 + 小号单位），
                与官网首页将来的读数面板同一套取值，不需要为预览另造视觉。 */}
            {draft.publicRepairStatsEnabled ? (
              <div className="member-metrics">
                <div className="member-metric">
                  <span className="member-metric__label">{copy.preview.statsTotal}</span>
                  <span className="member-metric__value">
                    {copy.preview.placeholder}
                    <span className="member-metric__unit">{copy.preview.statsTotalUnit}</span>
                  </span>
                </div>
                {draft.publicRepairStatsDetailEnabled ? (
                  <>
                    <div className="member-metric">
                      <span className="member-metric__label">{copy.preview.statsTerm}</span>
                      <span className="member-metric__value">
                        {copy.preview.placeholder}
                        <span className="member-metric__unit">{copy.preview.statsTermUnit}</span>
                      </span>
                    </div>
                    <div className="member-metric">
                      <span className="member-metric__label">{copy.preview.statsDuration}</span>
                      <span className="member-metric__value">
                        {copy.preview.placeholder}
                        <span className="member-metric__unit">
                          {copy.preview.statsDurationUnit}
                        </span>
                      </span>
                    </div>
                  </>
                ) : null}
              </div>
            ) : (
              <p className="admin-status">{copy.preview.statsOff}</p>
            )}

            {draft.publicRankingsEnabled ? (
              <div className="admin-preview">
                <p className="admin-preview__title">{copy.preview.rankingsTitle}</p>
                <ol className="admin-preview__list">
                  {copy.preview.rankingCounts.map((count, index) => (
                    <li className="admin-preview__row" key={count}>
                      <span className="admin-preview__rank">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="admin-preview__name">{rankingName(index)}</span>
                      <span className="admin-preview__count">{count}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <p className="admin-status">{copy.preview.rankingsOff}</p>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}

/** 设置时间精确到分钟即可，不需要秒。 */
function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(iso))
    .replace(/\//g, "-");
}
